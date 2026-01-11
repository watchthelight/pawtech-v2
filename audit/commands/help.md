# Command Audit: /help

> File: `src/commands/help/index.ts` | Created: 2025-12-03 | Author: watchthelight

## Overview

**WHAT:** Interactive, searchable help for all bot commands.
**WHY:** Provide discoverable documentation within Discord.
**FLOWS:**
- `/help` → Overview with category buttons
- `/help command:X` → Detailed command view
- `/help search:X` → Search results
- `/help category:X` → Category listing
- Button/Select interactions → Navigation

## Architecture

Modular design:
- `index.ts` - Main handler and interaction routing
- `data.ts` - SlashCommandBuilder definition
- `autocomplete.ts` - Command name autocomplete
- `metadata.ts` - Category info, parsing
- `cache.ts` - Permission filtering, search
- `embeds.ts` - Embed builders
- `components.ts` - Button/select builders
- `registry.ts` - Command registry

## Entry Points

| Type | Location |
|------|----------|
| Registration | `src/commands/buildCommands.ts` |
| Execute | `execute()` |
| Autocomplete | `handleAutocomplete()` |
| Button handlers | `handleHelpButton()` |
| Select handlers | `handleHelpSelect()` |
| Modal handlers | `handleHelpModal()` |

## Permissions Model

| Check | Location | Notes |
|-------|----------|-------|
| Discord perms | `null` | Visible to all |
| Role check | Per-command visibility | Filters by user permissions |
| Guild check | `setDMPermission(false)` | Guild-only |

## Cookie Cutter Delta

| Standard | Status | Notes |
|----------|--------|-------|
| File header | ✅ | Complete with DOCS |
| `CommandContext<I>` signature | ✅ | Uses ctx |
| `withStep()` instrumentation | ⚠️ | Has `ctx.step()` calls |
| Switch-based routing | ✅ | Clean routing |
| Error handling | ✅ | Good try/catch |

## Features

- **Dynamic filtering:** Shows only commands user can access
- **Search:** Fuzzy search across command names and descriptions
- **Pagination:** For categories with many commands
- **Nonce security:** Buttons tied to specific sessions

## Summary

| Severity | Issue | Fix Complexity |
|----------|-------|----------------|
| None | Well-implemented | - |

**Status:** Exemplary modular design. Good separation of concerns.
