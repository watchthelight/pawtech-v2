# Slash Commands and UX

## Complete Command Registry

All commands are guild-scoped and registered via `scripts/commands.ts` on deploy. Use `npm run commands` to sync with Discord.

### Core Commands

| Command             | Options                                       | Permissions    | Ephemeral | Description                                       |
| ------------------- | --------------------------------------------- | -------------- | --------- | ------------------------------------------------- |
| `/gate`             | _(modal: name, reason, age, referral)_        | Public         | Yes       | Submit join application; opens modal.             |
| `/accept`           | `app_id` (int), `reason` (string, optional)   | ManageMessages | Yes       | Approve application; DM user, grant role.         |
| `/reject`           | `app_id` (int), `reason` (string, optional)   | ManageMessages | Yes       | Reject application; DM user, optionally kick.     |
| `/kick`             | `user_id` (user), `reason` (string, optional) | KickMembers    | Yes       | Remove member; log action.                        |
| `/unclaim`          | `app_id` (int)                                | ManageMessages | Yes       | Release claimed application back to queue.        |
| `/health`           | _(none)_                                      | Public         | Yes       | Bot uptime, DB stats, last event timestamp.       |
| `/config`           | `action` (get/set), `key`, `value`            | Administrator  | Yes       | Manage guild config (e.g., logging channel).      |
| `/modmail`          | `action` (close/reopen), `thread_id`          | ManageMessages | Yes       | Close or reopen modmail thread.                   |
| `/analytics`        | `start_date`, `end_date`, `format` (text/csv) | ManageMessages | No        | Generate review/modmail analytics report.         |
| `/analytics-export` | `table` (choice), `format` (json/csv)         | Administrator  | Yes       | Export raw DB tables (review_action, action_log). |
| `/modstats`         | `mode` (leaderboard/user), `user_id`, `days`  | ManageMessages | No        | Show moderator KPIs or leaderboard.               |
| `/send`             | `channel`, `message`, `anonymous` (bool)      | Administrator  | Yes       | Send message to channel; optionally anonymous.    |
| `/flag`             | `user` (user), `reason` (string, optional)    | ManageGuild or Mod Role | Yes | Manually flag a user as a bot; posts alert to flags channel. |

## Interaction Lifecycles

### Modal-Based Submission (`/gate`)

```typescript
// Step 1: User invokes /gate
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'gate') return;

  // Step 2: Show modal
  const modal = new ModalBuilder()
    .setCustomId('gate_modal')
    .setTitle('Join Application')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('display_name')
          .setLabel('Display Name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('age')
          .setLabel('Age')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Why do you want to join?')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(50)
          .setRequired(true)
      )
    );

  await interaction.showModal(modal);
});

// Step 3: Handle modal submission
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== 'gate_modal') return;

  const name = interaction.fields.getTextInputValue('display_name');
  const age = parseInt(interaction.fields.getTextInputValue('age'));
  const reason = interaction.fields.getTextInputValue('reason');

  // Validation
  if (age < 18) {
    return interaction.reply({ content: 'Must be 18+.', ephemeral: true });
  }

  // Insert into DB
  const appId = db.prepare(`
    INSERT INTO review_action (user_id, display_name, age, reason, status, submitted_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(interaction.user.id, name, age, reason, new Date().toISOString()).lastInsertRowid;

  // Post review card
  await postReviewCard(appId);

  await interaction.reply({ content: 'Application submitted! We'll review soon.', ephemeral: true });
});
```

### Button Interaction (`[Claim]` on Review Card)

```typescript
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("claim_")) return;

  const appId = parseInt(interaction.customId.split("_")[1]);

  try {
    db.transaction(() => {
      const app = db.prepare("SELECT claimed_by FROM review_action WHERE id = ?").get(appId);
      if (app.claimed_by) throw new Error("Already claimed");

      db.prepare("UPDATE review_action SET claimed_by = ?, claimed_at = ? WHERE id = ?").run(
        interaction.user.id,
        new Date().toISOString(),
        appId
      );

      db.prepare(
        "INSERT INTO action_log (app_id, moderator_id, action, timestamp) VALUES (?, ?, ?, ?)"
      ).run(appId, interaction.user.id, "claim", new Date().toISOString());
    })();

    await logAction("claim", appId, interaction.user.id);
    await interaction.update({ components: [getClaimedButtons(appId)] });
    await interaction.followUp({ content: "Claimed! Use /accept or /reject.", ephemeral: true });
  } catch (error) {
    if (error.message === "Already claimed") {
      return interaction.reply({ content: "Already claimed by another mod.", ephemeral: true });
    }
    throw error;
  }
});
```

### Command with Options (`/accept`)

```typescript
// Command definition (scripts/commands.ts)
{
  name: 'accept',
  description: 'Approve application',
  defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
  options: [
    {
      name: 'app_id',
      type: ApplicationCommandOptionType.Integer,
      description: 'Application ID',
      required: true
    },
    {
      name: 'reason',
      type: ApplicationCommandOptionType.String,
      description: 'Optional reason for acceptance',
      required: false
    }
  ]
}

