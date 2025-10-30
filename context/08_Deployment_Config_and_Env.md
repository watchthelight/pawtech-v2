---
title: "Deployment, Configuration, and Environment"
slug: "08_Deployment_Config_and_Env"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Platform"
audience: "Engineers • DevOps • System Administrators"
source_of_truth: ["code", ".env.example", "src/lib/env.ts", "package.json"]
related:
  - "02_System_Architecture_Overview"
  - "07_Database_Schema_and_Migrations"
  - "09_Troubleshooting_and_Runbook"
summary: "Complete technical specification for deployment procedures, environment variables, build processes, PM2 configuration, and production server setup. Includes security best practices, OAuth2 setup, and operational procedures."
---

## Purpose & Outcomes

- **Deployment automation**: Streamlined process for building, deploying, and restarting bot in production
- **Environment management**: Type-safe, validated configuration with fail-fast on missing secrets
- **Security**: Secret management best practices, OAuth2 flow setup, and permission isolation
- **Build optimization**: TypeScript compilation with tree-shaking and sourcemaps
- **Process management**: PM2 configuration for auto-restart, logging, and graceful shutdown
- **Observability**: Sentry integration, Pino logging, and health check endpoints

## Scope & Boundaries

### In Scope
- Node.js 20+ runtime requirements
- TypeScript 5.5.4 compilation with tsup bundler
- Environment variable validation with Zod
- PM2 process manager configuration
- Production deployment via SSH and tar archives
- Web server (Fastify) with OAuth2 authentication
- Sentry error tracking integration
- Database migration automation

### Out of Scope
- Docker containerization (native Node.js deployment)
- Kubernetes orchestration
- Load balancing across multiple instances
- CDN configuration for static assets
- Certificate management (handled by reverse proxy)
- Database replication (single SQLite file)

## Current State

### Technology Stack

**Runtime**:
- **Node.js**: 20.0.0+ (LTS recommended)
- **TypeScript**: 5.5.4
- **Module System**: ESM (ES Modules, not CommonJS)

**Core Dependencies**:
```json
{
  "discord.js": "^14.16.3",          // Discord API client
  "better-sqlite3": "^12.4.1",       // Synchronous SQLite driver
  "fastify": "^5.6.1",               // Web server
  "@sentry/node": "^10.20.0",        // Error tracking
  "pino": "^10.0.0",                 // Structured logging
  "zod": "^3.23.8",                  // Schema validation
  "sharp": "^0.34.4",                // Image processing
  "@google-cloud/vision": "^5.3.4",  // NSFW detection API
  "ulid": "^3.0.1"                   // Sortable IDs
}
```

**Build Tools**:
```json
{
  "tsup": "^8.1.0",                  // TypeScript bundler
  "tsx": "^4.19.2",                  // TypeScript execution (dev)
  "vitest": "^3.2.4",                // Test runner
  "prettier": "^3.6.2",              // Code formatter
  "eslint": "^9.37.0"                // Linter
}
```

### Environment Variables

**File**: [.env.example](../.env.example)

#### Core Configuration (REQUIRED)

```bash
# Discord Bot Token (get from https://discord.com/developers/applications)
DISCORD_TOKEN=your-bot-token-here

# Application ID (same as bot client ID)
CLIENT_ID=1427436615021629590

# Guild ID (leave empty for global commands, or specific guild for testing)
GUILD_ID=896070888594759740

# Database path (auto-created directory)
DB_PATH=./data/data.db

# Reset password for /gate reset and /modstats reset
# SECURITY: Strong password, never commit to git
RESET_PASSWORD=choose-a-strong-password

# Node environment
NODE_ENV=production
```

#### Web Control Panel / OAuth2 (REQUIRED for dashboard)

