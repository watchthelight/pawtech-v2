# Pawtropolis Tech - Slash Commands

This folder contains all Discord slash command implementations for the Pawtropolis Tech bot.

## 📁 Command Inventory

| Command      | File           | Purpose                                    | Permission Level   |
| ------------ | -------------- | ------------------------------------------ | ------------------ |
| `/gate`      | `gate.ts`      | Application submission and review workflow | Public + Moderator |
| `/config`    | `config.ts`    | Guild configuration management             | Administrator      |
| `/modstats`  | `modstats.ts`  | Moderator statistics and leaderboard       | Moderator          |
| `/flag`      | `flag.ts`      | Manual user flagging system                | Moderator          |
| `/send`      | `send.ts`      | Anonymous staff messages                   | Moderator          |
| `/update`    | `update.ts`    | Bot status/activity management             | Administrator      |
| `/database`  | `database.ts`  | Database backup and export                 | Administrator      |
| `/health`    | `health.ts`    | Bot diagnostics                            | Administrator      |
| `/analytics` | `analytics.ts` | Application analytics                      | Moderator          |
| `/sample`    | `sample.ts`    | Generate sample applications               | Administrator      |
| `/sync`      | `sync.ts`      | Banner synchronization                     | Administrator      |
| `/resetdata` | `resetdata.ts` | Reset database (destructive)               | Owner only         |

## 🏗️ Architecture

### Command Structure

Each command file exports a `SlashCommandBuilder` as `data` and an `execute` function:

```typescript
import { SlashCommandBuilder } from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("commandname")
  .setDescription("Command description")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(ctx: CommandContext): Promise<void> {
  // Command logic here
}
```

### Key Components

- **`buildCommands.ts`** - Command registration builder
- **`registry.ts`** - Command registry singleton
- **Command files** - Individual command implementations

### Command Context (`CommandContext`)

Commands receive a wrapped context object that provides:

- `interaction` - Discord.js interaction object
- `client` - Discord client instance
- Helper methods for common operations

Defined in: `src/lib/cmdWrap.ts`

## 🎯 Command Categories

### Application Review (`/gate`)

**Subcommands:**

- `/gate submit` - Submit application
- `/gate claim` - Claim application for review
- `/gate accept` - Accept application
- `/gate reject` - Reject application
- `/gate kick` - Kick user
- `/gate unclaim` - Unclaim application
- `/gate status` - Check application status
- `/gate review` - View application details
- `/gate questions` - Manage gate questions
- `/gate welcome` - Configure welcome message

**Database Tables:**

- `applications`
- `action_log`
- `gate_questions`

### Configuration (`/config`)

**Settings:**

- Reviewer role
- Applicant role
- Logging channel
- Review channel
- Welcome channel
- Gate questions

**Database Tables:**

- `guild_config`

### Moderation Tools

**`/flag`** - Manual user flagging

- Add/remove flags
- View flagged users
- Track flag history

**`/send`** - Send anonymous staff messages

- DM users as "Pawtropolis Staff"
- Log all sent messages

**`/modstats`** - Performance analytics

- Moderator leaderboard
- Response time metrics
- Action counts

### Administration

**`/database`** - Database management

- Backup database
- Export data as CSV
- View schema info

**`/health`** - Bot diagnostics

- Uptime
- Memory usage
- Database stats

**`/analytics`** - Application analytics

- Submission trends
- Approval rates
- Queue health

## 🔧 Common Patterns

### Permission Checks

```typescript
export const data = new SlashCommandBuilder()
  .setName("admin-command")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
```

### Deferred Responses

```typescript
export async function execute(ctx: CommandContext): Promise<void> {
  await ensureDeferred(ctx); // Auto-defer if needed

  // Long-running operation
  const result = await processData();

  await replyOrEdit(ctx, { content: result });
}
```

### Error Handling

```typescript
export async function execute(ctx: CommandContext): Promise<void> {
  try {
    // Command logic
    await ctx.interaction.reply({ content: "Success!" });
  } catch (error) {
    logger.error({ error }, "Command failed");
    await replyOrEdit(ctx, {
      content: "An error occurred",
      ephemeral: true,
    });
  }
}
```

### Database Access

