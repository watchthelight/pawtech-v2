---
title: "Slash Commands Registry and Permissions"
slug: "14_Slash_Commands_Registry_and_Permissions"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Platform"
audience: "Engineers • Moderators • Administrators"
source_of_truth: ["src/commands/", "src/commands/registry.ts", "Discord.js SlashCommandBuilder"]
related:
  - "03_Slash_Commands_and_UX"
  - "16_Security_Secrets_and_Access_Control"
summary: "Complete registry of all slash commands with required permissions, environment variable guards, usage examples, and deployment procedures."
---

## Purpose & Outcomes

Provide comprehensive command reference including:
- Full list of all slash commands with descriptions
- Required Discord permissions per command
- Environment variable dependencies
- Permission level requirements (admin/moderator/user)
- Command deployment procedures
- Usage examples with expected outputs

## Scope & Boundaries

### In Scope
- All slash commands (`/gate`, `/modstats`, `/config`, etc.)
- Discord permission requirements (`ManageGuild`, `KickMembers`, etc.)
- Role-based access control (`ADMIN_ROLE_ID`, mod roles)
- Environment variable guards
- Command registration and deployment
- Error handling for permission failures

### Out of Scope
- Context menu commands (right-click actions)
- Message commands (prefix-based, deprecated)
- Buttons and modals (covered in other docs)

## Current State

**Total Commands**: 14 registered slash commands

**Command Files**: Located in [src/commands/](../src/commands/)

**Registry**: [src/commands/registry.ts](../src/commands/registry.ts)

**Deployment**: Via `npm run deploy:cmds` (uses Discord REST API)

**Permission Model**:
- **Admin**: `ManageGuild` permission OR `ADMIN_ROLE_ID` role
- **Moderator**: `mod_role_ids` in `guild_config` OR reviewer permissions
- **User**: Any guild member

## Key Flows

### Command Registration Flow
```
1. Build command definitions (SlashCommandBuilder)
2. Deploy to Discord API (global or guild-specific)
3. Bot receives interaction
4. Check permissions (Discord + custom)
5. Execute command handler
6. Reply to interaction (ephemeral or public)
```

### Permission Check Flow
```
1. Interaction received
2. Check Discord default permissions (ManageGuild, etc.)
3. Check custom role IDs (ADMIN_ROLE_ID, mod_role_ids)
4. If unauthorized: Reply with error (ephemeral)
5. If authorized: Execute command
```

## Commands & Snippets

### Complete Command Registry

#### Administrative Commands

##### `/gate setup`
**Description**: Initialize guild configuration with channels and roles
**Permission**: `ManageGuild` OR `ADMIN_ROLE_ID`
**Env Requirements**: None
**Usage**:
```
/gate setup review_channel:#staff-review gate_channel:#gate general_channel:#general accepted_role:@Verified
```
**File**: [src/commands/gate.ts](../src/commands/gate.ts)

##### `/gate reset`
**Description**: Reset gate configuration (requires password)
**Permission**: `ManageGuild` OR `ADMIN_ROLE_ID`
**Env Requirements**: `RESET_PASSWORD`
**Usage**:
```
/gate reset password:<secret>
```

##### `/resetdata`
**Description**: Reset metrics epoch and clear cached metrics
**Permission**: `ManageGuild` OR `ADMIN_ROLE_ID`
**Env Requirements**: `RESET_PASSWORD`
**Usage**:
```
/resetdata password:<secret>
```
**File**: [src/commands/resetdata.ts](../src/commands/resetdata.ts)

##### `/config get`
**Description**: View current guild configuration
**Permission**: Reviewer OR `ManageGuild`
**Usage**:
```
/config get setting:logging
/config get setting:mod_role_ids
```
**File**: [src/commands/config.ts](../src/commands/config.ts)

##### `/config set`
**Description**: Update guild configuration
**Permission**: `ManageGuild` OR `ADMIN_ROLE_ID`
**Usage**:
```
/config set logging channel:#logs
/config set mod_role_ids roles:@Mod,@Admin
```

