# 048: Explicit Event Listener Cleanup on Shutdown

**Issue Type:** Reliability / Defensive Programming
**Priority:** Low
**Estimated Effort:** 1-2 hours
**Risk Level:** Low

## Issue Summary

Multiple Discord.js event listeners are registered in `src/index.ts` but not explicitly removed during graceful shutdown. While `client.destroy()` should handle cleanup automatically, explicit listener removal is more defensive and ensures predictable cleanup behavior.

**Event listeners registered without explicit cleanup:**
- `guildCreate` (line 650)
- `guildDelete` (line 656)
- `guildMemberAdd` (line 670)
- `threadDelete` (line 689)
- `guildMemberUpdate` (line 719)
- `voiceStateUpdate` (line 745)
- `interactionCreate` (line 765)
- `messageCreate` (line 1420)
- `threadCreate` (line 1531)

## Current State

### Problem

**Location:** `src/index.ts:650-1531` (event listener registration)
**Location:** `src/index.ts:428-502` (graceful shutdown handler)

The bot registers 9 event listeners on the Discord client during startup, but the graceful shutdown handler does not explicitly remove them before calling `client.destroy()`:

```typescript
// Lines 484-486: Current shutdown logic
// 5. Destroy Discord client (closes WebSocket connection)
client.destroy();
logger.debug("[shutdown] Discord client destroyed");
```

**Why this matters:**

1. **Defensive programming:** Explicit cleanup makes shutdown behavior predictable and self-documenting
2. **Memory leak prevention:** If `client.destroy()` fails or is delayed, listeners could continue processing events
3. **Testing clarity:** Tests that mock the client need clear lifecycle expectations
4. **Race condition prevention:** Events could fire between other cleanup steps and `client.destroy()`
5. **Code clarity:** Explicit removal shows intent that these listeners are application-level, not persistent

### Current Shutdown Sequence

```typescript
const gracefulShutdown = async (signal: string) => {
  // 1. Stop schedulers (metrics, health, stale app)
  // 2. Flush message activity buffer
  // 3. Cleanup banner sync listeners (already does explicit removal!)
  // 4. Cleanup notify limiter interval
  // 5. Destroy Discord client  <-- Event listeners not removed first
  // 6. Close database
}
```

**Note:** The banner sync feature (line 465-471) already demonstrates explicit listener cleanup:

```typescript
// 3. Cleanup banner sync listeners
const { cleanupBannerSync } = await import("./features/bannerSync.js");
cleanupBannerSync(client);
logger.debug("[shutdown] Banner sync listeners cleaned up");
```

This proves the pattern works and is already in use.

### Risk Assessment

**Severity:** Low
- Discord.js `client.destroy()` is designed to remove all listeners
- No known production issues caused by current implementation
- Mostly a defensive programming improvement

**Impact:** Low
- Prevents potential edge cases during shutdown
- Improves code maintainability and clarity
- Aligns with existing cleanup patterns (banner sync)

**Likelihood:** Very Low
- Issue would only manifest if `client.destroy()` fails or is delayed
- More relevant for testing and code quality than production risk

## Proposed Changes

### Recommended Approach

Add `client.removeAllListeners()` call before `client.destroy()` in the graceful shutdown handler. This is the simplest and most comprehensive solution.

**Benefits:**
- Single line change (minimal risk)
- Removes all listeners at once (no need to track individual events)
- Matches Discord.js best practices
- Self-documenting (clearly shows intent to cleanup before destroy)
- Consistent with banner sync cleanup pattern

**Implementation:**

```typescript
// Lines 484-486 (AFTER banner sync cleanup, BEFORE client.destroy())
// 5. Remove all event listeners before destroying client
client.removeAllListeners();
logger.debug("[shutdown] Event listeners removed");

// 6. Destroy Discord client (closes WebSocket connection)
client.destroy();
logger.debug("[shutdown] Discord client destroyed");
```

## Implementation Steps

### Step 1: Add Event Listener Cleanup to Graceful Shutdown

**File:** `src/index.ts`
**Location:** Lines 484-486 (between notify limiter cleanup and client.destroy())

```typescript
// After step 4 (notify limiter cleanup)
// Add new step 5:

// 5. Remove all event listeners before destroying client
// WHY: Explicit cleanup prevents race conditions and makes shutdown behavior predictable
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=removeAllListeners
client.removeAllListeners();
logger.debug("[shutdown] Event listeners removed");

// Update step numbers in comments:
// 6. Destroy Discord client (closes WebSocket connection)
client.destroy();
logger.debug("[shutdown] Discord client destroyed");

// 7. Close database
try {
  db.close();
  logger.debug("[shutdown] Database closed");
} catch (err) {
  logger.warn({ err }, "[shutdown] Database close failed (non-fatal)");
}
```

### Step 2: Update Shutdown Sequence Documentation

Update the graceful shutdown header comment to reflect the new step:

