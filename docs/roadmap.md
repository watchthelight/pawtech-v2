# Roadmap, Open Issues, and Tasks

## P1–P3 Completed Summary

### P1r: Core Review Flow (Complete)

**Delivered**: Application submission via `/gate`, claim/unclaim workflow, approve/reject with DM notifications, basic action logging.

**Key Features**:

- Modal-based application form (name, age, reason, referral)
- Atomic claim logic preventing race conditions
- Review cards with interactive buttons ([Claim], [Unclaim])
- DM templates for acceptance/rejection
- Status tracking (pending → claimed → accepted/rejected)

**Metrics**:

- Average review time: 18h (target: <24h) ✅
- Acceptance rate: 65% (target: 60–70%) ✅

### P2r: Modmail and Logging Infrastructure (Complete)

**Delivered**: DM ↔ thread routing, close/reopen operations, action log database, pretty card framework.

**Key Features**:

- Persistent threads for each user in modmail channel
- Bidirectional message mirroring (user DM ↔ staff thread)
- Thread close/reopen with auto-archive
- `action_log` table for audit trail
- Pretty card embeds (color-coded, structured fields)

**Known Issues**:

- Permission 50013 errors when bot lacks `ManageThreads`
- Threads sometimes not archived (compensation job needed)

### P3r: Analytics and Configuration (Complete)

**Delivered**: `/modstats` (leaderboard + user modes), `/send` anonymous broadcasts, `/config` guild settings, pretty card posting to logging channel.

**Key Features**:

- Leaderboard: claims, accepts, rejects, avg response time per moderator
- User drill-down: per-moderator KPIs, activity sparkline (ASCII)
- `/send`: Anonymous message relay for staff broadcasts
- `/config set logging`: Guild-specific logging channel (blocked by missing column)
- Pretty cards posted to configurable logging channel

**Known Issues**:

- `logging_channel_id` column missing (SQLite error on `/config set logging`)
- Pretty cards not emitted for some actions (logAction() not called)
- Sentry 403 unauthorized (telemetry disabled)
- History not persisting on review cards until claim

---

## Now (Critical Blockers)

### 1. Add `logging_channel_id` Column to `configs` Table

**Issue**: `/config set logging` fails with `SqliteError: no such column: configs.logging_channel_id`.

**Impact**: Cannot configure guild-specific logging channels; all guilds use env var fallback (or no logging).

**Tasks**:

- [ ] Write migration script: `migrations/001_add_logging_channel_id.ts`
- [ ] Add column: `ALTER TABLE configs ADD COLUMN logging_channel_id TEXT`
- [ ] Backfill with `LOGGING_CHANNEL` env var for existing guilds
- [ ] Update `logger.ts`: prefer DB column, fallback to env var
- [ ] Update `/config set logging` handler to use new column
- [ ] Test: `/config set logging channel:#test` → verify no errors
- [ ] Deploy to production

**Acceptance Criteria**:

- ✅ `/config set logging` completes without SQLite error
- ✅ Logging cards posted to DB-configured channel (not env fallback)
- ✅ `/config get logging` returns correct channel ID
- ✅ Env var fallback still works if DB column NULL

**Priority**: P0 (blocks all logging channel config)

**ETA**: 1 day

---

### 2. Fix Blocked `review_action` Migration (Legacy SQL Guard)

**Issue**: Migration to rename `review_action` column blocked by better-sqlite3 safety check.

**Impact**: Deprecated `review_action` column still in schema; new code uses `reason` (TEXT) but can't remove old column.

**Tasks**:

- [ ] Implement create-copy-swap migration (see `migrations/002_review_action_to_reason.ts` in context file 07)
- [ ] Backup production DB before running
- [ ] Run migration in dev environment; verify data integrity
- [ ] Deploy migration to production (off-hours, low traffic)
- [ ] Remove deprecated `review_action` column references in code (search codebase)
- [ ] Verify `/accept` and `/reject` commands populate `reason` correctly

