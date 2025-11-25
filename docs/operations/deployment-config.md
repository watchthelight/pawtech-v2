# Deployment, Configuration, and Environment

## Technology Stack

### Node.js and TypeScript

- **Node Version**: 20.x LTS (ES modules, top-level await, native fetch)
- **TypeScript**: 5.x with strict mode enabled
- **Package Manager**: npm (lockfile: `package-lock.json`)

**tsconfig.json**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Build with tsup

**Why tsup**: Fast esbuild-based bundler optimized for Node.js libraries; handles TypeScript transforms without config overhead.

**tsup.config.ts**:

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  minify: false, // Keep readable for debugging
  splitting: false,
  treeshake: true,
  dts: false, // No declaration files needed
});
```

**Build Commands**:

```bash
npm run build       # tsup (production build)
npm run dev         # tsup --watch (hot reload)
npm run typecheck   # tsc --noEmit (validate types without building)
```

**Output**: `dist/index.js` (ESM bundle, ~2MB minified)

## Environment Variables Contract

### Required Variables

| Variable        | Type   | Description                               | Example                         |
| --------------- | ------ | ----------------------------------------- | ------------------------------- |
| `DISCORD_TOKEN` | string | Bot token from Discord Developer Portal   | `MTQyOTk0Njk4NjAxODM3Nzg0OA...` |
| `CLIENT_ID`     | string | Application ID (from Developer Portal)    | `1429946986018377848`           |
| `GUILD_ID`      | string | Discord server ID (right-click → Copy ID) | `1234567890123456789`           |
| `DATABASE_URL`  | string | Path to SQLite database file              | `./data/data.db`                |

### Optional Variables

| Variable          | Type   | Description                                 | Default / Notes            |
| ----------------- | ------ | ------------------------------------------- | -------------------------- |
| `LOGGING_CHANNEL` | string | Fallback logging channel ID                 | Used if DB column missing  |
| `OWNER_IDS`       | string | Comma-separated owner user IDs (superusers) | `123456789,987654321`      |
| `SENTRY_DSN`      | string | Sentry project DSN for error tracking       | ⚠️ Currently returns 403   |
| `ENVIRONMENT`     | string | `production` or `development`               | Controls logging verbosity |
| `PORT`            | number | HTTP health check port (if enabled)         | `3000` (optional)          |
| `OTEL_ENABLED`    | bool   | Enable OpenTelemetry tracing                | `false` (default)          |
| `LOG_LEVEL`       | string | Minimum log level (`debug`, `info`, `warn`) | `info`                     |

### Example `.env` File

```bash
# Discord Configuration
DISCORD_TOKEN=MTQyOTk0Njk4NjAxODM3Nzg0OA.GhJ9Kl.xYz1234567890abcdef
CLIENT_ID=1429946986018377848
GUILD_ID=1234567890123456789

# Database
DATABASE_URL=./data/data.db

# Logging (fallback if DB config missing)
LOGGING_CHANNEL=1429946986018377848

# Telemetry (currently blocked by 403)
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>

# Permissions
OWNER_IDS=123456789012345678,987654321098765432

# Environment
ENVIRONMENT=production
LOG_LEVEL=info

# Optional: OpenTelemetry
OTEL_ENABLED=false
# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### Loading Environment Variables (dotenvx)

**Why dotenvx**: Enhanced dotenv with encryption support and multiple environment files.

```typescript
// src/index.ts
import { config } from "@dotenvx/dotenvx";
config(); // Loads .env file into process.env

// Validate required vars
const requiredVars = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID", "DATABASE_URL"];
for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

console.log("✅ Environment loaded successfully");
```

**Multiple Environment Files**:

```bash
.env                 # Default (gitignored)
.env.development     # Dev overrides
.env.production      # Prod overrides (deploy only)
.env.example         # Template for contributors (committed)
```

**Load specific env**:

```bash
NODE_ENV=production npm start  # Loads .env.production then .env
```

## Command Sync Script

**Purpose**: Register slash commands with Discord API. Must run after any command definition changes.

**Script**: `scripts/commands.ts`

