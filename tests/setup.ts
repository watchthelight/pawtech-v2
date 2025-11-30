/**
 * Pawtropolis Tech — tests/setup.ts
 * WHAT: Global Vitest setup for deterministic tests.
 * WHY: Disable schedulers, use fake timers, ensure cache always stale.
 *
 * This file runs before EVERY test file via the setupFiles config in vitest.config.ts.
 * Changes here affect all tests - be careful about side effects.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { beforeAll, afterEach, vi } from "vitest";

beforeAll(() => {
  // The metrics scheduler runs background jobs on intervals. In tests, these
  // would fire unpredictably and cause flaky failures. Disabling entirely.
  process.env.METRICS_SCHEDULER_DISABLED = "1";

  // TTL=1ms means "always refetch" - prevents tests from accidentally passing
  // due to stale cached data from a previous test run. We want fresh data.
  // Note: LRUCache requires TTL > 0, so we use 1ms instead of 0.
  process.env.MOD_METRICS_TTL_MS = "1";
});

afterEach(() => {
  // Clean up any fake timers a test might have installed. If we don't do this,
  // a test using vi.useFakeTimers() would leak into subsequent tests.
  vi.clearAllTimers();
  // Restore real timers so the next test starts with a clean slate.
  // Without this, setTimeout/setInterval would remain mocked.
  vi.useRealTimers();
});
