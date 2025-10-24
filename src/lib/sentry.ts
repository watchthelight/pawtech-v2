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
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
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
  if (!dsn) return false;
  try {
    const parsed = new URL(dsn);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.username.length > 0 &&
      parsed.pathname.length > 1
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
 * Only activates if SENTRY_DSN is provided in environment
 */
export function initializeSentry() {
  if (!hasValidDsn(env.SENTRY_DSN)) {
    logger.info("Sentry DSN missing or invalid, error tracking disabled");
    return;
  }

  try {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
      release: `pawtropolis-tech@${getVersion()}`,

      // Performance monitoring
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

      // Filter out sensitive data
      beforeSend(event) {
        // Remove token from any error messages or data
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

      // Ignore certain errors
      ignoreErrors: ["DiscordAPIError", "AbortError", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"],

      // Better debugging in development
      debug: env.NODE_ENV === "development",
    });

    sentryEnabled = true;
    logger.info({ environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV }, "Sentry initialized");

    const client = Sentry.getClient();
    client?.on?.("afterSendEvent", (_event, response) => {
      const statusCode =
        typeof response === "object"
          ? (response as { statusCode?: number } | undefined)?.statusCode
          : undefined;
      if (statusCode === 403) {
        // 403 here usually means DSN invalid/unauthorized — silence capture and fall back to local logs only.
        // Sentry config options: https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/
        logger.warn({ statusCode }, "Sentry unauthorized (403); disabling capture");
        sentryEnabled = false;
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
export function captureException(error: Error | unknown, context?: Record<string, unknown>) {
  if (!sentryEnabled) return;

  Sentry.captureException(error, {
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
  if (!sentryEnabled || !Sentry.startSpan) {
    // Sentry not available or tracing disabled - run function directly
    return Promise.resolve(fn());
  }

  try {
    // Use Sentry v8+ startSpan API
    return await Sentry.startSpan({ name }, fn);
  } catch (err) {
    // Span creation failed - log and run function anyway
    logger.debug({ err, spanName: name }, "Sentry span failed, continuing without tracing");
    return Promise.resolve(fn());
  }
}

// Export Sentry for advanced usage
export { Sentry };
