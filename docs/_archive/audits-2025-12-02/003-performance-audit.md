# Performance Audit Plan

**Audit Date:** 2025-12-02
**Priority:** High
**Estimated Scope:** ~8 files modified

---

## Executive Summary

The codebase has good performance foundations (batching, caching, WAL mode) but suffers from critical N+1 query patterns in modstats, blocking rate limiting in NSFW audit, and missing database indexes for common query patterns.

---

## Critical Issues

### 1. N+1 Query: Modstats Leaderboard Member Fetching

**Impact:** HIGH - 1.5-3 second delay per command
**Location:** `src/commands/modstats/leaderboard.ts:124-142`

**Current Code:**
```typescript
for (let i = 0; i < displayRows.length; i++) {
  const row = displayRows[i];
  // N+1 QUERY: One API call per moderator (15-100 calls)
  const member = await interaction.guild?.members.fetch(row.actor_id);
  displayName = member?.displayName || "Unknown";
}
```

**Problem:** For 15 visible rows, this makes 15 sequential Discord API calls. For CSV export with 100 rows, it's 100 calls. Each takes 50-200ms.

**Fix:**
```typescript
// Batch fetch all members at once
const memberIds = displayRows.map(r => r.actor_id);
const members = await interaction.guild?.members.fetch({ user: memberIds });

for (let i = 0; i < displayRows.length; i++) {
  const row = displayRows[i];
  const member = members?.get(row.actor_id);
  displayName = member?.displayName || "Unknown";
}
```

**Expected improvement:** 1.5-3 seconds → 100-300ms (single API call)

**Files to modify:**
- `src/commands/modstats/leaderboard.ts`

---

### 2. N+1 Query: Average Claim-to-Decision Calculation

**Impact:** HIGH - 750+ queries per leaderboard command
**Location:** `src/commands/modstats/helpers.ts:62-132`

**Current Code:**
```typescript
export function getAvgClaimToDecision(guildId: string, actorId: string, since: number): number | null {
  // Query 1: Get all decisions
  const decisions = db.prepare(`
    SELECT app_id, created_at_s
    FROM action_log
    WHERE guild_id = ? AND actor_id = ?
      AND action IN ('approve', 'reject', 'perm_reject', 'kick')
      AND created_at_s >= ?
  `).all(guildId, actorId, since);

  for (const decision of decisions) {
    // N+1: Separate query for EACH decision to find matching claim
    const claim = db.prepare(`
      SELECT created_at_s
      FROM action_log
      WHERE guild_id = ? AND app_id = ? AND actor_id = ? AND action = 'claim'
      AND created_at_s < ?
      ORDER BY created_at_s DESC LIMIT 1
    `).get(guildId, decision.app_id, actorId, decision.created_at_s);
  }
}
```

**Problem:** If each of 15 moderators has 50 decisions, that's 750 additional queries for a single leaderboard command.

**Fix - Single Query with Self-Join:**
```typescript
export function getAvgClaimToDecision(guildId: string, actorId: string, since: number): number | null {
  const result = db.prepare(`
    WITH decisions AS (
      SELECT app_id, created_at_s as decision_time
      FROM action_log
      WHERE guild_id = ? AND actor_id = ?
        AND action IN ('approve', 'reject', 'perm_reject', 'kick')
        AND created_at_s >= ?
    ),
    claims AS (
      SELECT app_id, MAX(created_at_s) as claim_time
      FROM action_log
      WHERE guild_id = ? AND actor_id = ? AND action = 'claim'
      GROUP BY app_id
    )
    SELECT AVG(d.decision_time - c.claim_time) as avg_time
    FROM decisions d
    INNER JOIN claims c ON d.app_id = c.app_id
    WHERE c.claim_time < d.decision_time
  `).get(guildId, actorId, since, guildId, actorId) as { avg_time: number | null };

  return result?.avg_time ?? null;
}
```

**Expected improvement:** 750 queries → 1 query per moderator (15 total)

**Files to modify:**
- `src/commands/modstats/helpers.ts`

---

### 3. N+1 Query: Submit-to-First-Claim Calculation