```typescript
// Lines 422-425
// ===== Coordinated Graceful Shutdown =====
// WHAT: Single handler for SIGTERM/SIGINT that shuts down all subsystems in order
// WHY: Prevents data loss, ensures transcripts are flushed, stops schedulers cleanly
// ORDER: 1) Log, 2) Stop schedulers, 3) Cleanup features, 4) Remove listeners, 5) Destroy client, 6) Close DB
```

## Files Affected

### Modified
- `src/index.ts` - Add `client.removeAllListeners()` to graceful shutdown handler (lines 484-486)

### No Changes Needed
- Event listener registration code (lines 650-1531) - No changes required
- Banner sync cleanup (lines 465-471) - Already implements explicit cleanup pattern
- Other shutdown steps - Independent of event listener cleanup

## Testing Strategy

### Pre-Change Verification

1. Verify bot shuts down cleanly:
   ```bash
   npm run dev
   # Send SIGTERM (Ctrl+C)
   # Check logs for successful shutdown sequence:
   # [shutdown] Graceful shutdown initiated
   # [shutdown] Discord client destroyed
   # [shutdown] Database closed
   # [shutdown] Graceful shutdown complete
   ```

2. Verify no lingering processes:
   ```bash
   npm run dev
   # Press Ctrl+C
   # Verify process exits within 2 seconds
   ps aux | grep node  # Should show no bot process
   ```

### Post-Change Verification

1. **Compilation:** Ensure TypeScript compiles without errors
   ```bash
   npm run build
   ```

2. **Shutdown sequence:** Verify new log appears
   ```bash
   npm run dev
   # Press Ctrl+C
   # Check logs for:
   # [shutdown] Event listeners removed
   # [shutdown] Discord client destroyed
   # [shutdown] Graceful shutdown complete
   ```

3. **No runtime errors:** Verify `removeAllListeners()` doesn't throw
   ```bash
   npm run dev
   # Let bot start fully (check for "Bot ready" log)
   # Press Ctrl+C immediately
   # Verify no errors during shutdown
   ```

4. **Event handling stops:** Verify events stop processing after listener removal
   ```bash
   # This is implicit - if shutdown completes quickly, events aren't processing
   # Monitor shutdown duration in logs
   ```

### Edge Cases to Test

1. **Fast shutdown:** Send SIGTERM immediately after startup
   - Should remove listeners even if none have fired yet
   - Verify no errors during cleanup

2. **Duplicate signals:** Send SIGTERM twice rapidly
   - Existing `isShuttingDown` flag should prevent duplicate cleanup
   - Verify "Already shutting down, ignoring" log appears

3. **Listener-triggered shutdown:** Trigger shutdown from within an event handler
   - Should prevent new events from firing mid-shutdown
   - Verify clean exit with all cleanup steps logged

## Rollback Plan

### If Issues Arise

1. **Immediate rollback:** Revert the single line change
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. **Quick fix:** Comment out the removeAllListeners() call
   ```typescript
   // Temporary rollback if needed
   // client.removeAllListeners();
   client.destroy();
   ```

3. **Manual revert:** Remove the added line
   ```bash
   git checkout HEAD~1 -- src/index.ts
   npm run build
   git commit -m "Rollback: remove explicit event listener cleanup"
   ```

### Low Risk Justification

- **Single line change:** Only adds one method call
- **Discord.js built-in:** `removeAllListeners()` is a standard EventEmitter method
- **Non-breaking:** Does not change external behavior, only internal cleanup order
- **Already tested:** Discord.js has extensive internal tests for this method
- **Defensive only:** Improves on already-working shutdown (not fixing a bug)
- **Similar pattern:** Banner sync already uses explicit cleanup successfully

### Monitoring Post-Deploy

Watch for:
- Successful shutdown completion (verify "Graceful shutdown complete" log)
- No errors from `removeAllListeners()` call
- No increase in shutdown duration
- No zombie processes after shutdown

No special monitoring required beyond existing application logs.

## Success Criteria

- [ ] `client.removeAllListeners()` called before `client.destroy()`
- [ ] New debug log appears: "[shutdown] Event listeners removed"
- [ ] Shutdown sequence documentation updated
- [ ] Bot starts and stops cleanly in development
- [ ] TypeScript compilation passes
- [ ] No errors during shutdown
- [ ] Shutdown completes within 2 seconds (same as before)
- [ ] Process exits cleanly (no zombie processes)

## Notes

This change aligns with Discord.js best practices and defensive programming principles. While `client.destroy()` already handles listener cleanup internally, explicit removal makes the shutdown sequence more predictable and self-documenting.

**Related patterns:**
- Banner sync cleanup (line 465-471) already implements this pattern
- Consider applying similar explicit cleanup to other subsystems
- Future consideration: Track listener references individually for granular cleanup

**References:**
- Discord.js Client documentation: https://discord.js.org/#/docs/discord.js/main/class/Client
- Node.js EventEmitter removeAllListeners: https://nodejs.org/api/events.html#emitterremovealllistenerseventname
