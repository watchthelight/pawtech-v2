# Pawtropolis Tech Bot Handbook

A comprehensive guide to all bot commands, who can use them, and how.

---

## Table of Contents

1. [Gate System (Application Review)](#gate-system-application-review)
2. [Moderator Tools](#moderator-tools)
3. [Suggestion System](#suggestion-system)
4. [Artist Rotation](#artist-rotation)
5. [Movie Night](#movie-night)
6. [Role Automation](#role-automation)
7. [Configuration](#configuration)
8. [Utility & Admin](#utility--admin)

---

## Gate System (Application Review)

Commands for managing the member application and verification process.

### `/gate`
**Permission:** Staff (Manage Messages)
**Description:** Guild gate management for setting up and configuring the application system.

| Subcommand | Description |
|------------|-------------|
| `setup` | Initialize gate config with review channel, gate channel, general channel, and accepted role |
| `status` | Show application statistics |
| `config` | View current gate configuration |
| `reset` | Reset all application data (fresh start) |
| `welcome set` | Update the welcome message template |
| `welcome preview` | Preview the welcome message |
| `welcome channels` | Configure welcome channels and ping role |
| `welcome role` | Set the ping role for welcome messages |
| `set-questions` | Set gate questions (q1-q5) |

**Example:**
```
/gate setup review_channel:#staff-review gate_channel:#apply general_channel:#general accepted_role:@Member
/gate welcome set content:Welcome {applicant.mention}! Check out {channel.rules}!
```

---

### `/accept`
**Permission:** Staff (Reviewer role or Manage Guild)
**Description:** Approve an application by short code, user mention, or user ID.

| Option | Required | Description |
|--------|----------|-------------|
| `app` | No | Application short code (e.g., A1B2C3) |
| `user` | No | User to accept (@mention or select from picker) |
| `uid` | No | Discord User ID (if user not in server) |

> **Note:** Provide exactly ONE of: `app`, `user`, or `uid`.

**Example:**
```
/accept app:A1B2C3
/accept user:@Username
/accept uid:123456789012345678
```

---

### `/reject`
**Permission:** Staff (Reviewer role or Manage Guild)
**Description:** Reject an application with a reason.

| Option | Required | Description |
|--------|----------|-------------|
| `reason` | Yes | Reason for rejection (max 500 chars) |
| `app` | No | Application short code |
| `user` | No | User to reject (@mention or select from picker) |
| `uid` | No | Discord User ID (if user not in server) |
| `perm` | No | Permanently reject (blocks re-application) |

> **Note:** Provide exactly ONE of: `app`, `user`, or `uid`.

**Example:**
```
/reject app:A1B2C3 reason:Incorrect password
/reject user:@Username reason:Spam account perm:true
/reject uid:123456789012345678 reason:Spam account perm:true
```

---

### `/kick`
**Permission:** Staff (Reviewer role or Manage Guild)
**Description:** Kick an applicant by short code, user mention, or user ID.

| Option | Required | Description |
|--------|----------|-------------|
| `reason` | Yes | Reason for kick |
| `app` | No | Application short code |
| `user` | No | User to kick (@mention or select from picker) |
| `uid` | No | Discord User ID (if user not in server) |

> **Note:** Provide exactly ONE of: `app`, `user`, or `uid`.

**Example:**
```
/kick app:A1B2C3 reason:Underage
/kick user:@Username reason:Underage
```

---

### `/unclaim`
**Permission:** Staff
**Description:** Release a claim on an application so others can review it.

| Option | Required | Description |
|--------|----------|-------------|
| `app` | No | Application short code |
| `user` | No | User whose app to unclaim (@mention or select from picker) |
| `uid` | No | Discord User ID (if user not in server) |

> **Note:** Provide exactly ONE of: `app`, `user`, or `uid`.

**Example:**
```
/unclaim app:A1B2C3
/unclaim user:@Username
```

---

### `/listopen`
**Permission:** Staff (Reviewer role or Manage Guild)
**Description:** List claimed applications that need review.

| Option | Required | Description |
|--------|----------|-------------|
| `scope` | No | `mine` (default), `all`, or `drafts` |

**Scope options:**
- `mine` - Applications you've claimed (default)
- `all` - All open applications (claimed + unclaimed)
- `drafts` - Incomplete/draft applications

**Example:**
```
/listopen
/listopen scope:all
/listopen scope:drafts
```

---

### `/search`
**Permission:** Staff (Reviewer role or Manage Guild)
**Description:** Search for a user's application history.

| Option | Required | Description |
|--------|----------|-------------|
| `user` | Yes | The user to search for |

**Example:**
```
/search user:@Username
```

---

### `/unblock`
**Permission:** Staff
**Description:** Remove permanent rejection from a user, allowing them to re-apply.

| Option | Required | Description |
|--------|----------|-------------|
| `target` | No | User to unblock (mention) |
| `user_id` | No | Discord User ID (if user left server) |
| `username` | No | Username (fallback) |
| `reason` | No | Reason for unblocking |

**Example:**
```
/unblock target:@Username reason:Appeal approved
/unblock user_id:123456789012345678
```

---

## Moderator Tools

Commands for moderator analytics and oversight.

### `/modstats`
**Permission:** Staff
**Description:** View moderator analytics and leaderboards.

| Subcommand | Description |
|------------|-------------|
| `leaderboard` | Show leaderboard of moderators by decisions |
| `user` | Show detailed stats for a specific moderator |
| `export` | Export all moderator metrics as CSV |
| `reset` | Clear and rebuild statistics (requires password) |

**Options:**
- `days` - Number of days to analyze (default: 30)
- `moderator` - Moderator to analyze (for `user` subcommand)
- `export` - Export as CSV file

**Example:**
```
/modstats leaderboard days:7
/modstats user moderator:@ModName days:30
/modstats export days:90
```

---

### `/modhistory`
**Permission:** Leadership only (Server owners or designated leaders)
**Description:** View detailed moderator action history for oversight.

| Option | Required | Description |
|--------|----------|-------------|
| `moderator` | Yes | Moderator to inspect |
| `days` | No | Days of history (default: 30, max: 365) |
| `export` | No | Export to CSV |

**Example:**
```
/modhistory moderator:@ModName days:60
```

---

### `/analytics`
**Permission:** Staff
**Description:** View reviewer activity analytics with charts.

| Option | Required | Description |
|--------|----------|-------------|
| `from` | No | Start timestamp (Unix epoch) |
| `to` | No | End timestamp (Unix epoch) |
| `all-guilds` | No | Include all guilds (owners only) |
| `bucket` | No | Time bucket (hourly/daily/weekly) |

**Example:**
```
/analytics
/analytics bucket:daily
```

---

### `/analytics-export`
**Permission:** Staff
**Description:** Export reviewer activity as CSV file.

| Option | Required | Description |
|--------|----------|-------------|
| `from` | No | Start timestamp |
| `to` | No | End timestamp |
| `all-guilds` | No | Include all guilds (owners only) |

---

### `/flag`
**Permission:** Staff
**Description:** Manually flag a user as suspicious/bot.

| Option | Required | Description |
|--------|----------|-------------|
| `user` | Yes | The user to flag |
| `reason` | No | Reason for flagging |

**Example:**
```
/flag user:@SuspiciousUser reason:Suspicious join pattern
```

---

### `/approval-rate`
**Permission:** Staff
**Description:** View server-wide approval/rejection rate analytics.

| Option | Required | Description |
|--------|----------|-------------|
| `days` | No | Number of days to analyze (default: 30) |

**Example:**
```
/approval-rate days:7
```

---

## Suggestion System

Commands for the bot feature suggestion system.

### `/suggest`
**Permission:** Everyone
**Description:** Submit a bot feature suggestion.

| Option | Required | Description |
|--------|----------|-------------|
| `suggestion` | Yes | Your feature idea (max 1000 characters) |

**Example:**
```
/suggest suggestion:Add a command to view server statistics
```

---

### `/suggestions`
**Permission:** Everyone
**Description:** View bot feature suggestions with filtering and pagination.

| Option | Required | Description |
|--------|----------|-------------|
| `status` | No | Filter: open, approved, denied, implemented, all |

**Example:**
```
/suggestions
/suggestions status:approved
```

---

### `/suggestion`
**Permission:** Staff (Manage Messages)
**Description:** Staff commands for managing suggestions.

| Subcommand | Description |
|------------|-------------|
| `approve` | Approve a suggestion |
| `deny` | Deny a suggestion with reason |
| `implement` | Mark a suggestion as implemented |
| `delete` | Delete a suggestion |

**Options:**
- `id` - Suggestion ID (required)
- `response` - Optional response to suggester
- `reason` - Reason for denial

**Example:**
```
/suggestion approve id:42 response:Great idea, adding to roadmap!
/suggestion deny id:43 reason:Outside project scope
/suggestion implement id:42 response:Added in v1.5!
```

---

## Artist Rotation

Commands for managing the Server Artist rotation queue for art rewards.

### `/artistqueue`
**Permission:** Manage Roles
**Description:** Manage the Server Artist rotation queue.

| Subcommand | Description |
|------------|-------------|
| `list` | View current artist queue order |
| `sync` | Sync queue with current Server Artist role holders |
| `move` | Move an artist to a specific position |
| `skip` | Temporarily skip an artist in rotation |
| `unskip` | Remove skip status from an artist |
| `history` | View art reward assignment history |
| `setup` | Initial setup - sync queue and configure |

**Example:**
```
/artistqueue list
/artistqueue sync
/artistqueue move user:@Artist position:1
/artistqueue skip user:@Artist reason:On vacation
/artistqueue history user:@Artist limit:20
```

---

### `/redeemreward`
**Permission:** Manage Roles
**Description:** Assign an art reward to a user from the artist rotation queue.

| Option | Required | Description |
|--------|----------|-------------|
| `user` | Yes | User redeeming the art reward |
| `type` | Yes | Art type: headshot, halfbody, emoji, fullbody |
| `artist` | No | Override: Assign specific artist instead of next in queue |

**Flow:**
1. Run command in the ticket channel
2. Bot shows confirmation with user's ticket roles
3. Click Confirm to assign artist and send `$add` command
4. Artist is moved to end of queue

**Example:**
```
/redeemreward user:@Winner type:headshot
/redeemreward user:@Winner type:fullbody artist:@SpecificArtist
```

---

## Movie Night

Commands for tracking movie night attendance and assigning tier roles.

### `/movie`
**Permission:** Staff
**Description:** Movie night attendance tracking.

| Subcommand | Description |
|------------|-------------|
| `start` | Start tracking attendance in a voice channel |
| `end` | End movie night and finalize attendance |
| `attendance` | View attendance stats |

**Tier Roles (30+ min required to qualify):**
- **Red Carpet Guest:** 1+ qualified movies
- **Popcorn Club:** 5+ qualified movies
- **Director's Cut:** 10+ qualified movies
- **Cinematic Royalty:** 20+ qualified movies

**Example:**
```
/movie start channel:#movie-night-vc
/movie end
/movie attendance user:@Username
```

---

## Role Automation

Commands for configuring automatic role assignments.

### `/roles`
**Permission:** Manage Roles
**Description:** Configure role automation settings.

| Subcommand | Description |
|------------|-------------|
| `add-level-tier` | Map a level number to its Amaribot level role |
| `add-level-reward` | Add a reward token/ticket for a level |
| `add-movie-tier` | Add a movie night attendance tier |
| `list` | View configured role mappings |
| `remove-level-tier` | Remove a level tier mapping |
| `remove-level-reward` | Remove a level reward |
| `remove-movie-tier` | Remove a movie tier |

**Example:**
```
/roles add-level-tier level:15 role:@Engaged Fur
/roles add-level-reward level:15 role:@Byte Token [Common]
/roles add-movie-tier tier_name:Popcorn Club role:@Popcorn Club movies_required:5
/roles list type:level_tier
```

---

### `/panic`
**Permission:** Staff
**Description:** Emergency shutoff for role automation.

| Subcommand | Description |
|------------|-------------|
| `on` | Enable panic mode - stops all automatic role grants |
| `off` | Disable panic mode - resume normal operation |
| `status` | Check if panic mode is active |

**Example:**
```
/panic on
/panic off
/panic status
```

---

## Configuration

Commands for configuring bot behavior.

### `/config`
**Permission:** Administrator
**Description:** Guild-level bot configuration.

| Subcommand | Description |
|------------|-------------|
| `set logging_channel` | Set channel for action logs |
| `set flags_channel` | Set channel for Silent-Since-Join alerts |
| `set flags_threshold` | Set silent days threshold (7-365) |
| `set dadmode` | Toggle Dad Mode responses |
| `set pingdevonapp` | Toggle Bot Dev pings on new applications |
| `set suggestion_channel` | Set channel for suggestions |
| `set suggestion_cooldown` | Set cooldown between suggestions |
| `get logging` | View logging channel config |
| `get flags` | View flags config |
| `view` | View all current configuration |

**Example:**
```
/config set logging_channel channel:#mod-logs
/config set dadmode state:true chance:500
/config set flags_threshold days:14
/config view
```

---

### `/review-set-notify-config`
**Permission:** Administrator
**Description:** Configure forum post notification settings.

| Option | Required | Description |
|--------|----------|-------------|
| `mode` | No | Notification mode: post or channel |
| `role` | No | Role to ping |
| `forum` | No | Forum channel to watch |
| `channel` | No | Channel for notifications (channel mode) |
| `cooldown` | No | Seconds between notifications |
| `max_per_hour` | No | Maximum notifications per hour |

---

### `/review-get-notify-config`
**Permission:** Administrator
**Description:** View current forum post notification settings.

---

### `/review-set-listopen-output`
**Permission:** Manage Guild
**Description:** Set whether `/listopen` outputs are public or ephemeral.

| Option | Required | Description |
|--------|----------|-------------|
| `mode` | Yes | public or ephemeral |

---

## Utility & Admin

General utility and administrative commands.

### `/update`
**Permission:** Bot Owner only
**Description:** Update bot activity, status, banner, or avatar.

| Subcommand | Description |
|------------|-------------|
| `activity` | Update bot activity (Playing, Watching, etc.) |
| `status` | Update bot custom status text |
| `banner` | Update profile, gate, welcome, and website banners |
| `avatar` | Update bot profile picture |

**Example:**
```
/update activity type:watching text:over the gate
/update status text:Protecting the realm
/update banner image:<attachment>
```

---

### `/send`
**Permission:** Manage Messages
**Description:** Post an anonymous message as the bot.

| Option | Required | Description |
|--------|----------|-------------|
| `message` | Yes | Content to send |
| `embed` | No | Send as embed (default: false) |
| `reply_to` | No | Message ID to reply to |
| `attachment` | No | Include a file or image |
| `silent` | No | Block all mentions (default: true) |

**Example:**
```
/send message:Welcome to the server!
/send message:Important announcement embed:true
/send message:Replying to this reply_to:123456789012345678
```

---

### `/purge`
**Permission:** Manage Messages + Password
**Description:** Bulk delete messages in a channel.

| Option | Required | Description |
|--------|----------|-------------|
| `password` | Yes | Admin password |
| `count` | No | Number of messages (default: all) |

**Example:**
```
/purge password:*** count:50
```

---

### `/poke`
**Permission:** Bot Owner only
**Description:** Ping a user across multiple category channels.

| Option | Required | Description |
|--------|----------|-------------|
| `user` | Yes | The user to poke |

---

### `/health`
**Permission:** Everyone
**Description:** View bot health status (uptime and latency).

**Example:**
```
/health
```

---

### `/activity`
**Permission:** Everyone
**Description:** View server activity heatmap with trends analysis.

| Option | Required | Description |
|--------|----------|-------------|
| `weeks` | No | Number of weeks to show (1-8, default: 1) |

**Example:**
```
/activity
/activity weeks:4
```

---

### `/backfill`
**Permission:** Staff
**Description:** Backfill message activity data for heatmap.

| Option | Required | Description |
|--------|----------|-------------|
| `weeks` | No | Number of weeks to backfill (1-8, default: 8) |
| `dry-run` | No | Test without writing to database |

---

### `/database`
**Permission:** Bot Owner + Password
**Description:** Database management commands.

| Subcommand | Description |
|------------|-------------|
| `check` | Check database health and integrity |
| `recover` | Interactive database recovery assistant |

---

## Permission Reference

| Permission Level | Who Has It |
|------------------|------------|
| **Everyone** | All server members |
| **Staff** | Members with Reviewer role or Manage Guild permission |
| **Leadership** | Server owners and designated leaders |
| **Administrator** | Members with Administrator permission |
| **Bot Owner** | Designated bot owners in config |

---

## Quick Reference

### Most Used Commands

| Command | Purpose |
|---------|---------|
| `/accept` | Approve an application |
| `/reject` | Reject an application |
| `/listopen` | See pending applications |
| `/search` | Find user's app history |
| `/modstats leaderboard` | See mod activity |
| `/health` | Check bot status |

### Emergency Commands

| Command | Purpose |
|---------|---------|
| `/panic on` | Stop all role automation |
| `/purge` | Emergency message cleanup |
| `/database check` | Verify database integrity |

---

*Last updated: November 2025*
