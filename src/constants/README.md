# Constants

This folder contains application-wide constants and sample data used throughout the bot.

## Overview

The constants folder provides centralized test data and sample content for preview commands, testing, and development. This ensures consistency in how sample data is presented across the application.

## Files

### [sampleData.ts](./sampleData.ts)

Sample data for testing and preview commands, particularly for the gate review system.

**Primary Use Cases:**

- Preview commands (`/gate preview`, `/sample`)
- Development/testing of review UI
- Manual testing of review workflow
- Documentation and screenshots

**Exported Constants:**

| Export                         | Type             | Description                                           |
| ------------------------------ | ---------------- | ----------------------------------------------------- |
| `SAMPLE_ANSWERS_STANDARD`      | `ReviewAnswer[]` | Typical, well-written application responses           |
| `SAMPLE_ANSWERS_LONG`          | `ReviewAnswer[]` | Verbose responses for testing text wrapping/overflow  |
| `SAMPLE_ANSWERS_REJECTED`      | `ReviewAnswer[]` | Low-effort responses demonstrating rejection criteria |
| `SAMPLE_REJECTION_REASON`      | `string`         | Standard rejection message template                   |
| `SAMPLE_REJECTION_REASON_LONG` | `string`         | Detailed rejection message for testing long text      |
| `SAMPLE_HISTORY`               | `object[]`       | Sample action history timeline                        |

## Data Structure

### ReviewAnswer

All sample answer arrays conform to the `ReviewAnswer` type:

```typescript
interface ReviewAnswer {
  q_index: number; // Question number (1-indexed)
  question: string; // The question text
  answer: string; // The user's response
}
```

### Sample Answer Categories

#### 1. **SAMPLE_ANSWERS_STANDARD**

Represents a typical, acceptable application:

- Age: 24
- Well-written, thoughtful responses
- Demonstrates genuine interest
- Follows rules/guidelines
- Positive community attitude

**Use for:** Default previews, documentation, successful application examples

#### 2. **SAMPLE_ANSWERS_LONG**

Extended responses for UI testing:

- Same structure as STANDARD
- 2-4x longer text per answer
- Tests word wrapping, truncation, multi-line display
- Validates embed field limits (1024 chars)

**Use for:** Edge case testing, UI overflow validation, responsive design checks

#### 3. **SAMPLE_ANSWERS_REJECTED**

Low-quality responses demonstrating rejection criteria:

- Minimal effort ("idk", "yeah", "google")
- Short, unhelpful answers
- Empty/missing responses
- Age exactly at minimum (18)

**Use for:** Rejection workflow testing, moderator training examples

## Sample Rejection Reasons

### Standard

```typescript
SAMPLE_REJECTION_REASON = "Application contained incomplete or inconsistent responses.";
```

- Brief, professional
- Used for simple rejections
- Tests single-line display

### Long

```typescript
SAMPLE_REJECTION_REASON_LONG; // ~120 lines of detailed feedback
```

- Multi-paragraph structured feedback
- Numbered concerns
- Actionable recommendations
- Reapply instructions
- Tests multi-line text rendering and embed limits

## Sample History

Represents application lifecycle events:

```typescript
[
  { action: "claim", moderator_id: "...", reason: null, created_at: 1s ago },
  { action: "approved", moderator_id: "...", reason: null, created_at: 2h ago },
  { action: "submitted", moderator_id: "...", reason: null, created_at: 1d ago },
]
```

**Timeline:** Shows realistic review progression (submit → approve → claim)

**Use for:** Testing history display in review cards

## Usage Examples

### Preview Command

```typescript
import {
  SAMPLE_ANSWERS_STANDARD,
  SAMPLE_REJECTION_REASON,
  SAMPLE_HISTORY,
} from "../constants/sampleData.js";

// Show sample approved application
await interaction.reply({
  embeds: [
    buildReviewCard({
      answers: SAMPLE_ANSWERS_STANDARD,
      history: SAMPLE_HISTORY,
      // ... other fields
    }),
  ],
});
```

### Testing Long Text

```typescript
import { SAMPLE_ANSWERS_LONG } from "../constants/sampleData.js";

// Validate UI handles long text gracefully
expect(buildReviewCard({ answers: SAMPLE_ANSWERS_LONG })).toHaveEmbedFieldsWithinLimit(1024);
```

### Rejection Preview

```typescript
import { SAMPLE_ANSWERS_REJECTED, SAMPLE_REJECTION_REASON_LONG } from "../constants/sampleData.js";

// Show sample rejected application
await interaction.reply({
  embeds: [
    buildReviewCard({
      answers: SAMPLE_ANSWERS_REJECTED,
      rejectionReason: SAMPLE_REJECTION_REASON_LONG,
      // ... other fields
    }),
  ],
});
```

## Adding New Constants

### When to Add Constants Here

Add constants to this folder when:

- ✅ Data is used across multiple modules/commands
- ✅ Sample data for testing/previews
- ✅ Application-wide configuration values
- ✅ Shared enums or lookup tables

**Don't add here if:**

