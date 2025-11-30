# Issue #40: Extract allowedMentions Pattern to Shared Constant

## Summary

The pattern `allowedMentions: { parse: [] }` appears 34 times across 12 files to prevent accidental @mentions in log messages, audit trails, and automated notifications. This duplicated object literal should be extracted to a shared constant for consistency and maintainability.

**Priority:** Low (Code Quality)
**Type:** Refactoring
**Affected Area:** Logging, modmail, review system, events, commands

## Current State

### Problem Description

The `allowedMentions: { parse: [] }` pattern is scattered throughout the codebase with minor variations in comments and formatting:

**Distribution by File (34 total occurrences):**
- `src/features/modmail/threads.ts` - 7 occurrences
- `src/features/review/handlers.ts` - 7 occurrences
- `src/features/modmail/handlers.ts` - 5 occurrences
- `src/features/modmail/routing.ts` - 3 occurrences
- `src/features/modmail/transcript.ts` - 2 occurrences
- `src/features/review/card.ts` - 2 occurrences
- `src/logging/pretty.ts` - 2 occurrences
- `src/lib/configCard.ts` - 2 occurrences
- `src/events/forumThreadNotify.ts` - 1 occurrence
- `src/events/forumPostNotify.ts` - 1 occurrence
- `src/commands/send.ts` - 1 occurrence
- `src/commands/modstats.ts` - 1 occurrence

### Example Usages

```typescript
// src/logging/pretty.ts:419
allowedMentions: { parse: [] }, // Suppress all mentions in logs

// src/events/forumThreadNotify.ts:204
allowedMentions: { parse: [] }, // No mentions at all

// src/commands/send.ts:174
allowedMentions: { parse: [] }, // Never ping from audit logs

// src/features/modmail/threads.ts:665
await thread.send({ embeds: [embed], components: [buttons], allowedMentions: { parse: [] } });
```

### Why This Matters

1. **Consistency:** Ensures all logs/notifications use the same mention suppression strategy
2. **Maintainability:** Single place to update if Discord.js API changes
3. **Documentation:** Named constant makes intent clearer than inline object
4. **Type Safety:** Shared constant is defined once with correct TypeScript type

## Proposed Changes

### Step 1: Add Constant to Existing Constants File

