# Permission Matrix

Complete reference for all role-based permissions in Pawtropolis Tech.

---

## Table of Contents

- [Role Hierarchy](#role-hierarchy)
- [Special Bypass Roles](#special-bypass-roles)
- [Permission Types](#permission-types)
- [Commands by Permission Level](#commands-by-permission-level)
  - [Public Commands](#public-commands-anyone)
  - [Gatekeeper Only](#gatekeeper-only-gk)
  - [Gatekeeper+](#gatekeeper-gk-and-above)
  - [Junior Moderator+](#junior-moderator-jm)
  - [Moderator+](#moderator-m)
  - [Senior Moderator+](#senior-moderator-sm)
  - [Administrator+](#administrator-a)
  - [Senior Administrator+](#senior-administrator-sa)
  - [Community Manager+](#community-manager-cm)
  - [Bot Owner / Server Dev Only](#bot-owner--server-dev-only)
  - [Discord Permission Based](#discord-permission-based)
  - [Server Artist Role](#server-artist-role)
- [Review Card Buttons](#review-card-buttons)
- [Permission Denied Messages](#permission-denied-messages)
- [Technical Reference](#technical-reference)

---

## Role Hierarchy

Staff roles are organized in a strict hierarchy. Higher-ranked roles automatically have access to commands available to lower-ranked roles (when using "X+" notation).

| Rank | Role | Role ID | Abbreviation |
|:----:|------|---------|:------------:|
| 1 | Server Owner | `896070888779317254` | SO |
| 2 | Community Manager | `1190093021170114680` | CM |
| 3 | Community Development Lead | `1382242769468260352` | CDL |
| 4 | Senior Administrator | `1420440472169746623` | SA |
| 5 | Administrator | `896070888779317248` | A |
| 6 | Senior Moderator | `1095757038899953774` | SM |
| 7 | Moderator | `896070888762535975` | M |
| 8 | Junior Moderator | `896070888762535966` | JM |
| 9 | Gatekeeper | `896070888762535969` | GK |
| 10 | Moderation Team | `987662057069482024` | MT |

**Note:** Moderation Team (MT) is view-only and cannot use most commands.

---

## Special Bypass Roles

These roles bypass all permission checks and have full access to every command:

| Role | ID | Notes |
|------|-----|-------|
| Server Dev | `1120074045883420753` | Staff role with full access |
| Bot Owner | User ID: `697169405422862417` | Hardcoded user ID |

---

## Permission Types

Commands use different permission systems:

### Role-Based Hierarchical ("X+")

**"X+"** means the specified role and all roles above it in the hierarchy.

Example: **"Senior Mod+"** (SM+) includes:
- Senior Moderator, Administrator, Senior Administrator, CDL, Community Manager, Server Owner
- Plus Server Dev and Bot Owner bypass

### Role-Based Explicit ("[X]")

**"[X]"** means only that specific role, regardless of hierarchy.

Example: **"[GK]"** means only the Gatekeeper role can use the command.

### Discord Permission Based

Some commands use Discord's built-in permission system (e.g., ManageMessages, ManageRoles) rather than role-based checks. These are indicated with the Discord permission name.

---

## Commands by Permission Level

### Public Commands (Anyone)

Commands available to all server members:

| Command | Description |
|---------|-------------|
| `/help` | Interactive help system with category browsing and search |
| `/health` | Check bot status, uptime, and connection health |
| `/art getstatus` | Check progress of your personal art reward |
| `/sample` | Preview UI components for training purposes |

---

### Gatekeeper Only [GK]

Commands restricted to the Gatekeeper role specifically. Higher roles do NOT automatically have access.

| Command | Description |
|---------|-------------|
| `/accept` | Accept an application by short code, user mention, or user ID |
| `/reject` | Reject an application with a reason |
| `/kick` | Kick an applicant from the server |
| `/unclaim` | Release your claim on an application |
| `/listopen` | View your currently claimed applications |
| `/unblock` | Remove a permanent rejection from a user |
| `/search` | Search application history by user |

**Why Gatekeeper only?** Application handling is a specialized role. Higher-ranked staff who don't handle applications shouldn't accidentally process them.

---

### Gatekeeper+ (GK and above)

| Command | Description |
|---------|-------------|
| `/modstats leaderboard` | View ranked list of moderators by application decisions |
| `/modstats user @moderator` | View detailed stats for a specific moderator |

---

### Junior Moderator+ (JM+)

| Command | Description |
|---------|-------------|
| `/flag @user [reason]` | Flag a user as suspicious for staff review |
| `/isitreal` | Analyze images in a message for AI generation |
| "Is It Real?" context menu | Right-click any message to check for AI images |

---

### Moderator+ (M+)

| Command | Description |
|---------|-------------|
| `/movie start` | Start a movie night session |
| `/movie end` | End the current movie night |
| `/movie attendance` | View current attendance for active session |
| `/movie add @user <minutes>` | Add minutes to a user's attendance |
| `/movie credit @user <date> <minutes>` | Credit attendance to a past event |
| `/movie bump @user` | Give a user full qualified credit |
| `/movie resume` | Check status of recovered session after restart |

---

### Senior Moderator+ (SM+)

| Command | Description |
|---------|-------------|
| `/activity` | View server activity heatmap with message trends |
| `/skullmode chance:<N>` | Set the odds (1-1000) for random skull reactions |
| `/update activity` | Set bot's Discord activity (Playing, Watching, etc.) |
| `/update status` | Set bot's custom status text |
| `/art all` | View all active artist jobs in the system |
| `/art assign @user` | Assign an art job to a specific artist |

---

### Administrator+ (A+)

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `/config set` | `mod_roles`, `gatekeeper`, `logging`, `flags_channel`, `dadmode`, `skullmode`, etc. | Configure server settings |
| `/config get` | `logging`, `flags`, `movie_config`, `artist_rotation` | View current configuration |
| `/config view` | — | Overview of all settings |
| `/config set-advanced` | `flags_threshold`, `reapply_cooldown`, `min_account_age`, etc. | Advanced configuration |
| `/config artist` | `rotation`, `ignored_users` | Artist rotation configuration |
| `/config movie` | `threshold` | Movie night settings |
| `/config poke` | `add-category`, `remove-category`, `list` | Poke system config |
| `/art leaderboard` | — | View artist statistics |

---

### Senior Administrator+ (SA+)

| Command | Description |
|---------|-------------|
| `/panic on` | Enable emergency mode (stops all role automation) |
| `/panic off` | Disable emergency mode |
| `/panic status` | Check current panic mode state |
| `/modstats export` | Export all moderator metrics as CSV |
| `/modstats reset` | Clear and rebuild statistics (password required) |
| `/config isitreal` | Configure AI detection API keys |
| `/config toggleapis` | Toggle API services on/off |
| `/review-set-notify-config` | Configure forum notifications |
| `/review-get-notify-config` | View notification settings |

---

### Community Manager+ (CM+)

| Command | Description |
|---------|-------------|
| `/audit members` | Scan server for suspicious bot accounts |
| `/audit nsfw` | Scan all member avatars for NSFW content |
| `/gate setup` | Initialize guild gate configuration |
| `/gate reset` | Reset ALL application data (destructive) |
| `/gate status` | View application statistics |
| `/gate config` | View gate configuration |
| `/gate welcome` | Configure welcome messages |
| `/gate set-questions` | Set application questions |
| `/update banner` | Update bot's profile banner |
| `/update avatar` | Update bot's avatar image |
| `/backfill` | Rebuild historical activity data |

---

### Bot Owner / Server Dev Only

Commands restricted to Server Dev role or Bot Owner user ID only:

| Command | Description |
|---------|-------------|
| `/database check` | Run database integrity checks |
| `/database recover` | Attempt to recover corrupted data |
| `/sync` | Sync slash commands to Discord |
| `/poke @user` | Ping a user across multiple category channels |

---

### Discord Permission Based

These commands use Discord's built-in permission system rather than role-based checks:

| Command | Discord Permission | Description |
|---------|-------------------|-------------|
| `/send` | ManageMessages | Post an anonymous message as the bot |
| `/purge` | ManageMessages + Password | Bulk delete messages (up to 100, max 14 days old) |
| `/roles` | ManageRoles | Configure role automation mappings |
| `/artistqueue` | ManageRoles | Manage the artist rotation queue |
| `/redeemreward` | ManageRoles | Assign an art reward to a user |
| `/resetdata` | ManageGuild + Password | Reset metrics data from now forward |
| `/review-set-listopen-output` | ManageGuild | Configure listopen visibility |
| `/modhistory` | Administrator | View detailed mod action history |
| `/analytics` | Staff/Owner | Visual activity charts |
| `/analytics-export` | Staff/Owner | Export activity data as CSV |
| `/approval-rate` | Staff | Server-wide approval analytics |

---

### Server Artist Role

Commands for the Server Artist functional role (`896070888749940770`):

| Command | Description |
|---------|-------------|
| `/art jobs` | View your active art jobs |
| `/art bump @recipient` | Update job status/progress |
| `/art finish @recipient` | Mark a job as complete |
| `/art view @recipient` | View details of a specific job |

**Note:** Administrator+ can also access these commands for management purposes.

---

## Review Card Buttons

All review card buttons require **Gatekeeper [GK]** role specifically:

| Button | Action |
|--------|--------|
| Claim Application | Claim the application for review |
| Accept | Accept and grant member role |
| Reject | Reject with reason (opens modal) |
| Perm Reject | Permanently reject (opens modal) |
| Kick | Remove from server (opens modal) |
| Unclaim | Release your claim (requires confirmation) |
| Modmail | Open modmail thread with applicant |
| Copy UID | Copy user ID to clipboard |
| Ping | Mention the applicant in channel |

---

## Permission Denied Messages

When a user lacks permission, they see an ephemeral embed with specific information:

### Example: Command requires hierarchy (SM+)

```
Permission Denied

Command: /activity

This command views the server activity heatmap with message trends.

You need one of:
  Senior Moderator or above
    @Senior Moderator
    @Administrator
    @Senior Administrator
    @Community Development Lead
    @Community Manager
    @Server Owner

Trace: A1B2C3D4
```

### Example: Command requires specific role [GK]

```
Permission Denied

Command: /accept

This command approves an application by short code, user mention, or user ID.

You need one of:
  @Gatekeeper (Gatekeeper)

Trace: E5F6G7H8
```

### Example: Owner-only command

```
Permission Denied

Command: /database

This command performs database diagnostics and recovery.

You need one of:
  Bot Owner or Server Dev

Trace: I9J0K1L2
```

---

## Technical Reference

### Source Files

| File | Purpose |
|------|---------|
| `src/lib/roles.ts` | Role constants, hierarchy, and permission helpers |
| `src/lib/config.ts` | Permission check functions (`requireMinRole`, `requireGatekeeper`, etc.) |
| `src/lib/permissionCard.ts` | Permission denied embed generation |

### Permission Check Functions

```typescript
// Hierarchical check - requires role X or higher
requireMinRole(interaction, ROLE_IDS.SENIOR_MOD, options)

// Exact role check - requires specific role(s) only
requireExactRoles(interaction, [ROLE_IDS.GATEKEEPER], options)

// Convenience functions
requireGatekeeper(interaction, commandName, description)
requireOwnerOnly(interaction, commandName, description)
requireArtist(interaction, commandName, description)
```

### Bypass Logic

The permission system always checks bypass conditions first:

1. **Bot Owner check** — If `userId === "697169405422862417"`, always pass
2. **Server Dev check** — If member has role `1120074045883420753`, always pass
3. **Then** apply the specific permission check

---

## Quick Reference Card

| Level | Notation | Example Commands |
|-------|----------|------------------|
| Public | Anyone | `/help`, `/health` |
| Gatekeeper | [GK] | `/accept`, `/reject`, `/kick`, `/search` |
| Gatekeeper+ | GK+ | `/modstats leaderboard` |
| Junior Mod+ | JM+ | `/flag`, `/isitreal` |
| Moderator+ | M+ | `/movie` |
| Senior Mod+ | SM+ | `/activity`, `/skullmode` |
| Administrator+ | A+ | `/config` |
| Senior Admin+ | SA+ | `/panic`, `/modstats reset` |
| Community Manager+ | CM+ | `/audit`, `/backfill`, `/gate setup` |
| Owner Only | [BO/SD] | `/database`, `/poke` |
| Discord Perm | ManageMessages | `/send`, `/purge` |
| Discord Perm | ManageRoles | `/roles`, `/artistqueue`, `/redeemreward` |
