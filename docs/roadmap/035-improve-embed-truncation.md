# Issue #35: Improve Embed Truncation Logic

**Status:** Planned
**Priority:** Medium (Reliability)
**Estimated Effort:** 2-3 hours
**Created:** 2025-11-30

## Summary

The Discord embed truncation logic in `reviewCard.ts` uses fragile string-based section detection with `indexOf()` to remove content when exceeding Discord's 4096 character limit. If section headers change (e.g., "Action History" becomes "Recent Actions"), the truncation silently fails, potentially causing embed submission errors or displaying truncated content in unexpected places.

## Current State

### Problem

**Location:** `src/ui/reviewCard.ts:656-680`

The current implementation has three sequential truncation attempts:

1. **Remove Action History** (lines 656-664)
   ```typescript
   const actionHistoryStart = description.indexOf("**Action History");
   const answersStart = description.indexOf("**Answers:**");
   if (actionHistoryStart !== -1 && answersStart !== -1 && actionHistoryStart < answersStart) {
     description = description.slice(0, actionHistoryStart) + description.slice(answersStart);
   }
   ```

2. **Remove Application History** (lines 667-675)
   ```typescript
   const appHistoryStart = description.indexOf("**Application History");
   const actionHistoryStart = description.indexOf("**Action History");
   const nextSection = actionHistoryStart !== -1 ? actionHistoryStart : description.indexOf("**Answers:**");
   if (appHistoryStart !== -1 && nextSection !== -1 && appHistoryStart < nextSection) {
     description = description.slice(0, appHistoryStart) + description.slice(nextSection);
   }
   ```

3. **Hard Truncate** (lines 677-680)
   ```typescript
   if (description.length > 4000) {
     description = description.slice(0, 3950) + "\n\n*...content truncated for Discord limits*";
   }
   ```

### Fragility Issues

1. **Silent failures:** If header text changes, `indexOf()` returns `-1` and truncation is skipped
2. **Hardcoded strings:** Section headers are duplicated as magic strings (defined at lines 575, 603, 617)
3. **No size tracking:** Content is built blindly, only measured after joining all lines
4. **Order dependency:** Truncation assumes specific section ordering
5. **Regex cleanup:** `description.replace(/\n{3,}/g, "\n\n")` masks underlying issues

### Risk Assessment

- **Attack Vector:** None (internal reliability issue)
- **Impact:** Discord API errors when embed exceeds 4096 chars, or wrong content removed
- **Likelihood:** Medium - header text changes during refactoring are common
- **Severity:** MEDIUM - degrades user experience, may break moderation workflow
- **Current Mitigation:** Hard truncation at 3950 chars (last resort)

## Proposed Changes

### Overview

Replace string-based truncation with structured section building that tracks size in real-time and defines clear priority levels for content removal.

### Step 1: Define Section Priority Constants

**Goal:** Establish content importance hierarchy

Add to top of `buildReviewEmbed()` function (after line 486):

```typescript
// Section priority for truncation (lower = remove first)
const SECTION_PRIORITY = {
  ACTION_HISTORY: 1,      // Remove first - moderator actions are in logs
  APP_HISTORY: 2,         // Remove second - visible in database
  AVATAR_SCAN: 3,         // Keep - critical for review decisions
  MEMBER_INFO: 4,         // Keep - essential context
  ANSWERS: 5,             // Keep - core application content
} as const;

// Discord embed description limit
const DISCORD_MAX_LENGTH = 4096;
const TARGET_LENGTH = 4000; // Buffer for safety
```

### Step 2: Create Section Builder Interface

**Goal:** Track sections with metadata for intelligent truncation

Add after constants (around line 500):

```typescript
interface EmbedSection {
  priority: number;
  name: string;
  lines: string[];
  estimatedSize: number;
}

function buildSection(priority: number, name: string, lines: string[]): EmbedSection {
  const content = lines.join("\n");
  return {
    priority,
    name,
    lines,
    estimatedSize: content.length,
  };
}
```

