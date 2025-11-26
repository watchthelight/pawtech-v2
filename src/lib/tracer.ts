/**
 * Ultra-small tracing helper for interactions & commands.
 *
 * This is separate from reqctx.ts because it uses ULID (sortable) rather than
 * random base62 IDs, and is designed for feature-level tracing rather than
 * request-scoped context. Use this when you need sortable trace IDs for
 * log analysis; use reqctx when you need request context propagation.
 */
// ULID gives sortable unique ids: https://github.com/ulid/javascript
import { ulid } from "ulid";

export type TraceCtx = {
  traceId: string; // ULID - sortable by time, 26 chars
  feature: string; // e.g. "gate" - identifies the subsystem
  step?: string; // optional sub-step for finer granularity
};

export function newTrace(feature: string, step?: string): TraceCtx {
  // ULID encodes timestamp in first 10 chars, so traces from the same second
  // will sort together. Useful for correlating related operations in logs.
  return { traceId: ulid(), feature, step };
}

export function withStep(ctx: TraceCtx, step: string): TraceCtx {
  // Returns a new context - immutable pattern lets you branch traces without
  // worrying about mutation. The spread is cheap for 3-field objects.
  return { ...ctx, step };
}

/**
 * Structured trace logging. Uses console.* directly rather than the logger
 * module to keep this tracer zero-dependency (aside from ulid). If you need
 * pino-style structured logging, use the logger module directly.
 *
 * The payload object is passed as second arg so JSON log aggregators (like
 * Datadog or CloudWatch) can parse it. The human-readable line comes first
 * for local development.
 */
export function tlog(
  ctx: TraceCtx,
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>
) {
  const payload = {
    evt: "trace",
    traceId: ctx.traceId,
    feature: ctx.feature,
    step: ctx.step,
    ...extra,
  };
  const line = `[${ctx.feature}] ${msg}`;
  if (level === "info") console.info(line, payload);
  else if (level === "warn") console.warn(line, payload);
  else console.error(line, payload);
}
