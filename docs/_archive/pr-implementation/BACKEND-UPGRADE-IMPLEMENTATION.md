# Backend Upgrade Implementation Guide

## Overview
This document tracks the implementation of identities, avatars, graph APIs, and live log streaming for the Pawtropolis Tech admin dashboard.

## Completed

### ✅ 1. User Cache Migration (003_create_user_cache.ts)
- Created `user_cache` table with fields: user_id, guild_id, username, global_name, display_name, avatar_hash, avatar_url, updated_at
- Added indexes on updated_at and guild_id for cache invalidation
- Composite primary key (user_id, guild_id)
- Migration is idempotent and safe to run multiple times

### ✅ 2. User Resolution API (src/web/api/users.ts)
- GET /api/users/resolve?guild_id=...&ids=123,456
- Returns resolved user identities with usernames, avatars, display names
- Implements SQLite caching with 30-minute TTL
- Rate limiting: 50 requests per minute
- Fallback avatars for users without custom avatars
- Negative caching (5 minutes) for failed lookups
- ETag and Cache-Control headers
- X-RateLimit-Remaining header

## Remaining Tasks

### 3. Timeseries Metrics API

**File:** `src/web/api/metrics.ts` (extend existing file)

Add two new endpoints:

#### GET /api/metrics/timeseries
```typescript
Query params:
  - guild_id: string (required)
  - window: string (7d, 30d, 90d) - default: 7d
  - bucket: string (1h, 6h, 1d) - default: 1h

Response:
{
  buckets: [
    {
      timestamp: "2025-10-21T00:00:00Z",
      counts: {
        submitted: 10,
        claim: 8,
        accept: 5,
        reject: 3
      }
    }
  ]
}
```

**SQL Query Pattern:**
```sql
SELECT
  strftime('%Y-%m-%dT%H:00:00Z', datetime(created_at_s, 'unixepoch')) as bucket,
  action,
  COUNT(*) as count
FROM action_log
WHERE guild_id = ?
  AND created_at_s > ?
GROUP BY bucket, action
ORDER BY bucket
```

#### GET /api/metrics/latency
```typescript
Query params:
  - guild_id: string (required)
  - window: string (7d, 30d, 90d) - default: 7d
  - bucket: string (1h, 6h, 1d) - default: 1h

Response:
{
  buckets: [
    {
      timestamp: "2025-10-21T00:00:00Z",
      avg_response_time_s: 1250,
      p50_response_time_s: 890,
      p95_response_time_s: 3400
    }
  ]
}
```

**Implementation:**
- Calculate response times from action_log table (time between app_submitted and accept/reject)
- Compute percentiles in-memory per bucket
- Cache results for 5 minutes

### 4. Identity Expansion

**Files to modify:**
- `src/web/api/logs.ts`
- `src/web/api/metrics.ts`

Add optional `?expand=identity` query parameter to both endpoints.

When present:
1. Collect all unique moderator_ids from result set
2. Call `resolveUsers(guild_id, moderator_ids)` from users.ts
3. Attach `display_name` and `avatar_url` to each result
4. If resolver fails, include `warnings` array in response

**Example response with expansion:**
```json
{
  "items": [
    {
      "id": 123,
      "action": "accept",
      "moderator_id": "697169405422862417",
      "display_name": "watchthelight",
      "avatar_url": "https://cdn.discordapp.com/avatars/...",
      ...
    }
  ],
  "warnings": []  // Empty if all resolved successfully
}
```

### 5. Live Log Stream (SSE)

**File:** `src/web/api/logs.ts` (add new endpoint)

#### GET /api/logs/stream
```typescript
Query params:
  - guild_id: string (required)

Headers:
  - Last-Event-ID: string (optional, for reconnection)
```

**Implementation:**
- Use Fastify SSE plugin or raw `Content-Type: text/event-stream`
- Send heartbeat every 20 seconds
- When new action is inserted into action_log, broadcast as SSE event
- Support Last-Event-ID for resumption
- Cleanup connections on client disconnect

**Event format:**
```
id: 12345
event: action
data: {"action":"accept","moderator_id":"...","timestamp":"2025-10-21T..."}

```

**Heartbeat:**
```
: heartbeat

```

### 6. Route Registration

**File:** `src/web/api/index.ts`

Add import and registration:
```typescript
import { registerUsersRoutes } from "./users.js";

export async function registerApiRoutes(fastify: FastifyInstance) {
  await registerLogsRoutes(fastify);
  await registerMetricsRoutes(fastify);
  await registerConfigRoutes(fastify);
  await registerUsersRoutes(fastify);  // ADD THIS
}
```

### 7. Tests

Create the following test files:

#### tests/web/users.test.ts
- Cache hit/miss scenarios
- TTL expiration
- Fallback avatar generation
- Batched ID resolution
- Rate limiting behavior

#### tests/web/metrics-timeseries.test.ts
- Bucket calculation (1h, 6h, 1d)
- Window edges (7d, 30d, 90d)
- Empty data handling
- Timezone handling

#### tests/web/logs-expand.test.ts
- Identity expansion on logs
- Identity expansion on metrics
- Partial failures (some IDs resolve, some don't)
- Warnings array population

#### tests/web/sse.test.ts
- SSE connection establishment
- Heartbeat reception
- Event reception
- Reconnection with Last-Event-ID
- Connection cleanup

## Deployment Checklist

1. **Run Migration:**
   ```bash
   npm run migrate
   ```
   Verify user_cache table is created

2. **Build:**
   ```bash
   npm run build
   ```

3. **Test Locally:**
   ```bash
   npm test
   ```
   All tests should pass

4. **Deploy to Server:**
   - Upload dist/ and migrations/
   - Run migration on server
   - Restart PM2
   - Verify endpoints

5. **Verify Endpoints:**
   ```bash
   # User resolution
   curl "https://pawtropolis.tech/api/users/resolve?guild_id=...&ids=123,456" -H "Cookie: ..."

   # Timeseries metrics
   curl "https://pawtropolis.tech/api/metrics/timeseries?guild_id=...&window=7d&bucket=1h" -H "Cookie: ..."

   # Logs with identity
   curl "https://pawtropolis.tech/api/logs?guild_id=...&expand=identity" -H "Cookie: ..."

   # SSE stream
   curl "https://pawtropolis.tech/api/logs/stream?guild_id=..." -H "Cookie: ..."
   ```

## Current Status

- ✅ Migration created (003_create_user_cache.ts)
- ✅ User resolution API implemented
- ⏳ Timeseries metrics (not started)
- ⏳ Identity expansion (not started)
- ⏳ SSE live stream (not started)
- ⏳ Route wiring (partial)
- ⏳ Tests (not started)
- ⏳ Deployment (not started)

## Notes

- All API endpoints require authentication (verifySession middleware)
- ETag and Cache-Control headers should be added for cacheable responses
- Rate limiting is per-server (in-memory), not per-user
- SSE connections should be cleaned up to avoid memory leaks
- Consider adding metrics for cache hit rates and API latency
