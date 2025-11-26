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

// postErrorCard sends a user-facing error embed. We mock it to verify it's called
// with the right payload shape without actually posting to Discord.
const postErrorCardMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/lib/errorCard.js", () => ({
  postErrorCard: postErrorCardMock,
}));

// Request context mock — simulates the async-local-storage trace context.
// Tests can mutate reqCtxState to simulate different command contexts.
// The fixed traceId makes assertions deterministic.
const reqCtxState = {
  traceId: "trace-fixed",
  kind: "button" as const,
  cmd: "statusupdate",
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
 * Only includes properties that wrapCommand actually touches. The real object
 * has dozens more fields, but we don't need them for these tests.
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
    cmd: "statusupdate",
    userId: "user-1",
    guildId: "guild-1",
    channelId: "chan-1",
  });
});

describe("wrapCommand", () => {
  /**
   * Happy path: command runs to completion without throwing.
   * Verifies the full lifecycle logging: start -> step -> ok.
   * This is the bread-and-butter case—most commands should follow this pattern.
   */
  it("logs start, step, and completion on success", async () => {
    const interaction = createInteraction();
    const handler = wrapCommand("statusupdate", async (ctx) => {
      // withStep wraps a logical phase of the command for observability.
      // Each step gets its own log entry with timing data.
      await withStep(ctx, "validate_input", async () => undefined);
    });

    await handler(interaction);

    // Verify the three expected log calls in order: start, step, completion.
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "cmd_start", traceId: "trace-fixed", cmd: "statusupdate" }),
      "command start"
    );
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "cmd_step", phase: "validate_input" })
    );
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "cmd_ok", cmd: "statusupdate" }),
      "command ok"
    );
    // No error card on success—don't spam users with "everything is fine" messages.
    expect(postErrorCardMock).not.toHaveBeenCalled();
  });

  /**
   * Error path: simulates a SQLite error during command execution.
   * This tests the full error handling pipeline:
   * 1. Error gets logged with full context (phase, traceId, error details)
   * 2. User gets a friendly error card (not a raw stack trace)
   * 3. Sentry gets notified for alerting/tracking
   *
   * The error is intentionally thrown mid-step ("db_begin") to verify
   * the phase is captured correctly—helps debugging which step failed.
   */
  it("records error and posts error card on failure", async () => {
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

    // Key behavior: wrapCommand swallows errors gracefully (resolves, doesn't reject).
    // This prevents unhandled rejections from crashing the bot.
    await expect(handler(interaction)).resolves.toBeUndefined();

    // Verify structured error logging with all diagnostic fields.
    // These fields are critical for debugging production issues.
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "cmd_error",
        cmd: "gate",
        phase: "db_begin", // Which step failed
        traceId: "trace-fixed", // Correlation ID for log aggregation
        lastSql: null, // Would contain the failing SQL in real usage
        errorKind: "db_error", // Classification for alerting rules
        errorMessage: "boom",
        err: expect.objectContaining({
          name: "SqliteError",
          code: "SQLITE_ERROR",
          message: "boom",
        }),
      }),
      "command error: boom"
    );

    // User-facing error card with just enough info to report the issue.
    expect(postErrorCardMock).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        traceId: "trace-fixed",
        cmd: "gate",
        phase: "db_begin",
      })
    );

    // Sentry capture for ops alerting.
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});