```bash
# Discord OAuth2 credentials
DISCORD_CLIENT_ID=1427436615021629590
DISCORD_CLIENT_SECRET=your-client-secret

# OAuth2 redirect URI
# Production: https://pawtropolis.tech/auth/callback
# Development: http://localhost:3000/auth/callback
DASHBOARD_REDIRECT_URI=https://pawtropolis.tech/auth/callback

# Admin role IDs (comma-separated) - users must have one of these to access dashboard
ADMIN_ROLE_ID=1402989891830153269

# Fastify session secret (min 32 chars)
# Generate with: openssl rand -base64 32
FASTIFY_SESSION_SECRET=your-32-char-secret-here

# Dashboard port
DASHBOARD_PORT=3000

# Trust proxy headers (1=true, 0=false) - enable when behind nginx/cloudflare
TRUST_PROXY=1

# CORS origin for production
CORS_ORIGIN=https://pawtropolis.tech
```

#### Optional Configuration

```bash
# Default logging channel for action_log embeds (overridable per-guild via /config)
LOGGING_CHANNEL=1430015254053654599

# Sentry error tracking
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=1.0         # 0.0-1.0 (1.0 = 100% of transactions)

# Pino log level (trace, debug, info, warn, error, fatal)
LOG_LEVEL=info

# Show NSFW Avatar Risk on review cards (1=show, 0=hide)
GATE_SHOW_AVATAR_RISK=0

# /say command access control (comma-separated role IDs)
SEND_ALLOWED_ROLE_IDS=role1,role2,role3

# Owner user IDs for elevated permissions (comma-separated)
OWNER_IDS=user1,user2,user3

# Manual flag alerts channel
FLAGGED_REPORT_CHANNEL_ID=1234567890123456789

# Gate admin roles (comma-separated)
GATE_ADMIN_ROLE_IDS=role1,role2
```

#### Test/Development

```bash
# Test guild and role IDs for seed scripts
TEST_GUILD_ID=896070888594759740
TEST_REVIEWER_ROLE_ID=1402989891830153269
```

### Environment Validation

**File**: [src/lib/env.ts](../src/lib/env.ts)

**Purpose**: Type-safe environment loading with fail-fast validation using Zod.

**Code**:
```typescript
import dotenv from "dotenv";
import { z } from "zod";

// Load .env from project root
const isTest = process.env.NODE_ENV === "test";
dotenv.config({ path: path.join(process.cwd(), ".env"), override: !isTest });

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "Missing DISCORD_TOKEN"),
  CLIENT_ID: z.string().min(1, "Missing CLIENT_ID"),
  GUILD_ID: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DB_PATH: z.string().default("data/data.db"),
  RESET_PASSWORD: z.string().min(1, "RESET_PASSWORD is required"),

  // Optional fields
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  LOG_LEVEL: z.string().optional(),
  OWNER_IDS: z.string().optional(),

  // Web Control Panel (optional)
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DASHBOARD_REDIRECT_URI: z.string().optional(),
  ADMIN_ROLE_ID: z.string().optional(),
  FASTIFY_SESSION_SECRET: z.string().optional(),
  DASHBOARD_PORT: z.string().optional(),
});

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`Environment validation failed:\n${issues}`);
  process.exit(1); // Fail-fast on startup
}

export const env = parsed.data;
```

**Why Zod**: Type-safe validation at runtime, automatic coercion for numbers, clear error messages on startup.

**Fail-Fast Philosophy**: Bot refuses to start if critical secrets missing. Better than runtime crashes.

### Build Process

**File**: [tsup.config.ts](../tsup.config.ts)

**Bundler**: tsup (powered by esbuild) - fast, zero-config TypeScript bundler.

**Configuration**:
```typescript
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    splitting: false,              // Single output file
    sourcemap: true,               // Enable debugging in production
    clean: true,                   // Clean dist/ before build
    format: ["esm"],               // ES Modules (not CommonJS)
    target: "node20",              // Node.js 20 features
    outDir: "dist",
    minify: false,                 // Keep readable for debugging
  },
  {
    entry: ["scripts/commands.ts"],
    splitting: false,
    sourcemap: true,
    clean: false,                  // Don't delete main bundle
    format: ["esm"],
    target: "node20",
    outDir: "dist/scripts",
    minify: false,
  },
]);
```

**Why Not Minify**: Easier debugging in production logs, negligible size difference for server-side code.

**Why Sourcemaps**: Maps production stack traces back to original TypeScript line numbers via Sentry.

**Build Command**:
```bash
npm run build
# Equivalent to: tsup && npm run scan:legacy
```