**Acceptance Criteria**:

- ✅ `review_action` table has `reason` column (TEXT)
- ✅ No `review_action` column in schema (PRAGMA table_info)
- ✅ All historical data migrated (SELECT COUNT(\*) matches pre-migration)
- ✅ New accepts/rejects populate `reason` field
- ✅ Foreign key integrity check passes (PRAGMA foreign_key_check)

**Priority**: P1 (technical debt; blocks schema cleanup)

**ETA**: 2 days

---

### 3. Ensure Review History Persists on Application Submit

**Issue**: Applications missing from `/modstats` until first moderator action (claim).

**Root Cause**: No `action_log` row exists on submission; queries using `INNER JOIN` exclude pending apps.

**Tasks**:

- [ ] Update `gate.ts` submit handler: insert `action_log` row with `action='submit'`, `moderator_id='0'` (system)
- [ ] Update analytics queries: use `LEFT JOIN action_log` instead of `INNER JOIN`
- [ ] Test: submit application → immediately run `/modstats` → verify app appears in pending queue
- [ ] Backfill existing applications:
  ```sql
  INSERT INTO action_log (app_id, moderator_id, action, timestamp)
  SELECT id, '0', 'submit', submitted_at FROM review_action
  WHERE id NOT IN (SELECT DISTINCT app_id FROM action_log);
  ```
- [ ] Deploy and verify backfill in production

**Acceptance Criteria**:

- ✅ All new applications have `submit` action in `action_log`
- ✅ `/modstats` shows pending apps in leaderboard denominator
- ✅ Backfilled applications count in analytics
- ✅ No duplicate `submit` actions (unique constraint or check before insert)

**Priority**: P1 (data accuracy issue)

**ETA**: 1 day

---

### 4. Fix Sentry 403 Unauthorized

**Issue**: Telemetry disabled; no error tracking in production.

**Impact**: Blind to runtime issues; cannot track error rates or performance.

**Tasks**:

- [ ] Verify Sentry DSN in project settings (Client Keys page)
- [ ] Test DSN with `curl` (see context file 09)
- [ ] Rotate DSN if expired/revoked
- [ ] Update `.env` with new DSN
- [ ] Restart bot; verify Sentry dashboard shows events
- [ ] Test error capture: trigger `/health` with invalid DB → check Sentry issue created

**Acceptance Criteria**:

- ✅ Sentry dashboard shows events from production bot
- ✅ No 403 errors in logs
- ✅ Test exception appears in Sentry Issues
- ✅ Performance traces visible in Sentry Performance tab

**Priority**: P1 (observability gap)

**ETA**: 1 day

---

### 5. Fix Pretty Card Emission for Accept/Reject

**Issue**: Review decisions logged to DB but no embed posted to logging channel.

**Root Cause**: Multiple factors (see context file 09):

