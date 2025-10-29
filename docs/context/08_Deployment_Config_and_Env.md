# 08 — Deployment, Config, and Environment

**Last Updated:** 2025-10-22
**Status:** Production deployment with Apache proxy

## Summary

- **Runtime:** Node.js v20+ with PM2 process manager
- **Web Server:** Fastify on `:3000` (proxied by Apache)
- **Reverse Proxy:** Apache with SSL termination (Let's Encrypt)
- **Environment:** `.env` file with 25+ configuration variables
- **Discord OAuth2:** Required for admin panel authentication
- **Health Checks:** `/health` endpoint for uptime monitoring

---

## Table of Contents

- [Environment Variables](#environment-variables)
- [Apache Configuration](#apache-configuration)
- [PM2 Deployment](#pm2-deployment)
- [Systemd Alternative](#systemd-alternative)
- [Discord Developer Portal Setup](#discord-developer-portal-setup)
- [Health Checks](#health-checks)

---

## Environment Variables

### Complete `.env` Template

```bash
# ============================================
# Core Discord Bot Configuration
# ============================================

# Discord bot token (from Discord Developer Portal)
DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE

# Discord application client ID
CLIENT_ID=YOUR_CLIENT_ID_HERE

# Discord guild (server) ID to operate in
GUILD_ID=YOUR_GUILD_ID_HERE

# ============================================
# Web Control Panel OAuth2 (PR6)
# ============================================

# Discord OAuth2 client ID (usually same as CLIENT_ID)
DISCORD_CLIENT_ID=YOUR_CLIENT_ID_HERE

# Discord OAuth2 client secret (from Developer Portal → OAuth2)
DISCORD_CLIENT_SECRET=YOUR_CLIENT_SECRET_HERE

# OAuth2 redirect URI (must match Developer Portal setting)
# Example: https://pawtropolis.tech/auth/callback
DASHBOARD_REDIRECT_URI=https://YOUR_DOMAIN/auth/callback

# Discord role ID required for admin panel access
ADMIN_ROLE_ID=YOUR_ADMIN_ROLE_ID_HERE

# Session secret for cookie signing (generate random 32+ char string)
FASTIFY_SESSION_SECRET=YOUR_RANDOM_SECRET_HERE

# Fastify server port (default: 3000, proxied by Apache)
DASHBOARD_PORT=3000

# ============================================
# Database and Storage
# ============================================

# Path to SQLite database file
DB_PATH=data/data.db

# Enable SQL query tracing (verbose logging, dev only)
DB_TRACE=0

# ============================================
# Logging and Monitoring
# ============================================

# Pino log level (trace, debug, info, warn, error, fatal)
LOG_LEVEL=info

# Pretty-print logs in development (1 = enabled, 0 = JSON)
LOG_PRETTY=0

# Default logging channel ID (fallback if DB not configured)
LOGGING_CHANNEL_ID=YOUR_CHANNEL_ID_HERE

# ============================================
# Sentry Error Tracking
# ============================================

# Sentry DSN (optional, error tracking)
SENTRY_DSN=YOUR_SENTRY_DSN_HERE

# Sentry environment (production, staging, development)
SENTRY_ENVIRONMENT=production

# Sample rate for performance tracing (0.0 to 1.0)
SENTRY_TRACES_SAMPLE_RATE=0.1

# ============================================
# Security and Authentication
# ============================================

# Reset password for /gate reset and /resetdata commands
RESET_PASSWORD=YOUR_SECURE_PASSWORD_HERE

# Owner user IDs (comma-separated, bypass all permission checks)
OWNER_IDS=YOUR_USER_ID_HERE,ANOTHER_USER_ID

# Gate admin role IDs (comma-separated, can modify gate questions)
GATE_ADMIN_ROLE_IDS=ROLE_ID_1,ROLE_ID_2

# ============================================
# Feature Flags and Tuning
# ============================================

# Show avatar risk score in gate review cards (1 = yes, 0 = no)
GATE_SHOW_AVATAR_RISK=1

# Metrics cache TTL in milliseconds (default: 300000 = 5 minutes)
METRICS_CACHE_TTL_MS=300000

# Mod metrics scheduler interval in milliseconds (default: 900000 = 15 minutes)
MOD_METRICS_INTERVAL_MS=900000

# ============================================
# Testing and Development
# ============================================

# Node environment (development, production, test)
NODE_ENV=production

# Test guild ID (for test suite)
TEST_GUILD_ID=YOUR_TEST_GUILD_ID_HERE

# Test reviewer role ID (for test suite)
TEST_REVIEWER_ROLE_ID=YOUR_TEST_ROLE_ID_HERE

# Trace interaction lifecycle (verbose debug logs)
TRACE_INTERACTIONS=0
```

### Required vs. Optional Variables

**Required (Bot won't start without these):**

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `RESET_PASSWORD`

**Required for Web Panel:**

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DASHBOARD_REDIRECT_URI`
- `ADMIN_ROLE_ID`
- `FASTIFY_SESSION_SECRET`

**Optional (Sensible Defaults):**

- `GUILD_ID` (single-guild mode, can run multi-guild)
- `DB_PATH` (default: `data/data.db`)
- `LOG_LEVEL` (default: `info`)
- `DASHBOARD_PORT` (default: `3000`)
- `SENTRY_DSN` (error tracking disabled if not set)
- `OWNER_IDS` (no owner overrides)
- `GATE_ADMIN_ROLE_IDS` (no gate admin role restrictions)

---

## Apache Configuration

### VirtualHost Setup

**File:** `/etc/apache2/sites-available/pawtropolis.tech.conf`

```apache
<VirtualHost *:80>
    ServerName pawtropolis.tech
    ServerAlias www.pawtropolis.tech

    # Redirect all HTTP to HTTPS
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:443>
    ServerName pawtropolis.tech
    ServerAlias www.pawtropolis.tech
    DocumentRoot /var/www/pawtropolis/website

    # ============================================
    # SSL Configuration (Let's Encrypt)
    # ============================================
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/pawtropolis.tech/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/pawtropolis.tech/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf

    # ============================================
    # Security Headers
    # ============================================
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-XSS-Protection "1; mode=block"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"

    # ============================================
    # Reverse Proxy to Fastify (:3000)
    # ============================================
    ProxyPreserveHost On
    ProxyTimeout 300

    # OAuth2 authentication routes
    ProxyPass /auth/ http://localhost:3000/auth/
    ProxyPassReverse /auth/ http://localhost:3000/auth/

    # Protected API routes
    ProxyPass /api/ http://localhost:3000/api/
    ProxyPassReverse /api/ http://localhost:3000/api/

    # Health check endpoint
    ProxyPass /health http://localhost:3000/health
    ProxyPassReverse /health http://localhost:3000/health

    # ============================================
    # Static Site Serving
    # ============================================
    <Directory /var/www/pawtropolis/website>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted

        # Enable .htaccess for SPA routing
        <IfModule mod_rewrite.c>
            RewriteEngine On
            RewriteBase /

            # Serve existing files/directories
            RewriteCond %{REQUEST_FILENAME} !-f
            RewriteCond %{REQUEST_FILENAME} !-d

            # SPA fallback for /admin/* routes
            RewriteCond %{REQUEST_URI} ^/admin/
            RewriteRule ^admin/ /admin/index.html [L]
        </IfModule>
    </Directory>

    # ============================================
    # Logging
    # ============================================
    ErrorLog ${APACHE_LOG_DIR}/pawtropolis-error.log
    CustomLog ${APACHE_LOG_DIR}/pawtropolis-access.log combined
    LogLevel warn
</VirtualHost>
```

### Required Apache Modules

```bash
# Enable required modules
sudo a2enmod proxy proxy_http rewrite ssl headers

# Enable site configuration
sudo a2ensite pawtropolis.tech.conf

# Test configuration syntax
sudo apache2ctl configtest

# Reload Apache
sudo systemctl reload apache2
```

### SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-apache

# Obtain certificate (interactive)
sudo certbot --apache -d pawtropolis.tech -d www.pawtropolis.tech

# Auto-renewal (already configured by Certbot)
sudo systemctl status certbot.timer
```

---

## PM2 Deployment

### Installation

```bash
# Install PM2 globally
npm install -g pm2

# Install dependencies
cd /home/ubuntu/pawtech-v2
npm ci --production=false

# Build TypeScript
npm run build
```

### PM2 Ecosystem File

**File:** `ecosystem.config.js`

```javascript
module.exports = {
  apps: [
    {
      name: "pawtropolis",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "/home/ubuntu/.pm2/logs/pawtropolis-error.log",
      out_file: "/home/ubuntu/.pm2/logs/pawtropolis-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 10000,
    },
  ],
};
```

### PM2 Commands

```bash
# Start bot
pm2 start ecosystem.config.js

# Restart bot
pm2 restart pawtropolis

# Stop bot
pm2 stop pawtropolis

# View logs (real-time)
pm2 logs pawtropolis

# View logs (last 100 lines)
pm2 logs pawtropolis --lines 100 --nostream

# Monitor resources
pm2 monit

# Save PM2 configuration
pm2 save

# Setup PM2 startup script (runs on boot)
pm2 startup systemd
# Follow printed instructions to enable
```

---

## Systemd Alternative

### Service File

**File:** `/etc/systemd/system/pawtropolis.service`

```ini
[Unit]
Description=Pawtropolis Discord Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/pawtech-v2
Environment="NODE_ENV=production"
EnvironmentFile=/home/ubuntu/pawtech-v2/.env
ExecStart=/usr/bin/node /home/ubuntu/pawtech-v2/dist/index.js
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pawtropolis

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/home/ubuntu/pawtech-v2/data

[Install]
WantedBy=multi-user.target
```

### Systemd Commands

```bash
# Reload systemd daemon
sudo systemctl daemon-reload

# Enable service (start on boot)
sudo systemctl enable pawtropolis

# Start service
sudo systemctl start pawtropolis

# Check status
sudo systemctl status pawtropolis

# View logs
sudo journalctl -u pawtropolis -f

# Restart service
sudo systemctl restart pawtropolis

# Stop service
sudo systemctl stop pawtropolis
```

---

## Discord Developer Portal Setup

### Bot Configuration

**URL:** https://discord.com/developers/applications

1. **Create Application**
   - Name: Pawtropolis Tech
   - Description: Moderation toolkit with application review and analytics

2. **Bot Settings**
   - Navigate to: Bot → Add Bot
   - Token: Copy to `DISCORD_TOKEN` in `.env` (never commit!)
   - Privileged Gateway Intents:
     - ✅ Server Members Intent (read member data)
     - ✅ Message Content Intent (read DM content)
     - ❌ Presence Intent (not needed)

3. **OAuth2 Settings**
   - Navigate to: OAuth2 → General
   - Client ID: Copy to `CLIENT_ID` and `DISCORD_CLIENT_ID`
   - Client Secret: Generate → Copy to `DISCORD_CLIENT_SECRET` (one-time display!)
   - Redirect URIs: Add `https://pawtropolis.tech/auth/callback`

4. **OAuth2 Scopes**
   - ✅ `identify` — Read user info (username, avatar)
   - ✅ `guilds` — Read guild memberships (for role verification)

5. **Bot Permissions**
   - Navigate to: OAuth2 → URL Generator
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions:
     - ✅ Manage Roles (assign verified role)
     - ✅ Kick Members (kick rejected applicants)
     - ✅ Send Messages
     - ✅ Send Messages in Threads
     - ✅ Embed Links
     - ✅ Attach Files
     - ✅ Read Message History
     - ✅ Add Reactions
     - ✅ Use Slash Commands
     - ✅ Manage Threads (create modmail threads)

6. **Install Bot**
   - Copy generated URL
   - Open in browser → Select target guild → Authorize

### Guild Configuration

**Admin Role Setup:**

1. Create Discord role: "Admin Panel Access"
2. Copy role ID: Right-click role → Copy ID (Developer Mode enabled)
3. Paste into `ADMIN_ROLE_ID` in `.env`
4. Assign role to trusted moderators/admins

**Channel Setup:**

1. Create `#gate` channel (applicants see this first)
2. Create `#review` channel (moderators review applications)
3. Create `#modmail` channel (modmail ticket threads)
4. Create `#verification-logs` channel (action log embeds)
5. Configure channel permissions:
   - `#gate`: Everyone can view, bot can post
   - `#review`: Moderators only
   - `#modmail`: Moderators only
   - `#verification-logs`: Moderators only

---

## Health Checks

### Endpoint

**URL:** `GET https://pawtropolis.tech/health`
**Authentication:** None (public)

**Response:**

```json
{
  "ok": true,
  "version": "1.1.0",
  "service": "pawtropolis-web",
  "uptime_s": 3600,
  "timestamp": "2025-10-22T03:45:15.123Z"
}
```

### Monitoring Integration

**UptimeRobot / Pingdom:**

- URL: `https://pawtropolis.tech/health`
- Method: GET
- Success Condition: Status code 200, `"ok": true` in JSON

**Cron Health Check:**

```bash
#!/bin/bash
# /usr/local/bin/check-pawtropolis.sh

HEALTH_URL="https://pawtropolis.tech/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $RESPONSE -ne 200 ]; then
  echo "Health check failed: HTTP $RESPONSE"
  systemctl restart pawtropolis
  # Send alert (optional)
fi
```

**Crontab Entry:**

```cron
# Check health every 5 minutes
*/5 * * * * /usr/local/bin/check-pawtropolis.sh >> /var/log/pawtropolis-health.log 2>&1
```

---

## Changelog

**Since last revision:**

- Added complete `.env` template with all PR4-PR6 variables
- Documented Fastify web server on port :3000 (replaces old dashboard)
- Added Apache reverse proxy configuration (OAuth2 + API routes)
- Included SSL/TLS setup with Let's Encrypt
- Added PM2 ecosystem configuration and commands
- Provided systemd service file alternative
- Documented Discord Developer Portal OAuth2 setup (scopes, redirect URI)
- Added health check endpoint and monitoring examples
- Clarified required vs. optional environment variables
- Included security headers and Apache module requirements