```typescript
import { REST, Routes } from "discord.js";
import { config } from "@dotenvx/dotenvx";
config();

const commands = [
  { name: "gate", description: "Submit join application" },
  {
    name: "accept",
    description: "Approve application",
    defaultMemberPermissions: "8192", // ManageMessages
    options: [
      { name: "app_id", type: 4, description: "Application ID", required: true },
      { name: "reason", type: 3, description: "Optional reason for acceptance", required: false },
    ],
  },
  {
    name: "reject",
    description: "Reject application",
    defaultMemberPermissions: "8192",
    options: [
      { name: "app_id", type: 4, description: "Application ID", required: true },
      { name: "reason", type: 3, description: "Optional reason for rejection", required: false },
    ],
  },
  {
    name: "unclaim",
    description: "Release claimed application",
    defaultMemberPermissions: "8192",
    options: [{ name: "app_id", type: 4, description: "Application ID", required: true }],
  },
  {
    name: "kick",
    description: "Remove member from guild",
    defaultMemberPermissions: "2", // KickMembers
    options: [
      { name: "user", type: 6, description: "User to kick", required: true },
      { name: "reason", type: 3, description: "Reason for kick", required: false },
    ],
  },
  { name: "health", description: "Bot health check" },
  {
    name: "statusupdate",
    description: "Post status update",
    defaultMemberPermissions: "8", // Administrator
    options: [{ name: "message", type: 3, description: "Status message", required: true }],
  },
  {
    name: "config",
    description: "Manage guild configuration",
    defaultMemberPermissions: "8",
    options: [
      {
        name: "action",
        type: 3,
        description: "get or set",
        required: true,
        choices: [
          { name: "get", value: "get" },
          { name: "set", value: "set" },
        ],
      },
      { name: "key", type: 3, description: "Config key", required: true },
      { name: "value", type: 3, description: "Value (for set)", required: false },
    ],
  },
  {
    name: "modmail",
    description: "Manage modmail threads",
    defaultMemberPermissions: "8192",
    options: [
      {
        name: "action",
        type: 3,
        description: "close or reopen",
        required: true,
        choices: [
          { name: "close", value: "close" },
          { name: "reopen", value: "reopen" },
        ],
      },
      { name: "thread_id", type: 3, description: "Thread ID", required: false },
    ],
  },
  {
    name: "analytics",
    description: "Generate analytics report",
    defaultMemberPermissions: "8192",
    options: [
      { name: "start_date", type: 3, description: "Start date (YYYY-MM-DD)", required: false },
      { name: "end_date", type: 3, description: "End date (YYYY-MM-DD)", required: false },
      {
        name: "format",
        type: 3,
        description: "text or csv",
        required: false,
        choices: [
          { name: "text", value: "text" },
          { name: "csv", value: "csv" },
        ],
      },
    ],
  },
  {
    name: "analytics-export",
    description: "Export raw database tables",
    defaultMemberPermissions: "8",
    options: [
      {
        name: "table",
        type: 3,
        description: "Table to export",
        required: true,
        choices: [
          { name: "review_action", value: "review_action" },
          { name: "action_log", value: "action_log" },
          { name: "open_modmail", value: "open_modmail" },
        ],
      },
      {
        name: "format",
        type: 3,
        description: "json or csv",
        required: false,
        choices: [
          { name: "json", value: "json" },
          { name: "csv", value: "csv" },
        ],
      },
    ],
  },
  {
    name: "modstats",
    description: "Moderator performance statistics",
    defaultMemberPermissions: "8192",
    options: [
      {
        name: "mode",
        type: 3,
        description: "leaderboard or user",
        required: true,
        choices: [
          { name: "leaderboard", value: "leaderboard" },
          { name: "user", value: "user" },
        ],
      },
      { name: "user", type: 6, description: "User (for user mode)", required: false },
      { name: "days", type: 4, description: "Time window (days)", required: false },
    ],
  },
  {
    name: "send",
    description: "Send message to channel",
    defaultMemberPermissions: "8",
    options: [
      { name: "channel", type: 7, description: "Target channel", required: true },
      { name: "message", type: 3, description: "Message content", required: true },
      { name: "anonymous", type: 5, description: "Send anonymously", required: false },
    ],
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
  try {
    console.log(`Registering ${commands.length} guild commands...`);

    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID!), {
      body: commands,
    });

    console.log("✅ Commands registered successfully.");
  } catch (error) {
    console.error("❌ Command registration failed:", error);
    process.exit(1);
  }
})();
```

**Run on Deploy**:

```bash
npm run commands  # tsx scripts/commands.ts
```

**Clear All Commands** (if needed):

```bash
# Clear guild commands
npm run commands:clear

# Script: scripts/clear-commands.ts
await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: [] }
);
```

## Sentry Configuration

### Initialization

```typescript
// src/telemetry/sentry.ts
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

if (process.env.SENTRY_DSN && process.env.SENTRY_DSN !== "placeholder") {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.ENVIRONMENT || "development",
    tracesSampleRate: process.env.ENVIRONMENT === "production" ? 0.1 : 1.0,
    profilesSampleRate: 0.1,
    integrations: [
      nodeProfilingIntegration(),
      Sentry.httpIntegration(),
      Sentry.modulesIntegration(),
    ],
    beforeSend(event, hint) {
      // Filter out known issues
      if (event.exception?.values?.[0]?.type === "DiscordAPIError[50007]") {
        return null; // Don't report "Cannot send DM" errors
      }
      return event;
    },
  });

  console.log("✅ Sentry initialized");
} else {
  console.warn("⚠️ Sentry DSN not configured; telemetry disabled.");
}
```

### Known Issue: 403 Unauthorized

**Error**:

```
[Sentry] Failed to send event: 403 Forbidden
```

