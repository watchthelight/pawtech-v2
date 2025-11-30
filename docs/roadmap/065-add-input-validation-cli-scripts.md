# Issue #65: Add Input Validation to CLI Scripts

**Status:** Completed
**Priority:** High
**Type:** Security / Code Quality
**Estimated Effort:** 30 minutes

---

## Summary

CLI scripts accept user-provided arguments without validation, potentially causing runtime errors or unexpected behavior.

## Current State

```typescript
// backfill-message-activity.ts
const guildId = process.argv[2];  // No validation
const weeks = parseInt(process.argv[3] || '8', 10);  // parseInt but no NaN check

// check-channel-access.ts
const channelId = process.argv[2];  // No validation

// diagnostic-activity.ts
const guildId = process.argv[2];  // No validation
```

## Proposed Changes

1. Add validation helper function:

```typescript
function validateDiscordId(id: string | undefined, name: string): string {
  if (!id) {
    console.error(`Error: ${name} is required`);
    process.exit(1);
  }
  if (!/^\d{17,19}$/.test(id)) {
    console.error(`Error: ${name} must be a valid Discord snowflake (17-19 digits)`);
    process.exit(1);
  }
  return id;
}

function validatePositiveInt(value: string | undefined, name: string, min: number, max: number, defaultValue: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (isNaN(num) || num < min || num > max) {
    console.error(`Error: ${name} must be between ${min} and ${max}`);
    process.exit(1);
  }
  return num;
}
```

2. Apply to scripts:

```typescript
// backfill-message-activity.ts
const guildId = validateDiscordId(process.argv[2], "guildId");
const weeks = validatePositiveInt(process.argv[3], "weeks", 1, 8, 8);

// check-channel-access.ts
const channelId = validateDiscordId(process.argv[2], "channelId");
```

## Files Affected

- `scripts/backfill-message-activity.ts`
- `scripts/check-channel-access.ts`
- `scripts/diagnostic-activity.ts`
- `scripts/backfill-app-mappings.ts`

## Testing Strategy

1. Test with valid inputs
2. Test with invalid inputs (non-numeric, too short, too long)
3. Test with missing required arguments
4. Verify helpful error messages displayed
