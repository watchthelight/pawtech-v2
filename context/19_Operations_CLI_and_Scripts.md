---
title: "Operations CLI and Scripts"
slug: "19_Operations_CLI_and_Scripts"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Operations"
audience: "Operators • Engineers • SRE"
source_of_truth: ["start.cmd", "start.ps1", "scripts/", "package.json"]
related:
  - "08_Deployment_Config_and_Env"
  - "11_Runtime_Database_Recovery_Guide"
  - "15_Website_Status_and_Health_Monitoring"
summary: "Complete reference for operational scripts: start.cmd, start.ps1, deploy.ps1, common flags (--recover, --fresh, --skip-sync), database sync workflows, and usage examples."
---

## Purpose & Outcomes

Document all operational scripts and CLI tools:
- `start.cmd` unified start/stop/deploy script (Windows)
- `start.ps1` PowerShell remote deployment
- `deploy.ps1` website deployment
- Database sync workflows (pull, push, recover)
- PM2 process management
- Common flag combinations

## Scope & Boundaries

### In Scope
- All scripts in root directory (`*.cmd`, `*.ps1`)
- Scripts in `scripts/` directory
- NPM scripts in `package.json`
- Database sync operations
- PM2 remote control
- Recovery workflows

### Out of Scope
- Manual database operations (covered in 11_Runtime_Database_Recovery_Guide.md)
- Environment configuration (covered in 08_Deployment_Config_and_Env.md)

## Current State

**Primary Script**: `start.cmd` (Windows batch, 791 lines)
**Remote Deploy**: `start.ps1` (PowerShell, 62 lines)
**PM2 Process Name**: `pawtropolis`
**Remote Alias**: `pawtech` (configured in `~/.ssh/config`)

## Key Flows

### Local Development Flow
```
1. start.cmd --local (pulls remote DB)
2. Runs tests (npm test)
3. Builds project (npm run build)
4. Starts dev server (npm run dev)
5. Hot reload on code changes
```

### Remote Deployment Flow
```
1. start.cmd --remote --fresh
2. Builds locally (npm run build)
3. Creates tarball (tar -czf deploy.tar.gz)
4. Uploads to remote (scp)
5. Extracts on remote (ssh + tar)
6. Restarts PM2 (pm2 restart)
```

### Database Sync Flow (Default: Pull)
```
1. Check remote DB exists
2. Backup local DB (if exists)
3. Backup remote DB
4. Checkpoint WAL on remote
5. Pull remote DB → local (with WAL/SHM)
6. Verify integrity
7. Write manifest
```

## Commands & Snippets

### start.cmd Usage

#### Local Development
```cmd
REM Pull remote DB + start dev server
start.cmd --local

REM Start without DB sync (use existing local DB)
start.cmd --local --skip-sync

REM Clean install + rebuild + start
start.cmd --local --fresh
```

#### Remote Operations
```cmd
REM Quick restart (pulls DB first)
start.cmd --remote

REM Full deploy (build + upload + restart)
start.cmd --remote --fresh

REM Restart without DB sync
start.cmd --remote --skip-sync
```

#### Database Operations
```cmd
REM Push local DB to remote (explicit only, stops remote bot)
start.cmd --push-remote

REM Interactive recovery (choose from candidates)
start.cmd --recover

REM Download all remote DB files for offline recovery
start.cmd --recover-remote-db
```

#### Stop Operations
```cmd
REM Stop all local and remote processes
start.cmd --stop
```

### start.ps1 Usage (PowerShell)

```powershell
# Remote deployment via SSH
.\start.ps1

# Expected output:
# [local] Connecting to pawtech via SSH...
# [remote] cwd: /home/ubuntu/pawtropolis-tech
# [remote] Building project...
# [remote] Restarting PM2...
# [local] Remote deployment completed successfully!
```

### Common Workflows

#### Workflow 1: Start Local Development
```cmd
REM 1. Pull latest code
git pull

REM 2. Start with remote DB
start.cmd --local

REM Expected flow:
REM [sync] Pulling remote database to local...
REM [sync] ✓ Remote database pulled successfully
REM [1/4] Checking for npm...
REM [2/4] Running tests...
REM [3/4] Building project...
REM [4/4] Starting development server...
REM Bot ready as TestBot#1234
```

