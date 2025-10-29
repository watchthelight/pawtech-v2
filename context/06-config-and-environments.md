## Config and Environments

Configuration system, environment variables, and deployment profiles.

---

## Configuration Sources

The bot uses a three-tier configuration system:

1. **Environment variables** (`.env` file) - Instance-level settings
2. **Guild config table** (`guild_config`) - Per-guild database settings
3. **Hard-coded constants** - Default values in source code

---

## Environment Variables

**Loading:** `dotenvx` via [src/lib/env.ts](../src/lib/env.ts)

**Precedence:** `.env` file > shell environment > defaults

### Required Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `DISCORD_TOKEN` | String | Bot token from Discord Developer Portal | `MTIzNDU2...` |
| `CLIENT_ID` | String | Application ID for slash command registration | `123456789012345678` |
| `RESET_PASSWORD` | String | Password for `/gate reset` command (destructive) | `strong_password_123` |

### Optional - Core Settings

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | String | `development` | Runtime environment: `development` \| `production` \| `test` |
| `GUILD_ID` | String | `` | Guild ID for faster command sync (dev only) |
| `DB_PATH` | String | `data/data.db` | SQLite database file path |
| `LOG_LEVEL` | String | `info` | Pino log level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` |
| `OWNER_IDS` | String (CSV) | `` | Comma-separated user IDs with owner bypass |

### Optional - Feature Toggles

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GATE_SHOW_AVATAR_RISK` | Boolean | `1` | Show avatar NSFW risk on review cards |
| `TRACE_INTERACTIONS` | Boolean | `0` | Log all interaction events (verbose) |
| `VERBOSE_PAYLOADS` | Boolean | `0` | Log modal field values (debug) |
| `DB_TRACE` | Boolean | `0` | Log all SQL queries (debug) |

### Optional - Sentry Error Tracking

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SENTRY_DSN` | String | `` | Sentry DSN for error tracking |
| `SENTRY_ENVIRONMENT` | String | `production` | Sentry environment label |
| `SENTRY_TRACES_SAMPLE_RATE` | Number | `0.1` | Performance monitoring sample rate (0.0-1.0) |

### Optional - Web Control Panel

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISCORD_CLIENT_SECRET` | String | `` | OAuth2 client secret |
| `DASHBOARD_REDIRECT_URI` | String | `` | OAuth2 callback URL |
| `ADMIN_ROLE_ID` | String | `` | Required role for web panel access |
| `FASTIFY_SESSION_SECRET` | String | `DISCORD_TOKEN` | Session cookie signing secret (min 32 chars) |
| `DASHBOARD_PORT` | String | `3000` | Web server port |
| `CORS_ORIGIN` | String (CSV) | `*` (dev) | Allowed CORS origins |
| `TRUST_PROXY` | Boolean | `0` | Trust X-Forwarded-* headers (nginx/Apache) |

### Optional - Testing

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `TEST_GUILD_ID` | String | `` | Guild ID for integration tests |
| `TEST_REVIEWER_ROLE_ID` | String | `` | Reviewer role ID for tests |

**Full reference:** [ENV_REFERENCE.md](../ENV_REFERENCE.md)

---

## Guild Configuration (`guild_config` table)

**Per-guild settings** stored in SQLite, configured via `/config` commands.

**Schema:**
```sql
CREATE TABLE guild_config (
  guild_id TEXT PRIMARY KEY,

  -- Role IDs
  unverified_role_id TEXT,          -- Role assigned until verified
  verified_role_id TEXT,            -- Role assigned on approval
  mod_role_ids TEXT,                -- CSV of moderator role IDs
  gatekeeper_role_id TEXT,          -- Reserved for future use

  -- Channel IDs
  review_channel_id TEXT,           -- Where review cards appear
  gate_channel_id TEXT,             -- Where gate entry button appears
  welcome_channel_id TEXT,          -- Where welcome messages post
  logging_channel_id TEXT,          -- Where action logs post
  modmail_log_channel_id TEXT,      -- Where modmail transcripts post

  -- Display settings
  review_roles_mode TEXT NOT NULL DEFAULT 'level_only',  -- none | level_only | all

  -- Avatar scan weights
  avatar_scan_weight_model REAL NOT NULL DEFAULT 0.7,
  avatar_scan_weight_edge REAL NOT NULL DEFAULT 0.3,

  -- Metadata
  updated_at_s INTEGER NOT NULL
);
```

