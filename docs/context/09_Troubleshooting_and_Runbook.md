# 09 — Troubleshooting and Runbook

**Last Updated:** 2025-10-22
**Status:** Production runbook with common issues and playbooks

## Summary

- **Quick Diagnostics:** Health checks, log inspection, PM2 status
- **Common Issues:** Token errors, OAuth failures, permission problems, OOM on small instances
- **Playbooks:** Step-by-step resolution procedures
- **Test Isolation:** Cache clears, scheduler disabling, unique test IDs

---

## Table of Contents

- [Quick Probes](#quick-probes)
- [Common Issues](#common-issues)
- [Playbook: Invalid Bot Token](#playbook-invalid-bot-token)
- [Playbook: OAuth2 404 Behind Apache](#playbook-oauth2-404-behind-apache)
- [Playbook: NPM/CI Memory Issues](#playbook-npmci-memory-issues)
- [Playbook: Admin Role Required Error](#playbook-admin-role-required-error)
- [Playbook: Cache/Test Isolation](#playbook-cachetest-isolation)
- [Playbook: Logging Channel Permissions](#playbook-logging-channel-permissions)

---

## Quick Probes

### Check Bot Status

```bash
# PM2 status
pm2 status pawtropolis
pm2 logs pawtropolis --lines 50 --nostream

# Systemd status (if using systemd)
sudo systemctl status pawtropolis
sudo journalctl -u pawtropolis -n 50 --no-pager

# Check if bot is connected to Discord
pm2 logs pawtropolis --nostream | grep "Bot ready"
# Should see: {"level":30,"tag":"Pawtropolis Tech#2205","id":"1427436615021629590","msg":"Bot ready"}
```

### Check Web Server

```bash
# Test Fastify is listening on :3000
ss -tlnp | grep :3000
# Should see: LISTEN 0 511 127.0.0.1:3000

# Test health endpoint
curl -I http://localhost:3000/health
# Should return: HTTP/1.1 200 OK

# Test OAuth2 route behind Apache
curl -I https://pawtropolis.tech/auth/login
# Should return: HTTP/2 302 (redirect to Discord)
```

### Check Database

```bash
# SQLite database file exists and readable
ls -lh /home/ubuntu/pawtropolis-tech/data/data.db
# Should show file size > 0

# Query table counts
sqlite3 /home/ubuntu/pawtropolis-tech/data/data.db \
  "SELECT 'applications', COUNT(*) FROM applications
   UNION ALL
   SELECT 'action_log', COUNT(*) FROM action_log
   UNION ALL
   SELECT 'mod_metrics', COUNT(*) FROM mod_metrics;"
```

### Check Apache

```bash
# Apache status
sudo systemctl status apache2

# Check proxy modules enabled
apache2ctl -M | grep proxy
# Should see: proxy_module, proxy_http_module

# Test configuration syntax
sudo apache2ctl configtest
# Should return: Syntax OK

# View recent errors
sudo tail -f /var/log/apache2/pawtropolis-error.log
```

---

## Common Issues

### 1. Bot Not Connecting to Discord

**Symptoms:**

- PM2 shows "online" but logs show `TokenInvalid` error
- Bot doesn't respond to commands
- Bot user appears offline in guild

**Common Causes:**

- Invalid `DISCORD_TOKEN` in `.env`
- Token regenerated in Discord Developer Portal
- Wrong application token (using OAuth2 secret instead of bot token)

**See:** [Playbook: Invalid Bot Token](#playbook-invalid-bot-token)

---

### 2. OAuth2 Login Returns 404

**Symptoms:**

- Clicking "Admin Panel" → `/auth/login` returns 404
- Apache error log: `File does not exist: /var/www/pawtropolis/website/auth`

**Common Causes:**

- Apache proxy modules not enabled
- Incorrect ProxyPass configuration
- Fastify not listening on :3000

**See:** [Playbook: OAuth2 404 Behind Apache](#playbook-oauth2-404-behind-apache)

---

### 3. NPM Install Fails with ENOMEM

**Symptoms:**

- `npm install` or `npm ci` killed with no output
- Process killed by OOM killer
- `dmesg` shows "Out of memory: Kill process"

**Common Causes:**

- Small instance (< 1 GB RAM)
- npm trying to build native modules (better-sqlite3)
- No swap configured

**See:** [Playbook: NPM/CI Memory Issues](#playbook-npmci-memory-issues)

---

### 4. Admin Panel Shows "Admin Role Required"

**Symptoms:**

- OAuth2 login succeeds
- User redirected to `/admin/`
- Dashboard shows "You need the admin role to access this panel"

**Common Causes:**

- `ADMIN_ROLE_ID` not set in `.env`
- User doesn't have the configured role
- Role ID copied incorrectly (missing characters)

**See:** [Playbook: Admin Role Required Error](#playbook-admin-role-required-error)

---

### 5. Tests Failing Due to Cache/Scheduler Interference

**Symptoms:**

- Test suite passes locally but fails in CI
- Random test failures (flaky tests)
- Tests affect each other's state

**Common Causes:**

- Metrics cache persisting between tests
- Scheduler running during test execution
- Non-unique test IDs causing collisions

**See:** [Playbook: Cache/Test Isolation](#playbook-cachetest-isolation)

---

### 6. Action Logs Not Posting to Channel

**Symptoms:**

- Moderation actions succeed (user sees result)
- No embeds appear in logging channel
- JSON fallback file growing (`data/action_log_fallback.jsonl`)

**Common Causes:**

- Bot lacks SendMessages permission in logging channel
- Bot lacks EmbedLinks permission
- Logging channel deleted or archived

**See:** [Playbook: Logging Channel Permissions](#playbook-logging-channel-permissions)

---

## Playbook: Invalid Bot Token

### Symptoms

- Error: `[DISALLOWED_INTENTS] Privileged intent provided is not enabled or whitelisted`
- Error: `[TOKEN_INVALID] An invalid token was provided`
- Bot fails to start or immediately crashes

### Steps to Resolve

1. **Verify Token in `.env`**

   ```bash
   cd /home/ubuntu/pawtropolis-tech
   grep DISCORD_TOKEN .env
   # Should show: DISCORD_TOKEN=MTQyNzQzNjYxNTAyMTYyOTU5MA...
   ```

2. **Check Which Env Var is Read**

   ```bash
   # Search code for token usage
   grep -r "DISCORD_TOKEN" src/lib/env.ts
   # Confirm it reads process.env.DISCORD_TOKEN
   ```

3. **Regenerate Token (Discord Developer Portal)**
   - Go to: https://discord.com/developers/applications
   - Select application → Bot → Reset Token
   - Copy new token (shown only once!)
   - Update `.env`: `DISCORD_TOKEN=NEW_TOKEN_HERE`

4. **Verify Intents Are Enabled**
   - Discord Developer Portal → Bot → Privileged Gateway Intents
   - ✅ Enable "Server Members Intent"
   - ✅ Enable "Message Content Intent"
   - Click "Save Changes"

5. **Restart Bot**

   ```bash
   pm2 restart pawtropolis --update-env
   pm2 logs pawtropolis --lines 20 | grep "Bot ready"
   ```

6. **Test Connection**
   ```bash
   # Should see successful connection log
   {"level":30,"tag":"Pawtropolis Tech#2205","msg":"Bot ready"}
   ```

---

## Playbook: OAuth2 404 Behind Apache

### Symptoms

- `/auth/login` returns 404 Not Found
- Apache error log: `File does not exist: /var/www/pawtropolis/website/auth`
- Direct access to `http://localhost:3000/auth/login` works

### Steps to Resolve

1. **Verify Fastify is Running**

   ```bash
   ss -tlnp | grep :3000
   # Should show: LISTEN on 127.0.0.1:3000

   curl http://localhost:3000/health
   # Should return: {"ok":true,"version":"1.1.0"...}
   ```

2. **Check Apache Proxy Modules**

   ```bash
   apache2ctl -M | grep proxy
   # Should show:
   #   proxy_module (shared)
   #   proxy_http_module (shared)

   # If missing, enable modules:
   sudo a2enmod proxy proxy_http
   sudo systemctl reload apache2
   ```

3. **Verify ProxyPass Configuration**

   ```bash
   sudo nano /etc/apache2/sites-available/pawtropolis.tech.conf

   # Ensure these lines exist in <VirtualHost *:443>:
   ProxyPass /auth/ http://localhost:3000/auth/
   ProxyPassReverse /auth/ http://localhost:3000/auth/
   ProxyPass /api/ http://localhost:3000/api/
   ProxyPassReverse /api/ http://localhost:3000/api/
   ```

4. **Test Apache Configuration**

   ```bash
   sudo apache2ctl configtest
   # Should return: Syntax OK

   # Reload Apache
   sudo systemctl reload apache2
   ```

5. **Test OAuth2 Route**

   ```bash
   curl -I https://pawtropolis.tech/auth/login
   # Should return: HTTP/2 302 (redirect to Discord OAuth2)
   ```

6. **Check Apache Error Logs**
   ```bash
   sudo tail -f /var/log/apache2/pawtropolis-error.log
   # Look for proxy errors or connection refused
   ```

---

## Playbook: NPM/CI Memory Issues

### Symptoms

- `npm install` or `npm ci` killed with exit code 137
- Build process hangs and never completes
- `dmesg | grep oom` shows OOM killer activity

### Steps to Resolve

1. **Check Available Memory**

   ```bash
   free -h
   # Look at "available" column
   # If < 500 MB, proceed with workarounds
   ```

2. **Option A: Use npm ci with --prefer-offline**

   ```bash
   # Reduces memory usage by using local cache
   npm ci --prefer-offline
   ```

3. **Option B: Increase Swap Space**

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

4. **Option C: Build on Larger Instance, Deploy Artifacts**

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

5. **Option D: Use --production for Runtime**

   ```bash
   # Install only runtime dependencies (skip devDependencies)
   npm ci --production

   # Note: This skips TypeScript compiler, so build must happen elsewhere
   ```

---

## Playbook: Admin Role Required Error

### Symptoms

- User successfully logs in via Discord OAuth2
- Dashboard loads but shows "Admin role required" error
- User is moderator/admin in Discord but denied access

### Steps to Resolve

1. **Verify ADMIN_ROLE_ID in .env**

   ```bash
   cd /home/ubuntu/pawtropolis-tech
   grep ADMIN_ROLE_ID .env
   # Should show: ADMIN_ROLE_ID=987662057069482024
   ```

2. **Get Correct Role ID from Discord**
   - Enable Developer Mode: User Settings → Advanced → Developer Mode
   - Right-click role in Server Settings → Roles → Copy ID
   - Paste into `.env`: `ADMIN_ROLE_ID=ROLE_ID_HERE`

3. **Verify User Has Role**
   - Discord → Server Members list
   - Find user → Check role badge
   - If missing: Right-click user → Roles → Assign admin role

4. **Restart Bot with Updated Env**

   ```bash
   pm2 restart pawtropolis --update-env

   # Verify env loaded
   pm2 logs pawtropolis --lines 10 | grep ADMIN_ROLE_ID
   ```

5. **Clear Session and Re-Login**
   - Browser → Open dev tools (F12)
   - Application tab → Cookies → Delete `sessionId` cookie
   - Navigate to `/auth/logout`
   - Try logging in again via `/auth/login`

6. **Check API Logs for Role Verification**
   ```bash
   pm2 logs pawtropolis --lines 50 | grep "admin role"
   # Should see: User 123456789 has admin role: true
   ```

---

## Playbook: Cache/Test Isolation

### Symptoms

- Tests pass individually but fail when run together
- Flaky test failures in CI (works locally)
- "Expected X but got Y" where Y is from previous test

### Steps to Resolve

1. **Disable Schedulers in Tests**

   ```typescript
   // In test setup (before.ts or vitest.config.ts)
   if (process.env.NODE_ENV === "test") {
     process.env.DISABLE_SCHEDULERS = "1";
   }

   // In scheduler code
   if (process.env.DISABLE_SCHEDULERS === "1") {
     logger.info("Schedulers disabled in test mode");
     return;
   }
   ```

2. **Clear Caches Between Tests**

   ```typescript
   import { afterEach } from "vitest";
   import { clearMetricsCache } from "../src/features/modPerformance.js";

   afterEach(() => {
     // Clear all caches
     clearMetricsCache();

     // Clear identity cache
     identityCache.clear();
   });
   ```

3. **Use Unique IDs Per Test**

   ```typescript
   import { ulid } from "ulid";

   it("should handle application submission", () => {
     const testGuildId = `test_guild_${ulid()}`;
     const testUserId = `test_user_${ulid()}`;

     // Use unique IDs to prevent collisions
   });
   ```

4. **Isolate Database Per Test**

   ```typescript
   import { beforeEach, afterEach } from "vitest";
   import Database from "better-sqlite3";

   let testDb: Database.Database;

   beforeEach(() => {
     testDb = new Database(":memory:"); // In-memory DB per test
     // Run migrations
     runMigrations(testDb);
   });

   afterEach(() => {
     testDb.close();
   });
   ```

5. **Run Tests Serially (Last Resort)**
   ```json
   // vitest.config.ts
   {
     "test": {
       "threads": false, // Disable parallelism
       "pool": "forks"
     }
   }
   ```

---

## Playbook: Logging Channel Permissions

### Symptoms

- Action logs saved to database
- No embeds posted in Discord logging channel
- JSON fallback file growing: `data/action_log_fallback.jsonl`

### Steps to Resolve

1. **Check Logging Channel Configuration**

   ```bash
   # Query database for configured channel
   sqlite3 /home/ubuntu/pawtropolis-tech/data/data.db \
     "SELECT logging_channel_id FROM guild_config WHERE guild_id = 'YOUR_GUILD_ID';"

   # Or use /config get logging command in Discord
   ```

2. **Verify Channel Exists**
   - Discord → Server Settings → Channels
   - Find channel by ID
   - If missing: Create new channel, update config

3. **Check Bot Permissions in Channel**
   - Right-click channel → Edit Channel → Permissions
   - Find bot role → Check permissions:
     - ✅ View Channel
     - ✅ Send Messages
     - ✅ Embed Links
   - If missing: Grant permissions → Save

4. **Test Permission Health Check**

   ```bash
   # Use /config get logging to see health status
   # Admin panel: Config page → Logging Channel section
   # Should show: ✓ Healthy (green check)
   ```

5. **Trigger Test Log Action**

   ```bash
   # Use /modstats command (logs to database + channel)
   # Check if embed appears in logging channel
   ```

6. **Import JSON Fallback Logs (If Needed)**

   ```bash
   # Script to import fallback logs into database
   cd /home/ubuntu/pawtropolis-tech
   npm run import:fallback-logs

   # Manually post embeds for imported actions
   npm run replay:logs -- --since="2025-10-22T00:00:00Z"
   ```

---

## Changelog

**Since last revision:**

- Added quick probe commands for bot, web server, database, Apache
- Created playbook for invalid bot token errors (TokenInvalid, DISALLOWED_INTENTS)
- Added playbook for OAuth2 404 behind Apache (proxy module issues)
- Documented npm/CI memory issues on small instances (OOM, swap setup)
- Added playbook for admin role verification errors
- Created cache/test isolation playbook (schedulers, unique IDs, database per test)
- Documented logging channel permission troubleshooting
- Included Apache proxy module enablement steps
- Added JSON fallback log recovery procedures
