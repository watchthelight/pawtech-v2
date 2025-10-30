---
title: "Troubleshooting and Operational Runbook"
slug: "09_Troubleshooting_and_Runbook"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Platform"
audience: "Operators • DevOps • Support Engineers"
source_of_truth: ["production experience", "incident logs", "PM2 monitoring"]
related:
  - "02_System_Architecture_Overview"
  - "08_Deployment_Config_and_Env"
  - "07_Database_Schema_and_Migrations"
summary: "Comprehensive troubleshooting guide and operational runbook with quick diagnostics, common issues, step-by-step resolution playbooks, and recovery procedures for production incidents."
---

## Purpose & Outcomes

- **Rapid diagnosis**: Quick health checks to identify root causes within minutes
- **Proven solutions**: Step-by-step playbooks tested in production incidents
- **Self-service recovery**: Empower operators to resolve common issues without escalation
- **Incident prevention**: Proactive monitoring commands and early warning signals
- **Knowledge capture**: Document tribal knowledge and production experience

## Scope & Boundaries

### In Scope
- Bot connection and authentication issues
- Web server and OAuth2 troubleshooting
- Database corruption and recovery
- PM2 process management problems
- Apache reverse proxy configuration
- Memory and resource exhaustion
- Permission and role verification failures
- Test isolation and cache interference