**Access pattern:**
```typescript
import { getConfig } from './lib/config.js';

const config = getConfig(guildId);
console.log(config.verified_role_id);  // "123456789012345678"
```

**Configuration commands:**
```bash
# Set config values
/config set mod_role_ids 123,456,789
/config set review_channel_id 987654321
/config set logging_channel_id 111222333

# View current config
/config get mod_role_ids
```

**Stored in:** [src/lib/config.ts](../src/lib/config.ts) L50-200

---

## Environment Profiles

### Development Profile

**File:** `.env.development`

```env
# Authentication
DISCORD_TOKEN=dev_bot_token_here
CLIENT_ID=dev_client_id_here
RESET_PASSWORD=dev_password

# Development settings
NODE_ENV=development
GUILD_ID=your_test_server_id    # Fast command sync
DB_PATH=./data/dev.db
LOG_LEVEL=debug

# Debug features
TRACE_INTERACTIONS=1
VERBOSE_PAYLOADS=1
DB_TRACE=0                       # Enable only when debugging SQL

# Feature toggles
GATE_SHOW_AVATAR_RISK=1

# Sentry (optional in dev)
SENTRY_DSN=
```

**Usage:**
```bash
cp .env.development .env
npm run dev
```

---

### Production Profile

**File:** `.env.production`

```env
# Authentication
DISCORD_TOKEN=prod_bot_token_here
CLIENT_ID=prod_client_id_here
RESET_PASSWORD=strong_random_password_here

# Production settings
NODE_ENV=production
DB_PATH=./data/data.db
LOG_LEVEL=info

# Debug features (disabled)
TRACE_INTERACTIONS=0
VERBOSE_PAYLOADS=0
DB_TRACE=0

# Sentry error tracking
SENTRY_DSN=https://abc123@o123.ingest.sentry.io/456
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# Web control panel
DISCORD_CLIENT_SECRET=oauth2_secret_here
DASHBOARD_REDIRECT_URI=https://yourdomain.com/auth/callback
ADMIN_ROLE_ID=admin_role_id_here
FASTIFY_SESSION_SECRET=random_32_char_string_here
DASHBOARD_PORT=3000
CORS_ORIGIN=https://yourdomain.com
TRUST_PROXY=1                    # Behind nginx/Apache

# Owner access
OWNER_IDS=your_discord_user_id

# Feature toggles
GATE_SHOW_AVATAR_RISK=1
```

**Deployment:**
```bash
# On server
cp .env.production .env
npm run build
npm start
```

---

### Test Profile

**File:** `.env.test`

```env
NODE_ENV=test
DISCORD_TOKEN=fake_token_for_tests
CLIENT_ID=fake_client_id
DB_PATH=:memory:                 # In-memory SQLite
LOG_LEVEL=silent                 # No logs during tests
RESET_PASSWORD=test_password

# Test fixtures
TEST_GUILD_ID=123456789012345678
TEST_REVIEWER_ROLE_ID=987654321098765432
```

**Usage:**
```bash
cp .env.test .env
npm test
```

---

## Configuration Precedence

When multiple sources define the same setting:

1. **Environment variables** (highest priority)
2. **Guild config table** (per-guild overrides)
3. **Hard-coded defaults** (fallback)

**Example:**

```typescript
// Avatar scan weights
const config = getConfig(guildId);

// 1. Check guild_config table
const modelWeight = config.avatar_scan_weight_model ?? 0.7;  // Default if NULL

// 2. Check env var (global override)
const showRisk = process.env.GATE_SHOW_AVATAR_RISK === '1';

// 3. Hard-coded fallback
const maxAnswerLength = 1000;  // No config option, always 1000
```

---

## Secrets Management

### Development

**Safe to commit:**
- `.env.example` (template with no secrets)
- Configuration key names

**Never commit:**
- `.env` (contains real tokens)
- `.env.production`, `.env.local`, etc.

**`.gitignore` protection:**
```gitignore
.env
.env.local
.env.*.local
.env.production
.env.development
```

---

### Production

**Recommended approach:**

1. **Store `.env` on server** (not in repo)
2. **Use environment-specific secrets**
   - Different `DISCORD_TOKEN` for dev/prod
   - Separate Sentry projects
3. **Rotate tokens regularly**
   - Discord bot token every 6-12 months
   - `FASTIFY_SESSION_SECRET` annually
4. **Use strong passwords**
   - `RESET_PASSWORD`: 16+ random characters
   - `FASTIFY_SESSION_SECRET`: 32+ random characters

