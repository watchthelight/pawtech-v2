# Monster File Cleanup Plan

Generated: 2025-11-27

## Executive Summary

Complete the extraction of code from `review.ts` (3,246 lines) and `modmail.ts` (2,686 lines) into their submodule directories. Extraction was partially completed but significant duplicate code remains.

---

## Current State Analysis

### review.ts (3,246 lines)

**Already Extracted to review/ (2,547 lines):**

| File | Lines | Contents |
|------|-------|----------|
| `review/types.ts` | 155 | All type definitions |
| `review/claims.ts` | 100 | Claim guard, queries, mutations |
| `review/queries.ts` | 123 | Application queries |
| `review/handlers.ts` | 1,536 | All button/modal handlers |
| `review/flows/approve.ts` | 197 | approveTx, approveFlow |
| `review/flows/reject.ts` | 132 | rejectTx, rejectFlow |
| `review/flows/kick.ts` | 197 | kickTx, kickFlow |
| `review/flows/index.ts` | 15 | Barrel exports |
| `review/index.ts` | 92 | Main barrel |

**Still Duplicated in review.ts:**
- Lines 117-230: Type definitions
- Lines 231-364: Claim functions
- Lines 366-729: Transaction and flow functions
- Lines 734-1892: Handlers

**NOT YET EXTRACTED (unique):**
- `renderReviewEmbed()` - lines 2317-2561 (~245 lines)
- `buildDecisionComponents()` - lines 2566-2623 (~58 lines)
- `ensureReviewMessage()` - lines 2668-3020 (~353 lines)
- Welcome functions - lines 3021-3246 (~226 lines)

### modmail.ts (2,686 lines)

**Already Extracted to modmail/ (3,056 lines):**

| File | Lines | Contents |
|------|-------|----------|
| `modmail/types.ts` | 94 | Type definitions |
| `modmail/tickets.ts` | 225 | Ticket CRUD |
| `modmail/transcript.ts` | 306 | Transcript functions |
| `modmail/routing.ts` | 423 | Message routing |
| `modmail/threads.ts` | 1,708 | Thread operations |
| `modmail/handlers.ts` | 208 | Button handlers |
| `modmail/index.ts` | 92 | Main barrel |

**NOT YET EXTRACTED (unique):**
- `modmailCommand` SlashCommandBuilder (~23 lines)
- `executeModmailCommand()` (~44 lines)
- `modmailContextMenu` (~5 lines)

---

## Extraction Plan

### Phase 1: Extract Review Card Functions

#### Step 1.1: Create `review/card.ts`

Extract:
- `renderReviewEmbed()`
- `buildDecisionComponents()`
- `ensureReviewMessage()`
- Helper functions for card lifecycle

**Effort:** 3-4 hours

#### Step 1.2: Create `review/welcome.ts`

Extract:
- `DEFAULT_WELCOME_TEMPLATE`
- `renderWelcomeTemplate()`
- `postWelcomeMessage()`
- `buildWelcomeNotice()`
- `logWelcomeFailure()`
- `formatSubmittedFooter()`

**Effort:** 1-2 hours

#### Step 1.3: Update `review/index.ts`

Add exports for new modules.

**Effort:** 0.5 hours

---

### Phase 2: Extract Modmail Commands

#### Step 2.1: Create `modmail/commands.ts`

Extract:
- `modmailCommand` (SlashCommandBuilder)
- `executeModmailCommand()`
- `modmailContextMenu` (ContextMenuCommandBuilder)

**Effort:** 1 hour

#### Step 2.2: Update `modmail/index.ts`

Update exports, remove re-exports from parent.

**Effort:** 0.5 hours

---

### Phase 3: Remove Duplicate Code

#### Step 3.1: Clean review.ts

1. Remove duplicate types → replace with re-export
2. Remove duplicate claim functions
3. Remove duplicate transactions
4. Remove duplicate flows
5. Remove duplicate handlers
6. Keep only barrel re-exports

**Target:** ~50-100 lines (re-exports only)
**Effort:** 2-3 hours

#### Step 3.2: Clean modmail.ts

Same approach - convert to barrel file.

**Target:** ~50-100 lines
**Effort:** 2-3 hours

---

## Backwards Compatibility

All imports must continue working:

```typescript
// Before and after cleanup, this works:
import { ensureReviewMessage } from "./features/review.js";

// Because review.ts becomes:
export * from "./review/index.js";
```

---

## Verification Checklist

Before each step:
1. `grep -r "from.*review.js" src/` - list imports
2. `grep -r "from.*modmail.js" src/` - list imports

After each step:
1. `npm run build` - TypeScript compilation
2. `npm test` - Unit tests
3. Manual smoke test

---

## Effort Estimates

| Phase | Task | Hours | Risk |
|-------|------|-------|------|
| 1.1 | Extract `review/card.ts` | 3-4 | Medium |
| 1.2 | Extract `review/welcome.ts` | 1-2 | Low |
| 1.3 | Update barrel | 0.5 | Low |
| 2.1 | Extract `modmail/commands.ts` | 1 | Low |
| 2.2 | Update barrel | 0.5 | Low |
| 3.1 | Clean review.ts | 2-3 | High |
| 3.2 | Clean modmail.ts | 2-3 | High |
| - | Testing | 2-3 | - |
| **Total** | | **12-17 hours** | |

---

## Final State Metrics

| File | Current | Target | Reduction |
|------|---------|--------|-----------|
| `review.ts` | 3,246 | ~100 | 97% |
| `modmail.ts` | 2,686 | ~100 | 96% |
| `review/` total | 2,547 | ~3,400 | +33% |
| `modmail/` total | 3,056 | ~3,200 | +5% |

---

## Rollback Strategy

Each phase = separate PR:
1. Phase 1.1-1.3: review card + welcome
2. Phase 2.1-2.2: modmail commands
3. Phase 3.1: review cleanup
4. Phase 3.2: modmail cleanup

Revert specific PR if issues arise.
