/**
 * Pawtropolis Tech — tests/lib/autoDelete.test.ts
 * WHAT: Unit tests for auto-delete message utility.
 * WHY: Verify fire-and-forget deletion logic works correctly.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { autoDelete } from "../../src/lib/autoDelete.js";
import type { Message } from "discord.js";

describe("autoDelete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMockMessage(overrides: Partial<{ deletable: boolean; delete: () => Promise<Message> }> = {}) {
    return {
      deletable: true,
      delete: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as Message;
  }

  describe("with resolved message", () => {
    it("deletes message after default timeout (30s)", async () => {
      const mockMessage = createMockMessage();

      autoDelete(mockMessage);

      // Should not delete immediately
      expect(mockMessage.delete).not.toHaveBeenCalled();

      // Advance past default timeout
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockMessage.delete).toHaveBeenCalledTimes(1);
    });

    it("deletes message after custom timeout", async () => {
      const mockMessage = createMockMessage();

      autoDelete(mockMessage, 10_000);

      // Should not delete at 5s
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockMessage.delete).not.toHaveBeenCalled();

      // Should delete at 10s
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockMessage.delete).toHaveBeenCalledTimes(1);
    });

    it("checks deletable flag before deleting", async () => {
      const mockMessage = createMockMessage({ deletable: false });

      autoDelete(mockMessage, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockMessage.delete).not.toHaveBeenCalled();
    });

    it("swallows deletion errors silently", async () => {
      const mockMessage = createMockMessage({
        delete: vi.fn().mockRejectedValue(new Error("Unknown Message")),
      });

      autoDelete(mockMessage, 1_000);

      // Should not throw
      await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
    });
  });

  describe("with message promise", () => {
    it("awaits promise before scheduling deletion", async () => {
      const mockMessage = createMockMessage();
      const messagePromise = Promise.resolve(mockMessage);

      autoDelete(messagePromise, 5_000);

      // Let promise resolve
      await vi.advanceTimersByTimeAsync(0);

      // Advance timer
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockMessage.delete).toHaveBeenCalledTimes(1);
    });

    it("swallows promise rejection silently", async () => {
      const failedPromise = Promise.reject(new Error("Channel unavailable"));

      autoDelete(failedPromise, 1_000);

      // Should not throw - swallows the rejection
      await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("handles zero timeout", async () => {
      const mockMessage = createMockMessage();

      autoDelete(mockMessage, 0);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockMessage.delete).toHaveBeenCalledTimes(1);
    });

    it("handles message becoming non-deletable before timeout", async () => {
      const mockMessage = createMockMessage();

      autoDelete(mockMessage, 5_000);

      // Simulate message becoming non-deletable (e.g., manual deletion)
      (mockMessage as { deletable: boolean }).deletable = false;

      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockMessage.delete).not.toHaveBeenCalled();
    });

    it("handles multiple autoDelete calls on same message", async () => {
      const mockMessage = createMockMessage();

      autoDelete(mockMessage, 5_000);
      autoDelete(mockMessage, 10_000);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockMessage.delete).toHaveBeenCalledTimes(1);

      // Second call will try to delete but message might already be gone
      // (in real usage, deletable would become false after first delete)
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockMessage.delete).toHaveBeenCalledTimes(2);
    });

    it("handles delete throwing after deletable check passes", async () => {
      const mockMessage = createMockMessage({
        delete: vi.fn().mockRejectedValue(new Error("50013: Missing Permissions")),
      });

      autoDelete(mockMessage, 1_000);

      // Should not throw
      await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
    });
  });

  describe("fire-and-forget behavior", () => {
    it("returns void immediately", () => {
      const mockMessage = createMockMessage();

      const result = autoDelete(mockMessage, 5_000);

      expect(result).toBeUndefined();
    });

    it("does not block on promise resolution", async () => {
      let resolved = false;
      const slowPromise = new Promise<Message>((resolve) => {
        setTimeout(() => {
          resolved = true;
          resolve(createMockMessage());
        }, 10_000);
      });

      autoDelete(slowPromise, 1_000);

      // Should return immediately without waiting
      expect(resolved).toBe(false);

      // Advance to resolve the promise
      await vi.advanceTimersByTimeAsync(10_000);
      expect(resolved).toBe(true);
    });
  });
});