**Output Structure**:
```
dist/
├── index.js           # Main bot entry point
├── index.js.map       # Sourcemap
├── scripts/
│   ├── commands.js    # Command deployment script
│   └── commands.js.map
└── (bundled dependencies inlined)
```

### Package Scripts

**File**: [package.json](../package.json)

```json
{
  "scripts": {
    "dev": "dotenvx run -- tsx watch src/index.ts",
    "build": "tsup && npm run scan:legacy",
    "start": "dotenvx run -- node dist/index.js",
    "test": "vitest run",

    "deploy:cmds": "dotenvx run -- tsx scripts/deploy-commands.ts --all",
    "sync:cmds": "dotenvx run -- tsx scripts/commands.ts --all",
    "print:cmds": "dotenvx run -- tsx scripts/print-commands.ts",

    "migrate": "dotenvx run -- tsx scripts/migrate.ts",
    "migrate:dry": "dotenvx run -- tsx scripts/migrate.ts --dry-run",

    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run lint && npm run format:check && npm run test"
  }
}
```

**Script Explanations**:
- **dev**: Development mode with hot-reload via tsx watch
- **build**: Compile TypeScript → JavaScript bundle
- **start**: Run production build
- **deploy:cmds**: Register Discord slash commands globally
- **sync:cmds**: Sync commands to specific guild (faster for testing)
- **migrate**: Apply pending database migrations
- **check**: Full CI pipeline (type check, lint, format, test)

## Key Flows

### 1. Local Development Setup

**Prerequisites**:
- Node.js 20+ installed
- Git clone of repository
- Discord bot token from https://discord.com/developers/applications

**Flow**:

```
┌────────────────────────────────────┐
│ 1. Clone Repository                │
│    git clone https://github.com/   │
│    watchthelight/pawtech-v2.git    │
│    cd pawtech-v2                   │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 2. Install Dependencies            │
│    npm install                     │
│    (installs better-sqlite3,       │
│     discord.js, etc.)              │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 3. Create .env File                │
│    cp .env.example .env            │
│    Edit: DISCORD_TOKEN, CLIENT_ID, │
│    GUILD_ID, RESET_PASSWORD        │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 4. Generate Session Secret         │
│    openssl rand -base64 32         │
│    Add to .env: FASTIFY_SESSION_   │
│    SECRET=<generated>              │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 5. Register Slash Commands         │
│    npm run deploy:cmds             │
│    (or npm run sync:cmds for guild)│
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 6. Run Migrations                  │
│    npm run migrate                 │
│    (creates data/data.db)          │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 7. Start Development Server        │
│    npm run dev                     │
│    (bot starts with hot-reload)    │
└────────────────────────────────────┘
```

**Commands**:
```bash
git clone https://github.com/watchthelight/pawtech-v2.git
cd pawtech-v2
npm install
cp .env.example .env

# Edit .env with your tokens
nano .env

# Generate session secret
openssl rand -base64 32  # Copy output to FASTIFY_SESSION_SECRET

# Deploy commands (choose one)
npm run deploy:cmds      # Global (1-hour propagation delay)
npm run sync:cmds        # Guild-specific (instant)

# Initialize database
npm run migrate

# Start bot
npm run dev
```

### 2. Production Deployment

**Production Server**: Ubuntu 24.04 LTS on DigitalOcean / Linode

**Process Manager**: PM2 for automatic restarts and logging

**Flow**:

```
┌────────────────────────────────────┐
│ 1. Build Locally                   │
│    npm run build                   │
│    (creates dist/ directory)       │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 2. Create Deployment Archive       │
│    tar -czf deploy.tar.gz          │
│      dist/ migrations/ package.json│
│      .env.example                  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 3. Upload to Production Server     │
│    scp deploy.tar.gz               │
│      user@server:/path/            │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 4. SSH to Production               │
│    ssh user@server                 │
│    cd /path/to/app                 │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 5. Extract Archive                 │
│    tar -xzf deploy.tar.gz          │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 6. Install Production Dependencies │
│    npm ci --production             │
│    (uses package-lock.json)        │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 7. Run Migrations                  │
│    npm run migrate                 │
│    (updates schema if needed)      │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 8. Restart PM2 Process             │
│    pm2 restart pawtropolis         │
│    (graceful restart with 0        │
│     downtime)                      │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 9. Verify Health                   │
│    pm2 logs pawtropolis --lines 50 │
│    (check for startup errors)      │
└────────────────────────────────────┘
```

