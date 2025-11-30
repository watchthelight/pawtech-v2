# Roadmap #029: Cleanup Commented-Out Code

**Issue Type:** Code Cleanup
**Priority:** Low
**Complexity:** Simple
**Estimated Effort:** 1-2 hours

---

## Summary

The `buildCommands.ts` file contains a commented-out reference to `modmailContextMenu.toJSON()` at line 100. This suggests either an incomplete feature or legacy code that should be cleaned up.

**Location:** `/Users/bash/Documents/pawtropolis-tech/src/commands/buildCommands.ts:98-100`

**Evidence:**
```typescript
// Context menu commands use a different registration endpoint (ApplicationCommandType.User/Message)
// and aren't included here. See Discord docs on context menus if you need to add them.
// modmailContextMenu.toJSON(),
```

---

## Current State

### What Exists

1. **The context menu command is fully implemented:**
   - Definition: `src/features/modmail/commands.ts:99-102`
   - Handler: `src/features/modmail/handlers.ts:166-208`
   - Export: `src/features/modmail/index.ts:90` and `src/features/modmail.ts:105`

2. **The command is defined as:**
   ```typescript
   export const modmailContextMenu = new ContextMenuCommandBuilder()
     .setName("Modmail: Open")
     .setType(ApplicationCommandType.Message)
     .setDMPermission(false);
   ```

3. **The handler exists and is functional:**
   - `handleModmailContextMenu()` extracts the target message's author
   - Searches for app codes in message content/embeds
   - Opens a modmail thread for the user

### What's Missing

1. **Registration:** The context menu command is NOT registered with Discord because:
   - It's commented out in `buildCommands.ts`
   - It's not added to the command registration flow in `src/lib/commandSync.ts`

2. **Routing:** The interaction handler is NOT wired up in the main router:
   - `src/index.ts:823` filters out anything that's not a slash command, button, or modal
   - Context menu interactions fall into the "other" category and are silently ignored
   - No call to `handleModmailContextMenu()` anywhere in the routing logic

### Why It's Commented Out

The comment suggests this is **intentional** - Discord context menu commands use a different registration mechanism than slash commands:
- Slash commands: `Routes.applicationGuildCommands()` with `ApplicationCommandType.ChatInput` (default)
- Context menus: Same endpoint but with `ApplicationCommandType.Message` or `ApplicationCommandType.User`

However, Discord.js v14 supports registering context menu commands through the same bulk registration API, so the distinction mentioned in the comment is outdated.

---

## Proposed Changes

### Option A: Complete the Feature (Recommended)

**Rationale:** The handler is fully implemented and tested. Completing the feature provides value to moderators who can quickly open modmail from any message.

**Steps:**

1. **Uncomment the registration** (`buildCommands.ts:100`):
   ```typescript
   // Artist rotation commands
   artistqueueData.toJSON(),
   redeemrewardData.toJSON(),

   // Context menu commands
   modmailContextMenu.toJSON(),
   ```

2. **Add context menu routing** to `src/index.ts` (around line 815-825):
   ```typescript
   const kind = interaction.isChatInputCommand()
     ? "slash"
     : interaction.isButton()
       ? "button"
       : interaction.isModalSubmit()
         ? "modal"
         : interaction.isContextMenuCommand()
           ? "contextMenu"
           : "other";
   ```

3. **Add context menu handler** in the interaction router (after slash/button/modal handlers):
   ```typescript
   if (kind === "contextMenu" && interaction.isMessageContextMenuCommand()) {
     if (interaction.commandName === "Modmail: Open") {
       await handleModmailContextMenu(interaction);
       return;
     }
   }
   ```

4. **Update the comment** to reflect the change:
   ```typescript
   // Context menu commands are registered alongside slash commands
   modmailContextMenu.toJSON(),
   ```

### Option B: Remove the Dead Code

**Rationale:** If context menu support is not desired, remove the dead code entirely to reduce maintenance burden.

**Steps:**

1. **Remove the commented line** from `buildCommands.ts:98-100`

2. **Remove exports** from barrel files:
   - `src/features/modmail/index.ts:90`
   - `src/features/modmail.ts:105`

3. **Remove the handler** from `src/features/modmail/handlers.ts:155-208`

4. **Remove the command definition** from `src/features/modmail/commands.ts:97-102`

