## Dependencies and Integrations

Runtime dependencies, external integrations, and third-party services.

---

## Runtime Dependencies (Production)

All dependencies from [package.json](../package.json) L43-62.

### Core Framework

| Package | Version | Purpose |
|---------|---------|---------|
| `discord.js` | 14.16.3 | Discord API client, Gateway, REST, event handling |
| `better-sqlite3` | 12.4.1 | Synchronous SQLite driver with native bindings |
| `fastify` | 5.6.1 | High-performance web server for control panel |
| `axios` | 1.12.2 | HTTP client for avatar downloads, external APIs |

**Why discord.js v14:**
- TypeScript-first design
- Full support for modern Discord features (modals, buttons, threads)
- Active maintenance and community
- Built-in caching and rate limiting

**Why better-sqlite3:**
- Synchronous API (simpler error handling than async)
- Faster than `node-sqlite3` for bot workloads
- Direct C bindings (no IPC overhead)
- Full SQL feature support

**Why Fastify:**
- 2-3x faster than Express
- First-class TypeScript support
- Rich plugin ecosystem (CORS, sessions, OAuth2)
- Schema validation with automatic error responses

---

### Web Server Plugins

| Package | Version | Purpose |
|---------|---------|---------|
| `@fastify/cookie` | 11.0.2 | Cookie parsing for sessions |
| `@fastify/session` | 11.1.0 | Session management |
| `@fastify/cors` | 11.1.0 | CORS headers |
| `@fastify/rate-limit` | 10.3.0 | Rate limiting (100 req/min) |
| `@fastify/static` | 8.3.0 | Static file serving for website/ |

**Session flow:**
1. User visits `/auth/login` → redirect to Discord OAuth2
2. Discord redirects to `/auth/callback?code=...`
3. Bot exchanges code for access token
4. Bot creates session, sets `session` cookie
5. Subsequent API requests validated against session store

---

### Machine Learning & Image Processing

| Package | Version | Purpose |
|---------|---------|---------|
| `onnxruntime-node` | 1.20.1 | ONNX model inference (NSFW detection) |
| `sharp` | 0.34.4 | Image processing (resize, edge detection) |

**ONNX workflow:** ([src/features/avatarScan.ts](../src/features/avatarScan.ts) L200-450)
1. Download avatar image (via `axios`)
2. Resize to 224x224 (via `sharp`)
3. Convert to RGB tensor
4. Run through NSFW classification model (via `onnxruntime-node`)
5. Extract probability scores
6. Calculate weighted risk score

**Model file:** Not included in repo (add manually to `src/features/models/`)

**sharp edge detection:**
- Converts image to grayscale
- Applies edge filter
- Counts edge pixels (skin tone boundary heuristic)

---

### Utilities

| Package | Version | Purpose |
|---------|---------|---------|
| `ulid` | 3.0.1 | Sortable unique IDs for applications |
| `zod` | 3.23.8 | Runtime type validation for env vars |
| `pino` | 10.0.0 | Structured JSON logging |
| `dotenv` | 17.2.3 | Environment variable loading |