**Impact:** MEDIUM - 100+ queries per stats command
**Location:** `src/commands/modstats/helpers.ts:144-205`

**Current Code:**
```typescript
export function getAvgSubmitToFirstClaim(guildId: string, since: number): number | null {
  const submissions = db.prepare(`...`).all(guildId, since);  // Query 1

  for (const submission of submissions) {
    // N+1: One query per submission
    const claim = db.prepare(`...`).get(guildId, submission.app_id, submission.created_at_s);
  }
}
```

**Fix - Same self-join pattern:**
```typescript
export function getAvgSubmitToFirstClaim(guildId: string, since: number): number | null {
  const result = db.prepare(`
    WITH submissions AS (
      SELECT app_id, created_at_s as submit_time
      FROM action_log
      WHERE guild_id = ? AND action = 'submit' AND created_at_s >= ?
    ),
    first_claims AS (
      SELECT app_id, MIN(created_at_s) as claim_time
      FROM action_log
      WHERE guild_id = ? AND action = 'claim'
      GROUP BY app_id
    )
    SELECT AVG(c.claim_time - s.submit_time) as avg_time
    FROM submissions s
    INNER JOIN first_claims c ON s.app_id = c.app_id
    WHERE c.claim_time > s.submit_time
  `).get(guildId, since, guildId) as { avg_time: number | null };

  return result?.avg_time ?? null;
}
```

**Expected improvement:** 100 queries → 1 query

**Files to modify:**
- `src/commands/modstats/helpers.ts`

---

### 4. Blocking NSFW Audit Rate Limiting

**Impact:** MEDIUM - 100+ seconds of pure sleep time for 1000 members
**Location:** `src/commands/audit.ts:669-712`

**Current Code:**
```typescript
for (const member of membersToScan) {
  const visionResult = await detectNsfwVision(avatarUrl);

  // Small delay to avoid rate limiting
  await sleep(100);  // ← 100ms sleep per member
}
```

**Problem:** For 1000 members: 1000 × 100ms = 100 seconds of pure sleep time. Google Vision API has much higher rate limits.

**Fix - Use Proper Rate Limiter with Concurrency:**
```typescript
import PQueue from 'p-queue';

// 10 concurrent requests, max 100 per second
const queue = new PQueue({
  concurrency: 10,
  interval: 1000,
  intervalCap: 100
});

const results = await Promise.all(
  membersToScan.map(member =>
    queue.add(() => detectNsfwVision(member.avatarUrl))
  )
);
```

**Alternative - Simple Batch Processing:**
```typescript
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;

for (let i = 0; i < membersToScan.length; i += BATCH_SIZE) {
  const batch = membersToScan.slice(i, i + BATCH_SIZE);

  // Process batch concurrently
  await Promise.all(batch.map(member => detectNsfwVision(member.avatarUrl)));

  // Small delay between batches
  if (i + BATCH_SIZE < membersToScan.length) {
    await sleep(BATCH_DELAY_MS);
  }
}
```

**Expected improvement:** 100 seconds → ~15 seconds (10x concurrent)

**Files to modify:**
- `src/commands/audit.ts`
- `package.json` (add `p-queue` dependency if using that approach)

---

## High Priority Issues

### 5. Missing Composite Indexes

**Impact:** MEDIUM - 4-10x slower queries on large datasets
**Location:** Database schema

**Current indexes on action_log:**
```sql
CREATE INDEX idx_action_log_guild_action_created ON action_log(guild_id, action, created_at_s);
CREATE INDEX idx_action_log_guild_time ON action_log(guild_id, created_at_s DESC);
CREATE INDEX idx_action_log_actor_time ON action_log(actor_id, created_at_s DESC);
CREATE INDEX idx_action_log_app ON action_log(app_id);
```

**Missing indexes for common query patterns:**

