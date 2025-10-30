---
title: "System Architecture Overview"
slug: "02_System_Architecture_Overview"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Platform"
audience: "Engineers • Operators"
source_of_truth: ["code", "src/index.ts", "src/web/server.ts"]
related:
  - "01_Exec_Summary_and_Goals"
  - "07_Database_Schema_and_Migrations"
  - "08_Deployment_Config_and_Env"
summary: "Technical architecture of Pawtropolis Tech Gatekeeper including component diagrams, boot sequence, runtime processes, and critical file references. Essential reading for engineers onboarding to the codebase."
---

## Purpose & Outcomes

- **Understand system components**: Discord bot, web server, database, schedulers
- **Trace code execution**: From Discord events to database operations
- **Debug production issues**: Know which files handle which responsibilities
- **Plan architectural changes**: Identify coupling points and extension opportunities

## Scope & Boundaries

### In Scope
- Discord.js client lifecycle and event handling
- Fastify web server architecture (OAuth2, APIs, static serving)
- Database connection management and transaction patterns
- Scheduler implementations and intervals
- File system layout and module boundaries

### Out of Scope
- Detailed business logic (see flow-specific docs)
- Database schema design (see [07_Database_Schema_and_Migrations](./07_Database_Schema_and_Migrations.md))
- Deployment procedures (see [08_Deployment_Config_and_Env](./08_Deployment_Config_and_Env.md))

## Current State

### System Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    Discord Gateway                       │
│        (Interactions, Messages, Member Events)           │
└────────────────────┬─────────────────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │   src/index.ts      │  Discord.js Client
          │  (Main Entry Point) │  Event Router
          └──┬────────────────┬─┘
             │                │
    ┌────────▼──────┐  ┌──────▼───────────┐
    │ Command       │  │ Interaction      │
    │ Collection    │  │ Router (Regex)   │
    └───┬───────────┘  └────┬─────────────┘
        │                   │
   ┌────▼───────────────────▼────┐
   │     Feature Modules         │
   │  ┌──────────────────────┐   │
   │  │ src/features/        │   │
   │  │  - gate.ts           │   │  Application flow
   │  │  - review.ts         │   │  Decision making
   │  │  - modmail.ts        │   │  Staff-user DMs
   │  │  - avatarScan.ts     │   │  ONNX + Vision API
   │  │  - modPerformance.ts │   │  Metrics
   │  └──────────────────────┘   │
   └─────────────┬────────────────┘
                 │
          ┌──────▼──────┐
          │  SQLite DB  │  better-sqlite3
          │  (WAL mode) │  Synchronous I/O
          └─────────────┘

