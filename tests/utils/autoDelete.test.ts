/**
 * Pawtropolis Tech — tests/utils/autoDelete.test.ts
 * WHAT: Unit tests for autoDelete utility.
 * WHY: Ensures auto-deletion works correctly and gracefully handles errors.
 * COVERAGE:
 *  - Auto-deletion after specified delay
 *  - Graceful handling of already-deleted messages
 *  - Graceful handling of permission errors
 *  - Graceful handling of send failures
 *  - No unhandled promise rejections
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { autoDelete } from "../../src/utils/autoDelete.js";
import type { Message } from "discord.js";

describe("autoDelete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("deletes message after specified delay", async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockMessage = {
      deletable: true,
      delete: mockDelete,
    } as unknown as Message;

    // Call autoDelete with 30 second delay
    autoDelete(mockMessage, 30_000);

    // Should not delete immediately
    expect(mockDelete).not.toHaveBeenCalled();

    // Fast-forward time by 29 seconds
    await vi.advanceTimersByTimeAsync(29_000);
    expect(mockDelete).not.toHaveBeenCalled();

    // Fast-forward remaining 1 second
    await vi.advanceTimersByTimeAsync(1_000);

    // Wait for async operations
    await vi.runAllTimersAsync();

    // Should have deleted
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("uses default 30 second delay when not specified", async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockMessage = {
      deletable: true,
      delete: mockDelete,
    } as unknown as Message;

    autoDelete(mockMessage); // No delay specified

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.runAllTimersAsync();

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("does not delete if message is not deletable", async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockMessage = {
      deletable: false, // Bot can't delete this message
      delete: mockDelete,
    } as unknown as Message;

    autoDelete(mockMessage, 30_000);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.runAllTimersAsync();

    // Should check deletable flag and NOT call delete
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("swallows deletion errors gracefully", async () => {
    const mockDelete = vi.fn().mockRejectedValue(new Error("10008: Unknown Message"));
    const mockMessage = {
      deletable: true,
      delete: mockDelete,
    } as unknown as Message;

    // Should not throw
    expect(() => autoDelete(mockMessage, 30_000)).not.toThrow();

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.runAllTimersAsync();

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("handles message promise that resolves", async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockMessage = {
      deletable: true,
      delete: mockDelete,
    } as unknown as Message;

    const messagePromise = Promise.resolve(mockMessage);

    autoDelete(messagePromise, 30_000);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.runAllTimersAsync();

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("swallows message send failures gracefully", async () => {
    const failedPromise = Promise.reject(new Error("Failed to send message"));

    // Should not throw or cause unhandled rejection
    expect(() => autoDelete(failedPromise, 30_000)).not.toThrow();

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.runAllTimersAsync();

    // No errors should propagate
  });

  it("handles permission errors on deletion", async () => {
    const mockDelete = vi.fn().mockRejectedValue(new Error("50013: Missing Permissions"));
    const mockMessage = {
      deletable: true,
      delete: mockDelete,
    } as unknown as Message;

    autoDelete(mockMessage, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();

    expect(mockDelete).toHaveBeenCalledTimes(1);
    // Error should be swallowed, no crash
  });

  it("does not cause unhandled promise rejections", async () => {
    const unhandledRejections: Error[] = [];
    const handler = (err: Error) => unhandledRejections.push(err);

    process.on("unhandledRejection", handler);

    try {
      // Test with send failure
      const failedSend = Promise.reject(new Error("Send failed"));
      autoDelete(failedSend, 100);

      // Test with delete failure
      const mockDelete = vi.fn().mockRejectedValue(new Error("Delete failed"));
      const mockMessage = {
        deletable: true,
        delete: mockDelete,
      } as unknown as Message;
      autoDelete(mockMessage, 100);

      await vi.advanceTimersByTimeAsync(100);
      await vi.runAllTimersAsync();

      // Flush microtasks to ensure all promises settle
      await new Promise((resolve) => process.nextTick(resolve));

      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", handler);
    }
  });
});