**Create migration `migrations/XXX_add_performance_indexes.ts`:**
```typescript
import { db } from "../src/db/db.js";

export function migrate() {
  // For getAvgClaimToDecision (app_id + action + time)
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_action_log_app_action_time
    ON action_log(app_id, action, created_at_s)
  `).run();

  // For modstats actor queries with action filter
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_action_log_actor_action_time
    ON action_log(actor_id, action, created_at_s DESC)
  `).run();

  // For guild queries with app_id filters
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_action_log_guild_app
    ON action_log(guild_id, app_id, created_at_s DESC)
  `).run();

  // For nsfw_flags lookups
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_nsfw_flags_user
    ON nsfw_flags(user_id)
  `).run();

  // For modmail queries
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_modmail_guild_status_user
    ON modmail_ticket(guild_id, status, user_id)
  `).run();
}
```

**Expected improvement:** 20-50ms queries → 2-5ms queries

**Files to create:**
- `migrations/XXX_add_performance_indexes.ts`

---

### 6. Prepared Statement Caching

**Impact:** MEDIUM - 30-50% query overhead
**Location:** All store files

**Current Pattern (Bad):**
```typescript
export function getExample(id: string) {
  // Statement parsed on EVERY call
  return db.prepare("SELECT * FROM examples WHERE id = ?").get(id);
}
```

**Fixed Pattern:**
```typescript
// Statement parsed ONCE at module load
const getExampleStmt = db.prepare("SELECT * FROM examples WHERE id = ?");

export function getExample(id: string) {
  return getExampleStmt.get(id);
}
```

**Files to modify (each store file):**
- `src/store/flagsStore.ts`
- `src/store/nsfwFlagsStore.ts`
- `src/store/auditSessionStore.ts`
- `src/config/loggingStore.ts`
- `src/config/flaggerStore.ts`
- `src/features/panicStore.ts`
- `src/features/statusStore.ts`
- `src/features/artJobs/store.ts`
- `src/features/review/queries.ts`
- ~20 more files with db.prepare() calls

**Approach:**
1. At top of each store file, declare all prepared statements
2. Replace inline `db.prepare()` calls with statement references
3. Verify no dynamic SQL that can't be prepared

---

### 7. Message Buffer Overflow Protection

**Impact:** LOW - Prevents OOM in edge cases
**Location:** `src/features/messageActivityLogger.ts:35`

**Current Code:**
```typescript
const messageBuffer: MessageActivity[] = [];

export function logMessage(message: Message): void {
  messageBuffer.push({...});
  // No limit on buffer size
}
```

**Fix:**
```typescript
const MAX_BUFFER_SIZE = 10000;
const messageBuffer: MessageActivity[] = [];

export function logMessage(message: Message): void {
  if (messageBuffer.length >= MAX_BUFFER_SIZE) {
    logger.warn({ bufferSize: messageBuffer.length }, '[message_activity] Buffer full, dropping oldest messages');
    // Drop oldest 10% to make room
    messageBuffer.splice(0, Math.floor(MAX_BUFFER_SIZE * 0.1));
  }
  messageBuffer.push({...});
}
```

**Files to modify:**
- `src/features/messageActivityLogger.ts`

---

## Verification Steps

After each fix:

1. **For N+1 fixes:**
   - Enable SQLite query logging temporarily
   - Run `/modstats leaderboard` and count queries
   - Before: 750+ queries, After: <50 queries

2. **For rate limiter fix:**
   - Run `/audit nsfw` on test server with 100+ members
   - Time the operation
   - Before: 10+ seconds, After: 2-3 seconds

3. **For index additions:**
   - Run `EXPLAIN QUERY PLAN` on affected queries
   - Verify indexes are being used

4. **For prepared statement caching:**
   - No functional change, just faster
   - Run test suite to verify no regressions

---

## Benchmarking Commands

Add temporary logging to measure improvements:

```typescript
// Before fix
const start = performance.now();
// ... operation
logger.debug({ durationMs: performance.now() - start }, 'Operation completed');
```

---

## Estimated Impact

- **Files modified:** ~25
- **Lines changed:** ~500
- **New dependencies:** Optional (p-queue)
- **Risk level:** Medium (query logic changes)
- **Expected performance gain:**
  - Modstats: 3-5 seconds → 300-500ms
  - NSFW Audit: 100+ seconds → 10-15 seconds
  - General queries: 30-50% faster