#### Workflow 2: Deploy to Production
```cmd
REM 1. Test locally first
npm test

REM 2. Full deploy to remote
start.cmd --remote --fresh

REM Expected flow:
REM [sync] Pulling remote database to local...
REM [1/6] Checking for required tools...
REM [2/6] Building project locally...
REM [3/6] Creating deployment tarball...
REM [4/6] Uploading to remote server...
REM [5/6] Extracting and installing on remote...
REM [6/6] Restarting PM2 process...
REM [SUCCESS] Remote fresh deploy complete
```

#### Workflow 3: Recover from Corrupted Database
```cmd
REM 1. Download all remote DB candidates
start.cmd --recover-remote-db

REM 2. Interactive recovery (choose best candidate)
start.cmd --recover

REM 3. Push recovered DB to remote
start.cmd --push-remote

REM 4. Restart remote bot
start.cmd --remote
```

#### Workflow 4: Test Changes Without DB Sync
```cmd
REM Scenario: Testing local changes, don't want to pull remote DB

REM 1. Start with existing local DB
start.cmd --local --skip-sync

REM 2. Make code changes (hot reload active)

REM 3. Test changes
npm test
```

### NPM Scripts

```bash
# Development
npm run dev              # Start dev server with hot reload
npm run build            # Build for production

# Testing
npm test                 # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:ui          # Open Vitest UI

# Quality Checks
npm run check            # Run all checks (typecheck + lint + format + test)
npm run lint             # ESLint
npm run format           # Prettier (write)
npm run format:check     # Prettier (check only)
npm run typecheck        # TypeScript compilation check

# Deployment
npm run deploy:cmds      # Deploy slash commands to Discord
npm run sync:cmds        # Sync commands (alias for deploy:cmds)

# Utilities
npm run migrate          # Run database migrations
npm run migrate:dry      # Preview migrations without applying
npm run health:check     # Run health check (if script exists)
```

### Script Files Reference

#### scripts/deploy-commands.ts
**Purpose**: Register slash commands with Discord API
**Usage**: `npm run deploy:cmds`
**Output**: List of registered commands with IDs

#### scripts/migrate.ts
**Purpose**: Apply pending database migrations
**Usage**: `npm run migrate` or `npm run migrate:dry`
**Idempotency**: Safe to run multiple times

#### scripts/verify-db-integrity.js
**Purpose**: Check database integrity (used by start.cmd)
**Usage**: `node scripts/verify-db-integrity.js <path-to-db>`
**Exit codes**:
- 0: Database healthy
- 1: Database corrupted

#### scripts/recover-db.ps1
**Purpose**: Interactive DB recovery with candidate selection
**Usage**: `start.cmd --recover` (wrapper) or direct: `powershell -File scripts/recover-db.ps1`

## Interfaces & Data

### start.cmd Configuration (Edit at top of file)

```cmd
REM Configuration variables
set REMOTE_ALIAS=pawtech
set REMOTE_PATH=/home/ubuntu/pawtropolis-tech
set PM2_NAME=pawtropolis
set LOCAL_PORT=3000
set DB_LOCAL=.\data\data.db
set DB_REMOTE=%REMOTE_PATH%/data/data.db
set MANIFEST_FILE=data\.db-manifest.json
```

### Database Manifest (data/.db-manifest.json)

```json
{
  "local": {
    "exists": 1,
    "mtime": 1730217600,
    "size": 27336704,
    "sha256": "a3f8b2c1d4e5f6g7h8i9j0k1l2m3n4o5"
  },
  "remote": {
    "exists": 1,
    "mtime": 1730220000,
    "size": 27336704,
    "sha256": "a3f8b2c1d4e5f6g7h8i9j0k1l2m3n4o5"
  },
  "synced_at": "2025-10-30T12:00:00Z",
  "mode": "pull-remote"
}
```

**Fields**:
- `exists`: 1 if file exists, 0 if not
- `mtime`: Unix timestamp (seconds) of last modification
- `size`: File size in bytes
- `sha256`: SHA-256 hash of file contents
- `synced_at`: UTC timestamp of last sync
- `mode`: `pull-remote` | `push-remote`

## Ops & Recovery

### Troubleshooting start.cmd

