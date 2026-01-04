/**
 * WHAT: Proves wrapCommand emits step logs and posts error cards on thrown errors.
 * HOW: Uses hoisted vitest mocks for logger/sentry/errorCard and a fake ChatInputCommandInteraction.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";

// ============================================================================
// MOCK SETUP — vi.hoisted() ensures these run before ES module imports execute.
// This is critical: without hoisting, the real modules would load first and
// the mocks would never take effect. Order matters in ESM land.
//
// GOTCHA: If you add a new mock, put it ABOVE the imports that use it.
// vi.mock() is hoisted but vi.hoisted() is evaluated at definition position.
// ============================================================================

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: loggerMock,
}));

// Sentry mock captures exception reporting without hitting the real Sentry API.
// We verify captureException is called on errors to ensure observability works.
const sentryMock = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("../../src/lib/sentry.js", () => sentryMock);

// postErrorCardV2 sends a user-facing error embed with wide event context.
// We mock it to verify it's called with the right payload shape.
const postErrorCardV2Mock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/lib/errorCardV2.js", () => ({
  postErrorCardV2: postErrorCardV2Mock,
}));

// Wide event emitter mock - captures emitted events for assertion.
const emitWideEventMock = vi.hoisted(() => vi.fn());
const emitWideEventForcedMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/wideEventEmitter.js", () => ({
  emitWideEvent: emitWideEventMock,
  emitWideEventForced: emitWideEventForcedMock,
}));

// Request context mock — simulates the async-local-storage trace context.
// Tests can mutate reqCtxState to simulate different command contexts.
// The fixed traceId makes assertions deterministic.
const reqCtxState = {
  traceId: "trace-fixed",
  kind: "button" as const,
  cmd: "health",
  userId: "user-1",
  guildId: "guild-1",
  channelId: "chan-1",
};

vi.mock("../../src/lib/reqctx.js", () => ({
  ctx: vi.fn(() => reqCtxState),
  newTraceId: vi.fn(() => "trace-fixed"),
  // runWithCtx bypasses actual async context setup — just runs the callback immediately.
  runWithCtx: vi.fn((_meta, fn) => fn()),
}));

// Import AFTER mocks are set up — this is the module under test.
import { wrapCommand, withStep } from "../../src/lib/cmdWrap.js";

/**
 * Factory for minimal ChatInputCommandInteraction stubs.
 *
 * We only mock what wrapCommand touches. The real discord.js interaction object
 * is a monster with 50+ properties, but chasing full fidelity is a fool's errand.
 * If the tests pass and prod works, the mock is good enough.
 */
function createInteraction(): ChatInputCommandInteraction {
  return {
    user: { id: "user-1", username: "tester" },
    guildId: "guild-1",
    // replied/deferred control which Discord API method gets called for responses.
    // Starting fresh (both false) simulates a brand-new slash command.
    deferred: false,
    replied: false,
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset reqCtxState to defaults — tests that modify it (like the error test
  // changing cmd to "gate") need a clean slate each run.
  Object.assign(reqCtxState, {
    traceId: "trace-fixed",
    kind: "button" as const,
    cmd: "health",
    userId: "user-1",
    guildId: "guild-1",
    channelId: "chan-1",
  });
});

describe("wrapCommand", () => {
  /**
   * Happy path: command runs to completion without throwing.
   * Verifies wide event emission on success.
   * This is the bread-and-butter case—most commands should follow this pattern.
   */
  it("emits wide event on success", async () => {
    const interaction = createInteraction();
    const handler = wrapCommand("health", async (ctx) => {
      // withStep wraps a logical phase of the command for observability.
      // Each step gets its own log entry with timing data.
      await withStep(ctx, "validate_input", async () => undefined);
    });

    await handler(interaction);

    // Verify wide event was emitted with success outcome
    expect(emitWideEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "health",
        outcome: "success",
        traceId: "trace-fixed",
      })
    );
    // No error card on success—don't spam users with "everything is fine" messages.
    expect(postErrorCardV2Mock).not.toHaveBeenCalled();
  });

  /**
   * Error path: simulates a SQLite error during command execution.
   * This tests the full error handling pipeline:
   * 1. Wide event is emitted with error outcome and context
   * 2. User gets a friendly error card V2 (with severity coloring)
   * 3. Sentry gets notified for alerting/tracking
   *
   * The error is intentionally thrown mid-step ("db_begin") to verify
   * the phase is captured correctly—helps debugging which step failed.
   */
  it("emits wide event with error and posts error card V2 on failure", async () => {
    const interaction = createInteraction();
    // Switch context to "gate" command for this test.
    reqCtxState.cmd = "gate";
    const handler = wrapCommand("gate", async (ctx) => {
      ctx.step("db_begin");
      // Simulate a SQLite error with the shape better-sqlite3 produces.
      // The code property is used for error classification in hintFor().
      const err = new Error("boom");
      (err as { code?: string }).code = "SQLITE_ERROR";
      err.name = "SqliteError";
      throw err;
    });

    // Key behavior: wrapCommand ALWAYS resolves, never rejects.
    // If we let errors bubble, Node's unhandled rejection handler would fire,
    // and in prod that means "randomly crash and restart via PM2".
    await expect(handler(interaction)).resolves.toBeUndefined();

    // Verify wide event was emitted with error outcome
    // Note: emitWideEvent is used (not forced) because errors are always sampled at 100%
    expect(emitWideEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "gate",
        outcome: "error",
        traceId: "trace-fixed",
        error: expect.objectContaining({
          kind: "db_error",
          message: "boom",
          phase: "db_begin",
        }),
      })
    );

    // User-facing error card V2 with wide event context
    expect(postErrorCardV2Mock).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        wideEvent: expect.objectContaining({
          traceId: "trace-fixed",
          command: "gate",
        }),
        classified: expect.objectContaining({
          kind: "db_error",
        }),
      })
    );

    // Sentry capture for ops alerting.
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});
