# Pawtropolis Tech - Build & Utility Scripts

This folder contains build scripts, database utilities, and development tools for the Pawtropolis Tech Discord bot.

## 📁 Script Inventory

### Production Scripts (Always Safe)

| Script               | Purpose                          | Usage                 | Safe in Prod?       |
| -------------------- | -------------------------------- | --------------------- | ------------------- |
| `migrate.ts`         | Run database migrations          | `npm run migrate`     | ✅ Yes (idempotent) |
| `scan-legacy.ts`     | Scan for `__old*` tokens         | `npm run scan:legacy` | ✅ Yes (read-only)  |
| `deploy-commands.ts` | Deploy slash commands to Discord | `npm run deploy:cmds` | ✅ Yes              |
| `commands.ts`        | Sync slash commands              | `npm run sync:cmds`   | ✅ Yes              |
| `print-commands.ts`  | Show registered commands         | `npm run print:cmds`  | ✅ Yes (read-only)  |

### Development Scripts

| Script                       | Purpose                  | Usage                                    | Safe in Prod?          |
| ---------------------------- | ------------------------ | ---------------------------------------- | ---------------------- |
| `auth-check.ts`              | Verify Discord bot token | `npm run auth:whoami`                    | ✅ Yes (read-only)     |
| `migrate-logging-channel.ts` | Migrate logging config   | `tsx scripts/migrate-logging-channel.ts` | ⚠️ Careful (writes DB) |

### Testing Scripts

| Script                     | Purpose                 | Usage                                        | Safe in Prod?     |
| -------------------------- | ----------------------- | -------------------------------------------- | ----------------- |
| `test-google-vision.ts`    | Test Google Vision API  | `tsx scripts/test-google-vision.ts`          | ✅ Yes (API test) |
| `test-vision-with-urls.ts` | Test vision with URLs   | `tsx scripts/test-vision-with-urls.ts <url>` | ✅ Yes (API test) |
| `test-e621-vision.ts`      | Test e621 image tagging | `tsx scripts/test-e621-vision.ts`            | ✅ Yes (API test) |

### Legacy/Maintenance Scripts

| Script                    | Purpose                | Usage                                  | Safe in Prod?          |
| ------------------------- | ---------------------- | -------------------------------------- | ---------------------- |
| `check-db.js`             | Verify database schema | `node scripts/check-db.js`             | ✅ Yes (read-only)     |
| `verify-db-integrity.js`  | Check DB integrity     | `node scripts/verify-db-integrity.js`  | ✅ Yes (read-only)     |
| `init-db.js`              | Initialize database    | `node scripts/init-db.js`              | ⚠️ Careful (writes DB) |
| `apply-sql-migrations.js` | Apply SQL migrations   | `node scripts/apply-sql-migrations.js` | ⚠️ Careful (writes DB) |
| `fix-review-action.js`    | Fix review action data | `node scripts/fix-review-action.js`    | ❌ Dev only            |
| `recover-db.ps1`          | Recover corrupted DB   | `powershell scripts/recover-db.ps1`    | ❌ Emergency only      |

## 🚀 Common Tasks

### Deploying Slash Commands

```bash
# Deploy all commands to Discord
npm run deploy:cmds

# Deploy to specific guild (faster for testing)
GUILD_ID=your_guild_id npm run deploy:cmds

# Check what's currently registered
npm run print:cmds
```

### Running Migrations

```bash
# Show pending migrations (dry run)
npm run migrate:dry

# Apply all pending migrations
npm run migrate

# Migrate specific config (legacy)
tsx scripts/migrate-logging-channel.ts
```

### Testing Avatar Scanning

```bash
# Test Google Vision API setup
tsx scripts/test-google-vision.ts

# Test specific avatar URL
tsx scripts/test-vision-with-urls.ts "https://cdn.discordapp.com/avatars/..."

# Test e621 dataset
tsx scripts/test-e621-vision.ts
```

### Database Maintenance

```bash
# Check database schema
node scripts/check-db.js

# Verify database integrity
node scripts/verify-db-integrity.js

# Initialize fresh database (⚠️ destructive)
node scripts/init-db.js
```

### Development Checks

```bash
# Verify bot token is valid
npm run auth:whoami

# Scan for legacy code markers
npm run scan:legacy
```

## 📝 Script Details

### `migrate.ts`

**Purpose**: Run versioned TypeScript migrations in `migrations/` folder.

**Features**:

- Tracks applied migrations in `schema_migrations` table
- Runs migrations in transactions (automatic rollback on error)
- Creates database backup before applying changes
- Supports dry-run mode

**Usage**:

```bash
npm run migrate              # Apply pending migrations
npm run migrate:dry          # Show what would be applied
DB_PATH=./test.db npm run migrate  # Use custom DB path
```

