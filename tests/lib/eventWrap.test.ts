/**
 * Pawtropolis Tech — tests/lib/eventWrap.test.ts
 * WHAT: Unit tests for event handler wrapper.
 * WHY: Verify error protection, context extraction, and wide event emission.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/sentry.js", () => ({
  captureException: vi.fn().mockReturnValue("sentry-event-id"),
}));

vi.mock("../../src/lib/errors.js", () => ({
  classifyError: vi.fn((err) => ({
    kind: "unknown",
    message: err instanceof Error ? err.message : String(err),
    cause: err instanceof Error ? err : new Error(String(err)),
  })),
  errorContext: vi.fn().mockReturnValue({}),
  shouldReportToSentry: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/lib/wideEventEmitter.js", () => ({
  emitWideEvent: vi.fn(),
}));

// Mock wideEvent with builder pattern
const mockWideEventBuilder = {
  setInteraction: vi.fn().mockReturnThis(),
  addAttr: vi.fn().mockReturnThis(),
  setFeature: vi.fn().mockReturnThis(),
  enterPhase: vi.fn().mockReturnThis(),
  setOutcome: vi.fn().mockReturnThis(),
  setError: vi.fn().mockReturnThis(),
  finalize: vi.fn().mockReturnValue({ traceId: "test123", outcome: "success" }),
};

vi.mock("../../src/lib/wideEvent.js", () => ({
  WideEventBuilder: vi.fn(() => mockWideEventBuilder),
}));

vi.mock("../../src/lib/reqctx.js", () => ({
  newTraceId: vi.fn().mockReturnValue("test12345678"),
  runWithCtx: vi.fn(async (ctx, fn) => fn()),
}));

import { wrapEvent, extractEventContext } from "../../src/lib/eventWrap.js";
import { emitWideEvent } from "../../src/lib/wideEventEmitter.js";
import { captureException } from "../../src/lib/sentry.js";
import { classifyError, shouldReportToSentry } from "../../src/lib/errors.js";
import { newTraceId, runWithCtx } from "../../src/lib/reqctx.js";
import { WideEventBuilder } from "../../src/lib/wideEvent.js";

describe("eventWrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("extractEventContext", () => {
    it("extracts guildId from object", () => {
      const result = extractEventContext([{ guildId: "guild-123" }]);
      expect(result.guildId).toBe("guild-123");
    });

    it("extracts guildId from nested guild object", () => {
      const result = extractEventContext([{ guild: { id: "guild-456" } }]);
      expect(result.guildId).toBe("guild-456");
    });

    it("extracts userId from nested user object", () => {
      const result = extractEventContext([{ user: { id: "user-789" } }]);
      expect(result.userId).toBe("user-789");
    });

    it("extracts channelId from object", () => {
      const result = extractEventContext([{ channelId: "channel-111" }]);
      expect(result.channelId).toBe("channel-111");
    });

    it("extracts entityId from id property", () => {
      const result = extractEventContext([{ id: "entity-222" }]);
      expect(result.entityId).toBe("entity-222");
    });

    it("extracts multiple fields from single object", () => {
      const result = extractEventContext([
        {
          guildId: "guild-1",
          channelId: "channel-1",
          user: { id: "user-1" },
          id: "message-1",
        },
      ]);

      expect(result.guildId).toBe("guild-1");
      expect(result.channelId).toBe("channel-1");
      expect(result.userId).toBe("user-1");
      expect(result.entityId).toBe("message-1");
    });

    it("extracts from multiple arguments", () => {
      const result = extractEventContext([
        { guildId: "guild-1" },
        { channelId: "channel-2" },
        { user: { id: "user-3" } },
      ]);

      expect(result.guildId).toBe("guild-1");
      expect(result.channelId).toBe("channel-2");
      expect(result.userId).toBe("user-3");
    });

    it("handles null/undefined arguments", () => {
      const result = extractEventContext([null, undefined, { guildId: "guild-1" }]);
      expect(result.guildId).toBe("guild-1");
    });

    it("handles primitive arguments", () => {
      const result = extractEventContext([42, "string", true, { guildId: "guild-1" }]);
      expect(result.guildId).toBe("guild-1");
    });

    it("returns empty object for no matching fields", () => {
      const result = extractEventContext([{ foo: "bar" }]);
      expect(result).toEqual({});
    });

    it("returns empty object for empty array", () => {
      const result = extractEventContext([]);
      expect(result).toEqual({});
    });

    it("only uses first entityId found", () => {
      const result = extractEventContext([{ id: "first" }, { id: "second" }]);
      expect(result.entityId).toBe("first");
    });
  });

  describe("wrapEvent", () => {
    it("creates wrapped handler that can be called", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("testEvent", handler);

      expect(typeof wrapped).toBe("function");
    });

    it("calls the original handler with arguments", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("testEvent", handler);

      await wrapped("arg1", "arg2", { value: 3 });

      expect(handler).toHaveBeenCalledWith("arg1", "arg2", { value: 3 });
    });

    it("generates trace ID for each invocation", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("testEvent", handler);

      await wrapped();

      expect(newTraceId).toHaveBeenCalled();
    });

    it("creates WideEventBuilder", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("testEvent", handler);

      await wrapped();

      // Verify WideEventBuilder is created for the event
      expect(WideEventBuilder).toHaveBeenCalled();
    });

    it("sets interaction context for event", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("guildMemberAdd", handler);

      await wrapped();

      expect(mockWideEventBuilder.setInteraction).toHaveBeenCalledWith({
        kind: "event",
        command: "guildMemberAdd",
      });
    });

    it("extracts and adds context from event args", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("testEvent", handler);

      await wrapped({ guildId: "guild-123", user: { id: "user-456" }, channelId: "channel-789" });

      expect(mockWideEventBuilder.addAttr).toHaveBeenCalledWith("guildId", "guild-123");
      expect(mockWideEventBuilder.addAttr).toHaveBeenCalledWith("userId", "user-456");
      expect(mockWideEventBuilder.addAttr).toHaveBeenCalledWith("channelId", "channel-789");
    });

    it("sets feature based on event name mapping", async () => {
      const handler = vi.fn();

      // Test various event mappings
      const eventMappings: Record<string, string> = {
        guildMemberAdd: "gate",
        messageCreate: "message",
        interactionCreate: "interaction",
        guildCreate: "guild",
        userUpdate: "user",
      };

      for (const [eventName, expectedFeature] of Object.entries(eventMappings)) {
        vi.clearAllMocks();
        const wrapped = wrapEvent(eventName, handler);
        await wrapped();

        expect(mockWideEventBuilder.setFeature).toHaveBeenCalledWith(expectedFeature, eventName);
      }
    });

    it("does not set feature for unmapped events", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("customEvent", handler);

      await wrapped();

      expect(mockWideEventBuilder.setFeature).not.toHaveBeenCalled();
    });

    it("enters handler phase", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("testEvent", handler);

      await wrapped();

      expect(mockWideEventBuilder.enterPhase).toHaveBeenCalledWith("handler");
    });

    it("runs handler within context", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("testEvent", handler);

      await wrapped();

      expect(runWithCtx).toHaveBeenCalled();
      expect(handler).toHaveBeenCalled();
    });

    it("sets success outcome on successful completion", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("testEvent", handler);

      await wrapped();

      expect(mockWideEventBuilder.setOutcome).toHaveBeenCalledWith("success");
    });

    it("emits wide event on success", async () => {
      const handler = vi.fn();
      const wrapped = wrapEvent("testEvent", handler);

      await wrapped();

      expect(mockWideEventBuilder.finalize).toHaveBeenCalled();
      expect(emitWideEvent).toHaveBeenCalled();
    });

    describe("error handling", () => {
      it("catches errors from handler", async () => {
        const handler = vi.fn().mockRejectedValue(new Error("Handler failed"));
        const wrapped = wrapEvent("testEvent", handler);

        // Should not throw
        await expect(wrapped()).resolves.toBeUndefined();
      });

      it("classifies errors", async () => {
        const error = new Error("Test error");
        const handler = vi.fn().mockRejectedValue(error);
        const wrapped = wrapEvent("testEvent", handler);

        await wrapped();

        expect(classifyError).toHaveBeenCalledWith(error);
      });

      it("sets error on wide event", async () => {
        const handler = vi.fn().mockRejectedValue(new Error("Handler failed"));
        const wrapped = wrapEvent("testEvent", handler);

        await wrapped();

        expect(mockWideEventBuilder.setError).toHaveBeenCalled();
      });

      it("reports to Sentry when appropriate", async () => {
        vi.mocked(shouldReportToSentry).mockReturnValue(true);
        const error = new Error("Handler failed");
        const handler = vi.fn().mockRejectedValue(error);
        const wrapped = wrapEvent("testEvent", handler);

        await wrapped();

        expect(shouldReportToSentry).toHaveBeenCalled();
        expect(captureException).toHaveBeenCalled();
      });

      it("does not report to Sentry when shouldReportToSentry returns false", async () => {
        vi.mocked(shouldReportToSentry).mockReturnValueOnce(false);
        const handler = vi.fn().mockRejectedValue(new Error("Client error"));
        const wrapped = wrapEvent("testEvent", handler);

        await wrapped();

        expect(captureException).not.toHaveBeenCalled();
      });

      it("still emits wide event on error", async () => {
        const handler = vi.fn().mockRejectedValue(new Error("Handler failed"));
        const wrapped = wrapEvent("testEvent", handler);

        await wrapped();

        expect(emitWideEvent).toHaveBeenCalled();
      });

      it("handles non-Error objects thrown", async () => {
        const handler = vi.fn().mockRejectedValue("string error");
        const wrapped = wrapEvent("testEvent", handler);

        await expect(wrapped()).resolves.toBeUndefined();
        expect(classifyError).toHaveBeenCalledWith("string error");
      });
    });

    describe("timeout handling", () => {
      it("times out after default timeout", async () => {
        const handler = vi.fn(
          () =>
            new Promise((resolve) => {
              setTimeout(resolve, 20000); // 20 seconds
            })
        );
        const wrapped = wrapEvent("testEvent", handler);

        const promise = wrapped();

        // Fast-forward past timeout
        await vi.advanceTimersByTimeAsync(11000);
        await promise;

        expect(mockWideEventBuilder.setOutcome).toHaveBeenCalledWith("timeout");
      });

      it("respects custom timeout", async () => {
        const handler = vi.fn(
          () =>
            new Promise((resolve) => {
              setTimeout(resolve, 10000);
            })
        );
        const wrapped = wrapEvent("testEvent", handler, 5000);

        const promise = wrapped();
        await vi.advanceTimersByTimeAsync(6000);
        await promise;

        expect(mockWideEventBuilder.setOutcome).toHaveBeenCalledWith("timeout");
      });

      it("completes before timeout when handler is fast", async () => {
        const handler = vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
        });
        const wrapped = wrapEvent("testEvent", handler, 5000);

        const promise = wrapped();
        await vi.advanceTimersByTimeAsync(200);
        await promise;

        expect(mockWideEventBuilder.setOutcome).toHaveBeenCalledWith("success");
      });
    });

    describe("sync handler support", () => {
      it("handles synchronous handlers", async () => {
        const handler = vi.fn(() => {
          // Sync handler - no return
        });
        const wrapped = wrapEvent("testEvent", handler);

        await wrapped();

        expect(handler).toHaveBeenCalled();
        expect(mockWideEventBuilder.setOutcome).toHaveBeenCalledWith("success");
      });

      it("handles synchronous errors", async () => {
        const handler = vi.fn(() => {
          throw new Error("Sync error");
        });
        const wrapped = wrapEvent("testEvent", handler);

        await expect(wrapped()).resolves.toBeUndefined();
        expect(mockWideEventBuilder.setError).toHaveBeenCalled();
      });
    });
  });
});
