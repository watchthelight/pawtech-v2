# Backend Changelog

## November 2025 - Major Codebase Audit

### Dead Code Removal
- Removed unused `tracer.ts`, `RedisNotifyLimiter`, event wrappers (~150 lines)
- Deleted dead `forumThreadNotify.ts` (~230 lines)
- Removed unused functions: `execRaw`, `storeScan`, `buildCandidateSelectMenu`, UI helpers

### Security Fixes
- Added SQL identifier validation preventing injection attacks
- Added column allowlist for ALTER TABLE operations
- Fixed XSS in linked roles by escaping user content
- Added CSRF protection to OAuth with state validation
- Added rate limiting to OAuth endpoints
- Added pre-flight bot permission & hierarchy checks for role config

### Memory Leak Prevention
- Fixed modmail message tracking with bounded Map (~500KB max)
- Fixed uncleaned intervals with `.unref()`
- Created reusable `LRUCache` utility with size limits and TTL
- Replaced unbounded Maps with LRU caches (config, logging, flagger, drafts)

### Error Handling & Observability
- Wrapped `interactionCreate` and `messageCreate` with `wrapEvent`
- Added debug logging to 50+ empty catch handlers
- Migrated to structured Pino logging across commands
- Added audit trail failure logging with retry support
- Added scheduler health monitoring with alerting

### Database & Performance
- Added composite indexes for modmail tickets and applications
- Fixed cache invalidation race condition in logging store
- Fixed full table scan in gate shortcode check - scoped to guild
- Moved schema checks from runtime to startup

### Type Safety & Code Quality
- Consolidated duplicate claim implementations
- Extracted shared `requireAdminOrLeadership` helper
- Fixed unsafe `as any` casts with proper type guards
- Standardized `claimed_at` field type and timestamp formats

### Configuration Improvements
- Moved artist rotation IDs to database config
- Moved poke category IDs to database config
- Removed hardcoded role/guild IDs - now configurable per guild
- Made movie night threshold configurable

### Code Cleanup
- Consolidated tracing systems (tracer.ts → reqctx.ts)
- Standardized ephemeral reply patterns
- Extracted magic numbers to named constants
- Simplified null checks using optional chaining

### Reliability
- Fixed race condition in artist rotation queue with atomic transactions
- Fixed `perm_reject` status inconsistency
- Added panic mode check to gate verification
- Added fault tolerance with `Promise.allSettled` for analytics
