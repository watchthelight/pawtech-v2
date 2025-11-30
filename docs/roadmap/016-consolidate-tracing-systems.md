# Issue #16: Consolidate Inconsistent Tracing Systems

## Summary

The codebase has two separate tracing systems serving overlapping purposes:
- `src/lib/tracer.ts`: ULID-based traces with `TraceCtx` type (7 files)
- `src/lib/reqctx.ts`: Base62 trace IDs with `ReqContext` type (114+ files)

This creates confusion about which system to use and results in duplicate functionality. The `reqctx.ts` system is the clear winner (used 16x more), supports async context propagation, and is deeply integrated with the command infrastructure. This cleanup will migrate the remaining `tracer.ts` usage and remove the module entirely.

**Status:** Planned
**Priority:** Medium
**Effort:** ~2-3 hours
**Type:** Technical Debt / Code Consolidation

---

## Current State (What's Wrong)

### Two Competing Tracing Systems

#### tracer.ts (ULID-based, feature tracing)
**File:** `src/lib/tracer.ts` (57 lines)

```typescript
export type TraceCtx = {
  traceId: string; // ULID - sortable by time, 26 chars
  feature: string; // e.g. "gate"
  step?: string;
};

export function newTrace(feature: string, step?: string): TraceCtx;
export function withStep(ctx: TraceCtx, step: string): TraceCtx;
export function tlog(ctx: TraceCtx, level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>);
```

**Used in:**
1. `src/index.ts` - Creates trace object that's never consumed (lines 72, 766-791)
2. Dead code only - The `__trace` property is set but never read

#### reqctx.ts (Base62, request-scoped context)
**File:** `src/lib/reqctx.ts` (77 lines)

```typescript
export type ReqContext = {
  traceId: string; // 11-char base62 ID
  cmd?: string;
  kind?: "slash" | "button" | "modal";
  userId?: string;
  guildId?: string | null;
  channelId?: string | null;
};

export function newTraceId(): string;
export function runWithCtx<T>(meta: Partial<ReqContext>, fn: () => T): T;
export function ctx(): Partial<ReqContext>;
```

**Used in:** 114+ files across the entire application

### The Confusion

**Problem 1:** `withStep()` exists in TWO places with different signatures:
- `tracer.ts`: `withStep(ctx: TraceCtx, step: string): TraceCtx` - Returns new context
- `cmdWrap.ts`: `withStep(ctx: CommandContext, phase: string, fn: () => Promise<T>): Promise<T>` - Executes function

This naming collision is confusing. Commands import `withStep` from `cmdWrap.ts`, which is the correct system.

**Problem 2:** The `tracer.ts` usage in `src/index.ts` is dead code:
- Creates `trace` object but never uses it
- Sets `__trace` property on interaction but never reads it
- The `tlog()` calls are redundant with existing `logger` module

**Problem 3:** The `newTrace()` function is unused:
- Only imported in `src/index.ts` (line 72)
- Only called once (line 766) to create a trace that's never consumed

### Why reqctx.ts Won

1. **Async Context Propagation**: Uses Node's `AsyncLocalStorage` to automatically propagate context through async calls
2. **Integration**: Deeply integrated with `cmdWrap.ts`, `logger.ts`, and error handling
3. **Adoption**: Used in 114+ files vs 7 files (mostly dead code)
4. **Richer Context**: Tracks cmd, kind, userId, guildId, channelId - not just feature/step
5. **No Manual Threading**: Context is implicit, no need to pass `ctx` parameter everywhere

---

## Proposed Changes

### Step 1: Remove tracer.ts Import from index.ts

**File:** `src/index.ts` (line 72)

**Remove:**
```typescript
import { newTrace, tlog, withStep } from "./lib/tracer.js";
```

### Step 2: Remove Dead Tracing Code Block

**File:** `src/index.ts` (lines 766-791)

**Remove:**
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

**Rationale:**
- The `trace` object is never used
- The `__trace` property is never read
- The `__ownerBypass` property is only logged but never used for logic
- The `tlog()` calls duplicate existing logging via `logger` module (lines 827-864)

### Step 3: Verify No Other Direct Usage

**Search pattern:** `import.*tracer`

**Expected result:** Only documentation/roadmap files should reference tracer.ts after Step 1

**Action:** Run grep to confirm:
```bash
grep -r "from ['\"].*tracer" src/
```

### Step 4: Delete tracer.ts Module

**File:** `src/lib/tracer.ts` (entire file, 57 lines)

**Remove entire module** - it will have zero imports after Steps 1-2

### Step 5: Remove tracer.ts Dependency

**File:** `package.json`

**Check for:** `ulid` package (only used by tracer.ts)

**Action:**
```bash
grep -r "ulid" src/ --include="*.ts" --exclude-dir=node_modules
```

If `ulid` is only used by `tracer.ts`, remove it:
```bash
npm uninstall ulid
```

### Step 6: Update Documentation

**File:** `src/lib/reqctx.ts` (header comment)

**Add note:**
```typescript
/**
 * Pawtropolis Tech — src/lib/reqctx.ts
 * WHAT: Minimal async-local request context for tracing interaction flows.
 * WHY: Lets us attach traceId/cmd/kind across nested async calls without threading params everywhere.
 * FLOWS: newTraceId() → runWithCtx(meta, fn) → ctx() inside nested helpers
 *
 * NOTE: This is the ONLY tracing system in the codebase. Previously tracer.ts existed
 * but was removed in favor of this async-context-based approach.
 *
 * DOCS:
 *  - Node AsyncLocalStorage: https://nodejs.org/api/async_context.html#class-asynclocalstorage
 */
```