// Handler (src/commands/gate.ts)
if (interaction.commandName === 'accept') {
  const appId = interaction.options.getInteger('app_id', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';

  const app = db.prepare('SELECT * FROM review_action WHERE id = ?').get(appId);

  // Validate claim ownership
  if (app.claimed_by !== interaction.user.id) {
    return interaction.reply({ content: 'You must claim this application first.', ephemeral: true });
  }

  // Update status
  db.prepare('UPDATE review_action SET status = ?, decided_at = ? WHERE id = ?')
    .run('accepted', new Date().toISOString(), appId);

  // Insert action log
  db.prepare('INSERT INTO action_log (app_id, moderator_id, action, reason, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(appId, interaction.user.id, 'accept', reason, new Date().toISOString());

  // Send DM
  const user = await client.users.fetch(app.user_id);
  await user.send('Congratulations! Your application has been approved. Welcome to Pawtropolis!');

  // [Known Issue] Pretty card sometimes not posted
  await logAction('accept', appId, interaction.user.id, reason);

  await interaction.reply({ content: `Application #${appId} accepted.`, ephemeral: true });
}
```

## Ephemeral vs. Public Responses

**Ephemeral (visible only to invoker)**:

- All error messages (`'Already claimed'`, `'Must be 18+'`)
- Confirmation messages (`'Application submitted'`, `'Claimed!'`)
- Admin commands (`/config`, `/send`)
- Sensitive data (`/analytics-export` with raw user IDs)

**Public (visible to channel)**:

- `/modstats` leaderboard (transparency)
- `/analytics` summary (team visibility)

**Implementation**:

```typescript
// Ephemeral
await interaction.reply({ content: "Done!", ephemeral: true });

// Public
await interaction.reply({ content: "Server maintenance at 3 PM." }); // ephemeral: false (default)
```

### When to Use Ephemeral vs Public Replies

**Use Ephemeral (`ephemeral: true`) for:**
- **Errors** - Validation failures, permission denials, invalid input
  - Keeps channel clean and avoids distracting the team
  - Example: "This command can only be used in a server."

- **User Confirmations** - Personal acknowledgments with no team value
  - Example: "Suggestion submitted!" (after /suggest)

- **Status Queries** - Read-only information requests
  - Example: "Panic mode is OFF" (after /panic status)

- **Privacy-Critical** - Commands that must hide the actor
  - Example: "Sent!" (after /send)

**Use Public (`ephemeral: false`) for:**
- **Moderation Actions** - Team needs audit trail and visibility
  - Example: "User X has been unblocked" (after /unblock)
  - Example: "PANIC MODE ENABLED" (after /panic on)

- **Team Reports** - Analytics, stats, heatmaps for shared review
  - Example: Activity heatmap embed (after /activity)
  - Example: Moderator leaderboard (after /modstats)

- **Long-Running Jobs** - Notifications about background tasks
  - Example: "Starting backfill... you'll be pinged when complete" (after /backfill)

**Default Behavior:**
- `ephemeral` defaults to `false` if omitted
- **Always be explicit** - don't rely on defaults for clarity
- Deferred replies inherit ephemeral state from `deferReply()`

**Example Pattern:**
```typescript
// Validation error - ephemeral
if (!interaction.guild) {
  await interaction.reply({
    content: "This command can only be used in a server.",
    ephemeral: true,
  });
  return;
}

// Moderation action - public
await interaction.deferReply({ ephemeral: false });
await performUnblock(userId);
await interaction.editReply({
  content: `User <@${userId}> has been unblocked.`,
});

// Status query - ephemeral
const status = getPanicStatus(guildId);
await interaction.reply({
  content: status.enabled ? "Panic mode is ACTIVE" : "Panic mode is OFF",
  ephemeral: true,
});
```

## Permission Checks and Owner Overrides

### Discord Permission Levels

```typescript
// Command-level permissions (defaultMemberPermissions)
{
  name: 'config',
  defaultMemberPermissions: PermissionFlagsBits.Administrator
}

// Runtime permission checks
if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
  return interaction.reply({ content: 'Missing permissions.', ephemeral: true });
}
```

### Owner Override System

```typescript
// Environment variable: OWNER_IDS=123456789,987654321
const OWNER_IDS = process.env.OWNER_IDS?.split(",") || [];

function isOwner(userId: string): boolean {
  return OWNER_IDS.includes(userId);
}

// Usage in commands
if (
  !interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
  !isOwner(interaction.user.id)
) {
  return interaction.reply({ content: "Admin only.", ephemeral: true });
}
```

**Owner Capabilities**:

- Bypass all permission checks
- Access `/analytics-export` (raw data export)
- Use `/send` with `anonymous: true`
- Modify guild config via `/config set`

## Command Registration Strategy

### Guild-Scoped Registration

**Why Guild-Scoped**:

- Instant updates (no 1h global cache delay)
- Faster iteration during development
- Per-guild permission customization

**Registration Script** (`scripts/commands.ts`):

```typescript
import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
config();

const commands = [
  { name: 'gate', description: 'Submit join application' },
  { name: 'accept', description: 'Approve application', options: [...] },
  // ... all other commands
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
  try {
    console.log('Registering guild commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID!),
      { body: commands }
    );
    console.log(`✅ Registered ${commands.length} commands.`);
  } catch (error) {
    console.error('❌ Command registration failed:', error);
    process.exit(1);
  }
})();
```

**Run on Deploy**:

```bash
npm run commands  # tsx scripts/commands.ts
```

### Gotchas and Edge Cases

| Issue                             | Cause                                      | Fix                                                                           |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| Command not visible in Discord    | Per-channel disable in Integrations        | Server Settings → Integrations → Enable                                       |
| Changes not reflected             | Forgot to run `npm run commands`           | Re-sync after editing command definitions                                     |
| Duplicate global + guild commands | Registered both; guild takes precedence    | Clear globals: `rest.put(Routes.applicationCommands(clientId), { body: [] })` |
| Permission errors on invocation   | `defaultMemberPermissions` too restrictive | Lower permission level or use owner override                                  |

## UX Best Practices

### 1. Always Use Ephemeral for Errors

```typescript
// ❌ Bad: Public error (clutters channel)
await interaction.reply({ content: "Error: Invalid app ID." });