1. `logging_channel_id` missing (fix in task #1)
2. `logAction()` function not called in accept/reject handlers
3. Env var fallback not triggered

**Tasks**:

- [ ] Audit all command handlers: ensure `logAction()` called after DB update
- [ ] Add integration tests: verify card posted for each action type
- [ ] Add fallback logging: if card post fails, log JSON to console
- [ ] Verify bot permissions in logging channel on startup
- [ ] Deploy fixes

**Acceptance Criteria**:

- ✅ All accept/reject operations emit pretty cards
- ✅ Cards visible in logging channel within 1 second of action
- ✅ If channel unreachable, fallback JSON log appears in journalctl
- ✅ No silent failures (all errors logged)

**Priority**: P0 (audit trail gap)

**ETA**: 1 day

---

## Next (Feature Enhancements)

### 6. Richer `/modstats` Analytics

**Goal**: Expand analytics with percentiles, heatmaps, CSV export.

**Features**:

- **Percentiles**: P50, P75, P95 response times (not just average)
- **Heatmaps**: Claims by hour-of-day and day-of-week (ASCII sparkline)
- **Export**: `/modstats export` → CSV download (like `/analytics-export`)

**Tasks**:

- [ ] Implement percentile calculation in SQL or post-process in JS
- [ ] Add heatmap generation (count claims by `strftime('%w', timestamp)` for day-of-week)
- [ ] Create CSV exporter:
  ```typescript
  const csv = stats.map((row) => `${row.reviewer_id},${row.claims},${row.avg_time}`).join("\n");
  const buffer = Buffer.from(csv);
  await interaction.reply({ files: [{ attachment: buffer, name: "modstats.csv" }] });
  ```
- [ ] Update `/modstats` command to support `export:true` option
- [ ] Test with large datasets (>1000 reviews)

**Acceptance Criteria**:

- ✅ `/modstats mode:leaderboard` shows P95 response time
- ✅ `/modstats mode:user` includes activity heatmap (7-day sparkline)
- ✅ `/modstats export:true` returns CSV attachment
- ✅ CSV columns: moderator_id, claims, accepts, rejects, avg_time, p50_time, p95_time

**Priority**: P2 (nice-to-have)

**ETA**: 1 week

---

### 7. Modmail Permission Hardening

**Goal**: Gracefully handle permission 50013 errors; auto-detect and fix.

**Features**:

- Startup permission validation (exit if missing critical perms)
- Retry logic for thread archive failures
- Compensation job to sync DB state with Discord state
- Admin alerts when permissions missing

**Tasks**:

- [ ] Add startup check: verify `SendMessagesInThreads`, `ManageThreads` in modmail channel
- [ ] Implement retry with exponential backoff for archive operations
- [ ] Create sync job: `scripts/sync-modmail-threads.ts` (run daily via cron)
- [ ] Post alert in admin channel when permission error detected
- [ ] Document required permissions in deployment guide

**Acceptance Criteria**:

- ✅ Bot exits on startup if missing critical permissions (with helpful error message)
- ✅ Archive failures auto-retry 3 times before giving up
- ✅ Daily sync job fixes stuck threads (DB says closed but Discord shows open)
- ✅ Admin channel receives alert: "Missing permission: ManageThreads in #modmail"

**Priority**: P2 (reliability improvement)

**ETA**: 3 days

---

### 8. Enhanced Logging Channel Fallback

**Goal**: Make env var fallback actually work; add multi-tier fallback.

**Tiers**:

1. DB config (`configs.logging_channel_id`)
2. Env var (`LOGGING_CHANNEL`)
3. Default admin channel (configurable)
4. Console JSON logs (current behavior)

**Tasks**:

- [ ] Update `getLoggingChannel()`: implement all fallback tiers
- [ ] Add `DEFAULT_ADMIN_CHANNEL` to guild config
- [ ] Log warnings when falling back (track in action_log metadata)
- [ ] Test all fallback scenarios in dev environment
- [ ] Deploy and verify fallback chain

**Acceptance Criteria**:

- ✅ If DB config NULL, uses env var
- ✅ If env var empty, uses default admin channel
- ✅ If all channels fail, logs JSON to console
- ✅ Warnings logged for each fallback tier used
- ✅ No silent failures (all actions accounted for)

**Priority**: P2 (robustness improvement)

**ETA**: 2 days

---

## Later (Strategic Initiatives)

### 9. Multi-Database Abstraction (PostgreSQL Support)

**Goal**: Enable PostgreSQL backend for scalability and multi-guild deployments.

**Why**: SQLite single-file limits horizontal scaling; Postgres enables connection pooling, replication, sharding.

**Tasks**:

- [ ] Abstract DB layer: create `src/db/interface.ts` with CRUD methods
- [ ] Implement adapters:
  - `src/db/sqlite.ts` (current better-sqlite3 code)
  - `src/db/postgres.ts` (use `pg` or Prisma)
- [ ] Add `DATABASE_TYPE` env var (`sqlite` or `postgres`)
- [ ] Migration strategy: dump SQLite → import to Postgres (one-time)
- [ ] Update all queries to use abstraction layer (no raw SQL)
- [ ] Test suite for both backends

**Acceptance Criteria**:

- ✅ Bot runs on PostgreSQL with `DATABASE_TYPE=postgres`
- ✅ All features (gate, modmail, modstats) work identically
- ✅ Migration guide documented in context file 08
- ✅ Performance benchmarks (Postgres vs SQLite) documented

**Priority**: P3 (future scalability)

**ETA**: 1 month

---

### 10. Automated Test Harness

**Goal**: Prevent regressions; test embeds, commands, workflows.

**Scope**:

- Unit tests: DB queries, embed builders, permission checks
- Integration tests: Full command flows (submit → claim → accept)
- Snapshot tests: Validate embed structure (fields, colors, footers)

**Tasks**:

- [ ] Set up Vitest or Jest
- [ ] Mock Discord.js interactions (use `discord.js-mock` or custom factories)
- [ ] Write unit tests:
  - `gate.test.ts`: application validation, DB insert, embed structure
  - `logger.test.ts`: verify card color, fields, fallback logic
  - `modstats.test.ts`: verify SQL queries, percentile calculations
- [ ] Write integration tests:
  - Mock DB (in-memory SQLite), run full command flow (submit → claim → accept)
  - Assert DM sent, role granted, logging card posted
- [ ] CI/CD: GitHub Actions run tests on every PR
- [ ] Target: 80%+ code coverage

**Acceptance Criteria**:

- ✅ All tests pass in CI before merge
- ✅ 80%+ code coverage (commands, features)
- ✅ Mock embeds validated (field count, color, footer text)
- ✅ Integration tests cover happy path + error scenarios

**Priority**: P3 (quality assurance)

**ETA**: 2 weeks

---

### 11. Error Budget and SLO Tracking

**Goal**: Define service-level objectives; track error budget consumption.

**SLOs** (proposed):

- **Availability**: 99.5% uptime (target: <3.6h downtime/month)
- **Review SLA**: 95% of claims decided within 24h
- **Modmail Response SLA**: 90% of threads receive first staff reply within 2h

**Tasks**:

- [ ] Instrument uptime tracking (heartbeat pings to external monitor)
- [ ] Create SLO dashboard (separate from analytics):
  - Current SLA compliance percentage
  - Error budget remaining (e.g., "23h of downtime budget left this month")
- [ ] Alerting: Slack/Discord webhook when SLO breached
- [ ] Document SLOs in context file 09

**Acceptance Criteria**:

- ✅ SLO dashboard shows real-time compliance metrics
- ✅ Alert fires when review SLA drops below 95%
- ✅ Error budget tracked monthly; resets on 1st of month
- ✅ Historical SLO data retained for 12 months

**Priority**: P3 (operational maturity)

**ETA**: 1 week

---

## Open Issues Summary

| Issue                               | Severity | Status  | Owner     | ETA     |
| ----------------------------------- | -------- | ------- | --------- | ------- |
| Missing `logging_channel_id` column | Critical | Planned | Backend   | 1 day   |
| Blocked `review_action` migration   | High     | Planned | Backend   | 2 days  |
| History not persisting on submit    | High     | Planned | Backend   | 1 day   |
| Sentry 403 unauthorized             | High     | Planned | DevOps    | 1 day   |
| Pretty cards not emitted            | Critical | Planned | Backend   | 1 day   |
| Modmail permission 50013            | Medium   | Backlog | Backend   | 3 days  |
| Env var fallback not triggered      | Medium   | Backlog | Backend   | 2 days  |
| Richer modstats analytics           | Low      | Backlog | Analytics | 1 week  |
| PostgreSQL support                  | Low      | Idea    | Backend   | 1 month |
| Test harness                        | Medium   | Idea    | QA        | 2 weeks |
| SLO tracking                        | Low      | Idea    | DevOps    | 1 week  |

---

## Test Coverage Plan

### Current Coverage: ~0% (No Tests)

**Target**: 80% code coverage by end of Q1.

### Priority Test Suites

| Module           | Test Type   | Coverage Target | Priority |
| ---------------- | ----------- | --------------- | -------- |
| `gate.ts`        | Unit        | 90%             | P0       |
| `review.ts`      | Unit        | 90%             | P0       |
| `modmail.ts`     | Unit        | 85%             | P1       |
| `logger.ts`      | Unit        | 95%             | P0       |
| `modstats.ts`    | Unit        | 80%             | P2       |
| Command handlers | Integration | 75%             | P1       |
| DB queries       | Unit        | 90%             | P0       |
| Embed builders   | Snapshot    | 100%            | P1       |

### Example Test Cases

**Gate Tests** (`gate.test.ts`):

```typescript
describe('Application Submission', () => {
  it('should reject applications from users under 18', async () => {
    const result = await submitApplication({ age: 17, ... });
    expect(result.error).toBe('You must be 18 or older to join.');
  });

  it('should insert application into database', async () => {
    const appId = await submitApplication({ age: 25, ... });
    const app = db.prepare('SELECT * FROM review_action WHERE id = ?').get(appId);
    expect(app).toBeDefined();
    expect(app.status).toBe('pending');
  });

  it('should post review card in review channel', async () => {
    const appId = await submitApplication({ age: 25, ... });
    const message = await reviewChannel.messages.fetch(app.review_message_id);
    expect(message.embeds[0].title).toContain(`Application #${appId}`);
  });
});
```

**Logger Tests** (`logger.test.ts`):

```typescript
describe("Pretty Card Builder", () => {
  it("should use green color for accept actions", () => {
    const card = buildAcceptCard(123, "mod_id", "Great applicant");
    expect(card.data.color).toBe(0x2ecc71);
  });

  it("should include all required fields", () => {
    const card = buildAcceptCard(123, "mod_id", "Reason text");
    const fieldNames = card.data.fields.map((f) => f.name);
    expect(fieldNames).toEqual(["Application ID", "User", "Moderator", "Response Time", "Reason"]);
  });
});
```

---

## Actionable Recommendations

### Immediate (This Week)

1. **Deploy migration 001**: Add `logging_channel_id` column (unblocks `/config set logging`).
2. **Fix card emission**: Audit all handlers, ensure `logAction()` called.
3. **Backfill submit actions**: Insert initial `action_log` rows for existing applications.
4. **Fix Sentry 403**: Rotate DSN or disable until resolved.

### Short-Term (This Month)

1. **Deploy migration 002**: Clean up `review_action` column (technical debt).
2. **Implement permission checks**: Validate on startup, exit if missing critical perms.
3. **Enhance env fallback**: Make multi-tier fallback work reliably.
4. **Write first test suite**: Start with `gate.test.ts` (highest risk area).

### Long-Term (Next Quarter)

1. **Build test harness**: Achieve 80% coverage across core modules.
2. **Implement SLO tracking**: Monitor error budget, alert on SLA breaches.
3. **Evaluate Postgres migration**: Prototype DB abstraction layer, benchmark performance.
4. **Expand modstats**: Add percentiles, heatmaps, CSV export.

---

## Success Metrics

| Metric                        | Current | Target (Q1) | Target (Q2) |
| ----------------------------- | ------- | ----------- | ----------- |
| Code coverage                 | 0%      | 80%         | 90%         |
| Logging channel config uptime | 0%      | 100%        | 100%        |
| Pretty card emission rate     | ~80%    | 100%        | 100%        |
| Sentry error tracking uptime  | 0%      | 99%         | 99.9%       |
| Review SLA compliance (24h)   | ~90%    | 95%         | 98%         |
| Modmail response SLA (2h)     | ~85%    | 90%         | 95%         |
| Production incidents/month    | ~2      | <1          | 0           |
