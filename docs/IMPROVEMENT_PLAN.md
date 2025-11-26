# Pawtropolis Bot Improvement Plan

Generated: 2025-11-26

This document outlines identified improvements, bugs, and technical debt discovered during a comprehensive codebase audit.

---

## High Priority Issues

### 1. O(N) Full Table Scan on Short Code Lookup

**Location:** `src/features/review.ts` lines 248-289

**Issue:** The `findAppByShortCode()` function performs a full table scan of ALL applications in a guild every time it's called, computing shortCode() in JavaScript for each row:

```typescript
const rows = db
  .prepare(`
    SELECT id, guild_id, user_id, status, submitted_at, updated_at, created_at
    FROM application
    WHERE guild_id = ?
  `)
  .all(guildId) as ApplicationRow[];

for (const row of rows) {
  try {
    if (shortCode(row.id) === cleaned) {
      return row;
    }
  } catch (err) {
    continue;
  }
}
```

**Impact:** For guilds with 10,000+ applications, this loads and iterates through all rows on EVERY review action.

**Note:** `src/features/appLookup.ts` has an optimized O(1) implementation using the `app_short_codes` table, but `review.ts` has a duplicate slow implementation.

**Fix:** Remove duplicate from `review.ts` and import from `appLookup.ts`.

---

### 2. Duplicate findAppByShortCode Implementations

**Locations:**
- `src/features/review.ts` lines 248-289 (slow, full scan)
- `src/features/appLookup.ts` lines 50-96 (optimized, uses mapping table)

**Issue:** Two different implementations exist, creating inconsistent behavior depending on which module is imported.

**Fix:**
1. Delete the implementation in `review.ts`
2. Add `import { findAppByShortCode } from "./appLookup.js";` to review.ts
3. Search for other duplicates: `grep -r "export function findAppByShortCode" src/`

---

### 3. Silent Error Swallowing in Critical Logging

**Locations:**
- `src/features/levelRewards.ts` lines 51, 145, 169, 193
- `src/features/review.ts` lines 764, 832, 986, 1072, 1141, 1254, 1382

**Issue:** Critical logging calls use `.catch(() => {})` which silently swallows errors:

```typescript
await logActionPretty(guild, {
  actorId: botId,
  action: "role_grant",
  // ...
}).catch(() => {}); // Silent failure
```

**Impact:**
- No audit trail when logging fails
- Debugging impossible
- Security/compliance risk

**Fix:** Replace with:
```typescript
.catch((err) => {
  logger.warn({ err, action: "role_grant", userId: member.id },
    "[levelRewards] Failed to log action - audit trail incomplete");
})
```

---

### 4. Missing Index for Analytics Queries

**Location:** `src/commands/modstats.ts` lines 143, 298, 451, 678

**Issue:** Multiple heavy analytics queries filter by `action` column without an index:

```sql
SELECT actor_id, COUNT(*) as total,
  SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approvals,
  ...
FROM action_log
WHERE guild_id = ?
  AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'modmail_open')
  AND created_at_s >= ?
```

**Impact:** Full table scan on every `/modstats` command.

**Fix:** Add composite index:
```sql
CREATE INDEX IF NOT EXISTS idx_action_log_guild_action_created
ON action_log(guild_id, action, created_at_s);
```

---

## Medium Priority Issues

### 5. Review Action Insert Outside Transaction

**Location:** `src/features/review.ts` lines 960-967, 1045-1050

**Issue:** Claim/unclaim operations insert into `review_action` table OUTSIDE the atomic transaction:

```typescript
// This happens AFTER claimTx completes (not in same transaction)
try {
  db.prepare(
    `INSERT INTO review_action (app_id, moderator_id, action, created_at) VALUES (?, ?, 'claim', ?)`
  ).run(app.id, interaction.user.id, Math.floor(Date.now() / 1000));
} catch (err) {
  logger.warn({ err, appId: app.id }, "[review] failed to insert review_action (non-fatal)");
}
```

