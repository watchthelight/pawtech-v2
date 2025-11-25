# System Architecture Overview

## High-Level Component Map

```
┌─────────────────────────────────────────────────────────────┐
│                       Discord Gateway                        │
│  (Events: interactionCreate, messageCreate, guildMember...)  │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────▼──────────────────┐
        │   Bot Client (discord.js v14)    │
        │  - Event handlers                │
        │  - Command router                │
        └───────┬──────────────────────────┘
                │
    ┌───────────┼───────────────────┐
    │           │                   │
┌───▼───┐  ┌───▼────┐       ┌──────▼──────┐
│ Gate  │  │Modmail │       │   Logger    │
│ (gate.│  │(modmail│       │  (logger.ts)│
│  ts)  │  │  .ts)  │       │             │
└───┬───┘  └───┬────┘       └──────┬──────┘
    │          │                   │
    │          │          ┌────────▼────────┐
    │          │          │  Pretty Cards   │
    │          │          │ (action embeds) │
    │          │          └────────┬────────┘
    │          │                   │
┌───▼──────────▼───────────────────▼─────────┐
│       Database (SQLite, better-sqlite3)    │
│  Tables: configs, review_action, action_   │
│          log, open_modmail                 │
└────────────────┬───────────────────────────┘
                 │
         ┌───────▼────────┐
         │  Telemetry     │
         │  (Sentry SDK)  │
         │  [403 blocked] │
         └────────────────┘
```

## Core Modules

### Commands Layer (`src/commands/*.ts`)

Parses slash commands, validates options, and dispatches to feature modules. Uses Discord.js command handlers with permission checks.

**Key Files**:

- `gate.ts`: `/gate`, `/accept`, `/reject`, `/unclaim`, `/kick`
- `modmail.ts`: `/modmail` (close/reopen)
- `config.ts`: `/config` (get/set guild settings)
- `modstats.ts`: `/modstats` (leaderboard, user drill-down)
- `send.ts`: `/send` (anonymous broadcasts)
- `analytics.ts`: `/analytics`, `/analytics-export`

### Gate and Review Module (`src/features/gate.ts`, `review.ts`)

Manages application submission, claim/unclaim, approve/reject workflows. Tracks review history in `review_action` table.

**Core Responsibilities**:

- Validate application fields (age, reason length)
- Prevent duplicate claims (atomic DB transactions)
- Generate review cards with interactive buttons
- Send DM notifications to applicants
- Persist review history with free-text reasons

**State Machine**:

```
[Pending] ──claim──> [Claimed] ──accept/reject──> [Decided]
    ▲                    │
    └─────unclaim────────┘
```

### Modmail Module (`src/features/modmail.ts`)

Routes DMs ↔ threads; tracks conversations in `open_modmail` table. Creates persistent threads in designated modmail channel.

**Core Responsibilities**:

- Create thread on first DM from user
- Mirror messages bidirectionally (user DM ↔ staff thread)
- Close/reopen threads via command or auto-archive
- Link modmail threads to applications (`related_app_id`)

**Known Issue**: Permission 50013 errors when bot lacks `SendMessagesInThreads`.

### Logger Module (`src/features/logger.ts`)

Generates "pretty cards" (rich embeds) for all moderator actions and posts to guild-configured logging channel.

**Core Responsibilities**:

- Fetch logging channel from DB (`configs.logging_channel_id`) or env fallback
- Build color-coded embeds (green/red/blue/yellow)
- Handle fallback when channel unreachable (log to console)
- Track action types: `claim`, `unclaim`, `accept`, `reject`, `kick`, `modmail_open`, `modmail_close`, `config_change`

**Known Issue**: `logging_channel_id` column missing from `configs` table; `/config set logging` fails.

### Analytics Module (`src/commands/analytics.ts`, `modstats.ts`)

Queries `review_action` and `action_log` tables to generate performance metrics.

**Metrics Calculated**:

- Total claims, accepts, rejects per moderator
- Average response time (claim → decision)
- Acceptance ratio (accepts / total decisions)
- Leaderboard ranking by claim volume
- Per-moderator KPIs (median/P95 response time)

**Output Formats**: Markdown tables (in-Discord), CSV export (attachment)

## Event and Data Flow

### Application Lifecycle

```
1. User submits /gate form
   ├→ Insert into review_action table (status: pending)
   ├→ Post review card in staff channel (embed + [Claim] button)
   └→ [Known Issue] History not visible until claim action

2. Moderator clicks [Claim]
   ├→ Atomic update: SET claimed_by = moderator_id
   ├→ Insert action_log row (action: claim)
   ├→ [Known Issue] Logger may not post card if channel config broken
   └→ Update card embed (show "Claimed by @Moderator")

3. Moderator runs /accept <app_id> "reason"
   ├→ Validate claim ownership
   ├→ Insert action_log (action: accept, reason: free-text)
   ├→ Update status = accepted
   ├→ Send DM to applicant (approval template)
   ├→ [Known Issue] Pretty card sometimes not emitted
   └→ Grant member role (if configured)

4. (Alternative) /reject <app_id> "reason"
   ├→ Similar flow; status = rejected
   ├→ DM rejection template
   ├→ Optionally kick from guild
```

### Modmail Routing

```
1. User DMs bot
   ├→ Lookup open_modmail by user_id
   ├→ If none: CREATE THREAD → insert row
   ├→ Mirror DM → thread (embed with avatar/timestamp)

2. Staff replies in thread
   ├→ Validate thread exists in open_modmail
   ├→ Send reply to user DM
   ├→ React ✅ to confirm delivery
   ├→ [Known Issue] 50013 error if missing permissions

3. /modmail close
   ├→ SET status = closed
   ├→ Archive + lock thread
   ├→ [Known Issue] Thread sometimes not deleted/archived (permission issue)
   ├→ Send DM: "Conversation closed"
```

