# Command Refactoring Checklist

Use this checklist when refactoring any command to ensure consistency across the codebase.

---

## File Header

Every command file must have a standardized header:

```typescript
/**
 * Pawtropolis Tech -- src/commands/{name}.ts
 * WHAT: Brief description (one line)
 * WHY: Purpose/motivation (one line)
 * FLOWS:
 *  - /{name} {subcommand} -> description
 *  - /{name} {subcommand2} -> description
 * DOCS:
 *  - https://relevant-link.com (if any)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
```

- [ ] WHAT comment present (brief description)
- [ ] WHY comment present (purpose/motivation)
- [ ] FLOWS comment lists all command paths
- [ ] DOCS comment with relevant links (optional)
- [ ] SPDX license identifier on line after header

---

## Imports

Required imports for instrumented commands:

```typescript
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import {
  withStep,
  withSql,           // If using database
  ensureDeferred,    // If deferring
  replyOrEdit,       // For deferred replies
  type CommandContext,
} from "../lib/cmdWrap.js";
import { requireMinRole, ROLE_IDS } from "../lib/config.js";  // If permission check
import { db } from "../db/db.js";  // If using database
```

- [ ] Import `CommandContext` from cmdWrap
- [ ] Import `withStep` from cmdWrap
- [ ] Import `withSql` if command uses database
- [ ] Import `ensureDeferred` if command defers
- [ ] Import `replyOrEdit` if command defers
- [ ] Import appropriate permission helper

---

## Execute Function Structure

```typescript
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // 1. Permission check (always first)
  if (!requireMinRole(interaction, ROLE_IDS.X, {...})) return;

  // 2. Route to handler
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "foo":
      await handleFoo(ctx);
      break;
    // ...
    default:
      await interaction.reply({ content: "Unknown subcommand.", flags: MessageFlags.Ephemeral });
  }
}
```

- [ ] Signature: `async function execute(ctx: CommandContext<ChatInputCommandInteraction>)`
- [ ] Extract interaction: `const { interaction } = ctx;`
- [ ] Permission check at TOP (before any routing)
- [ ] Use `switch` statement for subcommand routing (not if/else)
- [ ] Each case has `break` statement
- [ ] Default case handles unknown subcommand

---

## Handler Functions

```typescript
async function handleFoo(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // Use withStep for all phases...
}
```

- [ ] Signature: `async function handleX(ctx: CommandContext<...>)`
- [ ] Receives full `ctx` (NOT just `interaction`)
- [ ] Extracts interaction: `const { interaction } = ctx;`
- [ ] Uses `withStep()` for all logical phases
- [ ] Uses `withSql()` for all database operations
- [ ] Uses `ensureDeferred()` for operations >1 second
- [ ] Uses `replyOrEdit()` for responses after deferral

---

## Required withStep Phases

Wrap each logical section with `withStep`:

```typescript
await withStep(ctx, "phase_name", async () => {
  // ... phase logic
});
```

### Common Phases

| Phase Name | When to Use |
|------------|-------------|
| `parse_options` | Extracting multiple command options |
| `validate` | Validating input or permissions |
| `defer` | When deferring the interaction |
| `fetch_data` | Database reads, API calls |
| `process` | Business logic, calculations |
| `build_embed` | Building complex embeds |
| `reply` | Sending the response |
| `notify` | Sending notifications/logs |

- [ ] Permission check wrapped (or use `requireX` helper)
- [ ] Option parsing wrapped (if extracting multiple)
- [ ] Defer wrapped: `await withStep(ctx, "defer", async () => { await ensureDeferred(interaction); });`
- [ ] Each DB query in its own phase
- [ ] Reply wrapped in "reply" phase

---

## withSql Coverage

Wrap ALL database operations with `withSql`:

```typescript
const result = withSql(ctx, "SELECT * FROM table WHERE id = ?", () => {
  return db.prepare("SELECT * FROM table WHERE id = ?").get(id);
});
```

**Important:** The SQL string passed to `withSql` should match the actual query.

- [ ] All `db.prepare().get()` wrapped
- [ ] All `db.prepare().all()` wrapped
- [ ] All `db.prepare().run()` wrapped
- [ ] SQL string in `withSql()` matches actual query
- [ ] Transactions: wrap the entire transaction block

---

## Response Patterns

### Quick Operation (No Defer)
```typescript
await interaction.reply({
  content: "Done!",
  flags: MessageFlags.Ephemeral,  // For private response
});
```

### Long Operation (With Defer)
```typescript
await ensureDeferred(interaction);
// ... do work ...
await replyOrEdit(interaction, {
  content: "Done!",
});
```

- [ ] Use `ensureDeferred` for operations >1s
- [ ] Use `replyOrEdit` after deferring
- [ ] Ephemeral by default for mod commands
- [ ] Public for user-facing results

---

## Permission Helpers

Choose the right helper:

| Helper | Use Case |
|--------|----------|
| `requireStaff(interaction)` | Any staff member |
| `requireMinRole(interaction, ROLE_IDS.X, opts)` | Role X or above |
| `requireExactRoles(interaction, [...], opts)` | Specific roles only |
| `requireGatekeeper(interaction, cmd, desc)` | Gatekeeper role only |
| `requireArtist(interaction, cmd, desc)` | Artist or admin |
| `requireOwnerOnly(interaction, cmd, desc)` | Bot owner only |

- [ ] Permission check uses appropriate helper
- [ ] Permission check is at TOP of execute (before routing)
- [ ] Handler-level permission checks only for different levels per subcommand

---

## Subcommand Groups

For commands with subcommand groups (like `/config set mod_roles`):

```typescript
const subcommandGroup = interaction.options.getSubcommandGroup(false);
const subcommand = interaction.options.getSubcommand();
const routeKey = subcommandGroup ? `${subcommandGroup}:${subcommand}` : subcommand;

switch (routeKey) {
  case "set:mod_roles":
    await handleSetModRoles(ctx);
    break;
  // ...
}
```

- [ ] Extract both group and subcommand
- [ ] Create composite routeKey
- [ ] Use `group:subcommand` format in switch cases

---

## Verification

After refactoring, verify:

- [ ] `npm run check` passes (typecheck + lint + format + test)
- [ ] Command runs successfully in Discord
- [ ] All subcommands work
- [ ] Permission denial shows correct error
- [ ] Trigger an error → verify trace shows phases in error card

---

## Common Mistakes to Avoid

1. **Forgetting `break` in switch cases** - Causes fall-through bugs
2. **Passing `interaction` instead of `ctx` to handlers** - Loses instrumentation
3. **withSql string doesn't match actual query** - Confusing error context
4. **Not deferring long operations** - Causes timeout errors
5. **Permission check after routing** - Allows unauthorized path execution
6. **Missing default case in switch** - Silent failures for unknown subcommands

---

## Reference

- Template: `src/commands/_template.ts.example`
- Good examples: `health.ts`, `developer.ts`, `update.ts`
- Infrastructure: `src/lib/cmdWrap.ts`
- Permissions: `src/lib/config.ts`, `src/lib/roles.ts`