┌──────────────────────────────────────────────────────────┐
│             Fastify Web Server (Port 3000)               │
│  ┌────────────┐  ┌──────────┐  ┌────────────────────┐    │
│  │ OAuth2     │  │ REST API │  │ Static Files       │    │
│  │ /auth/*    │  │ /api/*   │  │ /assets/* website/ │    │
│  └────────────┘  └──────────┘  └────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js | 20+ | JavaScript execution |
| Language | TypeScript | 5.5.4 | Type safety |
| Discord | discord.js | 14.16.3 | Gateway + REST API client |
| Database | better-sqlite3 | 12.4.1 | Synchronous SQLite driver |
| Web | Fastify | 5.6.1 | HTTP server |
| Logging | Pino | 10.0.0 | Structured JSON logs |
| Monitoring | Sentry | 10.20.0 | Error tracking |
| Process | PM2 | (global) | Production process manager |

## Key Flows

### 1. Bot Startup Sequence

1. **Environment validation** ([src/lib/env.ts](../src/lib/env.ts))
   - Check `DISCORD_TOKEN`, `CLIENT_ID`, required env vars
   - Fail fast if missing critical configuration

2. **Database initialization** ([src/db/db.ts](../src/db/db.ts) L1-50)
   - Open `data/data.db` with WAL mode
   - Set PRAGMAs: `journal_mode=WAL`, `synchronous=NORMAL`
   - Enable foreign keys

3. **Discord client login** ([src/index.ts](../src/index.ts) L1034-1048)
   - Create `Client` with intents: `Guilds`, `GuildMembers`, `GuildMessages`
   - Call `client.login(DISCORD_TOKEN)`
   - Wait for `ClientReady` event

4. **Ready event handler** ([src/index.ts](../src/index.ts) L144-345)
   ```typescript
   // Run database migrations
   await ensureSchema();
   await ensureActionLogFreeText();

   // Start web server
   await startWebServer(DASHBOARD_PORT);

   // Start schedulers
   startModMetricsScheduler(client);

   // Sync banner
   await syncBannerFromGuild(client);
   ```

5. **Command registration** ([scripts/deploy-commands.ts](../scripts/deploy-commands.ts))
   - Load all `commands/*.ts` files
   - Register with Discord REST API
   - Per-guild or global deployment options

### 2. Interaction Handling Flow

```
Discord User Action → Gateway Event
         ↓
   InteractionCreate
         ↓
   Router (src/index.ts L435-960)
         ↓
   ┌─────────────────┬───────────────┬──────────────┐
   │ Slash Command   │ Button Click  │ Modal Submit │
   └────────┬────────┴───────┬───────┴──────┬───────┘
            │                │              │
    commands.get(name)  Regex Match   Pattern Match
            │                │              │
            ▼                ▼              ▼
      Command Handler   Button Handler  Modal Handler
            │                │              │
            └────────────────┴──────────────┘
                           │
                      Database Ops
                           │
                    Discord Response
```

### 3. Web Server Request Flow

```
HTTPS Request → Apache Reverse Proxy (pawtropolis.tech)
         ↓
   Fastify (localhost:3000)
         ↓
   Route Matching
         ↓
   ┌──────────────┬─────────────┬────────────────┐
   │ /auth/*      │ /api/*      │ /* (static)    │
   └──────┬───────┴──────┬──────┴────────┬───────┘
          │              │               │
    OAuth2 Flow    Auth Middleware   Static Files
          │              │               │
    Session Store   API Handlers   website/ + assets/
          │              │               │
          └──────────────┴───────────────┘
                       │
                  JSON Response
```

## Commands & Snippets

### Starting the Bot

```bash
# Development mode (hot reload)
npm run dev

# Production build
npm run build
npm start

# Via PM2 (production)
pm2 start ecosystem.config.js
pm2 logs pawtropolis
```

### Inspecting Running Process

```bash
# Check PM2 status
pm2 status

# View realtime logs
pm2 logs pawtropolis --lines 100

# Restart with zero downtime
pm2 restart pawtropolis --update-env

# Monitor CPU/memory
pm2 monit
```

### Database Connection Test

```typescript
// Test synchronous query
import { db } from './src/db/db.js';
const result = db.prepare('SELECT COUNT(*) as count FROM applications').get();
console.log('Applications:', result.count);
```

## Interfaces & Data

### Discord Client Intents

```typescript
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
```

### Event Subscriptions

| Event | Handler | Purpose |
|-------|---------|---------|
| `ClientReady` | [src/index.ts:144](../src/index.ts) | Initialization, migrations, server startup |
| `InteractionCreate` | [src/index.ts:435](../src/index.ts) | Route commands, buttons, modals |
| `MessageCreate` | [src/index.ts:962](../src/index.ts) | Modmail relay, dad mode |
| `GuildMemberAdd` | [src/features/gate.ts](../src/features/gate.ts) | Auto-welcome with banner |

### API Endpoints

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/health` | GET | None | Health check |
| `/auth/login` | GET | None | Initiate Discord OAuth2 |
| `/auth/callback` | GET | None | OAuth2 redirect handler |
| `/auth/me` | GET | Session | Current user info |
| `/api/banner` | GET | None | Current guild banner URL |
| `/api/logs` | GET | Session | Recent bot logs |
| `/api/metrics` | GET | Session | Performance metrics |
| `/assets/*` | GET | None | Static assets (banner, avatar) |

## Ops & Recovery

### Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing gracefully');

  // Close Discord client
  await client.destroy();

  // Close database
  db.close();

  // Flush Sentry
  await Sentry.close(2000);

  process.exit(0);
});
```

### Health Monitoring

```bash
# Test web server
curl https://pawtropolis.tech/health

# Check database
sqlite3 data/data.db "PRAGMA integrity_check;"

# Verify Discord connection
pm2 logs pawtropolis | grep "logged in as"
```

### Recovery Procedures

1. **Database locked**: Kill stale processes, remove `data/data.db-shm`
2. **Out of memory**: Increase PM2 max memory, check for leaks
3. **Discord disconnects**: Auto-reconnect handled by discord.js, check rate limits
4. **Web server crash**: PM2 auto-restarts, check logs for exceptions

## Security & Privacy

### Process Isolation
- Bot runs as `ubuntu` user (non-root)
- PM2 daemon runs in user space
- No privileged port binding (Apache proxies port 80/443 to 3000)

### Network Security
- Discord Gateway: TLS 1.3, WebSocket over HTTPS
- Web Server: Behind Apache reverse proxy with SSL
- No public database access (localhost-only SQLite)

### Secrets Handling
- Environment variables loaded via `dotenvx`
- Never log sensitive tokens
- Session secrets rotated quarterly
- OAuth2 tokens encrypted in session store

## FAQ / Gotchas

**Q: Can I use PostgreSQL instead of SQLite?**
A: No. The codebase uses synchronous `better-sqlite3` APIs throughout. Porting to async Postgres would require significant refactoring.

**Q: Why synchronous database calls?**
A: Simplifies transaction handling and error recovery. Node.js event loop still handles I/O efficiently with SQLite's fast reads.

**Q: How do I scale horizontally?**
A: Current architecture is single-instance only. For multiple servers, migrate to Postgres and add Redis for session storage.

**Q: What happens during deployment?**
A: PM2 restarts the process, causing ~2-3 seconds of downtime. WebSocket auto-reconnects. Use blue-green deployment for zero downtime.

**Q: Where are TypeScript types defined?**
A: Discord.js provides types. Custom types in `src/types/` and inline interfaces in feature modules.

## Changelog

### 2025-10-30
- **Created**: Initial architecture documentation with component diagrams
- **Added**: Boot sequence, interaction flow, web server architecture
- **Documented**: All critical files, event handlers, and API endpoints
- **Cross-linked**: Related docs for database schema and deployment
- **Verified**: All file paths and code references against current repository
