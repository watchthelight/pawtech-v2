# Pawtropolis Tech - Configuration Store

This folder contains guild-specific configuration stores with environment variable fallbacks.

## 📁 Folder Contents

| File              | Purpose                       | Exports                                                          |
| ----------------- | ----------------------------- | ---------------------------------------------------------------- |
| `loggingStore.ts` | Logging channel configuration | `getLoggingChannelId`, `setLoggingChannelId`                     |
| `flaggerStore.ts` | Flagger system configuration  | `getFlaggerConfig`, `setFlagsChannelId`, `setSilentFirstMsgDays` |

## 🎯 Purpose

Configuration stores provide a unified pattern for managing guild-specific settings with graceful fallback to environment variables. This allows:

1. **Per-guild customization** - Each guild can override defaults
2. **Environment fallback** - Sensible defaults from `.env` file
3. **Graceful degradation** - Works even during database migrations
4. **Type safety** - Explicit interfaces for all config objects

## 🏗️ Architecture

### Configuration Priority

All configuration follows this resolution order:

```
1. Database (guild_config table) - Per-guild override
   ↓
2. Environment Variables (.env) - Global default
   ↓
3. Hard-coded Default - Fallback value
```

### Database Table

All configuration is stored in the `guild_config` table:

```sql
CREATE TABLE guild_config (
  guild_id              TEXT PRIMARY KEY,
  logging_channel_id    TEXT,           -- Logging store
  flags_channel_id      TEXT,           -- Flagger store
  silent_first_msg_days INTEGER,        -- Flagger store
  -- ... other config fields ...
  updated_at            TEXT NOT NULL
);
```

## 📚 Logging Store (`loggingStore.ts`)

Manages the logging channel where audit logs and moderator actions are posted.

### Functions

#### `getLoggingChannelId(guildId: string): string | null`

Get the logging channel ID for a guild.

**Resolution priority:**

1. `guild_config.logging_channel_id` (database)
2. `LOGGING_CHANNEL` (environment variable)
3. `null` (no logging)

**Example:**

```typescript
import { getLoggingChannelId } from "./config/loggingStore.js";

const channelId = getLoggingChannelId(interaction.guildId);
if (channelId) {
  const channel = await guild.channels.fetch(channelId);
  await channel.send({ embeds: [logEmbed] });
}
```

**Error handling:**

- Gracefully handles missing `guild_config` table
- Gracefully handles missing `logging_channel_id` column
- Logs debug message on database errors

#### `setLoggingChannelId(guildId: string, channelId: string): void`

Set the logging channel ID for a guild (upsert).

**Usage:**

```typescript
import { setLoggingChannelId } from "./config/loggingStore.js";

// Called by /config set logging command
setLoggingChannelId(interaction.guildId, channel.id);
```

**Error handling:**

- Throws if `logging_channel_id` column doesn't exist
- Provides helpful error message with migration instructions
- Idempotent (safe to call multiple times)

**Database operation:**

```sql
INSERT INTO guild_config (guild_id, logging_channel_id, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(guild_id) DO UPDATE SET
  logging_channel_id = excluded.logging_channel_id,
  updated_at = excluded.updated_at
```

### Environment Variables

```env
# Global default logging channel (applied to all guilds without override)
LOGGING_CHANNEL=1234567890123456789
```

### Related Commands

- `/config set logging <channel>` - Set logging channel for guild
- `/config get logging` - Show current logging channel

## 📚 Flagger Store (`flaggerStore.ts`)

Manages the "Silent-Since-Join First-Message Flagger" configuration.

### Types

```typescript
export interface FlaggerConfig {
  channelId: string | null; // Where to post flag reports
  silentDays: number; // Threshold in days (7-365)
}
```

### Functions

#### `getFlaggerConfig(guildId: string): FlaggerConfig`

Get flagger configuration for a guild.

**Resolution priority (channelId):**

1. `guild_config.flags_channel_id` (database)
2. `FLAGGED_REPORT_CHANNEL_ID` (environment variable)
3. `null` (no flagging)

**Resolution priority (silentDays):**

1. `guild_config.silent_first_msg_days` (database)
2. `SILENT_FIRST_MSG_DAYS` (environment variable)
3. `90` (default threshold)

**Example:**

```typescript
import { getFlaggerConfig } from "./config/flaggerStore.js";

const config = getFlaggerConfig(interaction.guildId);
if (config.channelId) {
  const channel = await guild.channels.fetch(config.channelId);
  const daysSinceJoin = getDaysSinceJoin(member);

  if (daysSinceJoin >= config.silentDays) {
    await channel.send({
      content: `⚠️ ${member.user.tag} first message after ${daysSinceJoin} days of silence`,
    });
  }
}
```

