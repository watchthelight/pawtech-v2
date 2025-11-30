# Issue #64: Move Hardcoded Guild IDs to Environment Variables

**Status:** Completed
**Priority:** Critical
**Type:** Security / Configuration
**Estimated Effort:** 20 minutes

---

## Summary

Multiple scripts contain hardcoded guild ID `896070888594759740` instead of using environment variables.

## Current State

```bash
# scripts/BACKFILL-NOW.sh:4
GUILD_ID="896070888594759740"

# scripts/setup-level-rewards.ts:9
const GUILD_ID = "896070888594759740";

# scripts/check-bot-permissions.ts:9
const GUILD_ID = "896070888594759740";
```

## Risk

- Scripts are not portable to other environments
- Exposes production server identifiers in code
- Could affect wrong guild if used carelessly

## Proposed Changes

1. Update shell scripts:

```bash
GUILD_ID="${GUILD_ID:-896070888594759740}"
```

2. Update TypeScript scripts:

```typescript
const GUILD_ID = process.env.GUILD_ID || "896070888594759740";
if (!GUILD_ID) {
  console.error("Error: GUILD_ID environment variable required");
  process.exit(1);
}
```

3. Add GUILD_ID to .env.example with documentation

## Files Affected

- `scripts/BACKFILL-NOW.sh`
- `scripts/setup-level-rewards.ts`
- `scripts/check-bot-permissions.ts`
- `.env.example`

## Testing Strategy

1. Test scripts with GUILD_ID environment variable set
2. Test fallback to default when not set
3. Verify scripts still function correctly