**Generate secrets:**
```bash
# Random password (Linux/Mac)
openssl rand -base64 32

# Windows
# Use password manager or online generator
```

---

### Secret Rotation

**Discord Token:**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Bot tab → Reset Token
3. Update `.env` on server
4. Restart bot: `pm2 restart pawtech-v2`

**Session Secret:**
1. Generate new 32-char string
2. Update `FASTIFY_SESSION_SECRET` in `.env`
3. Restart bot (all sessions invalidated)

---

## Configuration Best Practices

### Environment-Specific Config

**DO:**
```bash
# Development
GUILD_ID=123456789  # Fast command sync
LOG_LEVEL=debug
DB_PATH=./data/dev.db

# Production
# GUILD_ID=         # Global commands (omit GUILD_ID)
LOG_LEVEL=info
DB_PATH=./data/data.db
```

**DON'T:**
```bash
# Same .env for all environments (bad)
NODE_ENV=production
LOG_LEVEL=debug      # Too verbose for prod
GUILD_ID=123         # Prod should use global commands
```

---

### Validation

**Required vars checked at startup** ([src/util/ensureEnv.ts](../src/util/ensureEnv.ts)):
```typescript
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    logger.fatal({ key }, `Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
}
```

**Validation on startup:**
```typescript
// src/index.ts L1034-1041
const DISCORD_TOKEN = requireEnv('DISCORD_TOKEN');
const CLIENT_ID = requireEnv('CLIENT_ID');
```

---

### Type-Safe Config Access

**Recommended pattern:**

```typescript
// lib/env.ts
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  CLIENT_ID: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  GATE_SHOW_AVATAR_RISK: z.string().transform(v => v === '1').default('1'),
});

export const env = envSchema.parse(process.env);
```

**Usage:**
```typescript
import { env } from './lib/env.js';

// TypeScript knows these are defined
console.log(env.DISCORD_TOKEN);  // string
console.log(env.GATE_SHOW_AVATAR_RISK);  // boolean
```

**Implementation:** [src/lib/env.ts](../src/lib/env.ts)

---

## Deployment Configurations

### Local Development

**Setup:**
```bash
cp .env.example .env
# Edit .env with dev bot token
npm run dev
```

**Features enabled:**
- Hot reload (tsx watch)
- Verbose logging (`LOG_LEVEL=debug`)
- Guild-specific commands (`GUILD_ID` set)
- In-memory DB possible (`DB_PATH=:memory:`)

---

### Staging/QA

**Setup:**
```bash
# On staging server
cp .env.staging .env
npm run build
npm start
```

**Recommended settings:**
```env
NODE_ENV=production
LOG_LEVEL=debug                  # More verbose than prod
SENTRY_ENVIRONMENT=staging
DB_PATH=./data/staging.db
```

---

### Production

**Setup:**
```bash
# On production server
cp .env.production .env
npm run build
pm2 start dist/index.js --name pawtech-v2
pm2 save
```

**Recommended settings:**
```env
NODE_ENV=production
LOG_LEVEL=info
SENTRY_ENVIRONMENT=production
DB_PATH=./data/data.db
TRUST_PROXY=1                    # If behind nginx
```

---

## Troubleshooting

### Missing Environment Variables

**Symptom:** Bot exits immediately with "Missing required environment variable"

**Solution:**
```bash
# Check .env file exists
ls -la .env

# Verify required vars are set
cat .env | grep DISCORD_TOKEN
cat .env | grep CLIENT_ID

# Test env loading
npm run env:check
```

---

### Wrong Configuration Profile

**Symptom:** Production bot using dev settings

**Solution:**
```bash
# Verify NODE_ENV
echo $NODE_ENV

# Check .env file
cat .env | head -5

# Ensure correct .env is active
cp .env.production .env
```

---

### Guild Config Not Applying

**Symptom:** `/config set` changes don't take effect

**Solution:**
```sql
-- Verify config in database
sqlite3 data/data.db
SELECT * FROM guild_config WHERE guild_id = 'YOUR_GUILD_ID';

-- Check cache invalidation (restart bot)
pm2 restart pawtech-v2
```

---

## Next Steps

- Full env var reference: [ENV_REFERENCE.md](../ENV_REFERENCE.md)
- Deployment guide: [02-setup-and-running.md](02-setup-and-running.md)
- Guild config commands: [04-apis-and-endpoints.md](04-apis-and-endpoints.md)