**Automated Deployment Script**:
```bash
#!/bin/bash
# deploy.sh

set -e  # Exit on error

echo "=== Building application ==="
npm run build

echo "=== Creating deployment archive ==="
tar -czf deploy.tar.gz dist/ migrations/ package.json package-lock.json .env.example

echo "=== Uploading to production ==="
scp deploy.tar.gz pawtech:/home/ubuntu/pawtropolis-tech/

echo "=== Deploying on server ==="
ssh pawtech "bash -lc 'cd /home/ubuntu/pawtropolis-tech && \
  tar -xzf deploy.tar.gz && \
  npm ci --production && \
  npm run migrate && \
  pm2 restart pawtropolis'"

echo "=== Cleaning up ==="
rm deploy.tar.gz

echo "=== Deployment complete! ==="
echo "Check logs with: ssh pawtech \"pm2 logs pawtropolis --lines 50\""
```

**Usage**:
```bash
chmod +x deploy.sh
./deploy.sh
```

### 3. PM2 Configuration

**File**: `ecosystem.config.cjs` (not committed, created on server)

```javascript
module.exports = {
  apps: [{
    name: "pawtropolis",
    script: "dist/index.js",
    cwd: "/home/ubuntu/pawtropolis-tech",

    // Environment
    env: {
      NODE_ENV: "production"
    },

    // Process management
    instances: 1,                    // Single instance (SQLite limitation)
    autorestart: true,               // Auto-restart on crash
    watch: false,                    // Don't watch files in production
    max_memory_restart: "500M",      // Restart if memory exceeds 500MB

    // Logging
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    error_file: "logs/error.log",
    out_file: "logs/out.log",
    merge_logs: true,

    // Graceful shutdown
    kill_timeout: 5000,              // 5s to finish pending operations
    wait_ready: true,                // Wait for 'ready' signal
    listen_timeout: 10000,           // 10s timeout for startup
  }]
};
```

**PM2 Commands**:
```bash
# Start bot
pm2 start ecosystem.config.cjs

# Restart (graceful)
pm2 restart pawtropolis

# Stop
pm2 stop pawtropolis

# Delete from PM2
pm2 delete pawtropolis

# View logs
pm2 logs pawtropolis
pm2 logs pawtropolis --lines 100
pm2 logs pawtropolis --err     # Error logs only

# Monitor
pm2 monit

# Process info
pm2 info pawtropolis

# Save PM2 state (auto-restart on reboot)
pm2 save
pm2 startup  # Generate startup script
```

### 4. OAuth2 Setup for Web Dashboard

**Discord Developer Portal Setup**:

1. Navigate to https://discord.com/developers/applications
2. Select your application → OAuth2 → General
3. Add redirect URI: `https://pawtropolis.tech/auth/callback`
4. Copy Client ID and Client Secret

**Environment Configuration**:
```bash
DISCORD_CLIENT_ID=1427436615021629590
DISCORD_CLIENT_SECRET=your-client-secret-here
DASHBOARD_REDIRECT_URI=https://pawtropolis.tech/auth/callback
ADMIN_ROLE_ID=1402989891830153269  # Role required for dashboard access
FASTIFY_SESSION_SECRET=$(openssl rand -base64 32)
DASHBOARD_PORT=3000
TRUST_PROXY=1  # If behind nginx/cloudflare
CORS_ORIGIN=https://pawtropolis.tech
```