**ULID format:** `01ARZ3NDEKTSV4RRFFQ69G5FAV`
- Lexicographically sortable by creation time
- 128-bit (vs UUID's 122-bit entropy)
- Case-insensitive, URL-safe

**Zod usage:** [src/lib/env.ts](../src/lib/env.ts)
```typescript
const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  CLIENT_ID: z.string().min(1),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
});

export const env = envSchema.parse(process.env);
```

---

### Observability

| Package | Version | Purpose |
|---------|---------|---------|
| `@sentry/node` | 10.20.0 | Error tracking, performance monitoring |
| `@sentry/profiling-node` | 10.20.0 | CPU profiling for Sentry |

**Sentry integration:** [src/lib/sentry.ts](../src/lib/sentry.ts)
- Captures uncaught exceptions
- Tracks breadcrumbs (interaction flow, SQL queries)
- Performance monitoring (10% sample rate)
- User context (Discord user ID, username)

**Disable Sentry:** Omit `SENTRY_DSN` from `.env`

---

## Development Dependencies

**Not installed on production server** (use `npm ci --omit=dev`).

### TypeScript Toolchain

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | 5.5.4 | TypeScript compiler |
| `@types/better-sqlite3` | 7.6.13 | TypeScript types for better-sqlite3 |
| `tsx` | 4.19.2 | TypeScript execution with hot reload |
| `tsup` | 8.1.0 | esbuild-based bundler |

---

### Testing

| Package | Version | Purpose |
|---------|---------|---------|
| `vitest` | 3.2.4 | Test framework |
| `@vitest/ui` | 3.2.4 | Browser-based test UI |

---

### Code Quality

| Package | Version | Purpose |
|---------|---------|---------|
| `eslint` | 9.37.0 | JavaScript/TypeScript linter |
| `@typescript-eslint/parser` | 8.46.1 | TypeScript parser for ESLint |
| `@typescript-eslint/eslint-plugin` | 8.46.1 | TypeScript linting rules |
| `@eslint/js` | 9.38.0 | Core ESLint rules |
| `eslint-config-prettier` | 10.1.8 | Disable conflicting ESLint rules |
| `prettier` | 3.6.2 | Code formatter |

---

### Environment Management

| Package | Version | Purpose |
|---------|---------|---------|
| `@dotenvx/dotenvx` | 1.51.0 | Enhanced .env loading with encryption support |

**dotenvx features:**
- Load `.env` files with precedence rules
- Support for environment-specific files (`.env.production`)
- Encrypted secrets (optional)

**Usage:**
```bash
npx dotenvx run -- node dist/index.js
```

---

## External Integrations

### Discord API

**Documentation:** https://discord.com/developers/docs/intro

**Endpoints used:**
- **Gateway:** WebSocket connection for real-time events
- **REST API:** Slash command registration, message/embed posting
- **OAuth2:** User authentication for web panel

**Rate limits:**
- Global: 50 requests/second
- Per-route: Varies (e.g., 5 messages/5s per channel)
- Automatic retry with exponential backoff (handled by discord.js)

**Intents required:**
```typescript
// src/index.ts L96-102
intents: [
  GatewayIntentBits.Guilds,          // Guild/channel events
  GatewayIntentBits.DirectMessages,  // DM routing for modmail
  GatewayIntentBits.GuildMembers,    // Member join tracking
  GatewayIntentBits.GuildMessages,   // Message content for modmail
  GatewayIntentBits.MessageContent,  // Read message text
]
```

**Privileged intents:**
- `GuildMembers` - Enable in Developer Portal
- `MessageContent` - Enable in Developer Portal

---

### Google Lens (Reverse Image Search)

**Integration:** URL generation only (no API calls)

**Usage:** [src/features/avatarScan.ts](../src/features/avatarScan.ts) L100-120

```typescript
export function buildReverseImageUrl(avatarUrl: string): string {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(avatarUrl)}`;
}
```

**Displayed on review cards** as clickable link for moderators.

**No authentication required** - public Google Lens URL format.

---

### Sentry.io (Optional)

**Service:** Error tracking and performance monitoring

**Setup:**
1. Create Sentry project at https://sentry.io
2. Copy DSN to `.env`:
   ```env
   SENTRY_DSN=https://abc123@o123.ingest.sentry.io/456
   ```
3. Restart bot

**Data sent to Sentry:**
- Uncaught exceptions
- Breadcrumbs (last 100 actions before error)
- User context (Discord user ID, not DMs)
- Performance traces (10% sample rate)

**Privacy:** No message content logged (only metadata).

**Disable:** Omit `SENTRY_DSN` from `.env`.

---

## Risky or Pinned Dependencies

### Native Bindings

**Packages with C/C++ addons:**
- `better-sqlite3` - SQLite native bindings
- `onnxruntime-node` - ONNX inference engine
- `sharp` - libvips image processing

**Risk:** May require rebuild on Node.js version change

**Rebuild command:**
```bash
npm rebuild better-sqlite3 onnxruntime-node sharp
```

---

### Major Version Pins

**Why pins matter:**
- `discord.js` major updates often break API compatibility
- `better-sqlite3` v9+ changed column type handling
- `fastify` v5 introduced breaking changes vs v4

**Review before upgrading:**
```bash
npm outdated  # Check for updates
```

**Test before deploying:**
```bash
npm update <package>
npm test
npm run build
```

---

### Security Monitoring

**Audit dependencies:**
```bash
npm audit
```

**Auto-fix vulnerabilities:**
```bash
npm audit fix
```

**Force update (may break):**
```bash
npm audit fix --force
```

---

## Dependency Size Analysis

**Total installed size:** ~150MB (production dependencies)

**Largest contributors:**
| Package | Size | Notes |
|---------|------|-------|
| `onnxruntime-node` | ~60MB | Native ONNX runtime binaries |
| `sharp` | ~30MB | Native libvips bindings |
| `discord.js` | ~10MB | Includes all Discord API types |
| `better-sqlite3` | ~8MB | Native SQLite engine |

**Reduce size:**
- Skip `onnxruntime-node` if not using avatar scanning
- Skip `sharp` if not using avatar scanning
- Use `npm ci --omit=dev` for production (skips devDependencies)

---

## Dependency Update Strategy

### Patch/Minor Updates

**Safe to apply:**
```bash
npm update  # Updates within semver range
npm test    # Verify tests pass
```

**Schedule:** Monthly

---

### Major Updates

**Requires testing:**
1. Read changelog for breaking changes
2. Update one package at a time
3. Run full test suite
4. Test in staging environment
5. Deploy to production

**Example (discord.js v14 → v15):**
```bash
npm install discord.js@15
npm run check  # TypeScript errors?
npm test       # Tests pass?
npm run build  # Build succeeds?
# Deploy to staging, verify behavior
# Deploy to production
```

---

### Security Updates

**High/critical vulnerabilities:**
- Apply within 48 hours
- Test in staging
- Deploy to production ASAP

**Low/moderate vulnerabilities:**
- Review during monthly update cycle
- Evaluate risk vs. breaking changes

---

## Integration Health Checks

### Discord Gateway Connection

**Check:**
```typescript
// src/index.ts L256
client.once(Events.ClientReady, async () => {
  logger.info({ tag: client.user?.tag }, "Bot ready");
});
```

**Monitor:**
```bash
pm2 logs pawtech-v2 | grep "Bot ready"
```

---

### Database Connection

**Check:**
```typescript
// src/db/db.ts L28-39
const db = new Database(dbPath);
logger.info({ dbPath }, "SQLite opened");
```

**Manual check:**
```bash
sqlite3 data/data.db "PRAGMA integrity_check;"
```

---

### Web Server

**Health endpoint:**
```bash
curl http://localhost:3000/health
```

**Expected response:**
```json
{
  "ok": true,
  "version": "1.1.0",
  "service": "pawtropolis-web",
  "uptime_s": 3600
}
```

---

### Sentry Connection

**Check dashboard:** https://sentry.io (look for recent events)

**Test error capture:**
```typescript
import { captureException } from './lib/sentry.js';
captureException(new Error("Test error"));
```

---

## Troubleshooting Dependencies

### Module Not Found

**Problem:** `Cannot find module 'better-sqlite3'`

**Solution:**
```bash
# Reinstall dependencies
npm clean-install

# Rebuild native bindings
npm rebuild
```

---

### Native Binding Errors

**Problem:** `Error: Cannot find module '...better_sqlite3.node'`

**Solution:**
```bash
# Rebuild specific package
npm rebuild better-sqlite3

# Or all native packages
npm rebuild better-sqlite3 onnxruntime-node sharp
```

---

### Version Conflicts

**Problem:** `npm install` fails with peer dependency errors

**Solution:**
```bash
# Force install (use with caution)
npm install --legacy-peer-deps

# Or update conflicting package
npm update <package>
```

---

### ONNX Runtime Errors

**Problem:** `Error loading ONNX model`

**Solution:**
```bash
# Verify ONNX runtime is installed
npm list onnxruntime-node

# Rebuild ONNX runtime
npm rebuild onnxruntime-node

# Check model file exists
ls -la src/features/models/*.onnx
```

---

## Next Steps

- Review package.json: [package.json](../package.json)
- Audit dependencies: `npm audit`
- Check for updates: `npm outdated`
- Explore Discord.js docs: https://discord.js.org/
