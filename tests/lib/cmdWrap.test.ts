/**
 * WHAT: Proves wrapCommand emits step logs and posts error cards on thrown errors.
 * HOW: Uses hoisted vitest mocks for logger/sentry/errorCard and a fake ChatInputCommandInteraction.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: loggerMock,
}));

const sentryMock = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("../../src/lib/sentry.js", () => sentryMock);

const postErrorCardMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/lib/errorCard.js", () => ({
  postErrorCard: postErrorCardMock,
}));

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
  runWithCtx: vi.fn((_meta, fn) => fn()),
}));

import { wrapCommand, withStep } from "../../src/lib/cmdWrap.js";

function createInteraction(): ChatInputCommandInteraction {
  return {
    user: { id: "user-1", username: "tester" },
    guildId: "guild-1",
    deferred: false,
    replied: false,
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
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
  it("logs start, step, and completion on success", async () => {
    const interaction = createInteraction();
    const handler = wrapCommand("statusupdate", async (ctx) => {
      await withStep(ctx, "validate_input", async () => undefined);
    });

    await handler(interaction);

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
    expect(postErrorCardMock).not.toHaveBeenCalled();
  });

  it("records error and posts error card on failure", async () => {
    const interaction = createInteraction();
    reqCtxState.cmd = "gate";
    const handler = wrapCommand("gate", async (ctx) => {
      ctx.step("db_begin");
      const err = new Error("boom");
      (err as { code?: string }).code = "SQLITE_ERROR";
      err.name = "SqliteError";
      throw err;
    });

    await expect(handler(interaction)).resolves.toBeUndefined();

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "cmd_error",
        cmd: "gate",
        phase: "db_begin",
        traceId: "trace-fixed",
        lastSql: null,
        err: expect.objectContaining({
          name: "SqliteError",
          code: "SQLITE_ERROR",
          message: "boom",
        }),
      }),
      "command error"
    );
    expect(postErrorCardMock).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        traceId: "trace-fixed",
        cmd: "gate",
        phase: "db_begin",
      })
    );
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});
