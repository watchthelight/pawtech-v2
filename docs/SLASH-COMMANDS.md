# Slash Command System Documentation

> **For future Claude instances**: This document explains exactly how to create, register, and deploy slash commands in Pawtropolis Tech.

## Quick Reference

**To create a new command:**
1. Create file in `src/commands/mycommand.ts`
2. Export `data` (SlashCommandBuilder) and `execute` (async function)
3. Register in `src/commands/buildCommands.ts` (import + add to array)
4. Register in `src/index.ts` (import + add to `commands` Collection)
5. Run `npm run build && npm run deploy:cmds`

---

## 1. Command File Structure

### Minimum Required Exports

Every slash command file must export:

```typescript
// src/commands/example.ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type CommandContext } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("example")
  .setDescription("Example command");

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await interaction.reply({ content: "Hello!" });
}
```

### Optional Exports

```typescript
// For alternative commands (e.g., /accept as alias for /gate accept)
export const acceptData: SlashCommandBuilder;
export async function executeAccept(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void>;

// For autocomplete handling
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void>;

// For button interactions
export async function handleButton(interaction: ButtonInteraction): Promise<void>;

// For modal submissions
export async function handleModal(interaction: ModalSubmitInteraction): Promise<void>;
```

### File Header Convention

```typescript
/**
 * Pawtropolis Tech — src/commands/example.ts
 * WHAT: Brief description of command
 * WHY: Purpose/motivation
 * FLOWS:
 *  - Flow 1 description
 *  - Flow 2 description
 */
```

---

## 2. Command Organization Patterns

### Simple Commands (Single File)

For straightforward commands with no subcommands:

```
src/commands/health.ts      # Direct exports: data, execute
src/commands/flag.ts
src/commands/ping.ts
```

### Commands with Subcommands (Index Pattern)

For complex commands with multiple subcommands, use a directory with `index.ts`:

```
src/commands/stats/
├── index.ts          # Main execute router + re-exports
├── data.ts           # SlashCommandBuilder with all subcommands
├── activity.ts       # Handler: handleActivity()
├── leaderboard.ts    # Handler: handleLeaderboard()
├── user.ts           # Handler: handleUser()
└── shared.ts         # Shared utilities
```

**index.ts pattern:**
```typescript
// src/commands/stats/index.ts
export { data } from "./data.js";
import { handleActivity } from "./activity.js";
import { handleLeaderboard } from "./leaderboard.js";

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const subcommand = ctx.interaction.options.getSubcommand();

  switch (subcommand) {
    case "activity":
      await handleActivity(ctx);
      break;
    case "leaderboard":
      await handleLeaderboard(ctx);
      break;
    default:
      await ctx.interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  }
}
```

### Commands with Alternative Entry Points (Barrel Pattern)

For commands like `/gate` that have shortcut commands (`/accept`, `/reject`):

```
src/commands/gate/
├── gateMain.ts       # Main /gate command: data, execute
├── accept.ts         # /accept shortcut: acceptData, executeAccept
├── reject.ts         # /reject shortcut: rejectData, executeReject
└── shared.ts         # Shared utilities

src/commands/gate.ts  # Barrel file re-exporting everything
```

**Barrel file:**
```typescript
// src/commands/gate.ts
export { data, execute, handleResetModal } from "./gate/gateMain.js";
export { acceptData, executeAccept } from "./gate/accept.js";
export { rejectData, executeReject } from "./gate/reject.js";
```

---

## 3. Registration (Two Required Locations)

### 3.1 Register in buildCommands.ts

**File:** `src/commands/buildCommands.ts`

This file builds the array of command JSON sent to Discord's API.

```typescript
// Import your command's data export
import { data as mycommandData } from "./mycommand.js";

export function buildCommands() {
  return [
    // ... existing commands
    mycommandData.toJSON(),  // Add your command
  ];
}
```

**For commands with alternatives:**
```typescript
import { data as gateData, acceptData, rejectData } from "./gate.js";

export function buildCommands() {
  return [
    gateData.toJSON(),
    acceptData.toJSON(),   // /accept shortcut
    rejectData.toJSON(),   // /reject shortcut
  ];
}
```

### 3.2 Register in index.ts

**File:** `src/index.ts`

This file maps command names to their execute functions.

```typescript
// Import command module
import * as mycommand from "./commands/mycommand.js";

// In the command setup section:
commands.set(mycommand.data.name, wrapCommand("mycommand", mycommand.execute));
```

**For commands with alternatives:**
```typescript
import * as gate from "./commands/gate.js";

commands.set(gate.data.name, wrapCommand("gate", gate.execute));
commands.set(gate.acceptData.name, wrapCommand("accept", gate.executeAccept));
commands.set(gate.rejectData.name, wrapCommand("reject", gate.executeReject));
```

