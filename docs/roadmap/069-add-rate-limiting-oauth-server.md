# Issue #69: Add Rate Limiting to OAuth Server

**Status:** Completed
**Priority:** High
**Type:** Security
**Estimated Effort:** 30 minutes

---

## Summary

`src/web/linkedRoles.ts` OAuth server has no rate limiting, allowing potential abuse.

## Current State

No rate limiting on any endpoints:
- `/` - Server info
- `/linked-roles` - OAuth initiation
- `/linked-roles/callback` - OAuth callback

## Attack Vectors

- Attacker could spam authorization requests
- Could exhaust Discord API rate limits (getting app blocked)
- No protection against automated abuse

## Proposed Changes

1. Add simple in-memory rate limiter:

```typescript
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

const RATE_LIMIT = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,     // 10 requests per minute
};

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return true;
  }

  if (entry.count >= RATE_LIMIT.maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) {
      rateLimits.delete(ip);
    }
  }
}, 60 * 1000);
```

2. Apply to request handler:

```typescript
const clientIp = req.socket.remoteAddress || "unknown";

if (!checkRateLimit(clientIp)) {
  res.writeHead(429, {
    "Content-Type": "text/plain",
    "Retry-After": "60"
  });
  res.end("Too Many Requests. Please try again later.");
  return;
}
```

3. Add stricter limits for OAuth endpoints:

```typescript
const OAUTH_RATE_LIMIT = {
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 5,          // 5 OAuth attempts per 5 minutes
};
```

## Files Affected

- `src/web/linkedRoles.ts`

## Testing Strategy

1. Test normal requests pass through
2. Test rate limit triggers after threshold
3. Test rate limit resets after window
4. Test 429 response includes Retry-After header