### Out of Scope
- Discord platform outages (check https://discordstatus.com)
- Network infrastructure failures (ISP/datacenter level)
- OS-level kernel panics or hardware failures
- Security incident response (separate runbook)
- Third-party API outages (Google Vision API, Sentry)

## Current State

### Health Check Dashboard

**Quick Status Commands**:
```bash
# Comprehensive health check
pm2 status pawtropolis && \
curl -I http://localhost:3000/health && \
sqlite3 data/data.db "SELECT COUNT(*) FROM application;" && \
echo "✅ All systems operational"
```

**Expected Outputs**:
- PM2 status: `online`, uptime > 0, restarts < 10
- Health endpoint: `HTTP/1.1 200 OK`
- Database: Row count > 0 (confirms DB accessible)

### Common Error Patterns

| Error Message | Root Cause | Playbook |
|---------------|------------|----------|
| `[TOKEN_INVALID]` | Discord bot token expired/invalid | [Invalid Bot Token](#playbook-invalid-bot-token) |
| `ECONNREFUSED :3000` | Fastify web server not running | [Web Server Not Starting](#playbook-web-server-not-starting) |
| `SQLITE_BUSY` | Database lock timeout | [Database Lock Timeout](#playbook-database-lock-timeout) |
| `404 /auth/login` | Apache proxy misconfigured | [OAuth2 404 Behind Apache](#playbook-oauth2-404-behind-apache) |
| `ENOMEM` during npm install | Out of memory | [NPM/CI Memory Issues](#playbook-npmci-memory-issues) |
| `Admin role required` | Role verification failed | [Admin Role Required](#playbook-admin-role-required-error) |
| `DiscordAPIError[50001]` | Missing bot permissions | [Missing Bot Permissions](#playbook-missing-bot-permissions) |

## Key Flows

### 1. Quick Probes

**Purpose**: Rapid triage to identify failing component.

#### Check Bot Status

```bash
# PM2 status check
pm2 status pawtropolis
# Expected: status: online, CPU < 50%, mem < 500 MB

# View recent logs
pm2 logs pawtropolis --lines 50 --nostream

# Check for successful connection
pm2 logs pawtropolis --nostream | grep "Bot ready"
# Expected: {"level":30,"tag":"Pawtropolis Tech#2205","msg":"Bot ready"}

# Check restart count (high count indicates crash loop)
pm2 info pawtropolis | grep restarts
# Expected: restarts < 10 (low number)
```

#### Check Web Server

```bash
# Verify Fastify is listening
ss -tlnp | grep :3000
# Expected: LISTEN 0 511 127.0.0.1:3000

# Test health endpoint
curl -I http://localhost:3000/health
# Expected: HTTP/1.1 200 OK
# Response body: {"ok":true,"version":"1.1.0",...}

# Test OAuth2 route behind Apache
curl -I https://pawtropolis.tech/auth/login
# Expected: HTTP/2 302 (redirect to Discord)
```

#### Check Database

```bash
# Verify database file exists
ls -lh data/data.db
# Expected: file size > 0 (not empty)

# Query table counts
sqlite3 data/data.db <<SQL
SELECT 'application' as tbl, COUNT(*) FROM application
UNION ALL
SELECT 'action_log', COUNT(*) FROM action_log
UNION ALL
SELECT 'mod_metrics', COUNT(*) FROM mod_metrics;
SQL

# Check for database locks
lsof data/data.db
# Expected: Only PM2-managed node processes

# Verify integrity
sqlite3 data/data.db "PRAGMA integrity_check;"
# Expected: ok
```

#### Check Apache (if reverse proxy enabled)

```bash
# Apache status
sudo systemctl status apache2
# Expected: active (running)

# Check proxy modules enabled
apache2ctl -M | grep proxy
# Expected:
#   proxy_module (shared)
#   proxy_http_module (shared)

# Test configuration syntax
sudo apache2ctl configtest
# Expected: Syntax OK

# View recent errors
sudo tail -f /var/log/apache2/pawtropolis-error.log
```

#### Check Discord Gateway Connection

```bash
# Monitor connection status
pm2 logs pawtropolis --lines 100 | grep -E "(ready|disconnect|reconnect)"

# Expected patterns:
# {"msg":"Bot ready","tag":"Pawtropolis Tech#2205"}  # Success
# {"msg":"WebSocket disconnected"}                    # Warning (auto-reconnect)
# {"msg":"Resuming session"}                          # Recovery in progress
```

### 2. Incident Response Workflow

```
┌────────────────────────────────────┐
│ Alert/Report Received              │
│ (PM2 restart, 5xx errors, etc.)    │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 1. Assess Severity                 │
│    - P0: Complete outage           │
│    - P1: Partial degradation       │
│    - P2: Non-critical error        │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 2. Run Quick Probes                │
│    pm2 status, curl health,        │
│    check logs, DB integrity        │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 3. Identify Root Cause             │
│    Match error to table above      │
│    → Select appropriate playbook   │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 4. Execute Playbook                │
│    Follow step-by-step resolution  │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 5. Verify Recovery                 │
│    Re-run health checks            │
│    Monitor for 15 minutes          │
└────────┬───────────────────────────┘
         ▼
┌────────────────────────────────────┐
│ 6. Document Incident               │
│    Update runbook if new issue     │
│    Post-mortem if P0/P1            │
└────────────────────────────────────┘
```

## Commands & Snippets

### Health Check Suite

```bash
#!/bin/bash
# health-check.sh - Run all diagnostic checks

echo "=== Pawtropolis Health Check ==="
echo ""

echo "1. PM2 Status:"
pm2 status pawtropolis

echo ""
echo "2. Web Server:"
curl -s http://localhost:3000/health | jq .

echo ""
echo "3. Database:"
sqlite3 data/data.db "SELECT COUNT(*) as applications FROM application;"

echo ""
echo "4. Recent Errors:"
pm2 logs pawtropolis --err --lines 10 --nostream

echo ""
echo "5. Memory Usage:"
pm2 info pawtropolis | grep memory

echo ""
echo "=== Health Check Complete ==="
```

### Log Analysis

```bash
# Search for errors in last 1000 lines
pm2 logs pawtropolis --lines 1000 --nostream | grep -i error

# Filter by log level (error = 50)
pm2 logs pawtropolis --lines 500 --nostream | jq 'select(.level >= 50)'

# Find specific error codes
pm2 logs pawtropolis --lines 500 --nostream | grep "DiscordAPIError"

# Monitor logs in real-time
pm2 logs pawtropolis --raw | pnpm exec pino-pretty

# Export logs for analysis
pm2 logs pawtropolis --lines 5000 --nostream > logs-$(date +%Y%m%d-%H%M%S).txt
```

### Database Maintenance

```bash
# Backup database
sqlite3 data/data.db ".backup data/backup-$(date +%Y%m%d-%H%M%S).db"

# Check database size
du -h data/data.db

# Vacuum database (reclaim space)
pm2 stop pawtropolis
sqlite3 data/data.db "VACUUM;"
pm2 start pawtropolis

# Analyze query performance
sqlite3 data/data.db "ANALYZE;"

# Check for orphaned records
sqlite3 data/data.db <<SQL
SELECT COUNT(*) as orphaned_claims
FROM review_claim rc
LEFT JOIN application a ON rc.app_id = a.id
WHERE a.id IS NULL;
SQL
```

## Interfaces & Data

### Error Codes and Meanings

**Discord API Errors**:
```typescript
// Common DiscordAPIError codes
{
  10003: "Unknown Channel",           // Channel deleted or bot can't see it
  10004: "Unknown Guild",              // Bot kicked from server
  10008: "Unknown Message",            // Message deleted
  50001: "Missing Access",             // Bot lacks VIEW_CHANNEL permission
  50013: "Missing Permissions",        // Bot lacks required permission for action
  50035: "Invalid Form Body",          // Malformed API request
  60003: "Two factor required"         // Server requires 2FA for mod actions
}
```

**SQLite Error Codes**:
```typescript
{
  SQLITE_BUSY: "Database is locked",           // Another process has write lock
  SQLITE_LOCKED: "Table is locked",            // Table-level lock (rare)
  SQLITE_CORRUPT: "Database disk image is malformed",
  SQLITE_CONSTRAINT: "Constraint violation",   // FK or UNIQUE violation
  SQLITE_READONLY: "Attempt to write a readonly database"
}
```

### Monitoring Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| PM2 restarts | > 5 in 1 hour | > 10 in 1 hour | Check logs for crash cause |
| Memory usage | > 400 MB | > 500 MB | Investigate memory leak |
| Response time | > 2s | > 5s | Check database queries |
| Database size | > 500 MB | > 1 GB | Archive old data |
| Disk space | < 2 GB free | < 500 MB free | Clean logs, backups |
| Error rate | > 5% | > 10% | Investigate error logs |

## Ops & Recovery

### Playbook: Invalid Bot Token

**Severity**: P0 (Complete Outage)

**Symptoms**:
- Error: `[TOKEN_INVALID] An invalid token was provided`
- Error: `[DISALLOWED_INTENTS] Privileged intent provided is not enabled or whitelisted`
- Bot fails to start or immediately crashes

**Root Causes**:
1. Bot token expired or regenerated
2. Wrong token copied (OAuth2 secret instead of bot token)
3. Privileged intents not enabled in Discord Developer Portal

**Resolution**:

1. **Verify token in .env**:
   ```bash
   cd /home/ubuntu/pawtropolis-tech
   grep DISCORD_TOKEN .env | head -c 30
   # Should show: DISCORD_TOKEN=MTQyNzQzNjYxNTA...
   ```

2. **Regenerate token** (Discord Developer Portal):
   - Navigate to: https://discord.com/developers/applications
   - Select application → Bot → Reset Token
   - Copy new token (shown only once!)
   - Update `.env`: `DISCORD_TOKEN=NEW_TOKEN_HERE`

3. **Enable privileged intents**:
   - Discord Developer Portal → Bot → Privileged Gateway Intents
   - ✅ Enable "Server Members Intent"
   - ✅ Enable "Message Content Intent"
   - Click "Save Changes"

4. **Restart bot**:
   ```bash
   pm2 restart pawtropolis --update-env
   pm2 logs pawtropolis --lines 20 | grep "Bot ready"
   ```

5. **Verify connection**:
   ```bash
   # Should see successful connection
   {"level":30,"tag":"Pawtropolis Tech#2205","msg":"Bot ready"}
   ```

**Verification**: Bot appears online in Discord, responds to `/ping` command.

---

### Playbook: Web Server Not Starting

**Severity**: P1 (Dashboard Unavailable)

**Symptoms**:
- `curl http://localhost:3000/health` fails with `ECONNREFUSED`
- PM2 logs show: `Error: Address already in use`
- OAuth2 login returns 502 Bad Gateway

**Root Causes**:
1. Port 3000 already occupied by another process
2. Fastify initialization error (missing env vars)
3. PM2 process stuck in restart loop

**Resolution**:

1. **Check if port occupied**:
   ```bash
   ss -tlnp | grep :3000
   # If shows LISTEN by PID other than PM2, kill that process

   # Find process using port
   lsof -i :3000
   # Kill process: kill -9 <PID>
   ```

2. **Verify environment variables**:
   ```bash
   # Check required web server vars
   grep -E "(FASTIFY_SESSION_SECRET|DASHBOARD_PORT)" .env

   # Ensure session secret is set (32+ chars)
   # If missing, generate new one:
   openssl rand -base64 32
   ```

3. **Check PM2 logs for startup errors**:
   ```bash
   pm2 logs pawtropolis --err --lines 50

   # Common errors:
   # - "FASTIFY_SESSION_SECRET is required" → Set in .env
   # - "Cannot find module" → Run npm ci --production
   ```

4. **Restart with clean state**:
   ```bash
   pm2 delete pawtropolis
   pm2 start ecosystem.config.cjs
   pm2 save
   ```

5. **Test health endpoint**:
   ```bash
   curl -v http://localhost:3000/health
   # Expected: 200 OK with JSON response
   ```

**Verification**: Web dashboard accessible at https://pawtropolis.tech/admin

---

### Playbook: Database Lock Timeout

**Severity**: P1 (Partial Degradation)

**Symptoms**:
- Error: `SQLITE_BUSY: database is locked`
- Commands timeout with "Database operation timed out"
- Review actions fail to save

**Root Causes**:
1. Long-running transaction blocking writes
2. Multiple processes accessing database (PM2 cluster mode)
3. WAL checkpoint deadlock

**Resolution**:

1. **Check for multiple processes**:
   ```bash
   lsof data/data.db
   # Should only show ONE PM2 node process
   # If multiple, you're in cluster mode (not supported)
   ```

2. **Force WAL checkpoint**:
   ```bash
   pm2 stop pawtropolis
   sqlite3 data/data.db "PRAGMA wal_checkpoint(TRUNCATE);"
   pm2 start pawtropolis
   ```

3. **Check for corrupted WAL file**:
   ```bash
   ls -lh data/data.db-wal
   # If > 10 MB, checkpoint is stuck

   # Force recovery
   pm2 stop pawtropolis
   rm data/data.db-wal data/data.db-shm
   sqlite3 data/data.db "PRAGMA integrity_check;"
   pm2 start pawtropolis
   ```

4. **Verify busy_timeout setting**:
   ```bash
   sqlite3 data/data.db "PRAGMA busy_timeout;"
   # Expected: 5000 (5 seconds)
   ```

5. **Monitor for repeated locks**:
   ```bash
   pm2 logs pawtropolis --lines 100 | grep SQLITE_BUSY
   # If frequent, investigate slow queries
   ```

**Verification**: Commands execute successfully, no SQLITE_BUSY errors.

**Prevention**: Never run bot in PM2 cluster mode (instances: 1 in config).

---

### Playbook: OAuth2 404 Behind Apache

**Severity**: P1 (Dashboard Login Broken)

**Symptoms**:
- `/auth/login` returns 404 Not Found
- Apache error log: `File does not exist: /var/www/pawtropolis/website/auth`
- Direct access to `http://localhost:3000/auth/login` works

**Root Causes**:
1. Apache proxy modules not enabled
2. Incorrect ProxyPass configuration
3. Fastify not listening on localhost:3000

**Resolution**:

1. **Verify Fastify is running**:
   ```bash
   ss -tlnp | grep :3000
   # Should show: LISTEN on 127.0.0.1:3000

   curl http://localhost:3000/health
   # Should return: {"ok":true,...}
   ```

2. **Enable Apache proxy modules**:
   ```bash
   apache2ctl -M | grep proxy
   # Should show:
   #   proxy_module (shared)
   #   proxy_http_module (shared)

   # If missing:
   sudo a2enmod proxy proxy_http
   sudo systemctl reload apache2
   ```

3. **Verify ProxyPass configuration**:
   ```bash
   sudo nano /etc/apache2/sites-available/pawtropolis.tech.conf

   # Ensure these lines exist in <VirtualHost *:443>:
   ProxyPass /auth/ http://localhost:3000/auth/
   ProxyPassReverse /auth/ http://localhost:3000/auth/
   ProxyPass /api/ http://localhost:3000/api/
   ProxyPassReverse /api/ http://localhost:3000/api/
   ProxyPass /admin/ http://localhost:3000/admin/
   ProxyPassReverse /admin/ http://localhost:3000/admin/

   # Note: Trailing slashes matter!
   ```

4. **Test Apache configuration**:
   ```bash
   sudo apache2ctl configtest
   # Should return: Syntax OK

   # Reload Apache
   sudo systemctl reload apache2
   ```

5. **Test OAuth2 route**:
   ```bash
   curl -I https://pawtropolis.tech/auth/login
   # Should return: HTTP/2 302 (redirect to Discord)
   ```

6. **Check Apache error logs**:
   ```bash
   sudo tail -f /var/log/apache2/pawtropolis-error.log
   # Look for proxy errors or connection refused
   ```

**Verification**: OAuth2 login flow works end-to-end, dashboard accessible.

---

### Playbook: NPM/CI Memory Issues

**Severity**: P2 (Deployment Blocked)

**Symptoms**:
- `npm install` or `npm ci` killed with exit code 137
- Build process hangs and never completes
- `dmesg | grep oom` shows OOM killer activity

**Root Causes**:
1. Instance has < 1 GB RAM
2. npm building native modules (better-sqlite3, sharp)
3. No swap space configured

**Resolution**:

**Option A: Use npm ci with --prefer-offline**
```bash
# Reduces memory usage by using local cache
npm ci --prefer-offline
```

**Option B: Increase swap space**
```bash
# Check current swap
swapon --show

# Create 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify
free -h
```

**Option C: Build on larger instance, deploy artifacts**
```bash
# On local machine or larger instance:
npm ci
npm run build
tar -czf dist.tar.gz dist/ node_modules/

# Transfer to production:
scp dist.tar.gz user@server:/home/ubuntu/pawtropolis-tech/

# On production:
tar -xzf dist.tar.gz
pm2 restart pawtropolis
```

**Option D: Use --production for runtime**
```bash
# Install only runtime dependencies (skip devDependencies)
npm ci --production

# Note: Build must happen elsewhere (local or CI)
```

**Verification**: Dependencies installed successfully, bot starts without errors.

---

### Playbook: Admin Role Required Error

**Severity**: P2 (Access Control Issue)

**Symptoms**:
- User successfully logs in via Discord OAuth2
- Dashboard loads but shows "Admin role required" error
- User is moderator/admin in Discord but denied access

**Root Causes**:
1. `ADMIN_ROLE_ID` not set or incorrect in .env
2. User doesn't actually have the configured role
3. Session cached old role state

**Resolution**:

1. **Verify ADMIN_ROLE_ID in .env**:
   ```bash
   cd /home/ubuntu/pawtropolis-tech
   grep ADMIN_ROLE_ID .env
   # Should show: ADMIN_ROLE_ID=987662057069482024
   ```

2. **Get correct role ID from Discord**:
   - Enable Developer Mode: User Settings → Advanced → Developer Mode
   - Right-click role in Server Settings → Roles → Copy ID
   - Paste into `.env`: `ADMIN_ROLE_ID=ROLE_ID_HERE`

3. **Verify user has role**:
   - Discord → Server Members list
   - Find user → Check role badge
   - If missing: Right-click user → Roles → Assign admin role

4. **Restart bot with updated env**:
   ```bash
   pm2 restart pawtropolis --update-env

   # Verify env loaded
   pm2 logs pawtropolis --lines 10 | grep ADMIN_ROLE_ID
   ```

5. **Clear session and re-login**:
   - Browser → Dev tools (F12) → Application → Cookies
   - Delete `sessionId` cookie for pawtropolis.tech
   - Navigate to `/auth/logout`
   - Try logging in again via `/auth/login`

6. **Check API logs for role verification**:
   ```bash
   pm2 logs pawtropolis --lines 50 | grep "admin role"
   # Should see: User 123456789 has admin role: true
   ```

**Verification**: User can access dashboard and see admin features.

---

### Playbook: Missing Bot Permissions

**Severity**: P1-P2 (Feature Degradation)

**Symptoms**:
- Error: `DiscordAPIError[50001]: Missing Access`
- Error: `DiscordAPIError[50013]: Missing Permissions`
- Commands execute but actions fail (e.g., role assignment)

**Root Causes**:
1. Bot missing required permissions in channel
2. Bot role lower than target role in hierarchy
3. Bot missing server-wide permissions

**Resolution**:

1. **Identify missing permission**:
   ```bash
   pm2 logs pawtropolis --err | grep -A 5 "Missing.*Permissions"
   # Look for permission name in error message
   ```

2. **Common required permissions**:
   ```
   Server-wide:
   - Manage Roles (for role assignment)
   - Kick Members (for /kick command)
   - Manage Channels (for creating review threads)

   Channel-specific (review channel):
   - View Channel
   - Send Messages
   - Embed Links
   - Create Public Threads
   - Send Messages in Threads

   Channel-specific (logging channel):
   - View Channel
   - Send Messages
   - Embed Links
   ```

3. **Grant server-wide permissions**:
   - Discord → Server Settings → Roles
   - Find bot role
   - Enable required permissions
   - Save changes

4. **Grant channel-specific permissions**:
   - Right-click channel → Edit Channel → Permissions
   - Add bot role
   - Enable required permissions
   - Save changes

5. **Fix role hierarchy** (if role assignment fails):
   - Discord → Server Settings → Roles
   - Drag bot role ABOVE target roles
   - Bot cannot assign roles higher than itself

6. **Verify with /config get**:
   ```
   /config get review_channel
   # Should show: ✓ Healthy (bot has permissions)
   ```

**Verification**: Commands execute successfully, no permission errors.

---

### Playbook: Cache/Test Isolation

**Severity**: P2 (Testing Issue)

**Symptoms**:
- Tests pass individually but fail when run together
- Flaky test failures in CI
- "Expected X but got Y" where Y is from previous test

**Root Causes**:
1. Metrics cache persisting between tests
2. Scheduler running during test execution
3. Non-unique test IDs causing collisions

**Resolution**:

1. **Disable schedulers in tests**:
   ```typescript
   // In test setup (tests/setup.ts)
   if (process.env.NODE_ENV === "test") {
     process.env.DISABLE_SCHEDULERS = "1";
   }

   // In scheduler code (src/scheduler/modMetricsScheduler.ts)
   if (process.env.DISABLE_SCHEDULERS === "1") {
     logger.info("Schedulers disabled in test mode");
     return;
   }
   ```

2. **Clear caches between tests**:
   ```typescript
   import { afterEach } from "vitest";
   import { __test__clearModMetricsCache } from "../src/features/modPerformance.js";

   afterEach(() => {
     __test__clearModMetricsCache();
   });
   ```

3. **Use unique IDs per test**:
   ```typescript
   import { ulid } from "ulid";

   it("should handle application submission", () => {
     const testGuildId = `test_guild_${ulid()}`;
     const testUserId = `test_user_${ulid()}`;
     // Use unique IDs to prevent collisions
   });
   ```

4. **Isolate database per test** (if needed):
   ```typescript
   import Database from "better-sqlite3";

   let testDb: Database.Database;

   beforeEach(() => {
     testDb = new Database(":memory:");
     runMigrations(testDb);
   });

   afterEach(() => {
     testDb.close();
   });
   ```

5. **Run tests serially** (last resort):
   ```typescript
   // vitest.config.ts
   export default defineConfig({
     test: {
       threads: false,
       pool: "forks",
     },
   });
   ```

**Verification**: Full test suite passes consistently on every run.

---

### Playbook: Logging Channel Permissions

**Severity**: P2 (Audit Trail Gap)

**Symptoms**:
- Action logs saved to database
- No embeds posted in Discord logging channel
- JSON fallback file growing: `data/action_log_fallback.jsonl`

**Root Causes**:
1. Bot lacks SendMessages or EmbedLinks permission in channel
2. Logging channel deleted or archived
3. Logging channel ID misconfigured

**Resolution**:

1. **Check logging channel configuration**:
   ```bash
   sqlite3 data/data.db \
     "SELECT logging_channel_id FROM guild_config WHERE guild_id = 'YOUR_GUILD_ID';"

   # Or use: /config get logging
   ```

2. **Verify channel exists**:
   - Discord → Server Settings → Channels
   - Find channel by ID
   - If missing: Create new channel, run `/config set logging_channel #new-channel`

3. **Check bot permissions in channel**:
   - Right-click channel → Edit Channel → Permissions
   - Find bot role → Check:
     - ✅ View Channel
     - ✅ Send Messages
     - ✅ Embed Links
   - Grant missing permissions → Save

4. **Test permission health check**:
   ```bash
   # Use /config get logging to see health status
   # Should show: ✓ Healthy (green check)
   ```

5. **Trigger test log action**:
   ```bash
   # Use /modstats command (logs to database + channel)
   # Check if embed appears in logging channel
   ```

**Verification**: Action embeds appear in logging channel, no fallback logs.

## Security & Privacy

### Incident Classification

**P0 - Critical (Immediate Response)**:
- Complete bot outage (offline, no commands working)
- Data loss or corruption
- Security breach (token leaked, unauthorized access)

**P1 - High (< 1 hour response)**:
- Partial outage (specific commands broken)
- Web dashboard completely unavailable
- Database deadlocks blocking operations

**P2 - Medium (< 4 hour response)**:
- Non-critical feature degradation
- Performance slowdown
- Logging gaps

**P3 - Low (Next business day)**:
- Cosmetic issues
- Documentation gaps
- Nice-to-have improvements

### Post-Incident Actions

1. **Document incident** in #incidents channel (Discord)
2. **Update runbook** if new issue pattern discovered
3. **Create Sentry issue** for tracking
4. **Schedule post-mortem** for P0/P1 incidents
5. **Implement prevention** (monitoring, alerts, validation)

## FAQ / Gotchas

**Q: Bot shows "online" in PM2 but offline in Discord?**

A: Check `pm2 logs pawtropolis | grep -i disconnect` for gateway disconnections. Common causes: invalid token, network issues, rate limiting.

**Q: Why do logs show "Database is locked" even with no other processes?**

A: Long-running transactions can lock the DB. Check for slow queries with: `PRAGMA wal_checkpoint(TRUNCATE);`

**Q: Can I run bot in PM2 cluster mode for redundancy?**

A: No. SQLite doesn't support multi-writer concurrency. Always use `instances: 1`.

**Q: Health endpoint returns 200 but commands don't work?**

A: Health endpoint checks web server only. Check Discord gateway with: `pm2 logs | grep "Bot ready"`

**Q: How do I recover if database is corrupted?**

A: See [Database Schema and Migrations](./07_Database_Schema_and_Migrations.md#database-corruption-recovery) for full recovery procedure.

**Q: Why does OAuth2 work locally but not in production?**

A: Check `DASHBOARD_REDIRECT_URI` matches Apache proxy URL exactly. Must use `https://` in production.

**Q: Can I increase `busy_timeout` to prevent SQLITE_BUSY?**

A: Already set to 5000ms. Increasing won't help if queries are genuinely slow. Use EXPLAIN QUERY PLAN to optimize.

**Q: What's the difference between PM2 restart and reload?**

A: `restart` stops then starts (brief downtime). `reload` graceful restart (cluster mode only, not used here).

## Changelog

### 2025-10-30
- **Created**: Comprehensive troubleshooting and operational runbook
- **Added**: Standardized front-matter with metadata and related docs
- **Documented**: All 10 standard sections per project requirements
- **Cross-linked**: Related architecture, deployment, and database documentation
- **Verified**: All commands, error codes, and resolution procedures against production
- **Included**: Complete playbooks for common incidents with step-by-step resolution
- **Detailed**: Health check dashboard, incident response workflow, and monitoring thresholds
- **Provided**: Security incident classification and post-incident action procedures
