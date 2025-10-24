## Setup and Running

Quick start guide for local development and production deployment.

---

## Prerequisites

- **Node.js**: v20.0.0 or higher ([Download](https://nodejs.org/))
- **npm**: Included with Node.js
- **Git**: For cloning the repository
- **Discord Bot**: Create an application at [Discord Developer Portal](https://discord.com/developers/applications)
  - Enable `Privileged Gateway Intents`: Server Members Intent, Message Content Intent
  - OAuth2 scopes: `bot`, `applications.commands`
  - Bot permissions: Administrator (or granular: Manage Roles, Manage Channels, Manage Messages, etc.)

---

## Local Development Setup

### 1. Clone and Install

```bash
git clone https://github.com/watchthelight/pawtropolis-tech.git
cd pawtropolis-tech
npm install
```

### 2. Configure Environment

Create `.env` file in project root:

```env
# Required
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
RESET_PASSWORD=dev_password

# Optional - Development
NODE_ENV=development
GUILD_ID=your_test_guild_id  # Faster command sync (dev only)
DB_PATH=./data/dev.db
LOG_LEVEL=debug
GATE_SHOW_AVATAR_RISK=1
```

**Getting Discord credentials:**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. **Bot tab** → Copy token (this is `DISCORD_TOKEN`)
4. **General Information** → Copy Application ID (this is `CLIENT_ID`)
5. **OAuth2 → URL Generator** → Select `bot` + `applications.commands` + `Administrator` → Copy invite URL
6. Open invite URL to add bot to test server

### 3. Initialize Database

Database auto-creates on first run, but you can manually trigger migrations:

```bash
npm run migrate       # Apply migrations
npm run migrate:dry   # Preview migrations without applying
```

### 4. Register Slash Commands

```bash
npm run deploy:cmds
```

**Note:** Commands appear instantly in guilds when `GUILD_ID` is set. Global commands take up to 1 hour.

### 5. Start Development Server

```bash
npm run dev
```

**What happens:**
- Starts bot with hot reload (watches `src/**/*.ts`)
- Connects to Discord Gateway
- Runs schema migrations
- Starts Fastify web server on port 3000
- Logs JSON to console (pipe to `pino-pretty` for readable output)

---

## Common Development Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start with hot reload (tsx watch mode) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run production build |
| `npm test` | Run Vitest test suite |
| `npm run check` | TypeScript type checking (no build) |
| `npm run lint` | ESLint code quality checks |
| `npm run format` | Prettier auto-formatting |
| `npm run deploy:cmds` | Register slash commands to Discord |
| `npm run sync:cmds` | Sync commands to all guilds |
| `npm run migrate` | Apply database migrations |
| `npm run auth:whoami` | Verify Discord OAuth2 setup |

---

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test tests/review/approveFlow.test.ts

# Run with UI
npm test -- --ui

# Run with coverage
npm test -- --coverage

# Watch mode (auto-rerun on changes)
npm test -- --watch
```

Test files mirror `src/` structure in `tests/` directory. See [08-testing-and-quality.md](08-testing-and-quality.md).

---

## Production Deployment

### Build Artifacts

```bash
npm run build
```

**Output:**
- `dist/index.js` - Main bot entry point
- `dist/scripts/commands.js` - Command sync script
- Source maps included for debugging

**Build tool:** tsup ([tsup.config.ts](../tsup.config.ts))
- Target: Node.js 20 ESM
- No minification (readable stack traces)
- No code splitting (single bundle)

### Production Environment

Create `.env.production`:

```env
# Required
DISCORD_TOKEN=prod_bot_token
CLIENT_ID=prod_client_id
RESET_PASSWORD=strong_random_password

# Production settings
NODE_ENV=production
DB_PATH=./data/data.db
LOG_LEVEL=info

# Sentry error tracking (optional)
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# Web dashboard (optional)
DISCORD_CLIENT_SECRET=oauth2_secret
DASHBOARD_REDIRECT_URI=https://yourdomain.com/auth/callback
ADMIN_ROLE_ID=admin_role_id
FASTIFY_SESSION_SECRET=random_32_char_string
DASHBOARD_PORT=3000
```

### Start Production Server

**Using provided scripts (Windows):**

```powershell
# Start bot with PM2
.\start.ps1

# Deploy to remote server
.\deploy.ps1
```

**Manual start:**

```bash
# Copy environment
cp .env.production .env

# Build
npm run build

# Start (foreground)
npm start

# Or with PM2 (recommended)
pm2 start dist/index.js --name pawtropolis-tech
pm2 save
pm2 startup  # Auto-start on server reboot
```

### Remote Deployment (PowerShell)

The bot includes automated deployment to Windows servers:

1. **Edit [deploy.ps1](../deploy.ps1)** with your server details
2. Run `.\deploy.ps1` from local machine
3. Script will:
   - Build locally (`npm run build`)
   - Create tarball of `dist/` and `package.json`
   - SCP to remote server
   - SSH to extract and restart PM2 process

**Requirements:**
- WinRM or SSH access to remote server
- PM2 installed on remote server
- `.env` file already on remote server (not deployed via script)

---

## VS Code Integration

### Recommended Extensions

- **ESLint** (dbaeumer.vscode-eslint) - Linting
- **Prettier** (esbenp.prettier-vscode) - Formatting
- **TypeScript Vue Plugin** (Vue.volar) - Better TS support
- **Error Lens** (usernamehw.errorlens) - Inline errors

### Workspace Settings

Project includes `.vscode/settings.json` (if created):

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

### Debug Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Bot",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "skipFiles": ["<node_internals>/**"],
      "env": {
        "NODE_ENV": "development"
      }
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Run Tests",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["test"],
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

---

## Troubleshooting

### Commands Not Appearing in Discord

**Problem:** Slash commands don't show in server

**Solution:**
```bash
# Re-register commands
npm run deploy:cmds

# Check bot has applications.commands scope
# Verify CLIENT_ID matches application ID
npm run env:check
```

### Database Locked Errors

**Problem:** `SQLITE_BUSY` errors in logs

**Solution:**
- Ensure only one bot instance is running
- Check `DB_PATH` points to correct file
- Increase `DB_BUSY_TIMEOUT_MS` in [src/db/db.ts](../src/db/db.ts) L23

### Module Not Found Errors

**Problem:** `Cannot find module './config.js'`

**Solution:**
```bash
# Rebuild dependencies
npm clean-install

# Ensure NODE_ENV allows .ts imports
export NODE_ENV=development
npm run dev
```

### Avatar Scanning Fails

**Problem:** `ONNX runtime error` in logs

**Solution:**
```bash
# Rebuild ONNX runtime native bindings
npm rebuild onnxruntime-node

# Verify ONNX model file exists
ls -la src/features/models/  # Check for .onnx files
```

### Web Server Port In Use

**Problem:** `EADDRINUSE: address already in use :::3000`

**Solution:**
```bash
# Change port in .env
echo "DASHBOARD_PORT=8080" >> .env

# Or kill process using port 3000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac:
lsof -ti:3000 | xargs kill -9
```

### Permission Errors on Startup

**Problem:** `Missing Access` or `Missing Permissions` errors

**Solution:**
- Re-invite bot with Administrator permission
- Or grant specific permissions:
  - Manage Roles
  - Manage Channels
  - Manage Messages
  - Manage Threads
  - View Channels
  - Send Messages
  - Embed Links
  - Attach Files
  - Read Message History

### Database Migration Failures

**Problem:** Schema migration errors on startup

**Solution:**
```bash
# Backup database
cp data/data.db data/data.db.backup

# Dry run migrations
npm run migrate:dry

# Apply migrations
npm run migrate

# If corrupt, reset (WARNING: deletes data)
rm data/data.db
npm run migrate
```

---

## Health Monitoring

### Check Bot Status

```bash
# HTTP health endpoint
curl http://localhost:3000/health

# Response:
{
  "ok": true,
  "version": "1.1.0",
  "service": "pawtropolis-web",
  "uptime_s": 3600,
  "timestamp": "2025-10-23T12:00:00.000Z"
}
```

### View Logs

**Development:**
```bash
npm run dev 2>&1 | npx pino-pretty
```

**Production (PM2):**
```bash
pm2 logs pawtropolis-tech
pm2 logs pawtropolis-tech --lines 100  # Last 100 lines
pm2 logs pawtropolis-tech --err        # Errors only
```

### Database Inspection

```bash
sqlite3 data/data.db

# Inside SQLite prompt:
.tables                  # List tables
.schema application      # Show schema
SELECT COUNT(*) FROM application WHERE status='submitted';  # Query
.quit
```

---

## Next Steps

- Configure application questions: Insert rows into `guild_question` table
- Set up logging channel: Use `/config set logging_channel_id <channel_id>`
- Configure mod roles: Use `/config set mod_role_ids <role_ids>`
- Test application flow: Click "Start Verification" button in configured channel

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development workflow.
