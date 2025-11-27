# Test Coverage Implementation Plan

Generated: 2025-11-27

## Executive Summary

This document outlines a comprehensive plan to improve test coverage from approximately 29% to 80%+ across the `commands/`, `features/`, and `lib/` directories.

## Current State Assessment

### Test Infrastructure
- **Framework**: Vitest 3.2.4 with V8 coverage
- **Configuration**: `vitest.config.ts` with globals enabled, node environment
- **Setup**: `tests/setup.ts` handles timer cleanup and env variable isolation

### Coverage by Directory

| Directory | Total Files | Files with Tests | Coverage % |
|-----------|-------------|------------------|------------|
| commands/ | 28 | 1 | 4% |
| features/ | 42 | ~12 (partial) | ~29% |
| lib/ | 27 | 4 | 15% |
| **Total** | 97 | ~17 | **~18%** |

### Currently Tested Modules
- `src/commands/send.ts` (full)
- `src/features/review.ts` (partial - flows only)
- `src/features/gate.ts` (partial - payload only)
- `src/features/panicStore.ts` (full)
- `src/features/modPerformance.ts` (full)
- `src/lib/cmdWrap.ts` (full)
- `src/lib/errorCard.ts` (full)
- `src/lib/timefmt.ts` (full)

---

## Priority Order for Adding Tests

### Tier 1: Critical Path (Week 1-2)

1. **src/lib/errors.ts** - Error classification system
2. **src/lib/retry.ts** - Retry and circuit breaker
3. **src/lib/config.ts** - Guild configuration
4. **src/commands/gate.ts** - Gate command (main user flow)
5. **src/features/review/flows/approve.ts** - Approve flow
6. **src/features/review/flows/reject.ts** - Reject flow
7. **src/features/review/claims.ts** - Claim system

### Tier 2: High Value (Week 3-4)

8. **src/lib/ids.ts** - ID generation and short codes
9. **src/lib/secureCompare.ts** - Security-critical comparison
10. **src/features/modmail.ts** - Modmail system
11. **src/features/avatarScan.ts** - Avatar scanning
12. **src/features/welcome.ts** - Welcome messages
13. **src/commands/modstats.ts** - Moderator statistics
14. **src/features/levelRewards.ts** - Level rewards

### Tier 3: Standard Coverage (Week 5-6)

15. **src/commands/analytics.ts**
16. **src/commands/activity.ts**
17. **src/commands/panic.ts**
18. **src/commands/purge.ts**
19. **src/features/bannerSync.ts**
20. **src/features/movieNight.ts**
21. **src/features/opsHealth.ts**
22. **src/lib/anomaly.ts**
23. **src/lib/percentiles.ts**

### Tier 4: Low Priority (Week 7+)

24. **src/commands/database.ts**
25. **src/commands/backfill.ts**
26. **src/commands/health.ts**
27. **src/features/dbRecovery.ts**
28. **src/lib/startupHealth.ts**

---

## Test Files to Create

### Tier 1 Test Files

#### `tests/lib/errors.test.ts`
```typescript
// Test classifyError() with various error shapes
// Test isRecoverable() for each error kind
// Test shouldReportToSentry() filtering
// Test userFriendlyMessage() for each error type
```
**Estimated effort**: 2-3 hours

#### `tests/lib/retry.test.ts`
```typescript
// Test withRetry() exponential backoff
// Test CircuitBreaker state transitions
// Test withRetryAndBreaker() combined behavior
```
**Estimated effort**: 3-4 hours

#### `tests/lib/config.test.ts`
```typescript
// Test getConfig() with valid/missing guilds
// Test upsertConfig() updates and inserts
// Test permission helpers (hasManageGuild, isReviewer, etc.)
```
**Estimated effort**: 3-4 hours

#### `tests/commands/gate.test.ts`
```typescript
// Test each subcommand: setup, reset, status, config
// Test executeAccept/executeReject/executeKick flows
// Test permission checks
// Test claim guard integration
```
**Estimated effort**: 6-8 hours

#### `tests/features/review/approve.test.ts`
```typescript
// Test approveFlow() role assignment
// Test permission error handling (50013)
// Test DM delivery success/failure
// Test welcome card posting
```
**Estimated effort**: 4-5 hours

#### `tests/features/review/reject.test.ts`
```typescript
// Test rejectFlow() DM delivery
// Test permanent vs temporary rejection
// Test modmail closure on reject
```
**Estimated effort**: 3-4 hours

#### `tests/features/review/claims.test.ts`
```typescript
// Test claim creation/retrieval
// Test claim guard blocking
// Test claim timeout behavior
// Test clearClaim()
```
**Estimated effort**: 2-3 hours

---

## Testing Utilities to Create

### 1. Discord Mock Factory (`tests/utils/discordMocks.ts`)
```typescript
export function createMockInteraction(overrides?: Partial<ChatInputCommandInteraction>)
export function createMockGuild(overrides?: Partial<Guild>)
export function createMockMember(overrides?: Partial<GuildMember>)
export function createMockChannel(overrides?: Partial<TextChannel>)
export function createMockUser(overrides?: Partial<User>)
export function createMockMessage(overrides?: Partial<Message>)
```
**Estimated effort**: 4-5 hours

### 2. Database Fixture Factory (`tests/utils/dbFixtures.ts`)
```typescript
export function seedTestGuild(guildId: string)
export function seedTestApplication(appData: Partial<Application>)
export function seedTestUser(userId: string)
export function seedActionLog(entries: ActionLogEntry[])
export function cleanupTestData(guildId: string)
```
**Estimated effort**: 3-4 hours

### 3. Command Context Factory (`tests/utils/contextFactory.ts`)
```typescript
export function createTestCommandContext(
  interaction: ChatInputCommandInteraction
): CommandContext
```
**Estimated effort**: 1-2 hours

---

## Example Test Patterns

### Pattern 1: Command Test with Mocked Interaction
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockInteraction } from "../utils/discordMocks.js";

describe("/example command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle success case", async () => {
    const interaction = createMockInteraction({
      options: {
        getString: vi.fn().mockReturnValue("test"),
      } as any,
    });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Success") })
    );
  });
});
```

### Pattern 2: Feature Test with Real Database
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let testDb: Database.Database;
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "test-"));
  testDb = new Database(join(tempDir, "test.db"));
});

afterAll(() => {
  testDb.close();
  rmSync(tempDir, { recursive: true, force: true });
});
```

### Pattern 3: Module Mock with vi.hoisted()
```typescript
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

import { functionUnderTest } from "../../src/lib/something.js";
```

---

## Effort Estimates Summary

| Phase | Files | Hours | Calendar |
|-------|-------|-------|----------|
| Utilities | 3 | 8-11 | 2 days |
| Tier 1 | 7 | 23-31 | 5-6 days |
| Tier 2 | 7 | 25-32 | 5-7 days |
| Tier 3 | 9 | 20-25 | 4-5 days |
| Tier 4 | 5 | 10-12 | 2-3 days |
| **Total** | **31** | **86-111** | **18-23 days** |

---

## Success Metrics

1. **Coverage Goal**: 80%+ line coverage across commands/, features/, lib/
2. **Test Count**: Add ~200+ test cases
3. **CI Integration**: All tests pass in CI before merge
4. **Documentation**: Each test file includes docblocks explaining test strategy

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Discord.js type complexity | Use minimal stub pattern with `as unknown as Type` |
| SQLite state leakage | Use isolated temp databases per test file |
| Async timing issues | Use fake timers consistently |
| Module mock ordering | Always use vi.hoisted() for ESM |
