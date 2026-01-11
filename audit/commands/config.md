# Command Audit: /config

> File: `src/commands/config/index.ts` | Created: 2025-12-02 | Author: watchthelight

## Overview

**WHAT:** Main configuration router for all bot settings.
**WHY:** Centralized config management for guild settings.
**FLOWS:**
- `/config set <setting>` → Modify role/channel/feature settings
- `/config set-advanced <setting>` → Modify timing/threshold settings
- `/config get <setting>` → View configuration values
- `/config poke <action>` → Manage poke system
- `/config view` → View all configuration
- `/config isitreal` → Configure AI detection
- `/config toggleapis` → Toggle external API integrations

## Architecture

Uses modular handler files:
- `setRoles.ts` - Role configuration (6 handlers)
- `setChannels.ts` - Channel configuration (7 handlers)
- `setFeatures.ts` - Feature toggles (9 handlers)
- `setAdvanced.ts` - Timing/thresholds (13 handlers)
- `artist.ts` - Artist rotation config (3 handlers)
- `movie.ts` - Movie night config (2 handlers)
- `game.ts` - Game night config (2 handlers)
- `poke.ts` - Poke system (4 handlers)
- `get.ts` - View config (varies)
- `isitreal.ts` - AI detection toggle
- `toggleapis.ts` - API toggles

## Routing

Uses `routeKey` pattern: `${subcommandGroup}:${subcommand}`

```typescript
switch (routeKey) {
  case "set:mod_roles": ...
  case "set:gatekeeper": ...
  // ~50 cases total
}
```

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | Varies by handler | |
| Role check | Top of execute | `requireMinRole(ROLE_IDS.ADMINISTRATOR)` |
| Guild check | Early return | Guild-only |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete WHAT/WHY/FLOWS |
| Switch-based routing | ✅ | Uses routeKey pattern |
| Permission at top | ✅ | Before routing |
| Handler signatures | ✅ | All receive ctx |

## Handler Files Status

| File | withStep | withSql | Notes |
|------|----------|---------|-------|
| setRoles.ts | ❌ | ❌ | Needs instrumentation |
| setChannels.ts | ❌ | ❌ | Needs instrumentation |
| setAdvanced.ts | ❌ | ❌ | Needs instrumentation |
| setFeatures.ts | ❌ | ❌ | Needs instrumentation |
| get.ts | ❌ | ❌ | Needs instrumentation |
| artist.ts | ❌ | ❌ | Needs instrumentation |
| movie.ts | ❌ | ❌ | Needs instrumentation |
| game.ts | ❌ | ❌ | Needs instrumentation |
| poke.ts | ❌ | ❌ | Needs instrumentation |

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| P2 | All handlers missing withStep | L (many files) |
| P2 | All handlers missing withSql | L (many files) |

**Recommended commits:**
1. `refactor(config): add withStep to setRoles handlers`
2. `refactor(config): add withStep to setChannels handlers`
3. ... (one per handler file)
