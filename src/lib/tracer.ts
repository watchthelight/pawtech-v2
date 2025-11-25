// Ultra-small tracing helper for interactions & commands.
// ULID gives sortable unique ids: https://github.com/ulid/javascript
import { ulid } from "ulid";

export type TraceCtx = {
  traceId: string;
  feature: string; // e.g. "gate"
  step?: string; // optional sub-step
};

export function newTrace(feature: string, step?: string): TraceCtx {
  return { traceId: ulid(), feature, step };
}

export function withStep(ctx: TraceCtx, step: string): TraceCtx {
  return { ...ctx, step };
}

// Consistent log line payload
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
