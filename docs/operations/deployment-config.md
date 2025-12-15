# Deployment and Configuration

## Tech Stack

### Node.js and TypeScript

- Node: 20.x
- TypeScript: 5.x with strict mode
- Package Manager: npm

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

tsup is a fast bundler for TypeScript projects.

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
npm run build       # Build for production
npm run dev         # Build with hot reload
npm run typecheck   # Check types without building
```

Output: `dist/index.js`

## Environment Variables

### Required

| Variable        | Type   | Description                               | Example                         |
| --------------- | ------ | ----------------------------------------- | ------------------------------- |
| `DISCORD_TOKEN` | string | Bot token from Discord Developer Portal   | `MTQyOTk0Njk4NjAxODM3Nzg0OA...` |
| `CLIENT_ID`     | string | Application ID (from Developer Portal)    | `1429946986018377848`           |
| `GUILD_ID`      | string | Discord server ID (right-click → Copy ID) | `1234567890123456789`           |
| `DATABASE_URL`  | string | Path to SQLite database file              | `./data/data.db`                |

### Optional

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

### Loading Environment Variables

The bot uses dotenvx to load environment variables from `.env` files.

```typescript
// src/index.ts
import { config } from "@dotenvx/dotenvx";
config(); // Load .env file

// Check required variables
const requiredVars = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID", "DATABASE_URL"];
for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`Missing: ${varName}`);
    process.exit(1);
  }
}

console.log("Environment loaded");
```

**Multiple files**:

```bash
.env                 # Default (not in git)
.env.development     # Development settings
.env.production      # Production settings
.env.example         # Template (in git)
```

**Load specific file**:

```bash
NODE_ENV=production npm start
```

## Command Sync Script

This registers your slash commands with Discord. Run this after changing any command.

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
    console.log(`Registering ${commands.length} commands...`);

    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID!), {
      body: commands,
    });

    console.log("Commands registered.");
  } catch (error) {
    console.error("Registration failed:", error);
    process.exit(1);
  }
})();
```

**Run on deploy**:

```bash
npm run commands
```

**Clear all commands**:

```bash
npm run commands:clear
```

## Sentry Configuration

Sentry tracks errors and performance issues.

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
      // Ignore DM errors
      if (event.exception?.values?.[0]?.type === "DiscordAPIError[50007]") {
        return null;
      }
      return event;
    },
  });

  console.log("Sentry initialized");
} else {
  console.warn("Sentry disabled");
}
```

### Known Issue: 403 Error

If you get a 403 error, the DSN may be invalid.

**To fix**:

1. Check your DSN in Sentry: Settings → Projects → Client Keys
2. Make sure you have admin permissions
3. Test with curl:
   ```bash
   curl -X POST "https://o<org>.ingest.sentry.io/api/<project>/store/" \
     -H "X-Sentry-Auth: Sentry sentry_key=<key>, sentry_version=7" \
     -H "Content-Type: application/json" \
     -d '{"message":"test"}'
   ```

**To disable Sentry**:

```bash
# .env
SENTRY_DSN=
```

## OpenTelemetry

OpenTelemetry provides detailed tracing data.

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
  console.log("OpenTelemetry enabled");

  process.on("SIGTERM", () => {
    sdk.shutdown().then(() => console.log("Tracing stopped"));
  });
} else {
  console.log("OpenTelemetry disabled");
}
```

**Environment variables**:

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=pawtropolis-bot
```

## Running the Bot

### Systemd (Linux)

Create `/etc/systemd/system/pawtropolis.service`:

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

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/pawtropolis/data

[Install]
WantedBy=multi-user.target
```

**Commands**:

```bash
sudo systemctl enable pawtropolis   # Start on boot
sudo systemctl start pawtropolis    # Start bot
sudo systemctl status pawtropolis   # Check status
sudo systemctl restart pawtropolis  # Restart bot
journalctl -u pawtropolis -f        # View logs
```

### PM2 (Alternative)

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
pm2 startup              # Start on boot
pm2 save                 # Save running apps
pm2 logs pawtropolis     # View logs
pm2 restart pawtropolis  # Restart
pm2 monit                # Monitor
```

## Deployment Steps

1. `git pull origin main` - Get latest code
2. `npm ci` - Install dependencies
3. `npm run typecheck` - Check for errors
4. `npm run build` - Build the bot
5. `cp data.db data.db.backup` - Backup database
6. `npm run migrate` - Update database
7. `npm run commands` - Register commands
8. `systemctl restart pawtropolis` - Restart bot
9. Run `/health` in Discord - Test bot
10. `journalctl -u pawtropolis -f` - Watch logs
