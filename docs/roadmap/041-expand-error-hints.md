# Issue #41: Expand Error Hints Coverage

## Summary
The `hintFor()` function in `errorCard.ts` currently provides user-friendly hints for only 6 error scenarios (4 Discord API codes + 1 SQLite + 1 custom modal error). Discord's API has dozens of common error codes that users encounter regularly, leaving them with generic "Unexpected error" messages when specific guidance would be more helpful.

This is a UX improvement to expand error hint coverage for common Discord API errors and improve the developer/user experience when things go wrong.

## Current State

**Location:** `/Users/bash/Documents/pawtropolis-tech/src/lib/errorCard.ts:30-65`

Currently handled errors:
- `SqliteError` with "no such table" → Schema mismatch hint
- `10062` (Unknown interaction) → Interaction expired hint
- `40060` (Already replied) → Double reply hint
- `50013` (Missing permissions) → Permission hint
- Unhandled modal → Form ID mismatch hint
- Default fallback → "Unexpected error. Try again or contact staff."

**Problem:** Most Discord API errors fall through to the generic fallback, providing no actionable guidance.

## Proposed Changes

### Step 1: Research Common Discord Error Codes
Identify the most frequently encountered Discord API errors in production logs and documentation:
- `50001` - Missing Access (bot lacks access to resource)
- `50035` - Invalid Form Body (malformed API request)
- `40001` - Unauthorized (invalid bot token or insufficient OAuth2 scope)
- `10008` - Unknown Message (message was deleted or doesn't exist)
- `10003` - Unknown Channel (channel deleted or bot lacks visibility)
- `30001` - Maximum number of guilds reached
- `30007` - Maximum number of webhooks reached
- `30010` - Maximum number of roles reached
- `30013` - Maximum number of reactions reached

**Reference:** [Discord API Error Codes](https://discord.com/developers/docs/topics/opcodes-and-status-codes#json)

### Step 2: Write User-Friendly Hints
For each error code, craft hints that:
- Explain what went wrong in plain language
- Suggest actionable next steps where possible
- Match the existing hint style (concise, slightly technical since ephemeral)

Example additions:
```typescript
// 50001: Missing Access - bot can't see the resource
if (code === 50001) {
  return "Bot lacks access to this resource. Check channel visibility and role permissions.";
}

// 50035: Invalid Form Body - malformed request (usually a bot bug)
if (code === 50035) {
  return "Invalid request format. This is likely a bot bug; report to staff with trace ID.";
}

// 40001: Unauthorized - token or scope issue
if (code === 40001) {
  return "Bot authentication failed. Token may be invalid or missing required scope.";
}

// 10008: Unknown Message - message deleted or never existed
if (code === 10008) {
  return "Message not found. It may have been deleted or is in an inaccessible channel.";
}

// 10003: Unknown Channel
if (code === 10003) {
  return "Channel not found. It may have been deleted or bot lacks visibility.";
}

// Resource limit errors (30xxx series)
if (code === 30001) {
  return "Bot has reached maximum number of servers (100). Contact Discord support to increase.";
}
```

### Step 3: Update Implementation
Modify `hintFor()` in `errorCard.ts` lines 30-65:
- Add new error code checks following existing pattern
- Maintain alphabetical/numerical ordering by code for readability
- Keep existing hints unchanged to avoid breaking user expectations

### Step 4: Update Tests
Add test cases to `/Users/bash/Documents/pawtropolis-tech/tests/lib/errorHints.test.ts`:
- One test per new error code
- Follow existing test structure with descriptive comments
- Lock the new error-to-hint mappings

### Step 5: Documentation
Add inline comment above `hintFor()` listing all supported error codes with brief descriptions for future maintainers.

## Files Affected

- `/Users/bash/Documents/pawtropolis-tech/src/lib/errorCard.ts` - Main implementation
- `/Users/bash/Documents/pawtropolis-tech/tests/lib/errorHints.test.ts` - Test coverage

## Testing Strategy

### Unit Tests
- Add test cases for each new error code in `errorHints.test.ts`
- Verify fallback behavior still works for unknown codes
- Run test suite: `npm test tests/lib/errorHints.test.ts`

### Manual Testing
1. Trigger each error code in development:
   - Use Discord API test harness or mock responses
   - Verify correct hint appears in error card embed
   - Check hint formatting in Discord UI (ephemeral message)

2. Test edge cases:
   - Error with code as string vs number
   - Error with missing code field
   - Error with unknown/new code (should fallback)

### Production Validation
- Deploy to staging environment first
- Monitor error logs for hint accuracy over 48 hours
- Collect user feedback on hint helpfulness

## Rollback Plan

### Low Risk
This change is additive-only and doesn't modify existing hints, making rollback straightforward.

### If Issues Arise
1. **Incorrect hints:**
   - Hot-patch specific hint text via quick deploy
   - No rollback needed unless widespread

2. **Performance regression:**
   - Unlikely (simple string comparisons)
   - If detected, revert via: `git revert <commit-sha>`

3. **Breaking changes:**
   - Tests will catch breaking changes before merge
   - If tests pass but production breaks: immediate revert + incident review

### Rollback Command
```bash
git revert <commit-sha>
git push origin main
```

Error cards are ephemeral and non-blocking, so even a bad hint doesn't break functionality—worst case is users see the generic fallback they see today.

## Success Metrics
- Reduce "Unexpected error" fallback rate by 40%+
- Decrease user support tickets asking "what does error X mean?"
- Improve developer debugging time via clearer error context
