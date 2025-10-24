## APIs and Endpoints

REST API surface, Discord slash commands, and web control panel routes.

---

## Discord Slash Commands

All commands registered via [src/commands/buildCommands.ts](../src/commands/buildCommands.ts), deployed with `npm run deploy:cmds`.

### Command Registry

| Command | Permissions | Description | Handler |
|---------|-------------|-------------|---------|
| `/health` | Public | Bot status check | [src/commands/health.ts](../src/commands/health.ts) |
| `/gate setup` | Manage Guild | Create gate entry message | [src/commands/gate.ts](../src/commands/gate.ts) L100-200 |
| `/gate reset` | Manage Guild | **Destructive:** Delete all applications | [src/commands/gate.ts](../src/commands/gate.ts) L300-400 |
| `/gate status` | Reviewer | Show queue stats | [src/commands/gate.ts](../src/commands/gate.ts) L450-500 |
| `/gate config` | Manage Guild | Display guild config | [src/commands/gate.ts](../src/commands/gate.ts) L520-550 |
| `/accept <code>` | Reviewer | Approve application by HEX6 code | [src/commands/gate.ts](../src/commands/gate.ts) L600-700 |
| `/reject <code>` | Reviewer | Reject application with reason | [src/commands/gate.ts](../src/commands/gate.ts) L750-850 |
| `/kick <code>` | Reviewer | Kick applicant from server | [src/commands/gate.ts](../src/commands/gate.ts) L900-950 |
| `/unclaim <code>` | Reviewer | Release claim on application | [src/commands/gate.ts](../src/commands/gate.ts) L1000-1050 |
| `/config set <key> <value>` | Manage Guild | Update guild config | [src/commands/config.ts](../src/commands/config.ts) L50-200 |
| `/config get <key>` | Manage Guild | View config value | [src/commands/config.ts](../src/commands/config.ts) L250-300 |
| `/modmail close [reason]` | Reviewer | Close active modmail thread | [src/features/modmail.ts](../src/features/modmail.ts) L400-500 |
| `/modmail reopen <user>` | Reviewer | Reopen closed modmail thread | [src/features/modmail.ts](../src/features/modmail.ts) L550-600 |
| `/modstats [days]` | Reviewer | Mod performance metrics | [src/commands/modstats.ts](../src/commands/modstats.ts) L50-200 |
| `/analytics [period]` | Reviewer | Application analytics | [src/features/analytics/command.ts](../src/features/analytics/command.ts) L50-150 |
| `/analytics-export` | Manage Guild | Export analytics as CSV | [src/features/analytics/command.ts](../src/features/analytics/command.ts) L200-250 |
| `/send <channel> <message>` | Reviewer | Send anonymous message | [src/commands/send.ts](../src/commands/send.ts) L50-100 |
| `/flag <user> <reason>` | Reviewer | Manually flag user | [src/commands/flag.ts](../src/commands/flag.ts) L50-150 |
| `/statusupdate <message>` | Owner | Update bot status | [src/commands/statusupdate.ts](../src/commands/statusupdate.ts) L30-80 |

### Permission System

**Roles checked:** ([src/lib/config.ts](../src/lib/config.ts) L100-200)
1. **Owner bypass:** Users in `OWNER_IDS` env var skip all checks
2. **Manage Guild:** Discord `MANAGE_GUILD` permission
3. **Reviewer:** Has any role in `guild_config.mod_role_ids`

**Example:**
```typescript
// src/lib/config.ts L150-170
export function hasStaffPermissions(member: GuildMember): boolean {
  if (isOwner(member.id)) return true;
  if (hasManageGuild(member)) return true;
  if (isReviewer(member)) return true;
  return false;
}
```

---

## REST API (Web Control Panel)

**Base URL:** `http://localhost:3000` (configurable via `DASHBOARD_PORT`)

**Authentication:** Discord OAuth2 session-based (cookies)

**CORS:** Configured in [src/web/server.ts](../src/web/server.ts) L63-72
- Production: `https://pawtropolis.tech`
- Development: `*` (all origins)

**Rate Limiting:** 100 requests/minute per IP ([src/web/server.ts](../src/web/server.ts) L75-78)

---

### Authentication Endpoints

**Prefix:** `/auth`

#### `GET /auth/login`
**Description:** Initiate Discord OAuth2 flow

**Response:** Redirect to Discord authorization page

**Query params:**
- None

**Example:**
```bash
curl http://localhost:3000/auth/login
# Redirects to:
# https://discord.com/api/oauth2/authorize?client_id=...&redirect_uri=...
```

---

#### `GET /auth/callback`
**Description:** OAuth2 callback handler