// ✅ Good: Ephemeral error (private to user)
await interaction.reply({ content: "Error: Invalid app ID.", ephemeral: true });
```

### 2. Disable Buttons After Action

```typescript
const button = ButtonBuilder.from(interaction.component).setDisabled(true);
await interaction.update({ components: [new ActionRowBuilder().addComponents(button)] });
```

### 3. Use Embeds for Rich Responses

```typescript
const embed = new EmbedBuilder()
  .setTitle("Application #123")
  .setColor(0x2ecc71)
  .addFields(
    { name: "Status", value: "Accepted", inline: true },
    { name: "Moderator", value: `<@${modId}>`, inline: true }
  )
  .setTimestamp();

await interaction.reply({ embeds: [embed], ephemeral: true });
```

### 4. Provide Next Steps in Confirmations

```typescript
// ❌ Vague
await interaction.reply({ content: "Done.", ephemeral: true });

// ✅ Actionable
await interaction.reply({
  content: "Claimed! Next: Use `/accept <id>` or `/reject <id>` to decide.",
  ephemeral: true,
});
```

## Actionable Recommendations

### Command Improvements

1. **Add autocomplete** to `/accept` and `/reject` for `app_id` (query pending applications).
2. **Implement confirmation prompts** for destructive actions (`/kick`, `/reject` with auto-kick).
3. **Expand `/config`** to support bulk operations (`/config export` → JSON, `/config import`).

### UX Enhancements

1. **Show user context** in `/modstats user` (e.g., display avatar, join date, current roles).
2. **Add pagination** to `/analytics` for large date ranges (Discord embed field limits).
3. **Improve error messages**: Include app ID, moderator, timestamp in all error responses.

### Permission Hardening

1. **Audit all commands** for permission leaks (e.g., public commands exposing sensitive data).
2. **Log permission override usage**: Track when owners bypass permission checks (audit trail).
3. **Implement rate limiting** on `/gate` (1 submission per user per 24h).

### Registration Automation

1. **Auto-sync on deploy**: Add `npm run commands` to deployment script (systemd `ExecStartPre`).
2. **Validate command definitions**: Pre-flight checks for missing descriptions, invalid option types.
3. **Support multi-guild**: Parameterize `GUILD_ID` for dev/staging/prod environments.
