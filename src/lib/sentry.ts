/**
 * Pawtropolis Tech — src/lib/sentry.ts
 * WHAT: Sentry bootstrap and small helpers for capture/contexts.
 * WHY: Centralizes error tracking with safe shutdown and guardrails when DSN is invalid.
 * Sentry: watching our code fail in real-time since 2025
 * FLOWS: initializeSentry() → isSentryEnabled → captureException/Message → flushSentry on shutdown
 * DOCS:
 *  - Sentry Node SDK: https://docs.sentry.io/platforms/javascript/guides/node/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2026 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import {
  consoleIntegration,
  httpIntegration,
  onUncaughtExceptionIntegration,
  onUnhandledRejectionIntegration,
} from "@sentry/node";
import { env } from "./env.js";
import { logger } from "./logger.js";
import fs from "node:fs";
import path from "node:path";

let sentryEnabled = false;

function hasValidDsn(dsn: string | undefined): dsn is string {
  // Sentry DSN format: https://{key}@{org}.ingest.sentry.io/{project}
  // We validate structure rather than content because:
  // 1. Avoids making network requests to validate
  // 2. Catches typos/misconfigurations early
  // 3. The 403 handler below catches invalid keys at runtime
  if (!dsn) return false;
  try {
    const parsed = new URL(dsn);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.username.length > 0 && // This is the Sentry key
      parsed.pathname.length > 1 // Project ID in path
    );
  } catch {
    return false;
  }
}

// Get version from package.json for release tracking
function getVersion(): string {
  try {
    const packagePath = path.join(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    return packageJson.version || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Initialize Sentry error tracking
 * Only activates if SENTRY_DSN is provided in environment and not running tests
 */
export function initializeSentry() {
  const isVitest = !!process.env.VITEST_WORKER_ID;

  if (isVitest) {
    // Skip Sentry during tests to reduce noise
    return;
  }

  if (!hasValidDsn(env.SENTRY_DSN)) {
    logger.info("Sentry DSN missing or invalid, error tracking disabled");
    return;
  }

  try {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
      release: `pawtropolis-tech@${getVersion()}`,

      // Performance monitoring - using same rate for traces and profiles means
      // every traced transaction also gets profiled. Tune these independently
      // if profiling overhead becomes noticeable or you need different sampling.
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      profilesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,

      integrations: [
        // Profiling integration
        nodeProfilingIntegration(),

        // Capture console logs in breadcrumbs
        consoleIntegration({
          levels: ["error", "warn"],
        }),

        // HTTP request tracking
        httpIntegration(),

        // OnUncaughtException - let app handle gracefully
        onUncaughtExceptionIntegration({
          onFatalError: async (err: Error) => {
            logger.fatal({ err }, "Uncaught exception detected by Sentry");
            // Allow existing handlers to run
            process.exit(1);
          },
        }),

        // OnUnhandledRejection
        onUnhandledRejectionIntegration({
          mode: "warn",
        }),
      ],

      // Filter out sensitive data before it leaves the server
      beforeSend(event) {
        // Discord bot token regex: {bot_id}.{timestamp}.{hmac}
        // This pattern matches the standard Discord token format.
        // Critical: tokens in error messages would be a security nightmare.
        if (event.message) {
          event.message = event.message.replace(
            /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g,
            "[REDACTED_TOKEN]"
          );
        }

        // Scrub environment variables
        if (event.contexts?.runtime?.env) {
          const env = event.contexts.runtime.env as Record<string, unknown>;
          if (env.DISCORD_TOKEN) env.DISCORD_TOKEN = "[REDACTED]";
          if (env.SENTRY_DSN) env.SENTRY_DSN = "[REDACTED]";
        }

        return event;
      },

      // Ignore transient network errors that aren't actionable.
      // Discord API errors are logged separately with more context.
      // These would just create noise in Sentry without helping debug anything.
      ignoreErrors: ["DiscordAPIError", "AbortError", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"],

      // Better debugging in development
      debug: env.NODE_ENV === "development",
    });

    sentryEnabled = true;
    logger.info({ environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV }, "Sentry initialized");

    // Runtime DSN validation: if Sentry rejects our events with 403, disable
    // further capture. This handles stale/revoked DSNs gracefully.
    const client = Sentry.getClient();
    client?.on?.("afterSendEvent", (_event, response) => {
      const statusCode =
        typeof response === "object"
          ? (response as { statusCode?: number } | undefined)?.statusCode
          : undefined;
      if (statusCode === 403) {
        // 403 = unauthorized. Don't spam Sentry with requests they'll reject.
        logger.warn({ statusCode }, "Sentry unauthorized (403); disabling capture");
        sentryEnabled = false;
        // Close with timeout=0 to avoid blocking. Swallow rejection since we're
        // already in error recovery mode.
        const closeResult = client.close?.(0);
        if (closeResult && typeof (closeResult as PromiseLike<unknown>).then === "function") {
          (closeResult as PromiseLike<unknown>).then(undefined, () => undefined);
        }
      }
    });
  } catch (err) {
    logger.error({ err }, "Failed to initialize Sentry");
    sentryEnabled = false;
  }
}

