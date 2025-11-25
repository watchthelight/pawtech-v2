# PR6: Web Control Panel Integration

## Overview

This PR integrates a secure, OAuth2-protected admin dashboard with the Pawtropolis Discord bot backend, enabling admins to view logs, metrics, and manage configuration through a web interface.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    pawtropolis.tech                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Frontend (./website)          Backend (Fastify)           │
│  ├── index.html                ├── /auth/*                 │
│  ├── dashboard.html            │   ├── /login              │
│  ├── config.html               │   ├── /callback           │
│  └── styles.css                │   ├── /logout             │
│                                │   └── /me                 │
│                                ├── /api/*                  │
│                                │   ├── /logs               │
│                                │   ├── /metrics            │
│                                │   └── /config             │
│                                └── /* (static files)       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Components Implemented

### 1. Fastify Server (`src/web/server.ts`)

- **Framework**: Fastify (high-performance Node.js web framework)
- **Plugins**:
  - `@fastify/cookie` - Cookie parsing
  - `@fastify/session` - Session management (6h TTL)
  - `@fastify/static` - Static file serving
  - `@fastify/cors` - CORS support
  - `@fastify/rate-limit` - Rate limiting (100 req/min)

**Features**:
- Session-based authentication with secure cookies
- HTTPS-only cookies in production
- SPA fallback routing (serves index.html for unmatched routes)
- Health check endpoint (`/health`)

### 2. Discord OAuth2 Authentication (`src/web/auth.ts`)

**Endpoints**:
- `GET /auth/login` - Redirects to Discord OAuth2
- `GET /auth/callback` - Handles OAuth2 callback, verifies admin role
- `GET /auth/logout` - Clears session
- `GET /auth/me` - Returns current user info

**Security**:
- Validates admin role using `ADMIN_ROLE_ID` env var
- Stores minimal user data in session (id, username, avatar, roles)
- Rate-limited to prevent brute force attacks
- CSRF protection via SameSite cookies

**OAuth Flow**:
```
1. User visits /auth/login
2. Redirected to Discord OAuth2
3. User approves permissions
4. Discord redirects to /auth/callback?code=...
5. Bot exchanges code for access token
6. Fetches user info + guild member data
7. Verifies admin role
8. Creates session + redirects to /dashboard
```

### 3. Protected API Routes

#### `GET /api/logs` (`src/web/api/logs.ts`)
Returns recent action log entries with optional filters.

**Query Parameters**:
- `limit` (number, max 500) - Number of entries to return
- `guild_id` (string) - Filter by guild
- `moderator_id` (string) - Filter by moderator
- `action` (string, comma-separated) - Filter by action types

**Response**:
```json
{
  "items": [
    {
      "id": 123,
      "action": "approve",
      "timestamp": "2025-01-21T10:30:00.000Z",
      "guild_id": "896070888594759740",
      "moderator_id": "123456789",
      "applicant_id": "987654321",
      "app_id": "app-abc123",
      "app_code": "XYZ456",
      "reason": "Good application",
      "metadata": null
    }
  ],
  "count": 1,
  "limit": 100
}
```

#### `GET /api/metrics` (`src/web/api/metrics.ts`)
Returns moderator performance metrics.

**Query Parameters**:
- `guild_id` (string, required) - Guild to fetch metrics for
- `moderator_id` (string, optional) - Specific moderator
- `limit` (number, max 500) - Number of entries

**Response**:
```json
{
  "items": [
    {
      "moderator_id": "123456789",
      "guild_id": "896070888594759740",
      "total_claims": 50,
      "total_accepts": 45,
      "total_rejects": 5,
      "total_kicks": 0,
      "total_modmail_opens": 10,
      "avg_response_time_s": 120.5,
      "p50_response_time_s": 100.0,
      "p95_response_time_s": 300.0,
      "updated_at": "2025-01-21T10:00:00.000Z"
    }
  ],
  "count": 1,
  "limit": 100
}
```

#### `GET /api/config` (`src/web/api/config.ts`)
Returns guild configuration.

**Query Parameters**:
- `guild_id` (string, required)

**Response**:
```json
{
  "guild_id": "896070888594759740",
  "logging_channel_id": "1234567890",
  "created_at": "2025-01-01T00:00:00.000Z",
  "updated_at": "2025-01-21T10:00:00.000Z"
}
```

#### `POST /api/config` (`src/web/api/config.ts`)
Updates guild configuration.

**Request Body**:
```json
{
  "guild_id": "896070888594759740",
  "logging_channel_id": "1234567890"
}
```

**Response**: Same as GET /api/config

### 4. Static File Serving

The Fastify server serves the `./website` directory at the root URL (`/`). This allows the existing static site to load while providing backend APIs.

**SPA Routing**:
- All non-API/auth routes serve `index.html`
- Enables client-side routing for dashboard pages
- API routes return 404 JSON instead of HTML

## Environment Variables

### Required (New for PR6)

```bash
# Discord OAuth2 credentials
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret

# OAuth2 redirect URI
DASHBOARD_REDIRECT_URI=https://pawtropolis.tech/auth/callback

# Admin role IDs (comma-separated)
ADMIN_ROLE_ID=123456789,987654321

# Session secret (min 32 chars)
FASTIFY_SESSION_SECRET=generate-with-openssl-rand-base64-32
```

### Existing (Used by PR6)

```bash
GUILD_ID=896070888594759740  # For guild member lookup
DISCORD_TOKEN=Bot ...        # For guild member API calls
DASHBOARD_PORT=3000          # Server port (default: 3000)
```

## Testing

### Test Coverage

- **Auth Tests** (`tests/web/auth.test.ts`):
  - OAuth2 login redirect
  - Callback handling (success/failure)
  - Admin role verification
  - Logout functionality
  - User info endpoint

- **API Tests** (`tests/web/api.test.ts`):
  - Authentication requirement for all endpoints
  - CORS headers
  - Rate limiting
  - Query parameter validation

**Results**: All 184 tests passing ✅

### Manual Testing

1. **Start server**:
   ```bash
   npm run dev
   ```

2. **Test auth flow**:
   - Visit http://localhost:3000/auth/login
   - Authorize with Discord
   - Verify redirect to /dashboard
   - Check session cookie in browser DevTools

3. **Test API endpoints** (requires authenticated session):
   ```bash
   # Get logs
   curl -b cookies.txt http://localhost:3000/api/logs?guild_id=896070888594759740

   # Get metrics
   curl -b cookies.txt http://localhost:3000/api/metrics?guild_id=896070888594759740

   # Get config
   curl -b cookies.txt http://localhost:3000/api/config?guild_id=896070888594759740

   # Update config
   curl -X POST -b cookies.txt -H "Content-Type: application/json" \
     -d '{"guild_id":"896070888594759740","logging_channel_id":"123"}' \
     http://localhost:3000/api/config
   ```

## Deployment

### Production Checklist

1. **Set environment variables**:
   ```bash
   # In .env or systemd/PM2 config
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   DASHBOARD_REDIRECT_URI=https://pawtropolis.tech/auth/callback
   ADMIN_ROLE_ID=...
   FASTIFY_SESSION_SECRET=...
   NODE_ENV=production
   ```

2. **Build and deploy**:
   ```bash
   git pull origin main
   npm ci
   npm run build
   pm2 restart pawtropolis
   ```

3. **Verify**:
   - Visit https://pawtropolis.tech
   - Test login flow
   - Check API endpoints work
   - Verify static files load

### Security Considerations

- **HTTPS Required**: Sessions use `secure` flag in production
- **CORS**: Restricts to pawtropolis.tech origin
- **Rate Limiting**: 100 requests per minute
- **Role-Based Access**: All API routes require admin role
- **Session TTL**: 6 hours, auto-extends on activity
- **Secrets**: Never commit `FASTIFY_SESSION_SECRET` or `DISCORD_CLIENT_SECRET`

## Migration from PR4/PR5

PR6 **replaces** the old HTTP dashboard server (`src/server/dashboard.ts`) with the new Fastify server. The old `/logs/dashboard.json` endpoint is now `/api/logs`.

**Breaking Changes**:
- Old endpoint: `GET /logs/dashboard.json?mode=stats`
- New endpoint: `GET /api/metrics?guild_id=...`
- Authentication now required for all data endpoints

## Future Enhancements

- [ ] Add user profile editing
- [ ] Implement audit log for config changes
- [ ] Add WebSocket support for real-time log streaming
- [ ] Create admin user management UI
- [ ] Add export functionality for all data types

## References

- [Fastify Documentation](https://fastify.dev/docs/latest/)
- [Discord OAuth2 Guide](https://discord.com/developers/docs/topics/oauth2)
- [FastifySession Plugin](https://github.com/fastify/fastify-session)
- [Security Best Practices](https://fastify.dev/docs/latest/Guides/Recommendations/)
