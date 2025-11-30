# Issue #1: Remove Dead Code - tracer.ts Usage

## Summary

The `tracer.ts` module is imported and used in `src/index.ts` but produces no observable effects. The trace object is created and attached to interactions, but the `__trace` and `__ownerBypass` properties are never consumed anywhere in the codebase. This cleanup removes ~30 lines of dead code.

**Status:** Planned
**Priority:** Low
**Effort:** ~30 minutes
**Type:** Technical Debt / Code Cleanup

---

## Current State (What's Wrong)

### Dead Code Locations

**File:** `/Users/bash/Documents/pawtropolis-tech/src/index.ts`

**Import (Line 72):**
```typescript
import { newTrace, tlog, withStep } from "./lib/tracer.js";
```

**Usage (Lines 766-790):**
```typescript
client.on("interactionCreate", async (interaction) => {
  const trace = newTrace("gate", "interactionCreate");

  try {
    // Make traceId available on the object for downstream logs
    (interaction as any).__trace = trace;
    (interaction as any).__ownerBypass = isOwner(interaction.user.id);

    if (TRACE_INTERACTIONS) {
      tlog(trace, "info", "interaction received", {
        kind: interaction.isChatInputCommand() ? "slash" : ...,
        command: (interaction as any).commandName ?? ...,
        guildId: interaction.guildId ?? "DM",
        channelType: interaction.channel?.type ?? ChannelType.GuildText,
        userId: interaction.user?.id,
        ownerBypass: (interaction as any).__ownerBypass,
      });
    }
    // ... rest of handler
  } catch (err) {
    tlog(trace, "error", "interaction handler error", { err });
  }
  // ... continues with actual routing logic
```

### Why It's Dead Code

1. **`__trace` property**: Set on line 770, never read anywhere in the codebase
2. **`__ownerBypass` property**: Set on line 771, only logged on line 784 but never used for actual logic
3. **`tlog()` calls**: Only executed when `TRACE_INTERACTIONS=1` (debug mode), but this is redundant with existing structured logging via `reqctx.ts` (lines 827-864)
4. **Duplicate tracing**: The real request tracing happens via `reqctx.ts` with `newTraceId()` and `runWithCtx()` starting at line 827

### Functional Impact

**Zero** - The tracer module produces console output when `TRACE_INTERACTIONS=1`, but:
- The same information is already logged by the `logger` module (lines 853-864)
- The `reqctx` module provides superior request-scoped tracing (lines 827-846)
- No code reads the `__trace` or `__ownerBypass` properties from interactions

---

## Proposed Changes

### Step 1: Remove Import

**File:** `src/index.ts` (line 72)

**Remove:**
```typescript
import { newTrace, tlog, withStep } from "./lib/tracer.js";
```

**Keep:**
```typescript
import { TRACE_INTERACTIONS, OWNER_IDS } from "./config.js";
```

### Step 2: Remove Dead Code Block

**File:** `src/index.ts` (lines 766-791)

**Remove entire block:**
```typescript
client.on("interactionCreate", async (interaction) => {
  const trace = newTrace("gate", "interactionCreate");

  try {
    (interaction as any).__trace = trace;
    (interaction as any).__ownerBypass = isOwner(interaction.user.id);

    if (TRACE_INTERACTIONS) {
      tlog(trace, "info", "interaction received", {
        kind: interaction.isChatInputCommand() ? "slash" : ...,
        command: (interaction as any).commandName ?? ...,
        guildId: interaction.guildId ?? "DM",
        channelType: interaction.channel?.type ?? ChannelType.GuildText,
        userId: interaction.user?.id,
        ownerBypass: (interaction as any).__ownerBypass,
      });
    }
  } catch (err) {
    tlog(trace, "error", "interaction handler error", { err });
  }
```

**Preserve:** The owner override logging block (lines 793-812) which actually uses the owner check for functional purposes.

### Step 3: Delete tracer.ts Module (Optional)

**File:** `src/lib/tracer.ts`

**Decision:** Consider deleting if no other usage exists. The module itself is well-written and could be useful for future feature-level tracing, so consider archiving rather than deleting.

**Archive location:** Move to `src/lib/_archive/tracer.ts` with a comment explaining why it was removed.

### Step 4: Clean Up TRACE_INTERACTIONS Config (Optional Future Work)

The `TRACE_INTERACTIONS` config is now only used in one place (line 565 startup log). Consider:
- Removing the config entirely if interaction tracing is fully handled by `reqctx`
- OR repurposing it to control verbosity in the existing `reqctx` logging

This is out of scope for this cleanup task but noted for future consideration.