**Query params:**
- `code` (string): OAuth2 authorization code from Discord

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "123456789012345678",
    "username": "example",
    "avatar": "abc123..."
  }
}
```

**Errors:**
- `401 Unauthorized`: Missing admin role
- `400 Bad Request`: Invalid OAuth2 code

**Handler:** [src/web/auth.ts](../src/web/auth.ts) L100-200

---

#### `GET /auth/whoami`
**Description:** Get current session user

**Auth:** Required (session cookie)

**Response:**
```json
{
  "id": "123456789012345678",
  "username": "example",
  "avatar": "abc123...",
  "roles": ["123456789012345678"]
}
```

**Handler:** [src/web/auth.ts](../src/web/auth.ts) L250-280

---

#### `POST /auth/logout`
**Description:** Destroy session

**Auth:** Required

**Response:**
```json
{
  "success": true
}
```

---

### API Endpoints

**Prefix:** `/api`

**Auth:** All endpoints require active session (checked via middleware)

---

#### `GET /api/logs`
**Description:** Fetch action logs with pagination

**Query params:**
- `guild_id` (string, optional): Filter by guild
- `limit` (number, default 100): Max results
- `offset` (number, default 0): Pagination offset

**Response:**
```json
{
  "logs": [
    {
      "id": 123,
      "guild_id": "123456789012345678",
      "actor_id": "987654321098765432",
      "action": "approve",
      "app_code": "ABC123",
      "reason": "Looks good",
      "created_at_s": 1698765432
    }
  ],
  "total": 1500,
  "has_more": true
}
```

**Handler:** [src/web/api/logs.ts](../src/web/api/logs.ts) L30-100

---

#### `GET /api/metrics`
**Description:** Aggregate metrics for dashboard

**Query params:**
- `guild_id` (string, optional): Filter by guild
- `period` (string, default '7d'): Time window (1d, 7d, 30d, 90d)

**Response:**
```json
{
  "period": "7d",
  "guild_id": "123456789012345678",
  "metrics": {
    "applications_submitted": 45,
    "applications_approved": 32,
    "applications_rejected": 8,
    "applications_pending": 5,
    "avg_review_time_minutes": 12.5,
    "mod_performance": [
      {
        "moderator_id": "987654321098765432",
        "actions": 20,
        "avg_time_minutes": 10.2
      }
    ]
  }
}
```

**Handler:** [src/web/api/metrics.ts](../src/web/api/metrics.ts) L50-200

---

#### `GET /api/config`
**Description:** Get guild configuration

**Query params:**
- `guild_id` (string, required): Guild ID

**Response:**
```json
{
  "guild_id": "123456789012345678",
  "unverified_role_id": "111111111111111111",
  "verified_role_id": "222222222222222222",
  "review_channel_id": "333333333333333333",
  "gate_channel_id": "444444444444444444",
  "mod_role_ids": "555555555555555555,666666666666666666"
}
```

**Handler:** [src/web/api/config.ts](../src/web/api/config.ts) L30-80

---

#### `POST /api/config`
**Description:** Update guild configuration

**Auth:** Requires ADMIN_ROLE_ID

**Body:**
```json
{
  "guild_id": "123456789012345678",
  "verified_role_id": "222222222222222222",
  "review_channel_id": "333333333333333333"
}
```

**Response:**
```json
{
  "success": true,
  "config": { /* updated config */ }
}
```

**Handler:** [src/web/api/config.ts](../src/web/api/config.ts) L100-150

---

#### `GET /api/users`
**Description:** Search users by ID or username

**Query params:**
- `user_id` (string, optional): Discord user ID
- `username` (string, optional): Discord username (partial match)

**Response:**
```json
{
  "users": [
    {
      "id": "123456789012345678",
      "username": "example",
      "discriminator": "0",
      "avatar": "abc123..."
    }
  ]
}
```

**Handler:** [src/web/api/users.ts](../src/web/api/users.ts) L30-100

---

#### `GET /api/guild`
**Description:** Get guild information

**Query params:**
- `guild_id` (string, required): Guild ID

**Response:**
```json
{
  "id": "123456789012345678",
  "name": "Example Server",
  "icon": "abc123...",
  "member_count": 1234,
  "roles": [
    {
      "id": "111111111111111111",
      "name": "Verified",
      "color": 5814783
    }
  ]
}
```

**Handler:** [src/web/api/guild.ts](../src/web/api/guild.ts) L30-80

---

#### `GET /api/roles`
**Description:** List all roles in guild

**Query params:**
- `guild_id` (string, required): Guild ID

**Response:**
```json
{
  "roles": [
    {
      "id": "111111111111111111",
      "name": "Verified",
      "color": 5814783,
      "position": 10,
      "managed": false
    }
  ]
}
```

**Handler:** [src/web/api/roles.ts](../src/web/api/roles.ts) L30-70

---

#### `GET /api/banner`
**Description:** Get current bot banner image (public endpoint)

**Auth:** Not required

**Response:** Binary image data (PNG/JPG)

**Handler:** [src/web/api/banner.ts](../src/web/api/banner.ts) L30-80

---

### Admin Endpoints

**Prefix:** `/api/admin`

**Extra auth:** Requires `ADMIN_ROLE_ID` in session user's roles

---

#### `POST /api/admin/reset`
**Description:** **DESTRUCTIVE:** Reset all application data for guild

**Auth:** Admin role + password confirmation

**Body:**
```json
{
  "guild_id": "123456789012345678",
  "password": "from_RESET_PASSWORD_env_var"
}
```

**Response:**
```json
{
  "success": true,
  "deleted": {
    "applications": 150,
    "responses": 600,
    "reviews": 300
  }
}
```

**Handler:** [src/web/api/admin.ts](../src/web/api/admin.ts) L50-150

---

## Interactive Components (Discord UI)

**Button interactions** ([src/index.ts](../src/index.ts) L631-779):

| Custom ID Pattern | Action | Handler |
|-------------------|--------|---------|
| `v1:start:*` | Start verification flow | [src/features/gate.ts](../src/features/gate.ts) L150-200 |
| `v1:done` | Submit completed application | [src/features/gate.ts](../src/features/gate.ts) L500-600 |
| `v1:decide:<action>:<code>` | Approve/Reject/Kick decision | [src/features/review.ts](../src/features/review.ts) L200-400 |
| `v1:perm_reject:<code>` | Permanent rejection | [src/features/review.ts](../src/features/review.ts) L820-900 |
| `v1:copy_uid:<code>:<user_id>` | Copy user ID to clipboard | [src/features/review.ts](../src/features/review.ts) L950-980 |
| `v1:avatar:view_src:<code>` | View avatar source | [src/features/review.ts](../src/features/review.ts) L1000-1050 |
| `v1:modmail:open:<code>` | Open modmail thread | [src/features/modmail.ts](../src/features/modmail.ts) L200-300 |
| `v1:modmail:close:<code>` | Close modmail thread | [src/features/modmail.ts](../src/features/modmail.ts) L400-500 |
| `v1:ping:<user_id>` | Ping user in unverified channel | [src/features/review.ts](../src/features/review.ts) L1100-1150 |
| `v1:ping:delete:<msg_id>` | Delete ping message | [src/features/review.ts](../src/features/review.ts) L1200-1230 |

**Modal interactions** ([src/index.ts](../src/index.ts) L781-907):

| Custom ID Pattern | Purpose | Handler |
|-------------------|---------|---------|
| `v1:modal:<page>:<code>` | Application form page | [src/features/gate.ts](../src/features/gate.ts) L300-450 |
| `v1:reject:<code>` | Rejection reason modal | [src/features/review.ts](../src/features/review.ts) L750-850 |
| `v1:perm_reject:<code>` | Permanent rejection reason | [src/features/review.ts](../src/features/review.ts) L870-920 |
| `v1:avatar:confirm18:<code>` | 18+ avatar confirmation | [src/features/review.ts](../src/features/review.ts) L1030-1080 |
| `v1:gate:reset:<password>` | Reset confirmation modal | [src/commands/gate.ts](../src/commands/gate.ts) L350-400 |

---

## Error Responses

**Standard error format** (REST API):
```json
{
  "error": "Error message here",
  "code": "ERROR_CODE",
  "details": { /* optional */ }
}
```

**HTTP status codes:**
- `400` Bad Request (invalid params)
- `401` Unauthorized (missing/invalid session)
- `403` Forbidden (insufficient permissions)
- `404` Not Found
- `429` Too Many Requests (rate limit)
- `500` Internal Server Error (logged to Sentry)

**Discord interaction errors:** Posted as ephemeral messages via [src/lib/errorCard.ts](../src/lib/errorCard.ts)

---

## Rate Limits

**REST API:**
- 100 requests/minute per IP (Fastify rate limit plugin)

**Discord API:**
- Global: 50 requests/second
- Per-route: Varies (bot automatically retries 429s)

**No custom rate limiting** on slash commands (Discord handles this).

---

## Next Steps

- Test API endpoints: See [tests/web/api.test.ts](../tests/web/api.test.ts)
- Configure OAuth2: See [ENV_REFERENCE.md](../ENV_REFERENCE.md)
- Review button routing: See [src/lib/modalPatterns.ts](../src/lib/modalPatterns.ts)