##### `/database check`
**Description**: Run database integrity check
**Permission**: `ManageGuild`
**Usage**:
```
/database check
```
**File**: [src/commands/database.ts](../src/commands/database.ts)

#### Moderation Commands

##### `/accept`
**Description**: Approve applicant and assign verified role
**Permission**: Reviewer OR `ManageGuild`
**Usage**:
```
/accept user:@applicant reason:"Meets all requirements"
```
**File**: Handled by interaction handlers in [src/features/review.ts](../src/features/review.ts)

##### `/reject`
**Description**: Reject application with reason
**Permission**: Reviewer OR `ManageGuild`
**Usage**:
```
/reject user:@applicant reason:"Account too new"
```

##### `/kick`
**Description**: Reject and remove from guild
**Permission**: Reviewer OR `ManageGuild` + `KickMembers`
**Discord Perm**: `KickMembers`
**Usage**:
```
/kick user:@applicant reason:"Spam account"
```

##### `/flag`
**Description**: Mark user's avatar as manually reviewed/safe
**Permission**: Reviewer OR `ManageGuild`
**Usage**:
```
/flag user:@applicant reason:"False positive scan"
```
**File**: [src/commands/flag.ts](../src/commands/flag.ts)

#### Analytics Commands

##### `/modstats`
**Description**: View personal moderator performance statistics
**Permission**: Reviewer (self-serve) OR Admin (view others)
**Usage**:
```
/modstats
/modstats moderator:@ModName
```
**File**: [src/commands/modstats.ts](../src/commands/modstats.ts)

##### `/modstats leaderboard`
**Description**: View top 10 moderators by accepts
**Permission**: Reviewer OR `ManageGuild`
**Usage**:
```
/modstats leaderboard
```

##### `/modstats export`
**Description**: Export metrics to CSV
**Permission**: `ManageGuild` OR `ADMIN_ROLE_ID`
**Usage**:
```
/modstats export
```

#### Utility Commands

##### `/send`
**Description**: Send message as bot to specified channel
**Permission**: `ManageGuild` OR `ADMIN_ROLE_ID`
**Usage**:
```
/send channel:#announcements message:"Server maintenance tonight at 10 PM"
```
**File**: [src/commands/send.ts](../src/commands/send.ts)

##### `/health`
**Description**: Check bot health status (uptime, latency, database)
**Permission**: Reviewer OR `ManageGuild`
**Usage**:
```
/health
```
**File**: [src/commands/health.ts](../src/commands/health.ts)

##### `/sample`
**Description**: Generate sample review card for testing
**Permission**: Reviewer OR `ManageGuild`
**Usage**:
```
/sample
```
**File**: [src/commands/sample.ts](../src/commands/sample.ts)

### Permission Helper Functions

```typescript
// File: src/lib/config.ts
export function canRunAllCommands(member: GuildMember, guildId: string): boolean {
  // Check if user has admin role from env
  const adminRoleIds = (process.env.ADMIN_ROLE_ID || "").split(",").filter(Boolean);
  if (adminRoleIds.some(roleId => member.roles.cache.has(roleId))) {
    return true;
  }

  return false;
}

export function hasManageGuild(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

export function isReviewer(guildId: string, member: GuildMember): boolean {
  const config = getConfig(guildId);
  if (!config || !config.mod_role_ids) return false;

  const modRoleIds = config.mod_role_ids.split(",").filter(Boolean);
  return modRoleIds.some(roleId => member.roles.cache.has(roleId));
}
```

### Command Deployment

#### Deploy All Commands
```bash
# Deploy to specific guild (fast, instant updates)
npm run deploy:cmds

# Deploy globally (slow, up to 1 hour propagation)
npm run deploy:cmds -- --global
```

#### Deploy Single Command
```bash
# Edit src/commands/deploy-commands.ts to comment out unwanted commands
# Then run:
npm run deploy:cmds
```