**Diagnosis**:

1. Verify DSN in Sentry UI: Settings → Projects → [Your Project] → Client Keys
2. Check project permissions (must have admin access)
3. Test with `curl`:
   ```bash
   curl -X POST "https://o<org>.ingest.sentry.io/api/<project>/store/" \
     -H "X-Sentry-Auth: Sentry sentry_key=<key>, sentry_version=7" \
     -H "Content-Type: application/json" \
     -d '{"message":"test"}'
   ```

**Temporary Workaround** (disable Sentry):

```bash
# .env
SENTRY_DSN=  # Leave blank to disable
```

## OpenTelemetry Toggles

### Enable Tracing

```typescript
// src/telemetry/otel.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

if (process.env.OTEL_ENABLED === "true") {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces",
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  console.log("✅ OpenTelemetry tracing enabled");

  process.on("SIGTERM", () => {
    sdk.shutdown().then(() => console.log("Tracing terminated"));
  });
} else {
  console.log("⚠️ OpenTelemetry disabled (set OTEL_ENABLED=true to enable)");
}
```

**Environment Variables**:

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=pawtropolis-bot
```

## Process Supervision

### Systemd Service (Linux)

**Unit File**: `/etc/systemd/system/pawtropolis.service`

```ini
[Unit]
Description=Pawtropolis Discord Bot
After=network.target

[Service]
Type=simple
User=pawtropolis
WorkingDirectory=/opt/pawtropolis
EnvironmentFile=/etc/pawtropolis/secrets.env
ExecStartPre=/usr/bin/npm run commands
ExecStart=/usr/bin/node /opt/pawtropolis/dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/pawtropolis/data

[Install]
WantedBy=multi-user.target
```

**Management Commands**:

```bash
sudo systemctl enable pawtropolis   # Auto-start on boot
sudo systemctl start pawtropolis    # Start service
sudo systemctl status pawtropolis   # Check status
sudo systemctl restart pawtropolis  # Restart after deploy
journalctl -u pawtropolis -f        # Tail logs
```

### PM2 (Alternative)

**Install**:

```bash
npm install -g pm2
```

**ecosystem.config.js**:

```javascript
module.exports = {
  apps: [
    {
      name: "pawtropolis",
      script: "./dist/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env_production: {
        NODE_ENV: "production",
        ENVIRONMENT: "production",
      },
      env_development: {
        NODE_ENV: "development",
        ENVIRONMENT: "development",
      },
    },
  ],
};
```

**Commands**:

```bash
pm2 start ecosystem.config.js --env production
pm2 startup              # Generate startup script
pm2 save                 # Save process list
pm2 logs pawtropolis     # View logs
pm2 restart pawtropolis  # Restart
pm2 monit                # Monitor resources
```

## Deployment Checklist

| Step | Command/Action                               | Verification                     |
| ---- | -------------------------------------------- | -------------------------------- |
| 1    | `git pull origin main`                       | Check branch: `git status`       |
| 2    | `npm ci`                                     | Verify lockfile: `npm list`      |
| 3    | `npm run typecheck`                          | No errors in output              |
| 4    | `npm run build`                              | Check `dist/index.js` exists     |
| 5    | Backup DB: `cp data.db data.db.backup`       | Verify backup size matches       |
| 6    | `npm run migrate`                            | Check schema version incremented |
| 7    | `npm run commands`                           | Verify "N commands registered"   |
| 8    | `systemctl restart pawtropolis`              | Check status: `systemctl status` |
| 9    | Smoke test: Run `/health` in Discord         | Verify uptime reset to 0s        |
| 10   | Monitor logs: `journalctl -u pawtropolis -f` | No errors for 5 minutes          |

## Actionable Recommendations

### Immediate Actions

1. **Fix Sentry 403**: Rotate DSN or disable until project permissions resolved.
2. **Validate env on startup**: Exit if required vars missing (already implemented above).
3. **Auto-sync commands**: Add `npm run commands` to `ExecStartPre` in systemd unit.

### Deployment Improvements

1. **Blue-green deployment**: Run two instances; switch traffic after health check passes.
2. **Automated backups**: Cron job to backup DB before deploy (`0 2 * * * cp data.db backups/data_$(date +\%Y\%m\%d).db`).
3. **Rollback script**: Automate restore from backup + git revert + restart.

### Observability Enhancements

1. **Health endpoint**: HTTP server on port 3000 returning `/health` (uptime, DB stats).
2. **Structured logging**: Replace `console.log` with JSON logs (timestamp, level, context).
3. **Alert on crashes**: Systemd OnFailure hook to notify admin channel via webhook.

### Security Hardening

1. **Encrypt .env**: Use dotenvx encryption (`dotenvx encrypt`) for secrets.
2. **Rotate tokens**: Monthly Discord token rotation (regenerate in Developer Portal).
3. **Least privilege**: Run bot as dedicated user with minimal filesystem permissions.