**OAuth2 Flow**:
```
┌────────────────────────────────────┐
│ User clicks "Login with Discord"   │
│ https://pawtropolis.tech/auth      │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Redirect to Discord Authorization  │
│ https://discord.com/oauth2/        │
│   authorize?client_id=...&         │
│   redirect_uri=.../auth/callback&  │
│   response_type=code&scope=        │
│   identify+guilds                  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ User Approves (Discord UI)         │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Discord Redirects to Callback      │
│ /auth/callback?code=ABC123         │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Exchange Code for Access Token     │
│ POST https://discord.com/api/      │
│   oauth2/token                     │
│   grant_type=authorization_code    │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Fetch User Info                    │
│ GET https://discord.com/api/users/ │
│   @me                              │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Verify Admin Role                  │
│ Check if user has ADMIN_ROLE_ID    │
│ in configured guild                │
└────────┬───────────────────────────┘
         │ ❌ No role → 403 Forbidden
         ▼ ✅ Has role
┌────────────────────────────────────┐
│ Create Session                     │
│ Set encrypted cookie with user ID  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ Redirect to Dashboard              │
│ https://pawtropolis.tech/dashboard │
└────────────────────────────────────┘
```

**Code Reference**:
```typescript
// File: src/web/auth.ts
export async function handleOAuth2Callback(
  code: string,
  redirectUri: string
): Promise<{ userId: string; username: string }> {
  // Exchange code for token
  const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', {
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const { access_token } = tokenResponse.data;

  // Fetch user info
  const userResponse = await axios.get('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  return {
    userId: userResponse.data.id,
    username: userResponse.data.username,
  };
}
```

## Commands & Snippets

### Environment Setup

```bash
# Create .env from example
cp .env.example .env

# Generate strong session secret
openssl rand -base64 32

# Generate strong reset password
openssl rand -base64 24

# Verify environment loads correctly
npm run env:check
# Expected: "DISCORD_TOKEN? REDACTED..." (first 10 chars visible)
```

### Build and Deploy

```bash
# Full CI check (local)
npm run check

# Build for production
npm run build

# Test production build locally
NODE_ENV=production npm start

# Deploy to production (manual)
npm run build
tar -czf deploy.tar.gz dist/ migrations/ package.json package-lock.json
scp deploy.tar.gz user@server:/path/
ssh user@server "cd /path && tar -xzf deploy.tar.gz && npm ci --production && npm run migrate && pm2 restart pawtropolis"
```

### PM2 Management

```bash
# Start with ecosystem config
pm2 start ecosystem.config.cjs

# Restart (graceful, 0 downtime)
pm2 restart pawtropolis

# Reload (cluster mode, not used for this app)
pm2 reload pawtropolis

# Stop without removing from PM2
pm2 stop pawtropolis

# View real-time logs
pm2 logs pawtropolis --lines 50

# Tail error logs
pm2 logs pawtropolis --err

# Monitor CPU/memory
pm2 monit

# List all processes
pm2 list

# Detailed process info
pm2 info pawtropolis

# Save current process list
pm2 save

# Generate startup script (auto-start on boot)
pm2 startup
# Follow printed instructions to enable

# Flush logs
pm2 flush

# Reset restart counter
pm2 reset pawtropolis
```

### Database Management

```bash
# Run migrations
npm run migrate

# Dry-run migrations (preview)
npm run migrate:dry

# Backup database
sqlite3 data/data.db ".backup data/backup-$(date +%Y%m%d-%H%M%S).db"

# Restore from backup
pm2 stop pawtropolis
cp data/backup-20251030-123456.db data/data.db
pm2 start pawtropolis
```

### Command Deployment

```bash
# Deploy to all guilds (global, 1-hour propagation)
npm run deploy:cmds

# Sync to specific guild (instant)
npm run sync:cmds

# Print all commands (debugging)
npm run print:cmds

# Manual deployment script
tsx scripts/deploy-commands.ts --all
tsx scripts/deploy-commands.ts --guild 896070888594759740
```

## Interfaces & Data

### TypeScript Configuration

**File**: [tsconfig.json](../tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "scripts"]
}
```

**Why ES2022**: Modern JavaScript features (top-level await, class fields, etc.) supported by Node.js 20.

**Why NodeNext**: Proper ESM resolution with `.js` extensions in imports.

### Logging Configuration

**Pino (Structured JSON Logging)**:

```typescript
// File: src/lib/logger.ts
import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

