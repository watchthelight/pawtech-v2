# Command Audit: /audit

> File: `src/commands/audit.ts` | Created: 2025-12-02 | Author: watchthelight

## Overview

**WHAT:** Server audit commands for security analysis.
**WHY:** Scan for bot-like accounts, NSFW avatars, and generate security documentation.
**FLOWS:**
- `/audit members` → Scan for bot-like accounts using heuristics
- `/audit nsfw <scope>` → Scan member avatars for NSFW content via Google Vision
- `/audit security` → Generate server permission/security documentation
- `/audit acknowledge <issue_id>` → Mark security warning as intentional
- `/audit unacknowledge <issue_id>` → Remove acknowledgment

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |
| Button handlers | `handleAuditButton()` for `audit:members:*`, `audit:nsfw:*` |

## External Services

| Service | Usage |
|---------|-------|
| Google Vision API | NSFW detection via SafeSearch |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | None set | |
| Role check | Custom | `ALLOWED_ROLES` array (Admin+, Server Dev) |
| Guild check | Lines 80-90 | Guild-only enforcement |

## Rate Limiting

| Subcommand | Limit | Notes |
|------------|-------|-------|
| members | 1 hour/guild | `AUDIT_MEMBERS_MS` |
| nsfw | 1 hour/guild | `AUDIT_NSFW_MS` |

## DB Touches

| Operation | Table | Function |
|-----------|-------|----------|
| Read/Write | `audit_session` | Session tracking |
| Read/Write | `manual_flag` | Bot detection flags |
| Read/Write | `nsfw_flag` | NSFW detection flags |
| Read/Write | `acknowledged_security` | Security acknowledgments |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ⚠️ | Has header but minimal FLOWS |
| `CommandContext<I>` signature | ✅ | Uses ctx properly |
| `withStep()` instrumentation | ⚠️ | Partial coverage |
| `withSql()` for DB | ❌ | Not wrapped |
| Switch-based routing | ✅ | Clean switch |
| Error handling | ✅ | Good try/catch |

## Security

- Uses nonce generation to prevent button spoofing
- Rate limited to prevent API abuse
- Restricted to high-level roles only

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | Missing withSql wrappers | M |
| P2 | Incomplete withStep coverage | M |

**Recommended commits:**
1. `refactor(audit): add withStep to all phases`
2. `refactor(audit): add withSql wrappers for DB operations`
