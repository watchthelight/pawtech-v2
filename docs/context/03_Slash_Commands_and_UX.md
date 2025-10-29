# 03 — Slash Commands and UX

**Last Updated:** 2025-10-22
**Status:** All commands deployed and tested

## Summary

- **Total Commands:** 14 slash commands registered to guild (with multiple subcommands)
- **Authentication:** Role-based permissions (moderator, admin, owner overrides)
- **UX Patterns:** Ephemeral replies, interactive buttons/modals, color-coded action badges
- **Identity Rendering:** Discord avatars + display names with fallback to username#discriminator

---

## Table of Contents

- [Command Registry](#command-registry)
- [Command Details](#command-details)
- [Action Badge Color Taxonomy](#action-badge-color-taxonomy)
- [Identity Rendering](#identity-rendering)
- [CSV Export Workflow](#csv-export-workflow)
- [UX Patterns](#ux-patterns)

---

## Command Registry

| Command                 | Permissions | Description                                     |
| ----------------------- | ----------- | ----------------------------------------------- |
| `/health`               | None        | Bot diagnostics (latency, uptime, version)      |
| `/gate`                 | Moderator   | Manage gate settings (reset password-protected) |
| `/accept`               | Moderator   | Approve pending application                     |
| `/reject`               | Moderator   | Reject pending application with reason          |
| `/kick`                 | Moderator   | Reject and kick applicant with reason           |
| `/unclaim`              | Moderator   | Release claimed application back to queue       |
| `/config get logging`   | Admin       | View current logging channel                    |
| `/config set logging`   | Admin       | Update logging channel (validates permissions)  |
| `/modstats`             | Moderator   | View personal performance stats                 |
| `/modstats leaderboard` | Moderator   | View top moderators by accepts                  |
| `/modstats export`      | Admin       | Export all metrics to CSV                       |
| `/modmail`              | Moderator   | Manually trigger modmail operations             |
| `/send`                 | Moderator   | Send anonymous staff message to channel         |
| `/analytics`            | Admin       | View analytics dashboard link                   |
| `/analytics-export`     | Admin       | Export analytics data to CSV                    |
| `/resetdata`            | Admin       | Reset analytics epoch (password-protected)      |
| `/statusupdate`         | Admin       | Post formatted status update                    |

**Note:** Owner override via `OWNER_IDS` env var bypasses all permission checks.

---

## Command Details

### `/health`

**Purpose:** Bot diagnostics and health check
**Permissions:** None (public)
**Response:** Ephemeral embed with:

- Bot username and ID
- WebSocket latency (ms)
- Process uptime
- Bot version
- Node.js version

**Example:**

```
🏥 Bot Health Check
Username: Pawtropolis Tech#2205
ID: 1427436615021629590
Latency: 42ms
Uptime: 3 days, 14 hours
Version: 1.1.0
Node: v20.11.0
```

---

### `/gate`

**Purpose:** Gate system management and configuration
**Permissions:** Moderator role (see `/gate set-questions` for enhanced permission model)
**Subcommands:**

- `/gate setup` — Initialize guild configuration with channels and roles
- `/gate status` — View application statistics
- `/gate config` — Display current gate configuration
- `/gate reset` — Reset all applications (password-protected via modal)
- `/gate welcome set` — Update welcome message template
- `/gate welcome preview` — Preview welcome message
- `/gate welcome channels` — Configure info/rules channels
- `/gate welcome role` — Set ping role for welcome messages
- `/gate set-questions` — Update gate questions (q1..q5)

**`/gate set-questions` Details:**

**Purpose:** Configure custom verification questions for the guild

**Parameters:** `q1` through `q5` (all optional, 500 char max per question)

**Permissions:** Enhanced permission model allowing any of:

- Guild owner
- Bot owners (configured in `OWNER_IDS` env)
- Configured admin roles (`GATE_ADMIN_ROLE_IDS` env)
- Members with Manage Server permission (fallback)

**Behavior:**

- Only provided questions are updated (omitted parameters leave questions unchanged)
- Questions are required by default
- Running without parameters shows current questions

**Examples:**

```
# Update just q1 and q3 (others remain unchanged)
/gate set-questions q1:"What is your age?" q3:"Why do you want to join?"

# View current questions
/gate set-questions

# Update all questions at once
/gate set-questions q1:"Q1" q2:"Q2" q3:"Q3" q4:"Q4" q5:"Q5"
```

**Success Reply:**

```
✅ Updated: q1, q3

Current questions:
1) What is your age?
2) How did you find this server?
3) Why do you want to join?
4) What does a furry mean to you?
5) What is the password stated in our rules?
```

**Reset Command:**

```
/gate reset
# Opens modal requiring password confirmation
✓ Gate reset complete. Questions seeded: 5. Gate Entry ensured.
```

---

### `/accept` / `/reject` / `/kick`

**Purpose:** Moderator decision commands for claimed applications
**Permissions:** Moderator role
**Parameters:**

- `applicant` (User) — Required, autocomplete from claimed applications
- `reason` (String) — Optional for `/accept`, required for `/reject` and `/kick`

**Flow:**

1. Moderator uses `/accept @user` or `/reject @user reason: ...`
2. Bot validates claim ownership (must be claimed by executing moderator)
3. Action logged to action_log table and logging channel
4. DM sent to applicant with decision + optional reason
5. If approved: verified role assigned, welcome message posted
6. If rejected: applicant remains in server
7. If kicked: applicant removed from server immediately
8. Response time calculated and added to moderator metrics

**Badge Colors:**

- Approve: 🟢 Green (`#2ecc71`)
- Reject: 🟡 Yellow (`#f1c40f`)
- Kick: 🔴 Red (`#e74c3c`)

**Example DM (Rejection):**

```
❌ Application Rejected

Your application to Pawtropolis has been rejected.

Reason: Profile is too new (account created < 7 days ago). Please reapply after your account ages.

You may reapply in the future by returning to the #gate channel.
```

---

### `/unclaim`

**Purpose:** Release claimed application back to review queue
**Permissions:** Moderator role
**Use Case:** Moderator claimed application by mistake or needs to pass to another reviewer

**Flow:**

1. Moderator uses `/unclaim @user`
2. Bot validates claim ownership
3. Application status reset to `pending`
4. Claim button re-enabled on review card
5. No action logged (unclaim doesn't count as moderation action)

---

### `/config get logging` / `/config set logging`

**Purpose:** View or update logging channel configuration
**Permissions:** Admin role
**Resolution Priority:** Database > Environment Variable > null

**Set Command Flow:**

1. Admin uses `/config set logging channel:#logs`
2. Bot validates channel exists and is text channel
3. Bot checks permissions: `SendMessages`, `EmbedLinks`
4. If permissions OK: save to `guild_config.logging_channel_id`
5. If permissions fail: warn admin, fall back to JSON file logging

**Get Command:**
Shows current logging channel with health check:

```
📊 Logging Configuration

Channel: #verification-logs (ID: 1430015254053654599)
Status: ✓ Healthy
Permissions: ✓ Send Messages, ✓ Embed Links

All moderation actions will be logged here.
```

**JSON Fallback:**
If logging channel unavailable, actions written to `data/action_log_fallback.jsonl`:

```json
{
  "timestamp": "2025-10-22T03:00:00Z",
  "action": "approve",
  "moderator_id": "123",
  "applicant_id": "456",
  "reason": null
}
```

---

### `/modstats` / `/modstats leaderboard` / `/modstats export`

**Purpose:** View moderator performance metrics
**Permissions:** Moderator (personal stats), Admin (leaderboard + export)

**Personal Stats (`/modstats`):**
Shows ephemeral embed with:

- Total claims, approves, rejects, kicks
- Modmail tickets opened
- Response time p50 and p95
- Rank vs. other moderators

**Leaderboard (`/modstats leaderboard`):**
Public embed with top 10 moderators by accept count:

```
🏆 Top Moderators (30 days)

1. @Alice — 127 approvals (p50: 8m, p95: 45m)
2. @Bob — 98 approvals (p50: 12m, p95: 1h 2m)
3. @Charlie — 76 approvals (p50: 15m, p95: 1h 15m)

Total actions: 1,247
```

**Export (`/modstats export`):**
Generates CSV file with all moderator metrics:

```csv
moderator_id,username,total_claims,total_accepts,total_rejects,total_kicks,modmail_opens,response_time_p50_ms,response_time_p95_ms
123456789,Alice#1234,150,127,18,5,42,480000,2700000
234567890,Bob#5678,120,98,15,7,38,720000,3720000
```

**Metrics Refresh:**

- Automated: Every 15 minutes via scheduler
- Cache: 5-minute TTL (configurable via env)
- Manual: `/resetdata` command clears cache and recalculates

---

### `/resetdata <password>`

**Purpose:** Reset analytics epoch and clear metrics cache
**Permissions:** Admin role
**Authentication:** Requires `RESET_PASSWORD` from `.env`

**Flow:**

1. Admin uses `/resetdata MySecretPassword123`
2. Bot validates password using timing-safe comparison
3. If correct: clear mod_metrics table, reset epoch timestamp, clear cache
4. If incorrect: reject with warning, log attempt

**Security:**

- Uses `crypto.timingSafeEqual()` to prevent timing attacks
- Same password as `/gate reset` for consistency
- All attempts logged to action_log with admin user ID

**Example:**

```
/resetdata WrongPassword
❌ Incorrect password. This attempt has been logged.

/resetdata CorrectPassword
✓ Analytics data reset. Epoch started at 2025-10-22 03:00:00 UTC.
Cleared 3 moderator metric records.
```

---

### `/send <channel> <message>`

**Purpose:** Post anonymous staff message to any channel
**Permissions:** Moderator role
**Use Case:** Announcements, reminders, or clarifications without personal attribution

**Flow:**

1. Moderator uses `/send channel:#general message:Server maintenance in 10 minutes`
2. Bot posts message to target channel with "Staff Team" attribution
3. Action logged with moderator ID (audit trail maintained)
4. Moderator identity hidden from public message

**Example Output:**

```
📢 Staff Team
Server maintenance in 10 minutes. Please save your work and expect a brief disconnection.
```

---

### `/analytics` / `/analytics-export`

**Purpose:** Access web analytics dashboard
**Permissions:** Admin role

**Analytics Command:**
Returns ephemeral link to web dashboard:

```
📊 Analytics Dashboard

View detailed analytics and metrics:
https://pawtropolis.tech/admin/

Includes:
• 30-day action timeline
• Join→Submit conversion funnel
• Response time distributions
• Moderator leaderboards
```

**Export Command:**
Generates CSV with raw analytics data (joins, submits, actions, timestamps).

---

## Action Badge Color Taxonomy

All moderation actions displayed in logging channel and dashboard use consistent color coding:

| Action          | Color  | Hex Code  | Visual |
| --------------- | ------ | --------- | ------ |
| `app_submitted` | Blue   | `#3498db` | 🔵     |
| `claim`         | Green  | `#2ecc71` | 🟢     |
| `approve`       | Green  | `#2ecc71` | 🟢     |
| `reject`        | Yellow | `#f1c40f` | 🟡     |
| `perm_reject`   | Red    | `#e74c3c` | 🔴     |
| `kick`          | Red    | `#e74c3c` | 🔴     |
| `modmail_open`  | Purple | `#9b59b6` | 🟣     |
| `modmail_close` | Gray   | `#95a5a6` | ⚫     |

**Usage:**

- **Logging Channel:** Embed color matches action type
- **Dashboard:** Action badges use colored pills with icon
- **CSV Export:** `action` column contains raw action name

---

## Identity Rendering

All user references in bot responses and dashboard use Discord's identity resolution:

### Display Priority

1. **Server Nickname** (guild-specific display name)
2. **Global Display Name** (new username system)
3. **Username#Discriminator** (legacy format)
4. **User ID** (fallback if fetch fails)

### Avatar Resolution

```javascript
// Priority cascade
const avatarURL =
  member.displayAvatarURL({ size: 64 }) || // Server avatar
  user.displayAvatarURL({ size: 64 }) || // Global avatar
  `https://cdn.discordapp.com/embed/avatars/${userId % 5}.png`; // Default Discord avatar
```

### Dashboard Rendering

User tags in dashboard show avatar + name with hover tooltip:

```html
<span class="user-tag">
  <img class="avatar" src="https://cdn.discordapp.com/.../avatar.png" alt="" />
  <span class="display">Alice (Server Admin)</span>
</span>
```

**Cache:**

- **TTL:** 30 minutes
- **Storage:** In-memory Map
- **Invalidation:** Automatic on expiry, no manual refresh

---

## CSV Export Workflow

### Modstats Export

1. Admin uses `/modstats export`
2. Bot queries `mod_metrics` table
3. Resolves moderator IDs to usernames (cached)
4. Generates CSV with headers:
   ```csv
   moderator_id,username,total_claims,total_accepts,total_rejects,total_kicks,modmail_opens,response_time_p50_ms,response_time_p95_ms
   ```
5. Attaches file to ephemeral response

### Analytics Export

1. Admin uses `/analytics-export` or clicks "Export CSV" on dashboard
2. API queries `action_log` with date range filter
3. Resolves user IDs to usernames
4. Generates CSV with headers:
   ```csv
   timestamp,action,moderator,applicant,reason,response_time_ms
   ```
5. Browser downloads file: `analytics_YYYY-MM-DD.csv`

**Date Range Options:**

- Last 24 hours
- Last 7 days
- Last 30 days (default)
- Last year
- All time

---

## UX Patterns

### Ephemeral vs. Public Replies

| Pattern       | When to Use                                                   |
| ------------- | ------------------------------------------------------------- |
| **Ephemeral** | Error messages, personal stats, sensitive data, confirmations |
| **Public**    | Leaderboards, status updates, announcements                   |

### Interactive Components

**Buttons:**

- `Decide` — On applicant review cards (triggers claim)
- `Copy UID` — Copy applicant user ID to clipboard
- `View Avatar` — Open full-size avatar in modal
- `Close Ticket` — Archive modmail thread

**Modals:**

- Gate verification questions (5 text inputs)
- Reject reason input (single textarea)
- Avatar risk confirmation (checkbox + reason)

### Loading States

Commands that query database or API show loading indicator:

```
⏳ Fetching metrics...
```

Then update to result:

```
✓ Metrics loaded (3 moderators, 247 actions)
```

### Error Handling

All errors show user-friendly message + trace ID for debugging:

```
❌ Command Failed

An error occurred while processing your request.

Error: Could not fetch guild member data
Trace ID: 7xK9mPq2nL8

Please try again or contact a bot administrator if the issue persists.
```

**Trace IDs** are logged to console and Sentry for correlation.

---

## Changelog

**Since last revision:**

- Added `/resetdata` command with password protection details
- Updated action badge color taxonomy (claim=green, reject=yellow, perm_reject=red)
- Documented `/config get|set logging` subcommands from PR4
- Added CSV export workflow for both modstats and analytics
- Clarified identity rendering priority (nickname → display name → username#discriminator)
- Updated command count (14 total commands)
- Added security notes for password-protected commands
- Documented JSON fallback logging when channel unavailable