export const logger = pino({
  level: logLevel,
  transport: isProd
    ? undefined  // JSON to stdout in production
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
});
```

**Log Levels**:
- **trace**: Very verbose debugging (disabled in production)
- **debug**: Detailed operational info (disabled in production)
- **info**: General informational messages (default production)
- **warn**: Warning messages (potential issues)
- **error**: Error messages (with stack traces)
- **fatal**: Critical errors (app will exit)

**Production Logs**:
```bash
# View with PM2
pm2 logs pawtropolis

# Filter by level
pm2 logs pawtropolis | grep '"level":30'  # Info
pm2 logs pawtropolis | grep '"level":50'  # Error

# Pretty-print JSON logs
pm2 logs pawtropolis --raw | pnpm exec pino-pretty
```

### Sentry Configuration

**Error Tracking Setup**:

```typescript
// File: src/lib/sentry.ts
import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || 'production',
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE || 0.1,
    profilesSampleRate: 1.0,
    integrations: [
      new ProfilingIntegration(),
    ],
  });
}

export function captureException(err: Error, context?: Record<string, any>) {
  Sentry.captureException(err, { extra: context });
}
```

**Usage**:
```typescript
try {
  await riskyOperation();
} catch (err) {
  logger.error({ err }, 'Operation failed');
  captureException(err, { userId, guildId });
}
```

## Ops & Recovery

### Health Checks

```bash
# Check bot status
pm2 status pawtropolis

# Check logs for errors
pm2 logs pawtropolis --err --lines 50

# Check database connectivity
sqlite3 data/data.db "SELECT COUNT(*) FROM application;"

# Check web server (if running)
curl -I http://localhost:3000/health
# Expected: 200 OK

# Check Discord gateway connection
pm2 logs pawtropolis | grep "ClientReady"
# Expected: "ClientReady" event logged

# Check memory usage
pm2 info pawtropolis | grep memory
```

### Rollback Procedure

**Scenario**: Deployment introduced breaking changes.

```bash
# 1. SSH to production
ssh user@server

# 2. Stop bot
pm2 stop pawtropolis

# 3. Restore previous build
cd /home/ubuntu/pawtropolis-tech
cp -r dist/ dist-broken/
tar -xzf deploy-previous.tar.gz

# 4. Restore database backup (if schema changed)
cp data/data.db data/data-broken.db
cp data/backup-pre-deploy.db data/data.db

# 5. Restart bot
pm2 start pawtropolis

# 6. Verify health
pm2 logs pawtropolis --lines 50
```

### Common Issues

#### Issue: "Environment validation failed: Missing DISCORD_TOKEN"

**Symptoms**: Bot exits immediately on startup.

**Cause**: `.env` file missing or invalid.

**Fix**:
```bash
# Verify .env exists
ls -la .env

# Check .env contents (careful with secrets)
grep DISCORD_TOKEN .env

# Copy from example
cp .env.example .env
nano .env  # Edit with actual values

# Verify env loads
npm run env:check
```

#### Issue: "ECONNREFUSED: Discord gateway connection failed"

**Symptoms**: Bot can't connect to Discord.

**Cause**: Invalid bot token or network issues.

**Fix**:
```bash
# Verify token is correct
# Get from: https://discord.com/developers/applications

# Check network connectivity
ping discord.com

# Check firewall rules
sudo ufw status

# Verify bot has correct intents enabled
# Go to: https://discord.com/developers/applications → Bot → Privileged Gateway Intents
# Enable: SERVER MEMBERS, MESSAGE CONTENT
```

#### Issue: "PM2 process keeps restarting"

**Symptoms**: `pm2 list` shows high restart count.

**Cause**: Crash loop due to unhandled error.

**Fix**:
```bash
# Check logs for error
pm2 logs pawtropolis --err --lines 100

# Common causes:
# 1. Missing environment variable → check .env
# 2. Database locked → restart with: pm2 restart pawtropolis
# 3. Memory leak → check with: pm2 monit

# Disable auto-restart temporarily (debugging)
pm2 stop pawtropolis
pm2 delete pawtropolis
node dist/index.js  # Run directly to see errors
```

#### Issue: "Cannot find module" error after deployment

**Symptoms**: `Error: Cannot find module 'discord.js'`

**Cause**: Dependencies not installed on production server.

**Fix**:
```bash
# Install production dependencies
npm ci --production