---

## 4. Deployment

### Manual Deployment (Recommended)

```bash
npm run build          # Compile TypeScript
npm run deploy:cmds    # Deploy to all guilds
```

### How Deployment Works

**Script:** `scripts/deploy-commands.ts`

1. Loads command builders via `buildCommands()`
2. Serializes to JSON with `.toJSON()`
3. Logs into Discord with minimal permissions
4. For each guild the bot is in:
   - PUTs commands to `Routes.applicationGuildCommands(appId, guildId)`
   - Verifies critical commands have required options
   - Retries on failure (wipes and re-syncs)
5. Rate limited at 750ms between guilds

### Runtime Auto-Sync

Commands also sync automatically:
- **On bot startup:** `syncCommandsToGuild()` called for all guilds
- **On guild join:** `syncCommandsToGuild()` called for new guild
- **On guild leave:** Commands cleared for that guild

---

## 5. Command Execution Flow

### Interaction Routing (src/index.ts)

```typescript
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const executor = commands.get(interaction.commandName);
    if (!executor) {
      await interaction.reply({ content: "Unknown command.", ephemeral: true });
      return;
    }
    await executor(interaction);  // Wrapped with wrapCommand()
  }
  // ... button, modal, autocomplete routing
});
```

### CommandContext (src/lib/cmdWrap.ts)

Every command receives a `CommandContext` instead of raw interaction:

```typescript
export type CommandContext<I extends InstrumentedInteraction> = {
  interaction: I;              // The Discord interaction
  step: (phase: string) => void;  // Mark execution phase
  currentPhase: () => string;     // Get current phase
  setLastSql: (sql: string | null) => void;  // Track SQL for errors
  getTraceId: () => string;       // Get trace ID
  readonly traceId: string;       // Unique trace ID
};
```

### wrapCommand() Provides

- Sentry error tracking with breadcrumbs
- Execution phase tracking via `.step()`
- SQL tracking via `.setLastSql()` / `withSql()`
- WideEvent emission for observability
- Automatic error card posting on failures
- Execution time measurement

---

## 6. Helper Patterns

### withStep() - Execution Phases

```typescript
import { withStep } from "../lib/cmdWrap.js";

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  await withStep(ctx, "validate", async () => {
    // Validation logic
  });

  await withStep(ctx, "db_query", async () => {
    // Database operations
  });

  await withStep(ctx, "reply", async () => {
    await ctx.interaction.reply({ content: "Done!" });
  });
}
```

### withSql() - SQL Tracking

```typescript
import { withSql } from "../lib/cmdWrap.js";
import { db } from "../db/db.js";

const user = withSql(ctx, "SELECT * FROM users WHERE id = ?", () => {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
});
```

### Permission Checks

```typescript
import { requireStaff, requireAdminOrLeadership } from "../lib/config.js";

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  if (!requireStaff(ctx.interaction)) return;  // Early exit if not staff
  // ... command logic
}
```

### Safe Reply Helpers

```typescript
import { ensureDeferred, replyOrEdit } from "../lib/cmdWrap.js";

// For long operations (>3 seconds)
await ensureDeferred(ctx.interaction);
// ... slow work
await replyOrEdit(ctx.interaction, { content: "Done!" });
```

---

## 7. Interaction Handlers (Buttons, Modals, etc.)

### Button Routing

Buttons are routed by regex matching on `customId` in `src/index.ts`:

```typescript
if (interaction.isButton()) {
  const { customId } = interaction;

  if (customId.match(/^v1:decide:(approve|reject|kick):code([0-9A-F]{6})$/)) {
    await handleReviewDecision(interaction);
  } else if (customId.startsWith("v1:modmail:open:")) {
    await handleModmailOpen(interaction);
  }
  // ... more patterns
}
```

**CustomId Convention:** `v1:feature:action:context`
- `v1:` - Version prefix for future compatibility
- `feature:` - Feature area (decide, modmail, help, etc.)
- `action:` - What happens (approve, open, close, etc.)
- `context` - Identifier (code, userId, etc.)

### Modal Routing

**File:** `src/lib/modalPatterns.ts`

```typescript
export type ModalRoute =
  | { type: "gate_submit_page"; sessionId: string; pageIndex: number }
  | { type: "review_reject"; code: string }
  | { type: "review_accept"; code: string }
  // ... more types

export function identifyModalRoute(customId: string): ModalRoute | null {
  // Pattern matching logic
}
```

**In index.ts:**
```typescript
if (interaction.isModalSubmit()) {
  const route = identifyModalRoute(interaction.customId);
  if (route?.type === "review_reject") {
    await handleReviewRejectModal(interaction, route.code);
  }
  // ... more routing
}
```