If `src/lib/constants.ts` exists (from Issue #27), add to it. Otherwise, create the file:

**File:** `src/lib/constants.ts`

```typescript
/**
 * Pawtropolis Tech — src/lib/constants.ts
 * WHAT: Centralized application constants
 * WHY: Single source of truth for shared values, improves maintainability
 */

import type { MessageMentionOptions } from "discord.js";

// ===== Discord Message Options =====

/**
 * Suppresses all @mentions in messages (users, roles, everyone/here)
 * USE CASE: Logs, audit trails, automated notifications that quote user content
 * WHY: Prevents accidental pings when echoing user input or displaying metadata
 */
export const SAFE_ALLOWED_MENTIONS: MessageMentionOptions = { parse: [] };
```

### Step 2: Update Logging Module

**File:** `src/logging/pretty.ts` (2 occurrences)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../lib/constants.js";

// Replace line 419:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

### Step 3: Update Event Handlers

**File:** `src/events/forumThreadNotify.ts` (1 occurrence)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../lib/constants.js";

// Replace line 204:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

**File:** `src/events/forumPostNotify.ts` (1 occurrence)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../lib/constants.js";

// Replace:
allowedMentions: { parse: [] }
// With:
allowedMentions: SAFE_ALLOWED_MENTIONS
```

### Step 4: Update Commands

**File:** `src/commands/send.ts` (1 occurrence)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../lib/constants.js";

// Replace line 174:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

**File:** `src/commands/modstats.ts` (1 occurrence)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../lib/constants.js";

// Replace line 532:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

### Step 5: Update Config Utilities

**File:** `src/lib/configCard.ts` (2 occurrences)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "./constants.js";

// Replace both occurrences:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

### Step 6: Update Modmail Feature (5 files, 17 total occurrences)

**File:** `src/features/modmail/threads.ts` (7 occurrences)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";

// Replace all 7 occurrences:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

**File:** `src/features/modmail/handlers.ts` (5 occurrences)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";

// Replace all 5 occurrences:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

**File:** `src/features/modmail/routing.ts` (3 occurrences)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";

// Replace all 3 occurrences:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

**File:** `src/features/modmail/transcript.ts` (2 occurrences)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";

// Replace both occurrences:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

### Step 7: Update Review Feature (2 files, 9 total occurrences)

**File:** `src/features/review/handlers.ts` (7 occurrences)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";

// Replace all 7 occurrences:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

**File:** `src/features/review/card.ts` (2 occurrences)

```typescript
import { SAFE_ALLOWED_MENTIONS } from "../../lib/constants.js";

// Replace both occurrences:
allowedMentions: SAFE_ALLOWED_MENTIONS,
```

## Files Affected

### New File
1. `src/lib/constants.ts` - Create or update with SAFE_ALLOWED_MENTIONS constant

### Updates Required (12 files, 34 replacements)
2. `src/logging/pretty.ts` (2)
3. `src/events/forumThreadNotify.ts` (1)
4. `src/events/forumPostNotify.ts` (1)
5. `src/commands/send.ts` (1)
6. `src/commands/modstats.ts` (1)
7. `src/lib/configCard.ts` (2)
8. `src/features/modmail/threads.ts` (7)
9. `src/features/modmail/handlers.ts` (5)
10. `src/features/modmail/routing.ts` (3)
11. `src/features/modmail/transcript.ts` (2)
12. `src/features/review/handlers.ts` (7)
13. `src/features/review/card.ts` (2)

## Testing Strategy

### 1. Compile-Time Verification
```bash
npm run build
```
Ensure TypeScript compilation succeeds with correct type for `MessageMentionOptions`.

### 2. Runtime Verification

**Test 1: Logging (pretty.ts)**
- Trigger error that generates log message with user mentions
- Verify mentions are NOT clickable/pingable in log channel

**Test 2: Modmail System**
```bash
# Create new modmail ticket with @mentions in message
# Verify:
- Thread creation message doesn't ping
- Transcript doesn't ping quoted users
- Routing notifications don't ping
```

**Test 3: Review System**
```bash
# Submit content with @mentions for review
# Verify:
- Review card displays mentions as plain text
- Review notifications don't ping mentioned users
```

**Test 4: Commands**
```bash
# /send command with message containing @mentions
# Verify audit log doesn't trigger pings

# /modstats command
# Verify output suppresses mentions
```

**Test 5: Forum Events**
- Create forum post with role mentions
- Verify notification messages don't ping roles

### 3. Code Review Checklist
- [ ] Import paths use correct relative paths (../../lib/constants.js)
- [ ] Type annotation matches Discord.js MessageMentionOptions
- [ ] Constant name follows SCREAMING_SNAKE_CASE convention
- [ ] JSDoc comment explains purpose and use cases
- [ ] All 34 occurrences replaced (verify with grep)

### 4. Verification Command
```bash
# Before merge, confirm no remaining inline patterns:
grep -r "allowedMentions.*parse.*\[\]" src/
# Should only find the constant definition itself
```

## Rollback Plan

### Immediate Rollback (Git Revert)

```bash
# Identify commit hash
git log --oneline -5

# Revert the changes
git revert <commit-hash>

# Rebuild and restart
npm run build
pm2 restart pawtropolis-tech
```

### Manual Rollback (If Partial Merge)

If only some files were updated:

1. Remove constant from `src/lib/constants.ts`:
   ```typescript
   // Delete SAFE_ALLOWED_MENTIONS constant and import
   ```

2. Restore inline pattern in affected files:
   ```bash
   # Find files importing SAFE_ALLOWED_MENTIONS
   grep -l "SAFE_ALLOWED_MENTIONS" src/**/*.ts

   # For each file, replace:
   import { SAFE_ALLOWED_MENTIONS } from "...";
   allowedMentions: SAFE_ALLOWED_MENTIONS,

   # With original:
   allowedMentions: { parse: [] },
   ```

3. Rebuild: `npm run build`

### Verification After Rollback

```bash
# Test modmail still works
# Create ticket and verify no errors

# Test review system
# Submit review and verify no errors

# Check logs
pm2 logs pawtropolis-tech --lines 50
```

## Success Criteria

- [ ] Single `SAFE_ALLOWED_MENTIONS` constant defined in `src/lib/constants.ts`
- [ ] All 34 inline occurrences replaced with constant reference
- [ ] Zero remaining `allowedMentions: { parse: [] }` patterns in src/
- [ ] TypeScript compilation succeeds with no type errors
- [ ] All mention suppression behavior unchanged (no accidental pings)
- [ ] Modmail transcripts still suppress mentions correctly
- [ ] Review cards still display mentions as plain text
- [ ] Audit logs don't trigger user/role pings

## Implementation Notes

**Estimated Time:** 1-2 hours

**Dependencies:**
- None (standalone refactoring)
- Complementary to Issue #27 (magic numbers) if constants.ts already exists

**Breaking Changes:** None (refactoring only)

**Performance Impact:** None (constant reference is compile-time)

**Related Issues:**
- Issue #27: Extract Magic Numbers (shares constants.ts file)

**Best Practices:**
- Always use `SAFE_ALLOWED_MENTIONS` for logs, transcripts, audit trails
- Only allow mentions in direct user-facing responses where pings are intentional
- Document any exceptions where `{ parse: ['users'] }` or similar is needed

**Future Considerations:**
- Consider additional constants for common patterns:
  - `USER_MENTIONS_ONLY: { parse: ['users'] }`
  - `ROLE_MENTIONS_ONLY: { parse: ['roles'] }`
- Add ESLint rule to flag new inline `allowedMentions: { parse: [] }` patterns
