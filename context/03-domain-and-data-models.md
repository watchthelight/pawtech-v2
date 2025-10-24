## Domain and Data Models

Core entities, relationships, and schema definitions for the application verification system.

---

## Entity Relationship Diagram

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│guild_question│     │  application    │     │review_action │
│              │     │                 │     │              │
│ guild_id (FK)│     │ id (PK)         │ >>> │ app_id (FK)  │
│ q_index      │     │ guild_id        │     │ moderator_id │
│ prompt       │     │ user_id         │     │ action       │
│ required     │     │ status          │     │ reason       │
└──────────────┘     │ created_at      │     │ created_at   │
                     └────┬────────────┘     └──────────────┘
                          │
                          │
        ┌─────────────────┼─────────────────────┐
        │                 │                     │
   ┌────▼──────────┐ ┌────▼──────────┐   ┌─────▼────────┐
   │application_   │ │avatar_scan    │   │modmail_ticket│
   │  response     │ │               │   │              │
   │               │ │ application_id│   │ app_code     │
   │ app_id (FK)   │ │ nsfw_score    │   │ user_id      │
   │ q_index       │ │ edge_score    │   │ thread_id    │
   │ answer        │ │ final_pct     │   │ status       │
   └───────────────┘ └───────────────┘   └──────────────┘
```

---

## Core Tables

### `application`

**Purpose:** Tracks user verification applications and their lifecycle.

**Schema:** Auto-created in [src/db/db.ts](../src/db/db.ts), migrated in [src/db/ensure.ts](../src/db/ensure.ts)

**Key columns:**
```sql
CREATE TABLE application (
  id TEXT PRIMARY KEY,              -- ULID (sortable, unique)
  guild_id TEXT NOT NULL,           -- Discord guild snowflake
  user_id TEXT NOT NULL,            -- Discord user snowflake
  status TEXT NOT NULL,             -- draft | submitted | approved | rejected | needs_info | kicked
  created_at TEXT NOT NULL,         -- ISO8601 timestamp
  submitted_at TEXT,                -- NULL until status='submitted'
  permanently_rejected INTEGER NOT NULL DEFAULT 0,  -- Boolean (1=banned from reapplying)
  permanent_reject_at TEXT          -- Timestamp of permanent rejection
);

CREATE UNIQUE INDEX idx_applicants_guild_user
  ON application(guild_id, user_id, status);

CREATE INDEX idx_application_status_created
  ON application(status, created_at);
```

**Status flow:**
```
draft → submitted → (approved | rejected | kicked)
                  ↓
              needs_info → submitted (resubmission)
```

**Business rules:**
- One active application per user per guild
- `permanently_rejected=1` blocks future applications ([src/features/review.ts](../src/features/review.ts) L820-850)
- ULID primary key ensures sortability by creation time

---

### `application_response`

**Purpose:** Stores question answers for each application.

**Schema:**
```sql
CREATE TABLE application_response (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,             -- References application.id
  q_index INTEGER NOT NULL,         -- Question index (matches guild_question.q_index)
  question TEXT NOT NULL,           -- Snapshot of question prompt
  answer TEXT NOT NULL,             -- User's answer (max 1000 chars)
  FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
);

CREATE INDEX idx_responses_app ON application_response(app_id);
```

**Notes:**
- Question text is denormalized (snapshot) to preserve history even if questions change
- Cascade delete ensures cleanup when applications are deleted

---

### `guild_question`

**Purpose:** Defines per-guild application form questions.

**Schema:**
```sql
CREATE TABLE guild_question (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  q_index INTEGER NOT NULL,         -- Display order (0-based)
  prompt TEXT NOT NULL,             -- Question text shown to user
  required INTEGER NOT NULL DEFAULT 1,  -- Boolean (1=required, 0=optional)
  UNIQUE(guild_id, q_index)
);
```

**Usage:**
- Configured manually via SQL inserts (no UI yet)
- Read by [src/features/gate/questions.ts](../src/features/gate/questions.ts) `getQuestions()`
- Questions paginated into modals (5 per page, 45 char labels)

**Example:**
```sql
INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES
  ('123456789012345678', 0, 'What brings you to our community?', 1),
  ('123456789012345678', 1, 'Have you read our rules?', 1),
  ('123456789012345678', 2, 'Any additional info to share?', 0);
