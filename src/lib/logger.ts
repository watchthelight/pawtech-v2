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

const tokenRe = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g;
const dsnRe = /(https?:\/\/)([^:@]+):[^@]+@/gi;
const mentionRe = /@(everyone|here)/gi;

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

const logLevel = process.env.LOG_LEVEL ?? "info";
const isVitest = !!process.env.VITEST_WORKER_ID;
const wantPretty =
  isVitest || (process.env.LOG_PRETTY === "true" && process.stdout.isTTY);

export const logger = pino({
  level: logLevel,
  ...(wantPretty
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname", // drop noisy fields
            singleLine: false,
          },
        },
      }
    : {}),
  base: undefined,
  serializers: {
    err: (e: any) => ({
      name: e?.name,
      code: e?.code,
      message: e?.message,
      stack: e?.stack,
    }),
  },
  // Pino hooks to send errors to Sentry
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

          import("./sentry.js")
            .then(({ captureException, isSentryEnabled }) => {
              if (isSentryEnabled()) {
                captureException(errorCandidate, { message, level: label });
              }
            })
            .catch(() => undefined);
        }
      }

      return method.apply(this, args);
    },
  },
});

logger.info(
  {
    dbTraceEnabled: process.env.DB_TRACE === "1",
    traceInteractions: process.env.TRACE_INTERACTIONS === "1",
  },
  "diagnostic toggles"
);
