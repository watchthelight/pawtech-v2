# Issue #63: Add CSRF Protection to OAuth Flow

**Status:** Completed
**Priority:** High
**Type:** Security
**Estimated Effort:** 45 minutes

---

## Summary

OAuth2 flow in `src/web/linkedRoles.ts` lacks CSRF protection via state parameter.

## Current State

```typescript
function getAuthorizationUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify role_connections.write",
    // Missing: state parameter
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
```

## Attack Vector

Without state validation, attackers can trick users into authorizing malicious applications by crafting fake authorization links.

## Proposed Changes

1. Generate cryptographically secure state token:

```typescript
import { randomBytes } from "crypto";

const stateStore = new Map<string, { created: number }>();

function generateState(): string {
  const state = randomBytes(32).toString("hex");
  stateStore.set(state, { created: Date.now() });
  return state;
}

function validateState(state: string): boolean {
  const entry = stateStore.get(state);
  if (!entry) return false;

  // Expire after 10 minutes
  if (Date.now() - entry.created > 10 * 60 * 1000) {
    stateStore.delete(state);
    return false;
  }

  stateStore.delete(state); // One-time use
  return true;
}
```

2. Include state in authorization URL:

```typescript
function getAuthorizationUrl(): string {
  const state = generateState();
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify role_connections.write",
    state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
```

3. Validate state on callback:

```typescript
const state = url.searchParams.get("state");
if (!state || !validateState(state)) {
  sendHtml(res, 400, "Invalid or expired state parameter");
  return;
}
```

4. Clean up expired states periodically:

```typescript
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of stateStore) {
    if (now - entry.created > 10 * 60 * 1000) {
      stateStore.delete(state);
    }
  }
}, 60 * 1000); // Every minute
```

## Files Affected

- `src/web/linkedRoles.ts`

## Testing Strategy

1. Test OAuth flow completes successfully with state
2. Test rejection of missing state parameter
3. Test rejection of invalid/expired state
4. Test state is single-use (can't be reused)