### Step 3: Build Sections with Metadata

**Goal:** Replace direct `lines.push()` with structured section building

Update each section to use `buildSection()`:

**Application History Section** (replace lines 571-597):
```typescript
const appHistorySection: EmbedSection | null = (() => {
  if (!previousApps || previousApps.length <= 1) return null;
  const otherApps = previousApps.filter(a => a.id !== app.id);
  if (otherApps.length === 0) return null;

  const sectionLines: string[] = [];
  sectionLines.push(`**Application History** (${previousApps.length} total)`);

  for (const pastApp of otherApps) {
    const statusIcon = pastApp.status === 'approved' ? '✅' :
                      pastApp.status === 'rejected' ? '❌' :
                      pastApp.status === 'kicked' ? '🚫' :
                      pastApp.status === 'submitted' ? '⏳' : '📝';
    const appCode = shortCode(pastApp.id);
    const submittedTs = pastApp.submitted_at ? new Date(pastApp.submitted_at) : null;
    const timeStr = submittedTs ? ts(submittedTs, 'R') : 'unknown';
    let line = `${statusIcon} #${appCode} • ${pastApp.status} • ${timeStr}`;
    if (pastApp.resolution_reason) {
      const truncatedReason = pastApp.resolution_reason.length > 50
        ? pastApp.resolution_reason.slice(0, 47) + '...'
        : pastApp.resolution_reason;
      line += ` — "${truncatedReason}"`;
    }
    sectionLines.push(line);
  }

  sectionLines.push(EMPTY, DIVIDER, EMPTY);
  return buildSection(SECTION_PRIORITY.APP_HISTORY, "Application History", sectionLines);
})();
```

**Action History Section** (replace lines 602-611):
```typescript
const actionHistorySection: EmbedSection | null = (() => {
  if (!recentActions || recentActions.length === 0) return null;

  const sectionLines: string[] = [];
  sectionLines.push(`**Action History (Last ${Math.min(recentActions.length, 7)})**`);

  for (const a of recentActions.slice(0, 7)) {
    const actionDisplay = formatActionWithIcon(a.action);
    sectionLines.push(`${actionDisplay} by <@${a.moderator_id}> — ${ts(a.created_at * 1000, 'R')}`);
  }

  sectionLines.push(EMPTY, DIVIDER, EMPTY);
  return buildSection(SECTION_PRIORITY.ACTION_HISTORY, "Action History", sectionLines);
})();
```

### Step 4: Implement Smart Truncation

**Goal:** Remove sections by priority until size is acceptable

Replace truncation logic (lines 656-680) with:

```typescript
// Collect all sections (core content always included)
const coreLines = lines; // Lines built before sections (header, member info, avatar scan)
const optionalSections: EmbedSection[] = [
  appHistorySection,
  actionHistorySection,
].filter((s): s is EmbedSection => s !== null);

// Sort by priority (lowest first = remove first)
optionalSections.sort((a, b) => a.priority - b.priority);

// Build description with intelligent truncation
let description = coreLines.join("\n");
let currentSize = description.length;

// Add answers section size (always included)
const answersSize = [...lines.slice(lines.indexOf("**Answers:**"))].join("\n").length;
currentSize += answersSize;

// Add optional sections if they fit
const includedSections: EmbedSection[] = [];
for (const section of optionalSections.sort((a, b) => b.priority - a.priority)) {
  const projectedSize = currentSize + section.estimatedSize;
  if (projectedSize <= TARGET_LENGTH) {
    includedSections.push(section);
    currentSize = projectedSize;
  }
}

// Rebuild description with included sections
const finalLines: string[] = [];