```

---

### `review_action`

**Purpose:** Audit trail of all moderation actions on applications.

**Schema:**
```sql
CREATE TABLE review_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,       -- Discord user who performed action
  action TEXT NOT NULL,             -- approve | reject | kick | need_info | claim | perm_reject
  reason TEXT,                      -- Free-text reason (optional)
  message_link TEXT,                -- Discord message URL for context
  meta TEXT,                        -- JSON metadata (DM delivery status, etc.)
  created_at INTEGER NOT NULL,      -- Unix timestamp
  FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
);

CREATE INDEX idx_review_action_app_time ON review_action(app_id, created_at DESC);
CREATE INDEX idx_review_moderator ON review_action(moderator_id, created_at DESC);
```

**Notes:**
- No CHECK constraint on `action` (free-text for future actions)
- Migrated from TEXT to INTEGER `created_at` for performance (see [src/db/ensure.ts](../src/db/ensure.ts) L259-348)
- Used by mod performance analytics ([src/features/modPerformance.ts](../src/features/modPerformance.ts))

---

### `avatar_scan`

**Purpose:** Stores ONNX-based NSFW detection results for applicant avatars.

**Schema:**
```sql
CREATE TABLE avatar_scan (
  application_id TEXT PRIMARY KEY,
  avatar_url TEXT,
  nsfw_score REAL DEFAULT NULL,     -- ONNX model output (0.0-1.0)
  edge_score REAL DEFAULT 0,        -- Edge detection score (skin tone boundary)
  final_pct INTEGER DEFAULT 0,      -- Weighted composite (0-100)
  furry_score REAL DEFAULT 0,       -- Heuristic: furry art detection
  scalie_score REAL DEFAULT 0,      -- Heuristic: scalie art detection
  reason TEXT,                      -- Human-readable risk reason
  evidence_hard TEXT,               -- High-risk evidence (JSON)
  evidence_soft TEXT,               -- Medium-risk evidence (JSON)
  evidence_safe TEXT,               -- Low-risk evidence (JSON)
  scanned_at TEXT,                  -- ISO8601 scan timestamp
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX ux_avatar_scan_application ON avatar_scan(application_id);
```

**Scoring logic:** [src/features/avatarScan.ts](../src/features/avatarScan.ts) L200-350
- `final_pct = (nsfw_score * 0.7) + (edge_score * 0.3)` (configurable weights)
- Results displayed on review cards if `GATE_SHOW_AVATAR_RISK=1`

---

### `modmail_ticket`

**Purpose:** Tracks private thread DM bridges between staff and applicants.

**Schema:**
```sql
CREATE TABLE modmail_ticket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  app_code TEXT,                    -- HEX6 code linking to application
  review_message_id TEXT,           -- Review card message ID
  thread_id TEXT,                   -- Private thread ID
  thread_channel_id TEXT,           -- Parent channel of thread
  status TEXT NOT NULL DEFAULT 'open',  -- open | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  log_channel_id TEXT,              -- Where transcript was posted
  log_message_id TEXT               -- Transcript message ID
);

CREATE UNIQUE INDEX idx_modmail_open_unique
  ON modmail_ticket(guild_id, user_id, status)
  WHERE status = 'open';
```

**Workflow:** [src/features/modmail.ts](../src/features/modmail.ts)
1. Staff clicks "Open Modmail" button
2. Bot creates private thread, inserts row with `status='open'`
3. Messages route bidirectionally (thread ↔ user DM)
4. On close: set `status='closed'`, archive thread, post transcript

---

### `modmail_message`

**Purpose:** Maps thread message IDs to DM message IDs for reply threading.

**Schema:**
```sql
CREATE TABLE modmail_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('to_user','to_staff')),
  thread_message_id TEXT,
  dm_message_id TEXT,
  reply_to_thread_message_id TEXT,
  reply_to_dm_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(thread_message_id),
  UNIQUE(dm_message_id)
);
```

**Use case:** Preserves Discord reply chains when routing messages between thread and DMs.

---

### `guild_config`

**Purpose:** Per-guild settings for gate, roles, channels, and thresholds.

**Schema:**
```sql
CREATE TABLE guild_config (
  guild_id TEXT PRIMARY KEY,
  unverified_role_id TEXT,          -- Role assigned until approved
  verified_role_id TEXT,            -- Role assigned on approval
  review_channel_id TEXT,           -- Channel where review cards appear
  gate_channel_id TEXT,             -- Channel with "Start Verification" button
  welcome_channel_id TEXT,          -- Channel for welcome messages
  logging_channel_id TEXT,          -- Channel for action logs
  mod_role_ids TEXT,                -- CSV of moderator role IDs
  review_roles_mode TEXT NOT NULL DEFAULT 'level_only',  -- none | level_only | all
  avatar_scan_weight_model REAL NOT NULL DEFAULT 0.7,
  avatar_scan_weight_edge REAL NOT NULL DEFAULT 0.3,
  updated_at_s INTEGER NOT NULL
);
```

**Access:** [src/lib/config.ts](../src/lib/config.ts) `getConfig(guildId)`

---

### `action_log`

**Purpose:** High-level action audit for analytics (PR5 mod metrics).

**Schema:**
```sql
CREATE TABLE action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  app_id TEXT,                      -- NULL for non-app actions (e.g., member_join)
  app_code TEXT,
  actor_id TEXT NOT NULL,
  subject_id TEXT,
  action TEXT NOT NULL,             -- member_join | app_submitted | claim | approve | reject | etc.
  reason TEXT,
  meta_json TEXT,
  created_at_s INTEGER NOT NULL
);