**How it works**:

1. Scans `migrations/` for `NNN_*.ts` files
2. Checks `schema_migrations` table for applied versions
3. Runs pending migrations in order
4. Records each migration in tracking table

### `commands.ts` & `deploy-commands.ts`

**Purpose**: Manage Discord slash command registration.

**Difference**:

- `commands.ts` - Syncs commands (checks what's registered, updates if changed)
- `deploy-commands.ts` - Force deploys all commands (slower, always updates)

**Usage**:

```bash
npm run sync:cmds     # Smart sync (recommended)
npm run deploy:cmds   # Force deploy (use after changes)
```

**Flags**:

- `--all` - Deploy to all guilds (global commands)
- No flags - Deploy to GUILD_ID from .env only

### `scan-legacy.ts`

**Purpose**: Prevent shipping code with `__old*` markers to production.

**Run automatically** during `npm run build`.

**What it checks**:

- Scans `src/` for any `__old` prefixed tokens
- Ignores strings, comments, and log messages
- Fails build if found

**Why**: Ensures legacy/debug code doesn't reach production.

### `test-google-vision.ts`

**Purpose**: Verify Google Vision API is configured correctly.

**Tests**:

- Credentials loaded from `GOOGLE_APPLICATION_CREDENTIALS`
- API connection works
- SafeSearch detection functional

**Usage**:

```bash
tsx scripts/test-google-vision.ts
```

### `migrate-logging-channel.ts`

**Purpose**: One-time migration to move logging config from env var to database.

**When to use**: If you have `LOGGING_CHANNEL` in `.env` and want to store it in DB.

**Usage**:

```bash
tsx scripts/migrate-logging-channel.ts
```

## 🛡️ Safety Guidelines

### Before Running Any Script

1. **Check if it modifies data**: Look for `db.prepare().run()`, `db.exec()`, or `INSERT/UPDATE` statements
2. **Read the script header**: All scripts have WHAT/WHY/HOW documentation
3. **Backup first**: For any destructive operation, backup database:
   ```bash
   cp data/data.db data/data.db.backup-$(date +%Y%m%d)
   ```

### Safe Scripts (Read-Only)

These scripts never modify data:

- `auth-check.ts`
- `print-commands.ts`
- `scan-legacy.ts`
- `check-db.js`
- `verify-db-integrity.js`
- `test-*.ts` (all test scripts)

### Potentially Destructive Scripts

These scripts modify the database or Discord API:

- `migrate.ts` - Writes to DB (but safe, idempotent)
- `deploy-commands.ts` - Updates Discord commands
- `init-db.js` - **Wipes and recreates database**
- `fix-review-action.js` - **Modifies review data**
- `recover-db.ps1` - **Rebuilds database**

**Always backup before running destructive scripts!**

## 🔧 Script Conventions

### TypeScript Scripts (.ts)

**Location**: `scripts/`
**Run with**: `tsx scripts/script-name.ts`
**Or via npm**: `npm run script-alias`

**Template**:

```typescript
/**
 * Pawtropolis Tech — scripts/my-script.ts
 * WHAT: Brief description
 * WHY: Why this script exists
 * HOW: How it works
 * USAGE: How to run it
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import "dotenv/config"; // Load .env

// Script logic here

function main() {
  // Entry point
}

main();
```

### JavaScript Scripts (.js)

**Legacy scripts** - Being migrated to TypeScript.

**Run with**: `node scripts/script-name.js`

### PowerShell Scripts (.ps1)

**Platform**: Windows-specific emergency tools

**Run with**: `powershell scripts/script-name.ps1`

## 📦 Dependencies

Scripts use these key dependencies:

- **dotenv** - Load `.env` file
- **discord.js** - Discord API client
- **better-sqlite3** - SQLite database
- **tsx** - Run TypeScript directly

## 🚨 Troubleshooting

### "Cannot find module" Error

```bash
# Install dependencies first
npm install
```

### "Database locked" Error

```bash
# Stop the bot first
pm2 stop pawtropolis

# Then run script
tsx scripts/migrate.ts

# Restart bot
pm2 restart pawtropolis
```

### "Invalid token" Error

```bash
# Check your .env file has valid DISCORD_TOKEN
npm run auth:whoami
```

### TypeScript Errors

```bash
# Check types
npm run typecheck
```

## 📚 Additional Resources

- [Database Migrations Guide](../migrations/README.md)
- [Deployment Guide](../docs/context/08_Deployment_Config_and_Env.md)
- [Contributing Guide](../docs/CONTRIBUTING.md)

---

**Need to add a new script?** Follow the TypeScript template above and add an entry to this README.