#### Error: "npm not found"
**Cause**: Node.js not installed or not in PATH
**Fix**:
```cmd
REM Install Node.js from https://nodejs.org/
REM Verify installation:
where npm
npm --version
```

#### Error: "ssh not found"
**Cause**: SSH not installed (for remote operations)
**Fix**:
```cmd
REM Install Git for Windows (includes SSH)
REM Or install OpenSSH:
REM Settings → Apps → Optional Features → OpenSSH Client

REM Verify installation:
where ssh
ssh -V
```

#### Error: "Remote database is corrupted"
**Cause**: Remote DB failed integrity check during pull
**Resolution**:
```cmd
REM 1. Local DB is NOT overwritten (safe)

REM 2. Check remote DB health:
ssh pawtech "sqlite3 /home/ubuntu/pawtropolis-tech/data/data.db 'PRAGMA integrity_check'"

REM 3. If corrupted, recover from backup:
ssh pawtech "ls -lht /home/ubuntu/pawtropolis-tech/data/backups/"

REM 4. Restore good backup on remote:
ssh pawtech "cp /home/ubuntu/pawtropolis-tech/data/backups/data-TIMESTAMP.db /home/ubuntu/pawtropolis-tech/data/data.db"

REM 5. Retry pull:
start.cmd --local
```

#### Error: "PM2 restart failed"
**Cause**: PM2 not initialized or process not registered
**Fix**:
```cmd
REM Check PM2 status:
ssh pawtech "pm2 list"

REM If empty, start bot manually:
ssh pawtech "pm2 start /home/ubuntu/pawtropolis-tech/dist/index.js --name pawtropolis"

REM Save PM2 config:
ssh pawtech "pm2 save"

REM Setup PM2 startup:
ssh pawtech "pm2 startup"
```

### Manual Database Sync (Bypass start.cmd)

#### Manual Pull (Remote → Local)
```cmd
REM 1. Backup local
copy data\data.db data\backups\data-%DATE:~-4,4%%DATE:~-10,2%%DATE:~-7,2%.local.db

REM 2. Pull from remote
scp pawtech:/home/ubuntu/pawtropolis-tech/data/data.db data\data.db
scp pawtech:/home/ubuntu/pawtropolis-tech/data/data.db-wal data\data.db-wal
scp pawtech:/home/ubuntu/pawtropolis-tech/data/data.db-shm data\data.db-shm
```

#### Manual Push (Local → Remote)
```cmd
REM 1. Stop remote bot (critical!)
ssh pawtech "pm2 stop pawtropolis"

REM 2. Backup remote
ssh pawtech "cp /home/ubuntu/pawtropolis-tech/data/data.db /home/ubuntu/pawtropolis-tech/data/backups/data-$(date +%Y%m%d-%H%M%S).db"

REM 3. Push to remote
scp data\data.db pawtech:/home/ubuntu/pawtropolis-tech/data/data.db
scp data\data.db-wal pawtech:/home/ubuntu/pawtropolis-tech/data/data.db-wal
scp data\data.db-shm pawtech:/home/ubuntu/pawtropolis-tech/data/data.db-shm

REM 4. Restart remote bot
ssh pawtech "pm2 start pawtropolis"
```

## Security & Privacy

- SSH keys stored in `authentication/` (gitignored)
- Database backups stored in `data/backups/` (gitignored)
- Remote access via SSH keys only (no passwords)
- PM2 process runs as `ubuntu` user (non-root)

## FAQ / Gotchas

**Q: Why does --local always pull remote DB?**
A: Safety measure. Ensures local dev environment matches production. Use `--skip-sync` to disable.

**Q: Can I push local DB to remote without stopping bot?**
A: No, `start.cmd --push-remote` automatically stops remote bot to prevent corruption.

**Q: What if DB sync fails mid-transfer?**
A: Local DB is backed up before any writes. Original is preserved. Check `data/backups/`.

**Q: How do I change remote server?**
A: Edit `REMOTE_ALIAS` at top of `start.cmd`. Ensure SSH config has matching entry.

**Q: Can I run start.cmd on Linux/Mac?**
A: No, it's Windows-only (batch file). Use `start.ps1` (PowerShell) or manual commands.

## Changelog

- 2025-10-30: Initial creation with complete start.cmd and start.ps1 documentation
