# Issue #75: Migrate linkedRoles.ts to Structured Logging

**Status:** Completed
**Priority:** High
**Type:** Code Quality / Observability
**Estimated Effort:** 30 minutes

---

## Summary

`src/web/linkedRoles.ts` uses console.* for all logging (13 occurrences) instead of the structured pino logger, reducing observability and making debugging difficult.

## Current State

```typescript
// Line 35
console.error("Missing CLIENT_ID in .env");

// Lines 116-117
console.log("Sending role connection request:");
console.log("  Body:", JSON.stringify(body));

// Line 152
console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);
```

## Impact

- Web server logging not structured for monitoring
- No correlation IDs for request tracing
- Error logs lack context (timestamps, trace IDs)
- Security-sensitive OAuth flow has poor audit trail
- Debug output appears in production logs

## Proposed Changes

Import and use the structured logger:

```typescript
import { logger } from "../lib/logger.js";

// Replace console.error with:
logger.error({ requiredVar: "CLIENT_ID" }, "[linkedRoles] Missing required environment variable");

// Replace debug console.log with:
logger.debug({ body }, "[linkedRoles] Role connection request");

// Replace request logging with:
logger.info({ method: req.method, pathname }, "[linkedRoles] HTTP request");
```

## Files Affected

- `src/web/linkedRoles.ts:35,39-40,116-117,129-130,152,177,185,201,204,206,208,213`

## Testing Strategy

1. Test OAuth flow still works
2. Verify logs appear in structured format
3. Check log levels are appropriate