/**
 * Check if Sentry is enabled
 */
export function isSentryEnabled(): boolean {
  return sentryEnabled;
}

/**
 * Capture an exception in Sentry
 */
export function captureException(error: Error | unknown, context?: Record<string, unknown>): string | null {
  if (!sentryEnabled) return null;

  return Sentry.captureException(error, {
    contexts: context ? { custom: context } : undefined,
  });
}

/**
 * Capture a message in Sentry
 */
export function captureMessage(message: string, level: Sentry.SeverityLevel = "info") {
  if (!sentryEnabled) return;

  Sentry.captureMessage(message, level);
}

/**
 * Add breadcrumb for debugging context
 */
export function addBreadcrumb(breadcrumb: {
  message: string;
  category?: string;
  level?: Sentry.SeverityLevel;
  data?: Record<string, unknown>;
}) {
  if (!sentryEnabled) return;

  Sentry.addBreadcrumb(breadcrumb);
}

/**
 * Set user context for error tracking
 */
export function setUser(user: { id: string; username?: string; [key: string]: unknown }) {
  if (!sentryEnabled) return;

  Sentry.setUser(user);
}

/**
 * Clear user context
 */
export function clearUser() {
  if (!sentryEnabled) return;

  Sentry.setUser(null);
}

/**
 * Set tags for filtering errors
 */
export function setTag(key: string, value: string) {
  if (!sentryEnabled) return;

  Sentry.setTag(key, value);
}

/**
 * Set context for additional debugging info
 */
export function setContext(name: string, context: Record<string, unknown>) {
  if (!sentryEnabled) return;

  Sentry.setContext(name, context);
}

/**
 * Flush any pending events (use before shutdown)
 */
export async function flushSentry(timeout = 2000): Promise<boolean> {
  if (!sentryEnabled) return true;

  try {
    return await Sentry.close(timeout);
  } catch (err) {
    logger.error({ err }, "Failed to flush Sentry events");
    return false;
  }
}

/**
 * WHAT: Graceful span wrapper that falls back if Sentry tracing isn't available.
 * WHY: Never block user flows on telemetry; always execute core logic.
 * USAGE: await inSpan("operation.name", async () => { ... })
 */
export async function inSpan<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  // Defensive wrapper: telemetry failures should never break user-facing features.
  // If Sentry is misconfigured or unavailable, just run the function normally.
  if (!sentryEnabled || !Sentry.startSpan) {
    return Promise.resolve(fn());
  }

  try {
    // Sentry v8+ startSpan API handles span lifecycle automatically
    return await Sentry.startSpan({ name }, fn);
  } catch (err) {
    // Span creation failed - this shouldn't happen, but if it does, log once
    // at debug level (not error) to avoid log spam, then continue.
    logger.debug({ err, spanName: name }, "Sentry span failed, continuing without tracing");
    return Promise.resolve(fn());
  }
}

// Export Sentry for advanced usage
export { Sentry };