#### Verify Deployment
```bash
# Check Discord for registered commands
# In Discord: Type / and see command list

# Check logs
npm run deploy:cmds 2>&1 | grep "Successfully registered"
```

## Interfaces & Data

### Command Structure (TypeScript)
```typescript
// File: src/commands/example.ts
import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("example")
  .setDescription("Example command description")
  .addStringOption(option =>
    option
      .setName("input")
      .setDescription("Input parameter")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);  // Discord permission

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Permission check
  const member = interaction.member as GuildMember;
  if (!hasManageGuild(member) && !canRunAllCommands(member, interaction.guildId!)) {
    await interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true
    });
    return;
  }

  // Command logic
  await interaction.reply({
    content: "✅ Command executed successfully.",
    ephemeral: true
  });
}
```

### Permission Matrix

| Command | Discord Perm | Custom Role | Env Var |
|---------|-------------|-------------|---------|
| `/gate setup` | `ManageGuild` | `ADMIN_ROLE_ID` | - |
| `/gate reset` | `ManageGuild` | `ADMIN_ROLE_ID` | `RESET_PASSWORD` |
| `/resetdata` | `ManageGuild` | `ADMIN_ROLE_ID` | `RESET_PASSWORD` |
| `/accept` | - | `mod_role_ids` | - |
| `/reject` | - | `mod_role_ids` | - |
| `/kick` | `KickMembers` | `mod_role_ids` | - |
| `/flag` | - | `mod_role_ids` | - |
| `/modstats` | - | `mod_role_ids` (self) | - |
| `/modstats export` | `ManageGuild` | `ADMIN_ROLE_ID` | - |
| `/config get` | - | `mod_role_ids` | - |
| `/config set` | `ManageGuild` | `ADMIN_ROLE_ID` | - |
| `/send` | `ManageGuild` | `ADMIN_ROLE_ID` | - |
| `/health` | - | `mod_role_ids` | - |
| `/sample` | - | `mod_role_ids` | - |
| `/database check` | `ManageGuild` | - | - |

## Ops & Recovery

### Fixing Missing Commands
```bash
# 1. Check if commands are registered
# In Discord: Type / and look for commands

# 2. If missing, redeploy
npm run deploy:cmds

# 3. Check logs for errors
cat logs/deploy-commands.log

# 4. Verify CLIENT_ID is correct
echo $CLIENT_ID
```

### Debugging Permission Errors
```bash
# 1. Check PM2 logs for permission denials
pm2 logs pawtropolis | grep "permission"

# 2. Verify role IDs in guild_config
sqlite3 data/data.db "SELECT mod_role_ids FROM guild_config WHERE guild_id='<GUILD_ID>'"

# 3. Verify env vars are set
echo $ADMIN_ROLE_ID
echo $RESET_PASSWORD
```

## Security & Privacy

### Password-Protected Commands
- `/gate reset`: Requires `RESET_PASSWORD` env var
- `/resetdata`: Requires `RESET_PASSWORD` env var
- Both use timing-safe password comparison (`crypto.timingSafeEqual`)

### Ephemeral Responses
Commands with sensitive data use `ephemeral: true`:
- `/resetdata` (password input)
- `/config get` (may contain sensitive IDs)
- Permission denial errors

## FAQ / Gotchas

**Q: Why aren't commands showing up?**
A: Run `npm run deploy:cmds`. Commands can take up to 1 hour to propagate globally (instant for guild-specific).

**Q: Can I disable a command?**
A: Yes, comment out the command in `src/commands/registry.ts` and redeploy.

**Q: How do I add a new command?**
A:
1. Create `src/commands/mynewcmd.ts`
2. Export `data` and `execute`
3. Add to `src/commands/registry.ts`
4. Run `npm run deploy:cmds`

**Q: What's the difference between Discord permissions and custom roles?**
A: Discord permissions (e.g., `ManageGuild`) are built-in. Custom roles (e.g., `mod_role_ids`) are configured per-guild in the database.

## Changelog

- 2025-10-30: Initial creation with complete command registry
