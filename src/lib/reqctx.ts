/**
 * Pawtropolis Tech — src/lib/reqctx.ts
 * WHAT: Minimal async-local request context for tracing interaction flows.
 * WHY: Lets us attach traceId/cmd/kind across nested async calls without threading params everywhere.
 * FLOWS: newTraceId() → runWithCtx(meta, fn) → ctx() inside nested helpers
 * DOCS:
 *  - Node AsyncLocalStorage: https://nodejs.org/api/async_context.html#class-asynclocalstorage
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export type ReqContext = {
  traceId: string;
  cmd?: string;
  kind?: "slash" | "button" | "modal";
  userId?: string;
  guildId?: string | null;
  channelId?: string | null;
};

// thread-local vibes, but without the drama
const storage = new AsyncLocalStorage<ReqContext>();

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function newTraceId(): string {
  /**
   * newTraceId
   * WHAT: Generates a short base62 trace id for logs.
   * RETURNS: 11-char base62 string.
   */
  const length = 11;
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += BASE62[bytes[i] % BASE62.length];
  }
  return out;
}

export function runWithCtx<T>(meta: Partial<ReqContext>, fn: () => T): T {
  /**
   * runWithCtx
   * WHAT: Binds a merged ReqContext for the duration of a function.
   * WHY: Cheap and sufficient for our single-process bot.
   */
  const parent = storage.getStore();
  const next: ReqContext = {
    traceId: meta.traceId ?? parent?.traceId ?? newTraceId(),
    cmd: meta.cmd ?? parent?.cmd,
    kind: meta.kind ?? parent?.kind,
    userId: meta.userId ?? parent?.userId,
    guildId: meta.guildId ?? parent?.guildId ?? null,
    channelId: meta.channelId ?? parent?.channelId ?? null,
  };
  return storage.run(next, fn);
}

export function ctx(): Partial<ReqContext> {
  /**
   * ctx
   * WHAT: Returns the current context or {} when outside a runWithCtx scope.
   */
  return storage.getStore() ?? {};
}
