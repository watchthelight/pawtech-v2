/**
 * Pawtropolis Tech — src/lib/logger.ts
 * WHAT: Pino logger with light redaction and Sentry capture on error-level logs.
 * WHY: Centralizes structured logging to keep other modules clean.
 * logger.info("help")
 * FLOWS: create logger → redact helpers → hook to captureException on error logs
 * DOCS:
 *  - Sentry Node SDK: https://docs.sentry.io/platforms/javascript/guides/node/
 *  - Node ESM: https://nodejs.org/api/esm.html
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtech-v2
 */
import pino from "pino";

/**
 * Redaction patterns for common secrets that might leak into logs.
 *
 * Token pattern: Discord bot tokens are 3 base64-ish segments separated by dots.
 * DSN pattern: Sentry DSNs embed auth tokens in URLs. We keep the host, redact the secret.
 * Mention pattern: @everyone/@here shouldn't appear in logs - usually means something
 *                  user-controlled leaked through and could cause accidents if logged raw.
 */
const tokenRe = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;
const dsnRe = /(https?:\/\/)([^:@]+):[^@]+@/gi;
const mentionRe = /@(everyone|here)/gi;

// Sentry import warning flag - only warn once per process, not on every error
let sentryImportWarned = false;

/**
 * Sanitizes strings before logging. Use on any user-controlled or external data.
 * Truncates at 300 chars to prevent log flooding from malicious payloads.
 */
export function redact(value: string): string {
  if (!value) return "";
  let sanitized = value.replace(/\s+/g, " ").trim();
  sanitized = sanitized.replace(tokenRe, "[redacted_token]");
  sanitized = sanitized.replace(dsnRe, "$1$2:[redacted]@");
  sanitized = sanitized.replace(mentionRe, "@redacted");
  if (sanitized.length > 300) {
    sanitized = `${sanitized.slice(0, 300)}...`;
  }
  return sanitized;
}

/**
 * Log level defaults to "info" but can be overridden via LOG_LEVEL env var.
 * Set to "debug" for verbose output, "warn" for quieter production logs.
 *
 * Pretty printing enabled for: test runs (always) and TTY dev environments
 * (when LOG_PRETTY=true). Production should use JSON format for log aggregators.
 */
const logLevel = process.env.LOG_LEVEL ?? "info";
const isVitest = !!process.env.VITEST_WORKER_ID;
const wantPretty =
  isVitest || (process.env.LOG_PRETTY === "true" && process.stdout.isTTY);

const MAX_LOG_SIZE = parseInt(process.env.MAX_LOG_SIZE_MB ?? "100", 10) * 1024 * 1024;
const MAX_LOG_FILES = parseInt(process.env.MAX_LOG_FILES ?? "5", 10);

export const logger = pino({
  level: logLevel,
  // Conditional pretty-printing. When disabled, outputs newline-delimited JSON
  // which is what log aggregators (Datadog, Loki, etc.) expect.
  ...(wantPretty
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname", // Drop noise - PID and hostname rarely useful in Discord bot logs
            singleLine: false,
          },
        },
      }
    : process.env.LOG_FILE
      ? {
          transport: {
            target: "pino/file",
            options: {
              destination: process.env.LOG_FILE,
              maxSize: MAX_LOG_SIZE,
              maxFiles: MAX_LOG_FILES,
            },
          },
        }
      : {}),
  base: undefined, // Omit pid/hostname from JSON output too
  // Custom error serializer extracts only the useful fields, avoiding
  // circular refs or huge stack traces from discord.js errors
  serializers: {
    err: (e: any) => ({
      name: e?.name,
      code: e?.code,
      message: e?.message,
      stack: e?.stack,
    }),
  },
  /**
   * Pino hook that intercepts error-level logs and forwards to Sentry.
   * This keeps Sentry reporting automatic - just use logger.error() and
   * errors show up in Sentry without explicit captureException calls everywhere.
   */
  hooks: {
    logMethod(args, method, level) {
      const levelValue =
        typeof level === "number"
          ? level
          : (pino.levels.values[level as keyof typeof pino.levels.values] ?? 0);
      if (levelValue >= pino.levels.values.error) {
        const firstArg = args[0];
        const errorCandidate =
          firstArg instanceof Error
            ? firstArg
            : firstArg && typeof firstArg === "object" && "err" in firstArg
              ? (firstArg as { err?: unknown }).err
              : undefined;

        if (errorCandidate instanceof Error) {
          const message = typeof args[1] === "string" ? args[1] : undefined;
          const label =
            typeof level === "string"
              ? level
              : (pino.levels.labels[levelValue as keyof typeof pino.levels.labels] ?? "error");

          // Dynamic import to avoid circular deps and keep Sentry optional.
          // If Sentry isn't configured (no DSN), this is essentially a no-op.
          import("./sentry.js")
            .then(({ captureException, isSentryEnabled }) => {
              if (isSentryEnabled()) {
                captureException(errorCandidate, { message, level: label });
              }
            })
            .catch((importErr) => {
              // Sentry module failed to load - warn once, then silence.
              // This can happen if Sentry deps aren't installed.
              if (!sentryImportWarned) {
                sentryImportWarned = true;
                console.warn("[logger] Failed to import Sentry module:", importErr?.message);
              }
            });
        }
      }

      return method.apply(this, args);
    },
  },
});

// Startup log showing which debug flags are active. Helps diagnose
// "why isn't X logging" questions without checking .env directly.
logger.info(
  {
    dbTraceEnabled: process.env.DB_TRACE === "1",
    traceInteractions: process.env.TRACE_INTERACTIONS === "1",
  },
  "diagnostic toggles"
);