// Add core content (everything before optional sections)
const firstOptionalIndex = lines.findIndex(l =>
  l.startsWith("**Application History") || l.startsWith("**Action History")
);
if (firstOptionalIndex !== -1) {
  finalLines.push(...lines.slice(0, firstOptionalIndex));
} else {
  finalLines.push(...lines.slice(0, lines.indexOf("**Answers:**")));
}

// Add included sections in document order (not priority order)
if (includedSections.some(s => s.name === "Application History")) {
  const section = includedSections.find(s => s.name === "Application History")!;
  finalLines.push(...section.lines);
}
if (includedSections.some(s => s.name === "Action History")) {
  const section = includedSections.find(s => s.name === "Action History")!;
  finalLines.push(...section.lines);
}

// Always add answers section
const answersIndex = lines.indexOf("**Answers:**");
finalLines.push(...lines.slice(answersIndex));

description = finalLines.join("\n");

// Final safety check with hard truncation
if (description.length > TARGET_LENGTH) {
  description = description.slice(0, 3950) + "\n\n*...content truncated for Discord limits*";
}
```

### Step 5: Add Truncation Logging

**Goal:** Track when truncation occurs for debugging

Add before `embed.setDescription()` (around line 682):

```typescript
// Log truncation events for monitoring
if (description.length > TARGET_LENGTH) {
  const removedSections = optionalSections
    .filter(s => !includedSections.includes(s))
    .map(s => s.name);

  if (removedSections.length > 0) {
    console.warn(
      `[reviewCard] Truncated embed for app ${shortCode(app.id)}: ` +
      `removed sections: ${removedSections.join(", ")} ` +
      `(${description.length} chars -> ${Math.min(description.length, 3950)} chars)`
    );
  }
}
```

## Files Affected

### Modified
- `src/ui/reviewCard.ts`
  - Add `SECTION_PRIORITY` constants (~line 487)
  - Add `EmbedSection` interface and `buildSection()` helper (~line 500)
  - Refactor Application History section (~line 571)
  - Refactor Action History section (~line 602)
  - Replace truncation logic with smart section removal (~line 656)
  - Add truncation logging (~line 682)

### Reviewed (no changes needed)
- No other files import or depend on truncation logic
- This is an internal implementation detail of `buildReviewEmbed()`

## Testing Strategy

### Pre-Change Testing

1. **Capture current behavior**
   ```bash
   # Test review card generation with various content sizes
   # Document which sections are removed in edge cases
   ```

2. **Identify edge cases**
   - No optional sections (minimal embed)
   - All optional sections present (maximal embed)
   - Content that triggers truncation
   - Content just under limit

### Functional Testing

1. **Unit Tests for Section Builder**

   Create test cases for `buildSection()`:
   ```typescript
   describe("buildSection", () => {
     it("calculates size correctly", () => {
       const section = buildSection(1, "Test", ["line1", "line2"]);
       expect(section.estimatedSize).toBe("line1\nline2".length);
     });

     it("preserves priority and name", () => {
       const section = buildSection(5, "Important", []);
       expect(section.priority).toBe(5);
       expect(section.name).toBe("Important");
     });
   });
   ```

2. **Integration Tests for Truncation**

   Test realistic scenarios:
   ```typescript
   describe("Smart truncation", () => {
     it("removes low-priority sections first", () => {
       // Build embed with oversized content
       // Verify Action History removed before App History
     });

     it("preserves answers section always", () => {
       // Build embed with all sections oversized
       // Verify Answers section is never removed
     });

     it("handles no truncation needed", () => {
       // Build embed under limit
       // Verify all sections included
     });

     it("applies hard truncation as last resort", () => {
       // Build embed with Answers section alone exceeding limit
       // Verify hard truncation applied with warning message
     });
   });
   ```

3. **Regression Testing**
   ```bash
   # Test against production database exports
   # Verify no embeds break or change unexpectedly
   npm run test:reviewCard
   ```

### Manual Testing

1. **Visual inspection in Discord**
   - Send test embeds to development channel
   - Verify formatting, spacing, and content order
   - Confirm truncation warnings appear when expected

2. **Header change resilience**
   - Temporarily rename section headers
   - Verify truncation still works correctly
   - Restore original headers

3. **Size boundary testing**
   - Create applications with answers totaling ~3000, 3500, 4000, 4500 chars
   - Verify sections removed in correct order
   - Confirm no Discord API errors

## Rollback Plan

### If Truncation Logic Breaks

**Scenario:** Smart truncation removes wrong sections or breaks embed format

1. **Immediate Rollback**
   ```bash
   git revert <commit-hash>
   npm run build
   npm run deploy
   ```

2. **Investigation**
   - Check truncation logs for removed sections
   - Identify which embed configuration caused issue
   - Document size calculations vs actual sizes

3. **Fix Options**
   - **Option A:** Adjust `TARGET_LENGTH` buffer (more conservative)
   - **Option B:** Fix size estimation logic in `buildSection()`
   - **Option C:** Adjust section priority levels

### If Performance Degrades

**Scenario:** Section building adds noticeable latency

1. **Measure impact**
   ```bash
   # Add timing logs around buildReviewEmbed()
   console.time("buildReviewEmbed");
   // ... function logic
   console.timeEnd("buildReviewEmbed");
   ```

2. **Optimization strategies**
   - Cache section size calculations
   - Lazy-build sections only when needed
   - Pre-filter sections before size estimation

3. **If unfixable:** Revert to original string-based approach with better header constants

### Emergency Procedure

If deployed and causing moderation workflow disruption:

```bash
# 1. Hotfix: Remove truncation entirely (always hard-truncate)
# Edit reviewCard.ts to skip smart logic, go straight to hard truncate