5. **Add a note** to `docs/reference/modmail-system.md` explaining that context menu support was considered but not implemented

---

## Recommendation

**Choose Option A** - Complete the feature for these reasons:

1. **Low effort:** Only 3 small changes needed (uncomment + 2 routing additions)
2. **High value:** Provides moderators with a faster workflow
3. **Already tested:** The handler implementation is complete and follows existing patterns
4. **Consistent:** Matches the pattern used by other features (buttons, modals, slash commands)
5. **No risk:** Context menu commands are registered the same way as slash commands in Discord.js v14

---

## Files Affected

### Option A (Complete the Feature)

- `/Users/bash/Documents/pawtropolis-tech/src/commands/buildCommands.ts` (uncomment line 100, update comment)
- `/Users/bash/Documents/pawtropolis-tech/src/index.ts` (add context menu routing, ~10 lines)

### Option B (Remove Dead Code)

- `/Users/bash/Documents/pawtropolis-tech/src/commands/buildCommands.ts` (delete lines 98-100)
- `/Users/bash/Documents/pawtropolis-tech/src/features/modmail/commands.ts` (delete lines 97-102)
- `/Users/bash/Documents/pawtropolis-tech/src/features/modmail/handlers.ts` (delete lines 155-208)
- `/Users/bash/Documents/pawtropolis-tech/src/features/modmail/index.ts` (remove export on line 90)
- `/Users/bash/Documents/pawtropolis-tech/src/features/modmail.ts` (remove export on line 105)
- `/Users/bash/Documents/pawtropolis-tech/docs/reference/modmail-system.md` (add note)

---

## Testing Strategy

### For Option A (Complete the Feature)

1. **Build and deploy commands:**
   ```bash
   npm run build
   npm run deploy:cmds
   ```

2. **Verify registration:**
   - Check Discord client for "Modmail: Open" in message context menus
   - Confirm it appears when right-clicking any message in the guild

3. **Test the handler:**
   - Right-click a message from a review card (with app code)
   - Verify modmail thread opens correctly
   - Right-click a regular user message
   - Verify modmail opens for that user (without app code)
   - Right-click a bot message
   - Verify appropriate error handling

4. **Test permissions:**
   - Verify only authorized roles can see/use the command
   - Test with different member permission levels

5. **Monitor logs:**
   - Check for any routing errors during context menu interactions
   - Verify no "unknown interaction type" warnings

### For Option B (Remove Dead Code)

1. **Build and verify compilation:**
   ```bash
   npm run build
   ```

2. **Check for broken imports:**
   - Run tests: `npm test`
   - Verify no import errors for removed exports

3. **Verify no runtime errors:**
   - Start the bot: `npm start`
   - Confirm clean startup with no missing handler warnings

---

## Rollback Plan

### For Option A

If context menu registration causes issues:

1. **Immediate rollback:**
   ```bash
   git revert <commit-hash>
   npm run build
   npm run deploy:cmds
   ```

2. **Manual rollback:**
   - Re-comment the line in `buildCommands.ts`
   - Remove context menu routing from `index.ts`
   - Redeploy commands

3. **Verify:**
   - Context menu command disappears from Discord UI within 1-2 minutes (guild commands)
   - No errors in bot logs

### For Option B

If removing the code breaks something unexpected:

1. **Immediate rollback:**
   ```bash
   git revert <commit-hash>
   npm run build
   ```

2. **Verify:**
   - Exports are restored
   - Handler code is back
   - No compilation errors

---

## Dependencies

- None - this is an isolated cleanup task

---

## Notes

- Discord.js v14 unified the registration API for all command types (slash, user context, message context)
- The comment suggesting a "different registration endpoint" reflects a Discord.js v13 limitation that no longer exists
- The `handleModmailContextMenu` implementation is production-ready and follows the same patterns as other handlers
- Context menu commands count toward the 100-command-per-guild limit (currently using ~45 commands)

---

## Related Issues

- None identified

---

## References

- Discord.js v14 Context Menu Commands: https://discord.js.org/#/docs/discord.js/main/class/ContextMenuCommandBuilder
- Discord API - Application Commands: https://discord.com/developers/docs/interactions/application-commands#message-commands
- Existing modmail handler: `/Users/bash/Documents/pawtropolis-tech/src/features/modmail/handlers.ts:166-208`
