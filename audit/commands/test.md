# Command Audit: /test

> File: `src/commands/test.ts` | Created: 2026-01-11 | Author: watchthelight

## Overview

**WHAT:** Test command that throws an intentional error.
**WHY:** Tests error handling, logging, and Sentry integration.
**FLOWS:**
- `/test` → Throws error to verify error card and wide event logging

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None | Visible to all (intentional?) |
| Role check | None | No restriction |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ✅ | Wrapped in withStep |

## Security Concern

- No permission check - any user can trigger error
- Should restrict to bot owner or dev role

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | No permission check | S |

**Recommended fix:**
```typescript
import { requireOwnerOnly } from "../lib/owner.js";

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  if (!requireOwnerOnly(ctx.interaction)) return;
  // ...
}
```