**Impact:** If the insert fails, claim is recorded in `review_claim` but NOT in `review_action`, creating inconsistent audit trails.

**Fix:** Move the `review_action` insert INSIDE the transaction in `reviewActions.ts`.

---

### 6. Modmail Thread Race Condition

**Location:** `src/features/modmail.ts` lines 1196-1406

**Issue:** The modmail thread creation flow has a potential race condition:

1. Check if thread exists (line 1200)
2. If not, create thread (line ~1250)
3. Insert into DB (line 1273)

If two moderators click "Modmail" simultaneously, both could pass the check.

**Current Mitigation:** UNIQUE constraint catches duplicates (good), but one thread becomes orphaned.

**Fix:** Wrap check + create + insert in a database transaction.

---

### 7. No Permission Check Before Posting Review Card

**Location:** `src/features/review.ts` lines 2593-2666

**Issue:** `ensureReviewMessage()` fetches the review channel but doesn't check if bot has `SendMessages` or `EmbedLinks` permissions before posting.

**Impact:** Bot fails to post review cards with permission error, but application is already marked as submitted.

**Fix:** Add permission check similar to `getLoggingChannel()` in `logger.ts` lines 78-101.

---

### 8. Inconsistent Error Handling Patterns

**Locations:** Multiple files

**Issue:** Error handling is inconsistent:
- `review.ts` transactions: Throw on errors
- `welcome.ts`: Throw errors with messages
- `roleAutomation.ts`: Return `{ success: false, error: "..." }`
- Other places: Catch and return null

**Impact:** Callers don't know how to handle errors consistently.

**Fix:** Standardize on one pattern:
- **Option A:** Always return result objects: `{ success: boolean, data?: T, error?: string }`
- **Option B:** Use exceptions for unexpected errors, result objects for expected failures

---

## Low Priority Issues

### 9. Three Review Card Builder Versions

**Location:** `src/ui/reviewCard.ts`
- `buildReviewEmbed()` - lines 281-501
- `buildReviewEmbedV2()` - lines 507-623
- `buildReviewEmbedV3()` - lines 690-811

**Issue:** Three versions exist. V3 is used as default, but V1 and V2 are still exported.

**Question:** Are V1 and V2 kept for backward compatibility or can they be removed?

**Fix:** If V3 is final, delete V1 and V2 to reduce maintenance burden.

---

### 10. Member Left But Actions Still Enabled

**Location:** `src/ui/reviewCard.ts` lines 321-323, 538-540

**Issue:** When member leaves server, warning is shown but ALL review actions (approve, reject, kick) remain enabled.

**Question:** Is this intentional? Should approve be disabled if member is no longer present?

**Options:**
- A) Disable action buttons if member left (except reject)
- B) Current behavior is correct (member can be re-invited after approval)
- C) Add "Refresh Member Status" button

---

### 11. Transcript Buffer Has No Size Limit

**Location:** `src/features/modmail.ts` lines 143-166

**Issue:** The `transcriptBuffers` Map grows unbounded:

```typescript
const transcriptBuffers = new Map<number, TranscriptLine[]>();
```

**Impact:** Could be memory-exploited by spamming messages in long-running modmail threads.

**Fix:**
- Add per-ticket message limit (e.g., 1000 messages)
- Flush to database periodically
- Clear buffers after successful flush (already done on close)

---

### 12. Level Rewards Don't Track Grant History

**Location:** `src/features/roleAutomation.ts` lines 199-212

**Issue:** `assignRole()` checks if user already has role, but doesn't check if it was PREVIOUSLY granted as a reward.

**Scenario:**
1. User reaches Level 5, gets "Token Holder" role
2. Moderator manually removes "Token Holder" role
3. User reaches Level 10 - should they get "Token Holder" again?

**Question:** Should rewards be granted multiple times if manually removed? Or should there be a `rewards_granted` history table?