# Verify node_modules exists
ls -la node_modules/

# Check for native dependencies (better-sqlite3)
npm rebuild

# If still failing, try full reinstall
rm -rf node_modules/
npm ci --production
```

## Security & Privacy

### Secret Management

**Never Commit Secrets**:
```bash
# .gitignore already includes:
.env
.env.local
.env.production
*.db
*.log
```

**Rotate Secrets Periodically**:
```bash
# Generate new session secret
openssl rand -base64 32

# Update .env on server
ssh user@server
nano /path/to/app/.env
# Update FASTIFY_SESSION_SECRET

# Restart to apply
pm2 restart pawtropolis
```

**Minimum Password Requirements**:
- **RESET_PASSWORD**: 16+ characters, alphanumeric + symbols
- **FASTIFY_SESSION_SECRET**: 32+ characters, base64 encoded

### OAuth2 Security

**Redirect URI Validation**:
- Only allow `https://` in production (not `http://`)
- Whitelist exact callback URLs in Discord Developer Portal
- Validate `state` parameter to prevent CSRF

**Session Security**:
```typescript
// File: src/web/server.ts
fastify.register(fastifySession, {
  secret: env.FASTIFY_SESSION_SECRET,
  cookie: {
    secure: env.NODE_ENV === 'production', // HTTPS only in prod
    httpOnly: true,                        // No JS access
    sameSite: 'lax',                       // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000,      // 7 days
  },
});
```

### Rate Limiting

**Fastify Rate Limit**:
```typescript
// File: src/web/server.ts
fastify.register(fastifyRateLimit, {
  max: 100,              // 100 requests
  timeWindow: '1 minute' // per minute
});
```

**Per-Route Overrides**:
```typescript
fastify.get('/api/heavy-operation', {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute'
    }
  }
}, handler);
```

## FAQ / Gotchas

**Q: Why ESM (ES Modules) instead of CommonJS?**

A: Modern Node.js standard, better tree-shaking, top-level await, cleaner syntax. Discord.js 14+ is ESM-only.

**Q: Can I deploy to multiple servers for load balancing?**

A: No. SQLite doesn't support multi-writer concurrency. For scale, migrate to PostgreSQL with connection pooling.

**Q: Why PM2 instead of systemd?**

A: PM2 provides out-of-the-box log management, monitoring, graceful restart, and cluster mode. Systemd is lower-level.

**Q: Do I need to rebuild after changing .env?**

A: No. `.env` is read at runtime. Just restart: `pm2 restart pawtropolis`

**Q: How do I enable debug logging in production?**

A: Set `LOG_LEVEL=debug` in `.env` and restart. **Warning**: Very verbose, use temporarily.

**Q: Can I run multiple bot instances?**

A: No. Discord limits one connection per bot token. SQLite also prevents concurrent writes.

**Q: What's the difference between `npm ci` and `npm install`?**

A: `npm ci` uses `package-lock.json` exactly (deterministic), deletes `node_modules/` first. Use in production. `npm install` may update versions.

**Q: Why trust proxy in production?**

A: When behind nginx/cloudflare, `X-Forwarded-For` headers contain real client IP. `TRUST_PROXY=1` tells Fastify to trust these headers.

**Q: How do I update Node.js version?**

A:
```bash
# Using nvm (recommended)
nvm install 20
nvm use 20
nvm alias default 20

# Rebuild native dependencies
npm rebuild

# Restart bot
pm2 restart pawtropolis
```

**Q: What happens if migration fails during deployment?**

A: Transaction rolls back, database unchanged. Fix migration and re-deploy. Always backup before migrations.

## Changelog

### 2025-10-30
- **Created**: Initial deployment, configuration, and environment documentation
- **Added**: Front-matter with metadata, related docs, and summary
- **Documented**: All 10 standard sections per project requirements
- **Cross-linked**: Related architecture, database, and troubleshooting documentation
- **Verified**: All environment variables, build commands, and deployment procedures
- **Included**: Complete flows for local setup, production deployment, and OAuth2 configuration
- **Detailed**: PM2 configuration, Sentry integration, and security best practices
- **Provided**: Operational procedures for health checks, rollback, and secret management
