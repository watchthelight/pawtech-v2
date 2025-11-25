/**
 * Pawtropolis Tech — tests/setup.ts
 * WHAT: Global Vitest setup for deterministic tests.
 * WHY: Disable schedulers, use fake timers, ensure cache always stale.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { beforeAll, afterEach, vi } from "vitest";

beforeAll(() => {
  // Disable metrics scheduler in tests
  process.env.METRICS_SCHEDULER_DISABLED = "1";

  // Cache always stale in tests (TTL = 0)
  process.env.MOD_METRICS_TTL_MS = "0";
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
