/**
 * Pawtropolis Tech — src/lib/reqctx.ts
 * WHAT: Minimal async-local request context for tracing interaction flows.
 * WHY: Lets us attach traceId/cmd/kind across nested async calls without threading params everywhere.
 * FLOWS: newTraceId() → runWithCtx(meta, fn) → ctx() inside nested helpers
 *
 * NOTE: This is the ONLY tracing system in the codebase. Previously tracer.ts existed
 * but was removed in favor of this async-context-based approach.
 *
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

// AsyncLocalStorage propagates context through the async call chain automatically.
// Zero overhead when not in a context, near-zero when active.
const storage = new AsyncLocalStorage<ReqContext>();

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function newTraceId(): string {
  /**
   * Generates an 11-char base62 trace ID. This gives ~65 bits of entropy -
   * plenty to avoid collisions at our scale. Short enough to not clutter logs,
   * long enough to be effectively unique.
   *
   * Not using UUID/ULID here because we want minimal log noise and don't need
   * sortability (that's what timestamps are for).
   */
  const length = 11;
  const bytes = randomBytes(length);
  let out = "";
  // Note: modulo bias exists here (256 % 62 != 0) but for trace IDs we don't
  // care about cryptographic uniformity - just uniqueness.
  for (let i = 0; i < length; i += 1) {
    out += BASE62[bytes[i] % BASE62.length];
  }
  return out;
}

export function runWithCtx<T>(meta: Partial<ReqContext>, fn: () => T): T {
  /**
   * Binds a merged ReqContext for the duration of fn and all async calls it makes.
   * Supports nesting - child contexts inherit from parent but can override fields.
   *
   * Important: The context is NOT inherited across event emitters unless you
   * explicitly propagate it. Discord.js callbacks (on('messageCreate'), etc.)
   * won't automatically see the context - you need to wrap handlers with runWithCtx.
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
   * Returns the current context or empty object if none is set.
   * The empty object fallback means callers can safely destructure without
   * null checks: const { traceId } = ctx();
   */
  return storage.getStore() ?? {};
}