### Autocomplete Routing

```typescript
if (interaction.isAutocomplete()) {
  const { commandName } = interaction;
  if (commandName === "help") {
    await help.handleAutocomplete(interaction);
  }
}
```

---

## 8. Critical Rules & Gotchas

### 3-Second SLA

Discord requires first response within 3 seconds or returns error 10062.

```typescript
// For operations that might take >3 seconds:
await interaction.deferReply({ ephemeral: true });
// ... slow work
await interaction.editReply({ content: "Done!" });
```

A watchdog timer at 2500ms auto-defers if you forget.

### Ephemeral by Default for Staff Commands

Most moderator commands should be ephemeral:

```typescript
await interaction.reply({
  content: "Action taken.",
  flags: MessageFlags.Ephemeral
});
```

### Import Extensions (.js)

Always use `.js` extensions in imports (ESM requirement):

```typescript
import { data } from "./mycommand.js";  // ✅ Correct
import { data } from "./mycommand";     // ❌ Wrong
```

### HEX6 Code Pattern

Application/session references use 6-character uppercase hex codes:

```typescript
const code = shortCode(applicationId);  // Returns e.g., "98FF66"
const customId = `v1:decide:approve:code${code}`;
```

### Embed Context in CustomIds

When creating modals/buttons that need context on callback:

```typescript
// Creating modal
const modal = new ModalBuilder()
  .setCustomId(`v1:modal:reject:code${appCode}`)  // Embed code
  .setTitle("Reject Application");

// On submission, parse customId to recover appCode
```

---

## 9. File Reference

### Core Files

| File | Purpose |
|------|---------|
| `src/commands/buildCommands.ts` | Builds command JSON array for deployment |
| `src/commands/registry.ts` | Wrapper around buildCommands() |
| `src/commands/sync.ts` | Runtime guild sync functions |
| `src/index.ts` | Main bot, interaction routing, command mapping |
| `src/lib/cmdWrap.ts` | wrapCommand(), CommandContext, withStep, withSql |
| `src/lib/modalPatterns.ts` | Modal/button customId patterns and routing |
| `src/lib/config.ts` | Permission helpers, guild config access |
| `scripts/deploy-commands.ts` | Manual deployment script |

### Example Commands

| Command | Type | Files |
|---------|------|-------|
| `/health` | Simple | `src/commands/health.ts` |
| `/stats` | Subcommands | `src/commands/stats/` directory |
| `/gate` | Alternatives | `src/commands/gate/` + `src/commands/gate.ts` barrel |
| `/config` | Complex | `src/commands/config/` (40+ subcommands) |
| `/help` | Autocomplete | `src/commands/help/` with `autocomplete.ts` |

---

## 10. New Command Checklist

- [ ] Create command file: `src/commands/mycommand.ts`
- [ ] Export `data` (SlashCommandBuilder)
- [ ] Export `execute` (async function with CommandContext)
- [ ] Import in `src/commands/buildCommands.ts`
- [ ] Add to `buildCommands()` array with `.toJSON()`
- [ ] Import in `src/index.ts`
- [ ] Add to `commands` Collection with `wrapCommand()`
- [ ] If buttons/modals: add routing patterns to `index.ts`
- [ ] Run `npm run build` to verify TypeScript compiles
- [ ] Run `npm run deploy:cmds` to deploy
- [ ] Update CHANGELOG.md
- [ ] Update BOT-HANDBOOK.md if user-facing

---

## 11. Troubleshooting

### Command not appearing in Discord
1. Check `buildCommands.ts` - is the command imported and added?
2. Run `npm run deploy:cmds` - did it succeed for your guild?
3. Check the guild ID in deployment output

### "Unknown command" error at runtime
1. Check `index.ts` - is the command in the `commands` Collection?
2. Verify the name matches between `data.setName()` and `commands.set()`

### 10062 "Unknown interaction" error
- Command took >3 seconds without deferring
- Add `await interaction.deferReply()` early in execute

### 40060 "Already acknowledged" error
- Tried to reply after already replying/deferring
- Use `replyOrEdit()` helper or check `interaction.replied`/`interaction.deferred`

### Button/modal not responding
1. Check customId pattern matches routing regex in `index.ts`
2. Verify handler is imported and called
3. Check for typos in customId format

---

## 12. Statistics (Current)

- **Total slash commands:** 30+
- **Total subcommands:** 100+
- **Commands with subcommand groups:** 4
- **Commands with autocomplete:** 1 (/help)
- **Button patterns:** 15+
- **Modal types:** 6
- **Context menus:** 1