**Error handling:**

- Gracefully handles missing `guild_config` table
- Gracefully handles missing columns
- Logs debug message on database errors

#### `setFlagsChannelId(guildId: string, channelId: string): void`

Set flags channel ID for a guild (upsert).

**Usage:**

```typescript
import { setFlagsChannelId } from "./config/flaggerStore.js";

// Called by /config set flags.channel command
setFlagsChannelId(interaction.guildId, channel.id);
```

**Error handling:**

- Throws if `flags_channel_id` column doesn't exist
- Provides helpful error message with migration instructions
- Idempotent (safe to call multiple times)

#### `setSilentFirstMsgDays(guildId: string, days: number): void`

Set silent first message threshold for a guild (upsert).

**Validation:**

- Days must be between 7 and 365
- Throws error if out of range

**Usage:**

```typescript
import { setSilentFirstMsgDays } from "./config/flaggerStore.js";

// Called by /config set flags.silent_days command
setSilentFirstMsgDays(interaction.guildId, 120);
```

**Error handling:**

- Validates input range (7-365 days)
- Throws if `silent_first_msg_days` column doesn't exist
- Provides helpful error message with migration instructions
- Idempotent (safe to call multiple times)

### Environment Variables

```env
# Global default flags channel (applied to all guilds without override)
FLAGGED_REPORT_CHANNEL_ID=1234567890123456789

# Global default silent threshold in days (applied to all guilds without override)
SILENT_FIRST_MSG_DAYS=90
```

### Related Commands

- `/config set flags.channel <channel>` - Set flags channel for guild
- `/config set flags.silent_days <days>` - Set silent threshold for guild
- `/config get flags` - Show current flags configuration

## 🔧 Common Patterns

### Graceful Degradation

All config stores handle missing database tables/columns gracefully:

```typescript
try {
  const row = db.prepare(`SELECT column FROM guild_config WHERE guild_id = ?`).get(guildId);
  if (row?.column) {
    return row.column;
  }
} catch (err) {
  // Gracefully handle missing table/column (pre-migration databases)
  logger.debug({ err, guildId }, "[store] Failed to query, falling back to env");
}

// Fallback to environment variable
return process.env.ENV_VAR || DEFAULT_VALUE;
```

**Why this matters:**

- Bot can start before migrations run
- Prevents crashes during database schema changes
- Provides smooth upgrade path

### Upsert Pattern

All setters use SQLite's `ON CONFLICT` for idempotent updates:

```typescript
db.prepare(
  `
  INSERT INTO guild_config (guild_id, column, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    column = excluded.column,
    updated_at = excluded.updated_at
`
).run(guildId, value, now);
```

**Benefits:**

- No need to check if row exists first
- Atomic operation (no race conditions)
- Safe to call multiple times

### Error Messages

All setters provide helpful error messages for missing columns:

```typescript
catch (err: unknown) {
  const error = err as Error;
  if (error?.message?.includes("has no column named column_name")) {
    logger.error({ err, guildId }, "[store] Missing column - run migrations");
    throw new Error(
      "Database schema is outdated. Please run migrations (tsx scripts/migrate.ts), then try again."
    );
  }
  throw err;
}
```

**User-facing benefits:**

- Clear explanation of problem
- Actionable fix instructions
- Prevents cryptic SQLite errors

## 🧪 Testing

### Unit Testing

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { getLoggingChannelId, setLoggingChannelId } from "./loggingStore.js";

describe("loggingStore", () => {
  beforeEach(() => {
    // Reset test database
  });

  it("should return null when no config exists", () => {
    const channelId = getLoggingChannelId("test-guild");
    expect(channelId).toBeNull();
  });

  it("should return guild-specific channel after setting", () => {
    setLoggingChannelId("test-guild", "channel-123");
    const channelId = getLoggingChannelId("test-guild");
    expect(channelId).toBe("channel-123");
  });

  it("should fall back to environment variable", () => {
    process.env.LOGGING_CHANNEL = "env-channel-456";
    const channelId = getLoggingChannelId("new-guild");
    expect(channelId).toBe("env-channel-456");
  });
});
```

### Manual Testing

```bash
# Start bot in development
npm run dev

# In Discord:
/config set logging #audit-log
/config get logging

/config set flags.channel #flagged-users
/config set flags.silent_days 120
/config get flags
```

## 🐛 Debugging

### Enable Debug Logging

```env
LOG_LEVEL=debug
```

### Check Database State

```bash
sqlite3 data/data.db

-- View guild configs
SELECT * FROM guild_config;

-- Check specific guild
SELECT * FROM guild_config WHERE guild_id = '1234567890';

-- View schema
.schema guild_config
```

### Common Issues

**"Database schema is outdated"**

```bash
# Run migrations
npm run migrate
```

**"Failed to query guild_config"**

- Migration 001 hasn't run yet
- Table/column doesn't exist
- Check debug logs for details

**Configuration not taking effect**

- Check database value: `SELECT * FROM guild_config WHERE guild_id = ?`
- Check environment variable: `echo $LOGGING_CHANNEL`
- Restart bot to reload config

## 📝 Adding a New Config Store

### 1. Create Store File

```bash
touch src/config/myConfigStore.ts
```

### 2. Define Interface

```typescript
export interface MyConfig {
  settingOne: string | null;
  settingTwo: number;
}
```

### 3. Implement Getter

```typescript
export function getMyConfig(guildId: string): MyConfig {
  let settingOne: string | null = null;
  let settingTwo: number = 42; // Default

  try {
    const row = db
      .prepare(`SELECT setting_one, setting_two FROM guild_config WHERE guild_id = ?`)
      .get(guildId) as { setting_one: string | null; setting_two: number | null } | undefined;

    if (row) {
      if (row.setting_one) settingOne = row.setting_one;
      if (row.setting_two !== null) settingTwo = row.setting_two;
    }
  } catch (err) {
    logger.debug({ err, guildId }, "[myConfig] Failed to query, falling back to env");
  }

  // Fallback to env
  if (!settingOne) settingOne = process.env.MY_SETTING_ONE || null;
  if (!settingTwo) settingTwo = Number(process.env.MY_SETTING_TWO) || 42;

  return { settingOne, settingTwo };
}
```

### 4. Implement Setters

```typescript
export function setMySettingOne(guildId: string, value: string): void {
  const now = new Date().toISOString();

  try {
    db.prepare(
      `
      INSERT INTO guild_config (guild_id, setting_one, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        setting_one = excluded.setting_one,
        updated_at = excluded.updated_at
    `
    ).run(guildId, value, now);

    logger.info({ guildId, value }, "[myConfig] setting_one updated");
  } catch (err: unknown) {
    const error = err as Error;
    if (error?.message?.includes("has no column named setting_one")) {
      throw new Error("Database schema is outdated. Run migrations.");
    }
    throw err;
  }
}
```

### 5. Create Migration

```bash
touch migrations/012_add_my_config.ts
```

### 6. Add to `/config` Command

Update `src/commands/config.ts` to support new settings.

## 🔒 Security Considerations

### Input Validation

Always validate user input before storing:

```typescript
export function setSetting(guildId: string, value: string): void {
  // Validate
  if (!value || value.length > 100) {
    throw new Error("Invalid value");
  }

  // Store
  db.prepare(`...`).run(guildId, value, now);
}
```

### Channel Permissions

Verify bot has access to channels before storing:

```typescript
const channel = await guild.channels.fetch(channelId);
if (!channel) {
  throw new Error("Channel not found");
}

if (!channel.isTextBased()) {
  throw new Error("Channel must be a text channel");
}

// Now safe to store
setLoggingChannelId(guildId, channelId);
```

### SQL Injection

All config stores use prepared statements (safe by default):

```typescript
// ✅ SAFE: Prepared statement
db.prepare(`SELECT * FROM guild_config WHERE guild_id = ?`).get(guildId);

// ❌ UNSAFE: String interpolation (DO NOT DO THIS)
db.exec(`SELECT * FROM guild_config WHERE guild_id = '${guildId}'`);
```

## 📊 Performance

### Caching

Currently no caching (queries database on every call). If needed, add in-memory cache:

```typescript
const cache = new Map<string, { value: any; expiresAt: number }>();

export function getLoggingChannelId(guildId: string): string | null {
  // Check cache
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Query database
  const value = queryDatabase(guildId);

  // Cache for 5 minutes
  cache.set(guildId, {
    value,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return value;
}
```

### Database Indexes

`guild_config` table has primary key on `guild_id` (automatic index).

No additional indexes needed for config lookups (always by guild_id).

## 🔗 Related Documentation

- [Database Schema](../../docs/context/07_Database_Schema_and_Migrations.md)
- [Configuration Command](../commands/config.ts)
- [Migrations Guide](../../migrations/README.md)
- [Environment Variables](../../docs/context/08_Deployment_Config_and_Env.md)

---

**Questions?** See [docs/CONTRIBUTING.md](../../docs/CONTRIBUTING.md) or open an issue.
