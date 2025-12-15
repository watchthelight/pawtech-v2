# Database Schema

The bot uses SQLite stored at `./data/data.db`. All timestamps are ISO 8601 format. Discord IDs are stored as TEXT.

## Main Tables

### configs
Stores server settings.

```sql
CREATE TABLE configs (
  guild_id TEXT PRIMARY KEY,
  review_channel_id TEXT,
  modmail_channel_id TEXT,
  member_role_id TEXT,
  moderator_role_id TEXT,
  acceptance_message TEXT,
  rejection_message TEXT,
  auto_kick_rejected INTEGER DEFAULT 0,
  require_claim INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Known Issue:** `logging_channel_id` column is missing. Need to add it with a migration.

### review_action
Stores join applications.

```sql
CREATE TABLE review_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  age INTEGER NOT NULL,
  reason TEXT NOT NULL,
  referral TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  claimed_by TEXT,
  claimed_at TEXT,
  decided_at TEXT,
  submitted_at TEXT NOT NULL,
  review_message_id TEXT,
  CHECK (status IN ('pending', 'accepted', 'rejected'))
);
```

### action_log
Logs all moderator actions.

```sql
CREATE TABLE action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER,
  thread_id TEXT,
  moderator_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES review_action(id) ON DELETE CASCADE
);
```

### open_modmail
Tracks modmail tickets.

```sql
CREATE TABLE open_modmail (
  thread_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  related_app_id INTEGER,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT,
  reopened_at TEXT,
  transcript TEXT,
  FOREIGN KEY (related_app_id) REFERENCES review_action(id) ON DELETE SET NULL
);
```

### user_activity
Tracks join times and flags for bot detection.

```sql
CREATE TABLE user_activity (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  first_message_at INTEGER,
  flagged_at INTEGER,
  flagged_reason TEXT,
  manual_flag INTEGER DEFAULT 0,
  flagged_by TEXT,
  PRIMARY KEY (guild_id, user_id)
);
```

## Running Migrations

Migrations are in `migrations/` folder with numbered files like `033_audit_sessions.ts`.

Run them with:
```bash
npm run migrate
```

## Common Queries

**Pending applications:**
```sql
SELECT * FROM review_action WHERE status = 'pending' AND claimed_by IS NULL;
```

**Moderator stats:**
```sql
SELECT moderator_id, COUNT(*) as actions
FROM action_log
WHERE action IN ('accept', 'reject')
GROUP BY moderator_id;
```

**Open modmail tickets:**
```sql
SELECT * FROM open_modmail WHERE status = 'open';
```

## Adding logging_channel_id

To fix the missing column:

```typescript
// migrations/XXX_add_logging_channel.ts
export function migrate() {
  db.prepare("ALTER TABLE configs ADD COLUMN logging_channel_id TEXT").run();
}
```

Then run `npm run migrate`.