---

## Files Affected

1. **`/Users/bash/Documents/pawtropolis-tech/src/index.ts`**
   - Remove lines 72 (import)
   - Remove lines 766-791 (dead code block)

2. **`/Users/bash/Documents/pawtropolis-tech/src/lib/tracer.ts`** (optional)
   - Move to `_archive/` or delete entirely

3. **`/Users/bash/Documents/pawtropolis-tech/src/config.ts`** (future consideration)
   - Lines 11, 26, 29: `TRACE_INTERACTIONS` config may become obsolete

---

## Testing Strategy

### Pre-Change Validation

1. **Verify no consumers exist:**
   ```bash
   # Search for any code reading __trace or __ownerBypass
   rg '__trace\.' src/
   rg 'interaction\.__trace' src/
   rg 'interaction\.__ownerBypass' src/

   # Should return zero results (or only the assignment lines)
   ```

2. **Confirm tracer.ts has no other imports:**
   ```bash
   rg "from ['\"].*tracer" src/
   # Should only show src/index.ts:72
   ```

### Post-Change Testing

1. **Build verification:**
   ```bash
   npm run build
   # Should compile without errors
   ```

2. **Runtime smoke test:**
   - Start the bot in development mode
   - Execute a slash command (e.g., `/health`)
   - Execute a button interaction (e.g., gate flow)
   - Execute a modal submission (e.g., gate form)
   - Verify all interactions work correctly
   - Verify structured logging still appears in console

3. **Log output validation:**
   - Check that `ix_enter`, `ix_ok` events still log correctly
   - Verify `traceId` is present in logs (from `reqctx`, not `tracer`)
   - Confirm no errors about missing `__trace` properties

### Regression Risk

**Very Low** - The removed code has zero functional impact. The only observable change is the absence of `tlog()` console output when `TRACE_INTERACTIONS=1`, which is already duplicated by the `logger` module.

---

## Rollback Plan

### Git Rollback

If any issues arise:
```bash
git log --oneline -n 5  # Find commit hash
git revert <commit-hash>
git push
```

### Manual Rollback

If partial rollback needed:

1. **Restore import:**
   ```typescript
   import { newTrace, tlog, withStep } from "./lib/tracer.js";
   ```

2. **Restore code block at line 766:**
   ```typescript
   client.on("interactionCreate", async (interaction) => {
     const trace = newTrace("gate", "interactionCreate");

     try {
       (interaction as any).__trace = trace;
       (interaction as any).__ownerBypass = isOwner(interaction.user.id);

       if (TRACE_INTERACTIONS) {
         tlog(trace, "info", "interaction received", { /* ... */ });
       }
     } catch (err) {
       tlog(trace, "error", "interaction handler error", { err });
     }
     // ... rest of handler
   ```

3. **Rebuild and restart:**
   ```bash
   npm run build
   pm2 restart pawtropolis-bot
   ```

### Recovery Time

- Git revert: ~1 minute
- Manual restoration: ~5 minutes
- Total downtime: <2 minutes (hot reload via PM2)

---

## Additional Notes

### Why Was This Code Added?

The tracer module appears to have been an early attempt at interaction tracing before the `reqctx` module was implemented. The comment on line 769 ("Make traceId available on the object for downstream logs") suggests the intent was to propagate trace context through interactions, but this was never fully implemented.

### Alternative: Keep tracer.ts, Remove Usage

The `tracer.ts` module itself is well-designed (ULID-based sortable IDs, zero-dependency logging). If there's future need for feature-level tracing independent of request context, consider:
- Keeping the module archived
- Documenting when to use `tracer.ts` vs `reqctx.ts`
- Adding a linter rule to prevent `__trace` property assignments

### Related Cleanup Opportunities

While removing this code, consider:
1. **Owner override logic** (lines 793-812): Currently logs but doesn't affect command execution. Verify this is intentional.
2. **TRACE_INTERACTIONS config**: Currently only used for startup logging. May be obsolete.
3. **Structured logging consolidation**: Ensure all interaction logging uses consistent format across `logger`, `reqctx`, and `logActionPretty`.

---

## Acceptance Criteria

- [ ] Import statement removed from `src/index.ts`
- [ ] Dead code block (lines 766-791) removed from `src/index.ts`
- [ ] Code compiles without errors (`npm run build`)
- [ ] Bot starts successfully in development mode
- [ ] All interaction types work (slash commands, buttons, modals)
- [ ] Structured logging still functions correctly
- [ ] No references to `__trace` property remain in codebase
- [ ] `tracer.ts` archived or documented as unused (if kept)