CREATE INDEX idx_action_log_guild_time ON action_log(guild_id, created_at_s DESC);
CREATE INDEX idx_action_log_actor_time ON action_log(actor_id, created_at_s DESC);
```

**Used by:**
- `/modstats` command ([src/commands/modstats.ts](../src/commands/modstats.ts))
- Analytics dashboard ([src/web/api/metrics.ts](../src/web/api/metrics.ts))

---

## Validation Rules

### Application Submission
- **Draft persistence:** Answers auto-save on modal page submit ([src/features/gate.ts](../src/features/gate.ts) L300-450)
- **Required fields:** Empty answers rejected if `guild_question.required=1`
- **Answer length:** Max 1000 characters per answer
- **One active app:** UNIQUE constraint on `(guild_id, user_id, status)` prevents duplicates

### Avatar Scanning
- **Auto-triggered:** On application submit ([src/features/gate.ts](../src/features/gate.ts) L550-580)
- **Non-blocking:** Runs async, doesn't delay submission
- **Failure handling:** Graceful degradation (review card shows "Scan failed")

### Permanent Rejection
- **Irreversible:** `permanently_rejected=1` cannot be undone via UI (requires manual SQL)
- **Reapplication block:** Checked before allowing new application ([src/features/review.ts](../src/features/review.ts) L835)

### Modmail
- **Race prevention:** `open_modmail` table uses PRIMARY KEY `(guild_id, applicant_id)` to prevent duplicate threads
- **Auto-close:** Modmail tickets closed automatically on approve/reject/kick

---

## Invariants

1. **Application uniqueness:** No two `status='submitted'` applications for same user in same guild
2. **Review claim exclusivity:** `review_claim` table enforces one moderator per application
3. **Thread singularity:** `open_modmail` ensures max one open thread per user per guild
4. **Answer completeness:** All required questions must have answers before `status='submitted'`
5. **Audit trail immutability:** `review_action` and `action_log` rows are append-only (never updated/deleted)

---

## Schema Migrations

**Strategy:** Idempotent additive migrations run on every startup ([src/db/ensure.ts](../src/db/ensure.ts))

**Key migrations:**
- `ensureAvatarScanSchema()` - Adds avatar scanning columns
- `ensureApplicationPermaRejectColumn()` - Adds permanent rejection support
- `ensureOpenModmailTable()` - Creates race-safe modmail tracking
- `ensureReviewActionFreeText()` - Removes CHECK constraint, converts `created_at` to INTEGER
- `ensureActionLogSchema()` - Creates action audit table

**Verification:**
```bash
npm run migrate:dry  # Preview changes
npm run migrate      # Apply migrations
```

---

## Data Retention

- **No automatic deletion:** All data persisted indefinitely
- **Manual cleanup:** Admins must manually delete old applications
- **Backup strategy:** Copy `data/data.db` file regularly

**Example cleanup query:**
```sql
-- Delete approved applications older than 90 days
DELETE FROM application
WHERE status = 'approved'
  AND datetime(created_at) < datetime('now', '-90 days');
```

---

## Next Steps

- Configure guild questions: See [02-setup-and-running.md](02-setup-and-running.md)
- Review validation logic: See [src/features/gate.ts](../src/features/gate.ts) L200-300
- Understand modmail flow: See [src/features/modmail.ts](../src/features/modmail.ts)
