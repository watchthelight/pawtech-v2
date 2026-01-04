/**
 * Pawtropolis Tech — tests/lib/reqctx.test.ts
 * WHAT: Unit tests for request context and async local storage.
 * WHY: Verify trace ID generation, context propagation, and wide event enrichment.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock wideEvent to avoid circular dependency
vi.mock("../../src/lib/wideEvent.js", () => ({
  WideEventBuilder: class {
    addAttr = vi.fn().mockReturnThis();
    setFeature = vi.fn().mockReturnThis();
    addEntity = vi.fn().mockReturnThis();
  },
}));

import { newTraceId, runWithCtx, ctx, getWideEvent, enrichEvent } from "../../src/lib/reqctx.js";
import { WideEventBuilder } from "../../src/lib/wideEvent.js";

describe("reqctx", () => {
  describe("newTraceId", () => {
    it("generates 11-character string", () => {
      const id = newTraceId();
      expect(id).toHaveLength(11);
    });

    it("only contains base62 characters", () => {
      const id = newTraceId();
      const base62Pattern = /^[0-9A-Za-z]+$/;
      expect(id).toMatch(base62Pattern);
    });

    it("generates unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(newTraceId());
      }
      expect(ids.size).toBe(100);
    });

    it("is deterministic length", () => {
      for (let i = 0; i < 10; i++) {
        expect(newTraceId()).toHaveLength(11);
      }
    });
  });

  describe("ctx", () => {
    it("returns empty object when no context set", () => {
      const result = ctx();
      expect(result).toEqual({});
    });

    it("allows safe destructuring without context", () => {
      const { traceId, cmd, kind } = ctx();
      expect(traceId).toBeUndefined();
      expect(cmd).toBeUndefined();
      expect(kind).toBeUndefined();
    });
  });

  describe("runWithCtx", () => {
    it("provides context within callback", () => {
      const traceId = "test123abc";

      runWithCtx({ traceId }, () => {
        const current = ctx();
        expect(current.traceId).toBe(traceId);
      });
    });

    it("generates traceId if not provided", () => {
      runWithCtx({}, () => {
        const current = ctx();
        expect(current.traceId).toHaveLength(11);
      });
    });

    it("supports all context fields", () => {
      runWithCtx(
        {
          traceId: "abc123def45",
          cmd: "review",
          kind: "slash",
          userId: "user-123",
          guildId: "guild-456",
          channelId: "channel-789",
        },
        () => {
          const current = ctx();
          expect(current.traceId).toBe("abc123def45");
          expect(current.cmd).toBe("review");
          expect(current.kind).toBe("slash");
          expect(current.userId).toBe("user-123");
          expect(current.guildId).toBe("guild-456");
          expect(current.channelId).toBe("channel-789");
        }
      );
    });

    it("supports nested contexts with inheritance", () => {
      runWithCtx({ traceId: "parent12345", cmd: "outer" }, () => {
        const outer = ctx();
        expect(outer.traceId).toBe("parent12345");
        expect(outer.cmd).toBe("outer");

        runWithCtx({ cmd: "inner" }, () => {
          const inner = ctx();
          // Inherits traceId from parent
          expect(inner.traceId).toBe("parent12345");
          // Overrides cmd
          expect(inner.cmd).toBe("inner");
        });
      });
    });

    it("restores context after callback completes", () => {
      runWithCtx({ traceId: "outer123456" }, () => {
        runWithCtx({ traceId: "inner654321" }, () => {
          expect(ctx().traceId).toBe("inner654321");
        });
        // Back to outer context
        expect(ctx().traceId).toBe("outer123456");
      });
    });

    it("returns value from callback", () => {
      const result = runWithCtx({ traceId: "test1234567" }, () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it("propagates through async calls", async () => {
      await runWithCtx({ traceId: "async123456" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(ctx().traceId).toBe("async123456");
      });
    });

    it("handles null guildId and channelId", () => {
      runWithCtx(
        {
          traceId: "test1234567",
          guildId: null,
          channelId: null,
        },
        () => {
          const current = ctx();
          expect(current.guildId).toBeNull();
          expect(current.channelId).toBeNull();
        }
      );
    });

    it("supports all interaction kinds", () => {
      const kinds = ["slash", "button", "modal", "select", "autocomplete", "contextMenu", "event"] as const;

      for (const kind of kinds) {
        runWithCtx({ kind }, () => {
          expect(ctx().kind).toBe(kind);
        });
      }
    });
  });

  describe("getWideEvent", () => {
    it("returns null when no context", () => {
      expect(getWideEvent()).toBeNull();
    });

    it("returns null when context has no wideEvent", () => {
      runWithCtx({ traceId: "test1234567" }, () => {
        expect(getWideEvent()).toBeNull();
      });
    });

    it("returns wideEvent when present in context", () => {
      const mockEvent = new WideEventBuilder("test");

      runWithCtx({ traceId: "test1234567", wideEvent: mockEvent }, () => {
        expect(getWideEvent()).toBe(mockEvent);
      });
    });

    it("inherits wideEvent from parent context", () => {
      const mockEvent = new WideEventBuilder("test");

      runWithCtx({ traceId: "parent12345", wideEvent: mockEvent }, () => {
        runWithCtx({ cmd: "inner" }, () => {
          expect(getWideEvent()).toBe(mockEvent);
        });
      });
    });
  });

  describe("enrichEvent", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("does nothing when no context", () => {
      const enrichFn = vi.fn();
      enrichEvent(enrichFn);
      expect(enrichFn).not.toHaveBeenCalled();
    });

    it("does nothing when context has no wideEvent", () => {
      const enrichFn = vi.fn();

      runWithCtx({ traceId: "test1234567" }, () => {
        enrichEvent(enrichFn);
      });

      expect(enrichFn).not.toHaveBeenCalled();
    });

    it("calls enrichment function with wideEvent", () => {
      const mockEvent = new WideEventBuilder("test");
      const enrichFn = vi.fn();

      runWithCtx({ traceId: "test1234567", wideEvent: mockEvent }, () => {
        enrichEvent(enrichFn);
      });

      expect(enrichFn).toHaveBeenCalledWith(mockEvent);
    });

    it("allows chained enrichments", () => {
      const mockEvent = new WideEventBuilder("test");

      runWithCtx({ traceId: "test1234567", wideEvent: mockEvent }, () => {
        enrichEvent((e) => e.addAttr("key1", "value1"));
        enrichEvent((e) => e.addAttr("key2", "value2"));
      });

      expect(mockEvent.addAttr).toHaveBeenCalledTimes(2);
      expect(mockEvent.addAttr).toHaveBeenCalledWith("key1", "value1");
      expect(mockEvent.addAttr).toHaveBeenCalledWith("key2", "value2");
    });

    it("swallows errors in enrichment function", () => {
      const mockEvent = new WideEventBuilder("test");

      runWithCtx({ traceId: "test1234567", wideEvent: mockEvent }, () => {
        expect(() => {
          enrichEvent(() => {
            throw new Error("Enrichment failed");
          });
        }).not.toThrow();
      });
    });

    it("works with setFeature", () => {
      const mockEvent = new WideEventBuilder("test");

      runWithCtx({ traceId: "test1234567", wideEvent: mockEvent }, () => {
        enrichEvent((e) => e.setFeature("gate", "accept"));
      });

      expect(mockEvent.setFeature).toHaveBeenCalledWith("gate", "accept");
    });

    it("works with addEntity", () => {
      const mockEvent = new WideEventBuilder("test");

      runWithCtx({ traceId: "test1234567", wideEvent: mockEvent }, () => {
        enrichEvent((e) => e.addEntity({ type: "application", id: "app-123" }));
      });

      expect(mockEvent.addEntity).toHaveBeenCalledWith({ type: "application", id: "app-123" });
    });
  });
});