- ❌ Data is specific to one module (keep it local)
- ❌ Dynamic configuration (use `src/config/` stores instead)
- ❌ Environment-specific values (use `.env`)
- ❌ Database schema/migrations (use `migrations/`)

### Steps to Add New Sample Data

1. **Define the data structure**

   ```typescript
   export const SAMPLE_NEW_FEATURE = [
     { id: 1, name: "Example" },
     // ...
   ];
   ```

2. **Import the type** (if external)

   ```typescript
   import type { NewFeatureData } from "../features/newFeature.js";
   ```

3. **Document in this README**
   - Add to the "Exported Constants" table
   - Create a usage example
   - Explain the purpose

4. **Use in commands/tests**
   ```typescript
   import { SAMPLE_NEW_FEATURE } from "../constants/sampleData.js";
   ```

### Creating Realistic Sample Data

**Good Sample Data:**

- Representative of real-world usage
- Covers common cases and edge cases
- Uses realistic values (names, ages, text length)
- Follows current community standards
- Contains variety (different response styles)

**Bad Sample Data:**

- Placeholder text ("test", "foo", "asdf")
- Unrealistic values (age 999, empty strings everywhere)
- Offensive or inappropriate content
- Inconsistent with application domain

## Testing

### Validate Sample Data

```bash
# Type check
npm run typecheck

# Ensure imports work
npm run build

# Run any tests using sample data
npm test
```

### Manual Testing

Use preview commands to verify sample data displays correctly:

```
/gate preview standard    # Uses SAMPLE_ANSWERS_STANDARD
/gate preview rejected    # Uses SAMPLE_ANSWERS_REJECTED
/sample                   # General sample data command
```

## Best Practices

### Data Consistency

- **Keep questions aligned:** All sample answer arrays should use the same questions (matching real gate questions)
- **Maintain realistic flow:** Answers should logically follow from questions
- **Update together:** When gate questions change, update all sample datasets

### Performance

- **Static data only:** All exports should be compile-time constants
- **Avoid computation:** No function calls, date calculations should be simple offsets
- **Keep arrays small:** Large datasets should be in JSON files or database

### Documentation

- **Comment each export:** Explain purpose and use case
- **Group related data:** Use section comments to organize
- **Provide examples:** Show how to use the data in context

### Version Control

- **Don't commit sensitive data:** No real user data, even anonymized
- **Review changes carefully:** Sample data changes affect multiple areas
- **Update docs on changes:** Keep this README in sync with exports

## Related Documentation

- [src/ui/reviewCard.ts](../ui/reviewCard.ts) - Review card builder using this data
- [src/commands/sample.ts](../commands/sample.ts) - Sample preview command
- [src/commands/gate.ts](../commands/gate.ts) - Gate commands with preview functionality
- [tests/](../../tests/) - Test files using sample data

## Troubleshooting

### Sample data not showing in preview

**Problem:** `/gate preview` shows empty or incorrect data

**Solutions:**

1. Check import path: `from "../constants/sampleData.js"` (note `.js` extension)
2. Verify export name matches: `SAMPLE_ANSWERS_STANDARD` (case-sensitive)
3. Rebuild: `npm run build`
4. Check for TypeScript errors: `npm run typecheck`

### Type errors with ReviewAnswer

**Problem:** `Type 'X' is not assignable to type 'ReviewAnswer[]'`

**Solutions:**

1. Ensure all objects have `q_index`, `question`, `answer` fields
2. Verify `q_index` is number (not string)
3. Check for typos in field names
4. Import type: `import type { ReviewAnswer } from "../ui/reviewCard.js"`

### History timestamps not working

**Problem:** Sample history shows wrong times

**Cause:** Timestamps are calculated at module load time using `Date.now()`

**Solution:** This is expected behavior - timestamps are relative to when the bot starts. If you need fixed timestamps, replace:

```typescript
created_at: Math.floor(Date.now() / 1000) - 3600;
```

with:

```typescript
created_at: 1234567890; // Fixed Unix timestamp
```

### Long text truncated in embeds

**Problem:** `SAMPLE_ANSWERS_LONG` gets cut off

**Expected:** Discord embed field limit is 1024 characters. This is intentional for testing truncation logic.

**Solution:** Verify your UI code handles truncation gracefully (ellipsis, "show more" button, etc.)

## Future Improvements

Potential enhancements for this folder:

1. **Additional sample categories:**
   - SAMPLE_ANSWERS_NSFW (for NSFW server testing)
   - SAMPLE_ANSWERS_EDGE_CASES (special characters, emoji, mentions)
   - SAMPLE_ANSWERS_MULTILINGUAL (non-English responses)

2. **Sample user profiles:**
   - Different Discord user objects (new accounts, established users, bots)
   - Sample member data (roles, join dates, activity)

3. **Sample configurations:**
   - Different guild configs for testing
   - Sample environment variable sets

4. **Separate test fixtures:**
   - Move to `tests/fixtures/` if data is only used in tests
   - Keep only preview/command data here

5. **JSON data files:**
   - Large sample datasets could be JSON files
   - Import with `import data from "./file.json" assert { type: "json" }`
   - Better for non-code sample data
