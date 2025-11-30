# Roadmap: Remove currentTraceId Wrapper Function

**Issue:** #38 - Unused Function: currentTraceId
**Status:** Planned
**Priority:** Low
**Category:** Code Cleanup / Dead Code Removal
**Effort:** 15 minutes

## Summary

The `currentTraceId()` function in `src/lib/cmdWrap.ts:376` is a trivial wrapper that adds unnecessary indirection. It simply returns `ctx.traceId`, which is already a public readonly property on the `CommandContext` interface. This function is only used in 2 places and should be inlined.

## Current State

### Problem

```typescript
// src/lib/cmdWrap.ts:376
export function currentTraceId(ctx: CommandContext<InstrumentedInteraction>): string {
  return ctx.traceId;
}
```

The function provides no value:
- No validation or transformation logic
- No error handling
- No additional functionality
- Simply returns a property that's already publicly accessible

### Current Usage

The function is imported and used in **2 locations** in `src/features/gate.ts`:

1. **Line 720** (in `logPhase` function):
   ```typescript
   function logPhase(ctx: CmdCtx, phase: string, extras: Record<string, unknown> = {}) {
     logger.info({
       evt: "gate_entry_step",
       traceId: currentTraceId(ctx),  // <- Remove wrapper
       phase,
       ...extras,
     });
   }
   ```

2. **Line 1251** (in avatar scan queueing):
   ```typescript
   queueAvatarScan({
     appId: draftRow.id,
     user: interaction.user,
     cfg,
     client: interaction.client as Client,
     parentTraceId: currentTraceId(ctx) ?? null,  // <- Remove wrapper
   });
   ```

## Proposed Changes

### Step 1: Update gate.ts imports
Remove `currentTraceId` from the import statement:

```typescript
// Before (line 50):
import { currentTraceId, ensureDeferred, replyOrEdit, withSql } from "../lib/cmdWrap.js";

// After:
import { ensureDeferred, replyOrEdit, withSql } from "../lib/cmdWrap.js";
```

### Step 2: Inline direct property access (line 720)
Replace function call with direct property access:

```typescript
// Before:
traceId: currentTraceId(ctx),

// After:
traceId: ctx.traceId,
```

### Step 3: Inline direct property access (line 1251)
Replace function call with direct property access:

```typescript
// Before:
parentTraceId: currentTraceId(ctx) ?? null,

// After:
parentTraceId: ctx.traceId ?? null,
```

### Step 4: Remove function from cmdWrap.ts
Delete lines 376-378 in `src/lib/cmdWrap.ts`:

```typescript
// DELETE:
export function currentTraceId(ctx: CommandContext<InstrumentedInteraction>): string {
  return ctx.traceId;
}
```

## Files Affected

- `/Users/bash/Documents/pawtropolis-tech/src/features/gate.ts` (3 changes: import + 2 call sites)
- `/Users/bash/Documents/pawtropolis-tech/src/lib/cmdWrap.ts` (remove function definition)

## Testing Strategy

### Type Safety
TypeScript compilation will verify correctness:
```bash
npm run build
```

### Runtime Verification
1. Run the bot in dev mode
2. Execute any slash command that triggers gate entry (e.g., `/apply`)
3. Verify trace IDs appear correctly in logs:
   - Check `gate_entry_step` events contain valid `traceId`
   - Verify avatar scan jobs receive correct `parentTraceId`

### Regression Testing
No dedicated tests needed - this is a pure refactor with zero behavior change:
- The `ctx.traceId` property is already tested through existing command execution
- Log output should be identical before/after
- Avatar scan tracing should remain unchanged

## Rollback Plan

If issues arise (unlikely for such a trivial change):

1. **Immediate rollback**: Revert the git commit
   ```bash
   git revert <commit-hash>
   ```

2. **Manual rollback**: Restore the function and update call sites:
   ```bash
   # Restore cmdWrap.ts lines 376-378
   # Update gate.ts import and 2 call sites
   ```

The rollback is low-risk because:
- Only 2 call sites affected
- No external API changes
- No database schema changes
- TypeScript will catch any errors immediately

## Notes

- This cleanup was identified during the codebase audit (2025-11-30)
- Similar trivial wrappers should be audited in future cleanup passes
- The `ctx.traceId` property is well-documented in the `CommandContext` type
- No performance impact (negligible function call overhead)