# 2. Deploy hotfix immediately
npm run build && npm run deploy

# 3. Fix properly in separate branch
git checkout -b fix/truncation-logic
# Debug and test thoroughly

# 4. Re-deploy with full test coverage
```

## Success Criteria

- [ ] `SECTION_PRIORITY` constants defined with clear hierarchy
- [ ] `EmbedSection` interface and `buildSection()` helper implemented
- [ ] Application History section uses structured building
- [ ] Action History section uses structured building
- [ ] Smart truncation removes sections by priority
- [ ] Truncation logging tracks removed sections
- [ ] All section removals are intentional (no silent failures)
- [ ] Header text changes do not break truncation
- [ ] Hard truncation only triggers when answers section too large
- [ ] No Discord API errors from oversized embeds
- [ ] Unit tests cover section building and truncation logic
- [ ] Integration tests verify real-world scenarios
- [ ] Performance impact negligible (< 5ms added latency)

## Timeline

1. **Hour 1: Implementation** (Steps 1-3) - 45 minutes
   - Define constants and interfaces
   - Refactor section building to use structured approach
   - Update both optional sections

2. **Hour 1-2: Smart Truncation** (Steps 4-5) - 45 minutes
   - Implement priority-based truncation algorithm
   - Add logging for debugging
   - Manual testing in Discord

3. **Hour 2-3: Testing** - 60 minutes
   - Write unit tests for section builder
   - Write integration tests for truncation scenarios
   - Run regression tests on existing data
   - Manual edge case testing

4. **Buffer** - 30 minutes
   - Handle unexpected edge cases
   - Documentation updates
   - Code review

**Total estimated time:** 2-3 hours

## Benefits

### Reliability
- No silent failures when headers change
- Predictable truncation behavior
- Clear priority system

### Maintainability
- Section headers defined once (DRY principle)
- Easy to adjust priority levels
- Self-documenting code structure

### Debuggability
- Truncation events logged
- Size tracking visible
- Clear separation of concerns

## References

- **Discord API Limits:** https://discord.com/developers/docs/resources/channel#embed-object-embed-limits
- **Current implementation:** `src/ui/reviewCard.ts:656-680`
- **Section definitions:** Lines 575, 603, 617
