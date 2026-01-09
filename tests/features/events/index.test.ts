/**
 * Pawtropolis Tech — tests/features/events/index.test.ts
 * WHAT: Unit tests for events barrel export.
 * WHY: Verify all event-related exports are accessible.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";

// Mock all dependencies before importing
vi.mock("../../../src/db/db.js", () => ({
  db: { prepare: vi.fn().mockReturnValue({ get: vi.fn(), all: vi.fn(), run: vi.fn() }) },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/store/gameConfigStore.js", () => ({
  getGameConfig: vi.fn(),
}));

vi.mock("../../../src/features/roleAutomation.js", () => ({
  assignRole: vi.fn(),
  removeRole: vi.fn(),
  getRoleTiers: vi.fn(),
}));

vi.mock("../../../src/features/panicStore.js", () => ({
  isPanicMode: vi.fn(),
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn(),
}));

import * as eventsIndex from "../../../src/features/events/index.js";

describe("events/index", () => {
  describe("barrel exports", () => {
    it("exports types from types.ts", () => {
      // Types are compile-time only, but we can verify the module loads
      expect(eventsIndex).toBeDefined();
    });

    it("exports gameNight functions", () => {
      expect(eventsIndex.startGameEvent).toBeDefined();
      expect(typeof eventsIndex.startGameEvent).toBe("function");

      expect(eventsIndex.getActiveGameEvent).toBeDefined();
      expect(typeof eventsIndex.getActiveGameEvent).toBe("function");

      expect(eventsIndex.isGameEventActive).toBeDefined();
      expect(typeof eventsIndex.isGameEventActive).toBe("function");

      expect(eventsIndex.handleGameVoiceJoin).toBeDefined();
      expect(typeof eventsIndex.handleGameVoiceJoin).toBe("function");

      expect(eventsIndex.handleGameVoiceLeave).toBeDefined();
      expect(typeof eventsIndex.handleGameVoiceLeave).toBe("function");

      expect(eventsIndex.finalizeGameAttendance).toBeDefined();
      expect(typeof eventsIndex.finalizeGameAttendance).toBe("function");

      expect(eventsIndex.getUserQualifiedGameCount).toBeDefined();
      expect(typeof eventsIndex.getUserQualifiedGameCount).toBe("function");

      expect(eventsIndex.getUserTotalEventCount).toBeDefined();
      expect(typeof eventsIndex.getUserTotalEventCount).toBe("function");

      expect(eventsIndex.getGameEventStats).toBeDefined();
      expect(typeof eventsIndex.getGameEventStats).toBe("function");

      expect(eventsIndex.persistAllGameSessions).toBeDefined();
      expect(typeof eventsIndex.persistAllGameSessions).toBe("function");

      expect(eventsIndex.recoverPersistedGameSessions).toBeDefined();
      expect(typeof eventsIndex.recoverPersistedGameSessions).toBe("function");

      expect(eventsIndex.clearPersistedGameSessions).toBeDefined();
      expect(typeof eventsIndex.clearPersistedGameSessions).toBe("function");

      expect(eventsIndex.startGameSessionPersistence).toBeDefined();
      expect(typeof eventsIndex.startGameSessionPersistence).toBe("function");

      expect(eventsIndex.stopGameSessionPersistence).toBeDefined();
      expect(typeof eventsIndex.stopGameSessionPersistence).toBe("function");

      expect(eventsIndex.getGameRecoveryStatus).toBeDefined();
      expect(typeof eventsIndex.getGameRecoveryStatus).toBe("function");

      expect(eventsIndex.addManualGameAttendance).toBeDefined();
      expect(typeof eventsIndex.addManualGameAttendance).toBe("function");

      expect(eventsIndex.creditHistoricalGameAttendance).toBeDefined();
      expect(typeof eventsIndex.creditHistoricalGameAttendance).toBe("function");

      expect(eventsIndex.bumpGameAttendance).toBeDefined();
      expect(typeof eventsIndex.bumpGameAttendance).toBe("function");

      expect(eventsIndex.getCurrentGameSession).toBeDefined();
      expect(typeof eventsIndex.getCurrentGameSession).toBe("function");

      expect(eventsIndex.getAllGameSessions).toBeDefined();
      expect(typeof eventsIndex.getAllGameSessions).toBe("function");

      expect(eventsIndex.updateGameTierRole).toBeDefined();
      expect(typeof eventsIndex.updateGameTierRole).toBe("function");
    });

    it("exports gameQualification functions", () => {
      expect(eventsIndex.calculateGameQualification).toBeDefined();
      expect(typeof eventsIndex.calculateGameQualification).toBe("function");

      expect(eventsIndex.calculateGameSessionQualification).toBeDefined();
      expect(typeof eventsIndex.calculateGameSessionQualification).toBe("function");

      expect(eventsIndex.formatQualificationResult).toBeDefined();
      expect(typeof eventsIndex.formatQualificationResult).toBe("function");

      expect(eventsIndex.minutesNeededToQualify).toBeDefined();
      expect(typeof eventsIndex.minutesNeededToQualify).toBe("function");
    });
  });
});