---

## Files Affected

### Modified
- `src/index.ts` - Remove tracer.ts import and dead code block (~20 lines removed)
- `src/lib/reqctx.ts` - Add clarifying comment about being the sole tracing system

### Deleted
- `src/lib/tracer.ts` - Entire module removed (57 lines)

### Potentially Modified
- `package.json` - Remove `ulid` dependency if no other usage

### No Changes Required
- `src/lib/cmdWrap.ts` - Already uses reqctx.ts, no changes needed
- All commands using `withStep` from cmdWrap.ts - No changes needed
- All code using `ctx()` from reqctx.ts - No changes needed

---

## Testing Strategy

### Pre-Migration Verification

1. **Confirm tracer.ts usage is dead code:**
   ```bash
   # Should only find index.ts
   grep -r "__trace" src/

   # Should only find index.ts
   grep -r "newTrace(" src/

   # Should show withStep from cmdWrap.ts everywhere except index.ts
   grep -r "withStep" src/ -A 2
   ```

2. **Verify reqctx.ts is functional:**
   ```bash
   # Run existing tests
   npm test

   # Check that tracing works in commands
   # Look for traceId in logs during command execution
   ```

### Post-Migration Testing

1. **Build Verification:**
   ```bash
   npm run build
   # Should complete without errors
   ```

2. **Type Check:**
   ```bash
   npx tsc --noEmit
   # Should show no type errors
   ```

3. **Runtime Testing:**
   - Start bot in development mode
   - Execute various slash commands (`/health`, `/update`, `/gate`)
   - Verify that `traceId` appears in logs
   - Verify that error cards still show trace IDs
   - Test button interactions (gate flow)
   - Test modal interactions (rejection reasons)

4. **Log Inspection:**
   ```bash
   # Verify trace IDs are present
   # Format: evt: "cmd_start", traceId: "abc123XYZ89"
   ```

5. **Error Handling:**
   - Trigger an intentional error
   - Verify error card includes trace ID
   - Verify Sentry event includes trace ID
   - Check that logger.error includes traceId field

### Regression Test Checklist

- [ ] `/health` command works
- [ ] `/update` subcommands work
- [ ] Gate flow (start button → modal → verification) works
- [ ] Review actions (approve/reject buttons) work
- [ ] Error cards display correctly with trace IDs
- [ ] Logs contain trace IDs in structured format
- [ ] No TypeScript errors
- [ ] No runtime errors in console
- [ ] Bot responds to interactions within 3s (no 10062 errors)

---

## Rollback Plan

### If Issues Discovered Post-Deployment

**Option 1: Revert Commit (Recommended)**

```bash
# Find the merge commit
git log --oneline -n 10

# Revert the consolidation commit
git revert <commit-sha>

# Push revert
git push origin main
```

**Option 2: Emergency Hotfix**

If tracer.ts functionality was accidentally needed:

1. **Restore tracer.ts from git:**
   ```bash
   git checkout HEAD~1 -- src/lib/tracer.ts
   ```

2. **Restore index.ts usage:**
   ```bash
   git checkout HEAD~1 -- src/index.ts
   ```

3. **Reinstall ulid if removed:**
   ```bash
   npm install ulid
   ```

4. **Deploy immediately:**
   ```bash
   npm run build
   # Deploy via your normal process
   ```

### Recovery Time Estimate

- **Revert commit:** < 5 minutes
- **Emergency hotfix:** < 15 minutes
- **Full restoration from backup:** < 30 minutes

### Risk Level

**Very Low** - This is purely dead code removal:
- tracer.ts is not used in any active code paths
- reqctx.ts is already the primary tracing system
- No behavioral changes to existing commands
- Type system will catch any missed references at build time

---

## Success Criteria

1. **Build Success:** `npm run build` completes without errors
2. **Type Safety:** `npx tsc --noEmit` shows zero errors
3. **Test Pass:** All existing tests continue to pass
4. **Runtime Stability:** No new errors in production logs for 48 hours post-deploy
5. **Code Reduction:** ~77 lines removed (57 from tracer.ts + 20 from index.ts)
6. **Single Source of Truth:** Only one tracing system remains (`reqctx.ts`)
7. **Documentation Clear:** Comments in reqctx.ts clarify it's the sole tracing system

---

## Related Issues

- **Issue #1:** Remove Dead Code - tracer.ts Usage (overlaps with this issue)
- **Codebase Audit:** Section on "Inconsistent Tracing Systems" (CODEBASE_AUDIT_2025-11-30.md line 269)

---

## Notes

- The confusion between `tracer.ts` and `reqctx.ts` likely arose from different development phases
- `tracer.ts` was designed for "feature-level tracing" but `reqctx.ts` evolved to handle both request and feature context
- The ULID vs Base62 ID choice doesn't matter at our scale (both provide sufficient uniqueness)
- Commands already use `withStep` from `cmdWrap.ts`, which integrates with `reqctx.ts`, so no migration needed there
- The `tlog()` function duplicates functionality already provided by `logger` module with `ctx()` enrichment