```typescript
import { db } from "../lib/db.js";

const result = db
  .prepare(
    `
  SELECT * FROM applications WHERE user_id = ?
`
  )
  .get(userId);
```

### Logging

```typescript
import { logger } from "../lib/logger.js";

logger.info({ userId, guildId }, "User submitted application");
logger.warn({ error }, "Failed to process command");
logger.error({ error, stack: error.stack }, "Critical error");
```

## 📚 Key Dependencies

### Discord.js

```typescript
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
```

### Internal Utilities

```typescript
import { replyOrEdit, ensureDeferred } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { db } from "../lib/db.js";
import { requireEnv } from "../util/ensureEnv.js";
```

## 🧪 Testing

### Manual Testing

```bash
# Start bot in development
npm run dev

# In Discord, use slash commands
/gate submit
/config get
/health
```

### Unit Testing

```bash
# Run tests
npm test

# Run tests for specific command
npm test -- src/commands/gate.test.ts
```

## 🐛 Debugging

### Enable Debug Logging

```env
LOG_LEVEL=debug
```

### Common Issues

**"Missing Permissions"**

- Check bot has required permissions in guild
- Verify role hierarchy (bot role must be above managed roles)

**"Unknown Interaction"**

- Interaction took >3 seconds without deferring
- Use `ensureDeferred(ctx)` at start of command

**"Application command not found"**

- Run `npm run deploy:cmds` to register commands
- Wait 5-10 minutes for Discord cache to update

**"Database locked"**

- SQLite is locked by another process
- Check if multiple bot instances are running

## 📝 Adding a New Command

### 1. Create Command File

```bash
touch src/commands/mycommand.ts
```

### 2. Implement Command

```typescript
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { replyOrEdit, ensureDeferred } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("mycommand")
  .setDescription("What my command does")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(ctx: CommandContext): Promise<void> {
  await ensureDeferred(ctx);

  try {
    // Command logic here
    await replyOrEdit(ctx, {
      content: "Command executed successfully!",
    });

    logger.info(
      {
        userId: ctx.interaction.user.id,
        guildId: ctx.interaction.guildId,
      },
      "My command executed"
    );
  } catch (error) {
    logger.error({ error }, "My command failed");
    await replyOrEdit(ctx, {
      content: "An error occurred",
      ephemeral: true,
    });
  }
}
```

### 3. Register Command

Command is automatically registered by `buildCommands.ts` scanning the folder.

### 4. Deploy to Discord

```bash
npm run deploy:cmds
```

### 5. Test

Use the command in Discord and verify it works as expected.

## 🔒 Security Considerations

### Permission Levels

- **Public**: Anyone can use (e.g., `/gate submit`)
- **Moderator**: Requires reviewer role (e.g., `/gate accept`)
- **Administrator**: Requires admin permissions (e.g., `/config`)
- **Owner**: Requires bot owner ID (e.g., `/resetdata`)

### Input Validation

Always validate user input:

```typescript
if (!input || input.length > 1000) {
  return replyOrEdit(ctx, {
    content: "Invalid input",
    ephemeral: true,
  });
}
```

### Rate Limiting

Discord enforces rate limits:

- 5 interactions per 5 seconds per user
- Commands should complete within 3 seconds or use deferral

### Sensitive Data

Never log:

- Discord tokens
- User passwords
- Personal information (DMs, emails)

## 📊 Performance

### Command Response Times

- **Target**: <1 second for simple commands
- **Acceptable**: <3 seconds with deferral
- **Timeout**: 15 minutes (Discord limit)

### Database Queries

- Use prepared statements for security
- Add indexes for frequently queried columns
- Avoid N+1 queries in loops

### Memory Usage

- Avoid loading large datasets into memory
- Stream large responses when possible
- Clean up resources in finally blocks

## 🔗 Related Documentation

- [Architecture Overview](../../docs/context/02_System_Architecture_Overview.md)
- [Slash Commands Reference](../../docs/context/03_Slash_Commands_and_UX.md)
- [Database Schema](../../docs/context/07_Database_Schema_and_Migrations.md)
- [Contributing Guide](../../docs/CONTRIBUTING.md)

---

**Questions?** See [docs/CONTRIBUTING.md](../../docs/CONTRIBUTING.md) or open an issue.
