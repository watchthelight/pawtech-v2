# Architecture Audit Plan

**Audit Date:** 2025-12-02
**Priority:** High
**Estimated Scope:** ~15 files modified

---

## Executive Summary

The codebase has strong foundations but suffers from permission helper fragmentation, lib/utils confusion, and inconsistent store organization. This plan addresses architectural debt to improve maintainability.

---

## Issues to Fix

### 1. Permission Helper Consolidation

**Problem:** 5 different permission checking approaches scattered across codebase.

**Current State:**
- `src/lib/config.ts:614` - `canRunAllCommands()`
- `src/lib/config.ts:707` - `requireStaff()`
- `src/lib/config.ts:563` - `hasStaffPermissions()`
- `src/lib/config.ts:771` - `hasGateAdmin()`
- `src/utils/requireAdminOrLeadership.ts:41` - `requireAdminOrLeadership()`

**Actions:**
1. Create `src/lib/permissions.ts` with unified permission system:
   ```typescript
   export type PermissionLevel = 'owner' | 'admin' | 'leadership' | 'staff' | 'gate-admin';

   export async function requirePermission(
     interaction: ChatInputCommandInteraction,
     level: PermissionLevel
   ): Promise<boolean>;

   export function hasPermission(
     interaction: ChatInputCommandInteraction,
     level: PermissionLevel
   ): boolean;
   ```

2. Move `src/utils/requireAdminOrLeadership.ts` content into `src/lib/permissions.ts`

3. Update all imports across commands to use new unified module

4. Deprecate old functions with JSDoc `@deprecated` pointing to new function

5. Delete `src/utils/requireAdminOrLeadership.ts` after migration

**Files to modify:**
- `src/lib/permissions.ts` (new)
- `src/lib/config.ts` (add deprecation notices)
- `src/utils/requireAdminOrLeadership.ts` (delete)
- All command files using permission helpers (~25 files)

---

### 2. Merge utils/ into lib/

**Problem:** No clear distinction between `src/lib/` (33 files) and `src/utils/` (7 files).

**Current utils/ contents:**
- `autoDelete.ts` - Used in review handlers
- `dt.ts` - Discord timestamp helper
- `owner.ts` - Owner check utilities
- `requireAdminOrLeadership.ts` - (handled above)
- `typeGuards.ts` - Type guard utilities

**Actions:**
1. Move `src/utils/autoDelete.ts` → `src/lib/autoDelete.ts`
2. Move `src/utils/dt.ts` → `src/lib/dt.ts`
3. Move `src/utils/owner.ts` → `src/lib/owner.ts`
4. Move `src/utils/typeGuards.ts` → `src/lib/typeGuards.ts`
5. Update all imports (use find/replace)
6. Delete `src/utils/` directory
7. Also delete `src/util/` directory (contains only `ensureEnv.ts` which duplicates `lib/env.ts`)

**Files to modify:**
- Move 4 files from utils/ to lib/
- Delete `src/util/ensureEnv.ts`
- Update imports in ~15 files

---

### 3. Fix Duplicate ApplicationRow Type

**Problem:** `ApplicationRow` defined in two places.

**Locations:**
- `src/features/review/types.ts:16` - Canonical definition (KEEP)
- `src/commands/search.ts:84` - Duplicate interface (DELETE)

**Actions:**
1. In `src/commands/search.ts`:
   - Remove local `interface ApplicationRow { ... }`
   - Add import: `import type { ApplicationRow } from "../features/review/types.js";`

2. Verify type compatibility (compare fields)

**Files to modify:**
- `src/commands/search.ts`

---

### 4. Standardize Store Location Pattern

**Problem:** Store functions scattered across 3 directories.

**Current locations:**
```
src/store/           (3 files)
  - flagsStore.ts
  - nsfwFlagsStore.ts
  - auditSessionStore.ts

src/features/        (mixed with features)
  - panicStore.ts
  - statusStore.ts

src/config/          (config-related stores)
  - loggingStore.ts
  - flaggerStore.ts
```

**Recommendation:** Use feature-colocated stores pattern.

**Actions:**
1. Create `src/features/panic/store.ts` and move `panicStore.ts` content
2. Create `src/features/panic/index.ts` barrel file
3. Create `src/features/status/store.ts` and move `statusStore.ts` content
4. Move `src/config/loggingStore.ts` → `src/lib/config/loggingStore.ts`
5. Move `src/config/flaggerStore.ts` → `src/lib/config/flaggerStore.ts`
6. Update all imports

