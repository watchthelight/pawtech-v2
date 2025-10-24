# 02 — System Architecture Overview

**Last Updated:** 2025-10-22
**Status:** Production-ready

## Summary

- **Architecture:** Monolithic Node.js process with Discord.js bot + Fastify web server + SQLite database
- **Deployment:** PM2 process manager + Apache reverse proxy + Linux systemd
- **Security:** OAuth2 Discord authentication, role-based access control, session cookies, password-protected config changes
- **Ports:** Bot uses Discord Gateway (WSS), web server on `:3000`, Apache proxies HTTPS traffic

---

## Table of Contents

- [High-Level Architecture](#high-level-architecture)
- [Module Map](#module-map)
- [Fastify Web Server](#fastify-web-server)
- [OAuth2 Flow](#oauth2-flow)
- [Apache Proxy Configuration](#apache-proxy-configuration)
- [Security Posture](#security-posture)
- [Data Flow](#data-flow)
- [Banner Sync System](#banner-sync-system)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Layer                            │
├──────────────────┬──────────────────────┬───────────────────┤
│  Discord Client  │  Web Browser         │  Admin User       │
│  (Members)       │  (Public Site)       │  (Dashboard)      │
└────────┬─────────┴──────────┬───────────┴─────────┬─────────┘
         │                    │                     │
         │ WebSocket (WSS)    │ HTTPS               │ HTTPS + OAuth2
         │                    │                     │
┌────────▼────────────────────▼─────────────────────▼─────────┐
│                     Apache HTTP Server                       │
│  - SSL Termination (Let's Encrypt)                          │
│  - Static site serving (/var/www/pawtropolis/website/)     │
│  - Reverse proxy: /auth/*, /api/* → localhost:3000         │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             │ HTTP (internal)
                             │
┌────────────────────────────▼─────────────────────────────────┐
│              Node.js Process (PM2 managed)                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Discord.js Bot                                      │  │
│  │  - Gateway connection (intents, partials)            │  │
│  │  - Slash command handlers                            │  │
│  │  - Event listeners (messageCreate, guildUpdate)      │  │
│  │  - Features: gate, review, modmail, logger           │  │
│  └──────────────────────────────────────────────────────┘  │
│                             │                               │
│  ┌──────────────────────────▼───────────────────────────┐  │
│  │  Fastify Web Server (:3000)                          │  │
│  │  - OAuth2 routes (/auth/login, /callback, /logout)  │  │
│  │  - Protected APIs (/api/logs, /metrics, /config)    │  │
│  │  - Public APIs (/api/banner)                         │  │
│  │  - Session management (@fastify/cookie, signed)      │  │
│  └──────────────────────────────────────────────────────┘  │
│                             │                               │
│  ┌──────────────────────────▼───────────────────────────┐  │
│  │  SQLite Database (better-sqlite3)                    │  │
│  │  - applications, action_log, guild_config            │  │
│  │  - mod_metrics, open_modmail                         │  │
│  │  - Migrations: 001_base.ts, 002_mod_metrics.ts      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Scheduler (setInterval)                             │  │
│  │  - Mod metrics refresh every 15 minutes              │  │
│  │  - Banner sync check every 6 hours                   │  │
│  │  - Graceful shutdown on SIGTERM                      │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Module Map

### Bot Layer (`src/`)

```
src/
├── index.ts                    # Main entrypoint, Discord client init
├── commands/                   # Slash command definitions
│   ├── gate.ts                 # /gate, /accept, /reject, /kick, /unclaim
│   ├── config.ts               # /config get|set logging
│   ├── modstats.ts             # /modstats [leaderboard|export]
│   ├── resetdata.ts            # /resetdata (password-protected)
│   ├── health.ts               # /health (bot diagnostics)
│   ├── statusupdate.ts         # /statusupdate
│   ├── send.ts                 # /send (anonymous staff messages)
│   └── analytics.ts            # /analytics, /analytics-export
├── features/                   # Domain logic modules
│   ├── gate.ts                 # Application flow, modal handlers
│   ├── review.ts               # Claim/decide handlers, DM logic
│   ├── modmail.ts              # Ticket lifecycle, DM ↔ thread routing
│   ├── logger.ts               # Action log persistence, pretty cards
│   ├── modPerformance.ts       # Metrics engine, percentile calculation
│   ├── avatarScan.ts           # Risk scoring for profile pictures
│   ├── welcome.ts              # Post-approval welcome message
│   ├── metricsEpoch.ts         # Analytics epoch management
│   └── bannerSync.ts           # Server banner → bot profile + website
├── web/                        # Fastify web server
│   ├── server.ts               # Server initialization, routes registration
│   ├── auth.ts                 # OAuth2 flow, session verification
│   └── api/                    # API route handlers
│       ├── logs.ts             # GET /api/logs
│       ├── metrics.ts          # GET /api/metrics
│       ├── config.ts           # GET/POST /api/config (password-protected)
│       ├── guild.ts            # GET /api/guild
│       ├── users.ts            # GET /api/users/resolve
│       ├── roles.ts            # GET /api/roles/resolve
│       ├── banner.ts           # GET /api/banner (public)
│       └── admin.ts            # POST /api/admin/resetdata
├── db/                         # Database layer
│   ├── db.ts                   # better-sqlite3 connection
│   ├── ensure.ts               # Schema migrations runner
│   └── migrations/             # Migration scripts
│       ├── 001_base.ts         # Core tables (applications, action_log, guild_config)
│       └── 002_mod_metrics.ts  # Mod performance tracking
├── lib/                        # Shared utilities
│   ├── env.ts                  # Environment variable validation (zod)
│   ├── logger.ts               # Pino structured logging
│   ├── sentry.ts               # Error tracking integration
│   ├── config.ts               # Guild config helpers
│   └── cmdWrap.ts              # Command execution wrapper, error cards
└── scheduler/                  # Background jobs
    └── modMetricsScheduler.ts  # 15-minute metrics refresh
```

### Frontend Layer (`website/`)

```
website/
├── index.html                  # Homepage with dynamic banner loading
├── styles.css                  # Global styles, glassmorphism, modal UI
├── app.css                     # Additional homepage styles
├── blur-text.js                # GSAP text animation effects
├── admin/                      # Admin dashboard SPA
│   ├── index.html              # Dashboard shell
│   ├── admin.js                # Vanilla JS SPA (tabs, API calls, rendering)
│   └── admin.css               # Dashboard-specific styles
├── assets/                     # Static assets
│   ├── avatar.png              # Bot avatar fallback
│   └── banner.webp             # Server banner fallback
└── glass/                      # React Three Fiber glass effects (legacy)
    ├── GlassCard.js
    ├── FluidGlass.js
    └── init.js
```

---

## Fastify Web Server

**Port:** `:3000` (internal, proxied by Apache)

### Route Map

| Path                   | Method | Auth                       | Description                                                        |
| ---------------------- | ------ | -------------------------- | ------------------------------------------------------------------ |
| `/health`              | GET    | None                       | Service health check, uptime, version                              |
| `/auth/login`          | GET    | None                       | Initiates Discord OAuth2 flow                                      |
| `/auth/callback`       | GET    | None                       | OAuth2 callback, creates session                                   |
| `/auth/logout`         | POST   | None                       | Destroys session cookie                                            |
| `/auth/me`             | GET    | Session                    | Returns current user info                                          |
| `/api/logs`            | GET    | Session + Admin            | Fetch action logs (filters: guild_id, moderator_id, action, limit) |
| `/api/metrics`         | GET    | Session + Admin            | Leaderboard or moderator metrics (5-min cache)                     |
| `/api/config`          | GET    | Session + Admin            | Fetch guild configuration                                          |
| `/api/config`          | POST   | Session + Admin + Password | Update guild configuration (requires `RESET_PASSWORD`)             |
| `/api/guild`           | GET    | Session + Admin            | Guild metadata (name, icon, member count)                          |
| `/api/users/resolve`   | GET    | Session + Admin            | Resolve Discord user IDs to usernames/avatars                      |
| `/api/roles/resolve`   | GET    | Session + Admin            | Resolve Discord role IDs to names/colors/emojis                    |
| `/api/banner`          | GET    | None                       | Current Discord server banner URL (public, cached)                 |
| `/api/admin/resetdata` | POST   | Session + Admin + Password | Reset analytics epoch (requires `RESET_PASSWORD`)                  |

### Session Management

- **Cookie Name:** `sessionId` (signed with `FASTIFY_SESSION_SECRET`)
- **Storage:** In-memory Map (ephemeral, resets on bot restart)
- **Flags:** `httpOnly: true`, `secure: true` (production), `sameSite: 'lax'`
- **TTL:** 7 days (configurable via `maxAge`)

---

## OAuth2 Flow

```
┌──────────┐                                      ┌──────────────┐
│  User    │                                      │   Discord    │
│  Browser │                                      │   OAuth2     │
└────┬─────┘                                      └──────┬───────┘
     │                                                    │
     │  1. Click "Admin Panel"                          │
     ├───────────────────────────────────────────────►  │
     │     GET /auth/login                               │
     │                                                    │
     │  2. Redirect to Discord authorize URL             │
     │  ◄─────────────────────────────────────────────┤  │
     │     Location: discord.com/api/oauth2/authorize    │
     │     ?client_id=...&redirect_uri=...&scope=identify│
     │                                                    │
     │  3. User grants permission                        │
     ├────────────────────────────────────────────────► │
     │                                                    │
     │  4. Discord redirects back with code              │
     │  ◄─────────────────────────────────────────────┤  │
     │     GET /auth/callback?code=ABC123                │
     │                                                    │
     │  5. Exchange code for access token                │
     ├───────────────────────────────────────────────►  │
     │     POST /api/oauth2/token                        │
     │                                                    │
     │  6. Return access_token                           │
     │  ◄─────────────────────────────────────────────┤  │
     │                                                    │
     │  7. Fetch user info                               │
     ├───────────────────────────────────────────────►  │
     │     GET /api/users/@me                            │
     │                                                    │
     │  8. Verify ADMIN_ROLE_ID membership               │
     │  ◄─────────────────────────────────────────────┤  │
     │                                                    │
     │  9. Create session, set cookie, redirect          │
     │  ◄─────────────────────────────────────────────┤  │
     │     Set-Cookie: sessionId=...                     │
     │     Location: /admin/                             │
     │                                                    │
     │  10. Load dashboard with session                  │
     ├───────────────────────────────────────────────►  │
     │     GET /admin/ (Cookie: sessionId=...)          │
     │                                                    │
```

### Required OAuth2 Scopes

- `identify` — Read user ID, username, discriminator, avatar
- `guilds` — Read user's guild memberships (for role verification)

### Role Verification

After OAuth2 callback, the server:

1. Fetches user's guild memberships (`GET /users/@me/guilds`)
2. Finds the target guild (matches `GUILD_ID` from `.env`)
3. Fetches guild member object to get roles
4. Verifies `ADMIN_ROLE_ID` is present in member's roles
5. Rejects with 403 if role not found

---

## Apache Proxy Configuration

### VirtualHost Snippet

```apache
<VirtualHost *:443>
    ServerName pawtropolis.tech
    DocumentRoot /var/www/pawtropolis/website

    # SSL Configuration
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/pawtropolis.tech/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/pawtropolis.tech/privkey.pem

    # Proxy OAuth2 and API routes to Fastify
    ProxyPreserveHost On
    ProxyPass /auth/ http://localhost:3000/auth/
    ProxyPassReverse /auth/ http://localhost:3000/auth/
    ProxyPass /api/ http://localhost:3000/api/
    ProxyPassReverse /api/ http://localhost:3000/api/

    # Serve static site
    <Directory /var/www/pawtropolis/website>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    # SPA fallback for admin panel
    RewriteEngine On
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteCond %{REQUEST_URI} ^/admin/
    RewriteRule ^admin/ /admin/index.html [L]

    # Logging
    ErrorLog ${APACHE_LOG_DIR}/pawtropolis-error.log
    CustomLog ${APACHE_LOG_DIR}/pawtropolis-access.log combined
</VirtualHost>
```

### Required Apache Modules

```bash
sudo a2enmod proxy proxy_http rewrite ssl headers
sudo systemctl reload apache2
```

---

## Security Posture

### Authentication & Authorization

- **OAuth2 Flow:** Discord authentication with PKCE implicit grant
- **Session Cookies:** Signed with `FASTIFY_SESSION_SECRET`, httpOnly, secure in production
- **Role-Based Access:** All `/api/*` routes require `ADMIN_ROLE_ID` membership
- **Password Protection:** Configuration changes require `RESET_PASSWORD` verification

### Data Protection

- **Secrets:** All sensitive values in `.env` (never committed to git)
- **Timing-Safe Comparison:** Password verification uses `crypto.timingSafeEqual()`
- **SQL Injection:** Parameterized queries via `better-sqlite3` prepared statements
- **XSS Prevention:** All user input escaped before rendering (escapeHtml helper)

### Network Security

- **HTTPS Only:** Apache handles SSL termination with Let's Encrypt
- **Internal HTTP:** Fastify listens on `localhost:3000` (not exposed externally)
- **CORS:** Not configured (same-origin policy enforced by browser)
- **Rate Limiting:** Not yet implemented (roadmap: PR10)

### Audit Trail

- **Action Logs:** Every moderation action logged with moderator ID, timestamp, optional reason
- **Password Attempts:** Failed config save attempts logged with guild ID
- **Session Events:** Login/logout events logged with user ID

---

## Data Flow

### Application Review Flow

```
1. User clicks "Verify" button in #gate channel
   ↓
2. Bot sends modal with 5 questions
   ↓
3. User submits modal → app_submitted action logged
   ↓
4. Bot creates applicant card in #review channel
   ↓
5. Moderator clicks "Decide" → claim action logged
   ↓
6. Moderator chooses approve/reject/kick → action logged with reason
   ↓
7. Bot sends DM to applicant with decision + optional reason
   ↓
8. If approved: assign verified role, post welcome message
   ↓
9. Metrics engine calculates response time, updates mod_metrics table
```

### Modmail Flow

```
1. User sends DM to bot
   ↓
2. Bot checks for existing ticket (open_modmail table)
   ↓
3. If new: create private thread in modmail channel → modmail_open logged
   ↓
4. Bot forwards DM content to thread
   ↓
5. Moderator replies in thread → bot forwards to user's DM
   ↓
6. User replies in DM → bot forwards to thread
   ↓
7. Moderator clicks "Close Ticket" → modmail_close logged
   ↓
8. Bot archives thread, removes from open_modmail table
```

### Metrics Calculation Flow

```
1. Scheduler triggers every 15 minutes
   ↓
2. For each guild: call recalcModMetrics(guildId)
   ↓
3. Query action_log for all moderator actions
   ↓
4. Calculate counts (claims, approves, rejects, kicks, modmail opens)
   ↓
5. Calculate response time percentiles (p50, p95) using nearest-rank algorithm
   ↓
6. Upsert mod_metrics table (composite PK: moderator_id, guild_id)
   ↓
7. Cache result in memory with 5-minute TTL
   ↓
8. API requests served from cache until TTL expires
```

---

## Banner Sync System

### Flow

```
1. Bot starts → fetch guild banner → cache URL
   ↓
2. Update bot profile banner (ClientUser.setBanner)
   ↓
3. Listen for guildUpdate event
   ↓
4. If banner hash changes → sync to bot profile (rate limited: 10-min min interval)
   ↓
5. Periodic fallback check every 6 hours (in case events missed)
   ↓
6. Website calls GET /api/banner → returns cached URL
   ↓
7. Homepage dynamically updates background-image CSS
   ↓
8. Open Graph meta tags updated for social media embeds
```

### Components

- **Backend:** `src/features/bannerSync.ts` (event-driven sync + caching)
- **API:** `src/web/api/banner.ts` (public endpoint, no auth required)
- **Frontend:** `website/index.html` (fetch on DOMContentLoaded)

### Rate Limiting

- **Bot Profile Updates:** Max once per 10 minutes (prevents Discord API abuse)
- **Change Detection:** Uses banner hash comparison (only updates if changed)
- **Fallback:** Checks every 6 hours in case `guildUpdate` events are missed

---

## Changelog

**Since last revision:**

- Replaced old HTTP dashboard server with Fastify web server architecture
- Added OAuth2 authentication flow diagram and session management details
- Documented Apache reverse proxy configuration (paths, modules, VirtualHost)
- Added security posture section (auth, data protection, network, audit)
- Documented banner sync system architecture and data flow
- Added password protection details for config changes
- Updated module map to reflect PR4-PR6 additions (metrics, banner sync, auth)
- Added route map with all API endpoints and authentication requirements
- Clarified deployment ports and proxy paths