## Technology Stack

| Layer       | Technology                   | Notes                                          |
| ----------- | ---------------------------- | ---------------------------------------------- |
| Runtime     | Node.js 20 (LTS)             | ES modules, top-level await supported          |
| Language    | TypeScript 5.x               | Strict mode; built with tsup                   |
| Discord SDK | discord.js v14               | Intents: Guilds, GuildMessages, DirectMessages |
| Database    | better-sqlite3 (SQLite 3.x)  | Synchronous API; file at `./data/data.db`      |
| Build       | tsup (esbuild)               | Fast bundler; outputs ESM to `dist/`           |
| Config      | dotenvx                      | Environment variable loader                    |
| Telemetry   | @sentry/node + OpenTelemetry | 403 unauthorized; awaiting DSN/project fix     |
| Deployment  | Systemd / PM2 (bare-metal)   | No containerization yet; local file DB         |

## Error Handling Strategy

### Database Errors

```typescript
try {
  db.prepare("INSERT INTO review_action ...").run(data);
} catch (error) {
  if (error.code === "SQLITE_CONSTRAINT") {
    // Handle duplicate application
    return interaction.reply({ content: "Already submitted.", ephemeral: true });
  }
  Sentry.captureException(error); // [Known Issue] 403 blocked
  console.error("DB error:", error);
  return interaction.reply({ content: "Database error. Try again.", ephemeral: true });
}
```

### Discord API Errors

```typescript
try {
  await user.send(dmEmbed);
} catch (error) {
  if (error.code === 50007) {
    // Cannot send DM (user blocks bot)
    console.warn(`Cannot DM user ${user.id}: blocked`);
    return; // Continue flow; don't block accept/reject
  }
  throw error; // Re-throw unexpected errors
}
```

### Logging Fallback

```typescript
const loggingChannel = getLoggingChannel(guildId); // DB → env → null
if (!loggingChannel) {
  console.warn("No logging channel; skipping action card");
  // [Known Issue] Fallback never triggers; LOGGING_CHANNEL env not read
  return;
}

try {
  await loggingChannel.send({ embeds: [card] });
} catch (error) {
  console.error(`Failed to post to logging channel:`, error);
  // Fallback: structured console log
  console.log(JSON.stringify({ action, appId, timestamp }));
}
```

## Configuration System

### Guild-Specific Config (`configs` table)

```sql
CREATE TABLE configs (
  guild_id TEXT PRIMARY KEY,
  review_channel_id TEXT,
  modmail_channel_id TEXT,
  member_role_id TEXT,
  acceptance_message TEXT,
  rejection_message TEXT,
  auto_kick_rejected INTEGER DEFAULT 0,
  -- [Missing] logging_channel_id TEXT
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Access Pattern**:

```typescript
const config = db.prepare("SELECT * FROM configs WHERE guild_id = ?").get(guildId);
const reviewChannel = client.channels.cache.get(config.review_channel_id);
```

### Environment Variables

| Variable          | Purpose                     | Fallback             |
| ----------------- | --------------------------- | -------------------- |
| `DISCORD_TOKEN`   | Bot authentication          | _(required)_         |
| `LOGGING_CHANNEL` | Fallback logging channel ID | _(optional)_         |
| `SENTRY_DSN`      | Error tracking endpoint     | _(disabled if null)_ |
| `DATABASE_URL`    | SQLite file path            | `./data/data.db`     |
| `OWNER_IDS`       | Superuser Discord IDs (CSV) | _(optional)_         |

## Concurrency and State Management

**Single-Process Architecture**: No clustering; Discord.js client runs in one event loop.

**SQLite WAL Mode**: Concurrent reads; single writer. Atomic transactions via `db.transaction()`.

**Race Condition Prevention**:

```typescript
// Claim application atomically
db.transaction(() => {
  const app = db.prepare("SELECT claimed_by FROM review_action WHERE id = ?").get(appId);
  if (app.claimed_by !== null) throw new Error("Already claimed");
  db.prepare("UPDATE review_action SET claimed_by = ? WHERE id = ?").run(modId, appId);
})();
```

## Actionable Recommendations

### Architecture Improvements

1. **Add retry logic** to Discord API calls (DM sends, embed posts) with exponential backoff.
2. **Implement circuit breaker** for Sentry (disable after N consecutive 403s).
3. **Centralize config access** in dedicated `ConfigManager` class (cache guild configs in memory).

### Observability Enhancements

1. **Structured logging**: Replace `console.log` with JSON logs (include `timestamp`, `level`, `action`, `userId`).
2. **Health check endpoint**: HTTP server on port 3000 returning `/health` (uptime, DB stats, last event timestamp).
3. **Trace all command invocations** with OpenTelemetry spans (measure latency, identify bottlenecks).

### Database Optimization

1. **Add indexes** on `review_action.claimed_by`, `action_log.timestamp`, `open_modmail.user_id`.
2. **Vacuum DB weekly**: `sqlite3 data.db "VACUUM;"` to reclaim space.
3. **Implement DB migrations framework** (track applied migrations in `schema_migrations` table).

### Error Recovery

1. **Graceful degradation**: If logging channel unreachable, queue cards in DB (`pending_logs` table) and retry on next boot.
2. **Auto-retry modmail sends**: If thread creation fails (50013), log warning and notify admin channel.
3. **Validate permissions on startup**: Check bot has required permissions in review/modmail/logging channels; exit if missing.