**Files to modify:**
- Create `src/features/panic/` directory structure
- Create `src/features/status/` directory structure
- Create `src/lib/config/` directory structure
- Update imports in ~10 files

---

### 5. Refactor gate.ts into Directory

**Problem:** `src/features/gate.ts` is 1,281 lines - too large.

**Actions:**
1. Create directory structure:
   ```
   src/features/gate/
     ├── index.ts          (barrel exports)
     ├── types.ts          (interfaces, types)
     ├── handlers.ts       (button/modal handlers)
     ├── validation.ts     (input validation)
     ├── avatarScan.ts     (avatar scanning logic)
     ├── draft.ts          (draft management)
     └── questions.ts      (already exists separately!)
   ```

2. Split `gate.ts` by logical sections:
   - Lines 1-100: Imports and types → `types.ts`
   - Lines 101-300: Draft functions → `draft.ts`
   - Lines 301-600: Avatar scanning → `avatarScan.ts`
   - Lines 601-900: Handlers → `handlers.ts`
   - Lines 901-1281: Core gate logic → `index.ts`

3. Create barrel exports in `index.ts`

4. Update imports in:
   - `src/commands/gate/*.ts`
   - `src/index.ts`
   - Any other gate consumers

**Files to modify:**
- Create 6 new files in `src/features/gate/`
- Delete `src/features/gate.ts`
- Update imports in ~8 files

---

### 6. Move Audit Button Handler to Features

**Problem:** `handleAuditButton()` in `src/commands/audit.ts:244-368` contains business logic.

**Actions:**
1. Create `src/features/audit/handlers.ts`
2. Move `handleAuditButton()` function to new file
3. Export from `src/features/audit/index.ts`
4. Update import in `src/index.ts` interaction handler

**Files to modify:**
- Create `src/features/audit/handlers.ts`
- Create `src/features/audit/index.ts`
- Modify `src/commands/audit.ts`
- Modify `src/index.ts`

---

### 7. Consolidate Event Handlers

**Problem:** Event handlers scattered - some in `src/events/`, most inline in `src/index.ts`.

**Current state:**
- `src/events/forumPostNotify.ts` - Standalone event handler
- `src/index.ts` - Contains inline handlers for interactionCreate, messageCreate, guildMemberAdd, etc.

**Actions:**
1. Create event handler files:
   ```
   src/events/
     ├── interactionCreate.ts
     ├── messageCreate.ts
     ├── guildMemberAdd.ts
     ├── guildMemberUpdate.ts
     ├── voiceStateUpdate.ts
     ├── guildDelete.ts
     └── forumPostNotify.ts (already exists)
   ```

2. Extract handler logic from `src/index.ts` into respective files

3. Import and register in `src/index.ts`:
   ```typescript
   import { handleInteractionCreate } from "./events/interactionCreate.js";
   client.on(Events.InteractionCreate, wrapEvent("interactionCreate", handleInteractionCreate));
   ```

**Files to modify:**
- Create 6 new event handler files
- Refactor `src/index.ts` (extract ~500 lines)

---

### 8. Add Import Ordering

**Problem:** Inconsistent import ordering across files.

**Actions:**
1. Install ESLint plugin:
   ```bash
   npm install --save-dev eslint-plugin-simple-import-sort
   ```

2. Add to `.eslintrc.json`:
   ```json
   {
     "plugins": ["simple-import-sort"],
     "rules": {
       "simple-import-sort/imports": "error",
       "simple-import-sort/exports": "error"
     }
   }
   ```

3. Run `npx eslint --fix src/` to auto-fix

**Files to modify:**
- `.eslintrc.json` or `eslint.config.js`
- `package.json` (dev dependency)
- All source files (auto-fixed)

---

## Verification Steps

After completing each section:

1. Run `npm run check` (typecheck + lint + format + test)
2. Run `npm run build` to verify ESM imports work
3. Grep for old import paths to ensure none remain
4. Test bot startup with `npm run dev`

---

## Dependencies

- None of these changes require database migrations
- Changes can be done incrementally
- Each section is independently deployable

---

## Estimated Impact

- **Files modified:** ~60
- **Lines changed:** ~2,000
- **New files:** ~15
- **Deleted files:** ~8
- **Risk level:** Medium (refactoring, no logic changes)