---

### 13. Avatar Scan Evidence Not Validated

**Location:** `src/ui/reviewCard.ts` lines 46-56

**Issue:** The `evidence` field structure is complex but never validated:

```typescript
evidence: {
  hard: Array<{ tag: string; p?: number }>;
  soft: Array<{ tag: string; p?: number }>;
  safe: Array<{ tag: string; p?: number }>;
};
```

**Impact:** If avatar scan API changes format, accessing `evidence.hard` could crash.

**Fix:** Add Zod schema validation or null checks.

---

### 14. Missing Foreign Key on modmail_message

**Location:** `src/db/db.ts` lines 182-196

**Issue:** `modmail_message` table has no foreign key to `modmail_ticket`:

```sql
ticket_id INTEGER NOT NULL,  -- No FOREIGN KEY constraint
```

**Impact:** If a ticket is deleted, orphaned messages remain.

**Fix:** Add foreign key:
```sql
ticket_id INTEGER NOT NULL REFERENCES modmail_ticket(id) ON DELETE CASCADE,
```

---

### 15. Embed Size Estimation Incomplete

**Location:** `src/ui/reviewCard.ts` lines 670-684

**Issue:** `estimateEmbedSize()` only counts title, description, footer text, and fields. Doesn't count author name, footer icon URL, or timestamp.

**Impact:** Embeds might exceed Discord's 6000 character limit.

**Fix:** Add all fields to calculation, or use safety margin (check against 5500).

---

### 16. Regex Allows Two Formats for perm_reject Button

**Location:** `src/lib/modalPatterns.ts` line 20

**Issue:** Regex accepts both `permreject` and `perm_reject`:

```typescript
export const BTN_PERM_REJECT_RE = /^(?:v1:decide|review):(permreject|perm_reject):code([0-9A-F]{6})$/;
```

But only `perm_reject` is used in `reviewCard.ts` line 638.

**Fix:** Pick one format and simplify regex.

---

### 17. No Rate Limiting on Application Submissions

**Location:** `src/features/gate.ts`

**Issue:** A user could potentially submit multiple applications by rapidly clicking submit before first transaction completes.

**Current Mitigation:** Checks for existing drafts/submitted apps (lines 158-176).

**Fix:** Add cooldown Map to enforce 1 submission per 5 seconds per user.

---

## Implementation Priority

### Immediate (This Week)
- [ ] Fix duplicate `findAppByShortCode` - import optimized version
- [ ] Add `idx_action_log_guild_action_created` index
- [ ] Replace silent `.catch(() => {})` with warning logs
- [ ] Move review_action inserts into transactions

### Short-Term (Next Sprint)
- [ ] Add permission checks before posting review cards
- [ ] Wrap modmail thread creation in transaction
- [ ] Standardize error handling patterns
- [ ] Add Zod validation for avatar scan evidence

### Long-Term (Backlog)
- [ ] Remove unused V1/V2 embed builders (after confirming not needed)
- [ ] Add foreign key constraints to database schema
- [ ] Implement rate limiting on application submissions
- [ ] Add per-ticket message limits to transcript buffers
- [ ] Consider rewards_granted history table

---

## Questions for Product Decision

1. **Member left server:** Should review actions be disabled when applicant leaves?
2. **Level rewards:** Should manually-removed rewards be re-granted on next level up?
3. **Embed versions:** Can V1 and V2 review card builders be deleted?

---

## Files Reference

| Category | Files |
|----------|-------|
| Performance | `src/features/review.ts`, `src/features/appLookup.ts` |
| Error Handling | `src/features/levelRewards.ts`, `src/features/review.ts`, `src/logging/pretty.ts` |
| Database | `src/db/db.ts`, `src/features/reviewActions.ts` |
| UI/UX | `src/ui/reviewCard.ts` |
| Modmail | `src/features/modmail.ts` |
