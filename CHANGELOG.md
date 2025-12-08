# Changelog

All notable changes to Pawtropolis Tech will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [4.8.0] - 2025-12-08

### Added

- **Intelligent Permission Denied Cards** - Permission errors now show specific role requirements:
  - Displays the exact roles needed to use each command (e.g., "@Community Manager", "@Bot Developer")
  - Dynamically resolves role IDs to names from the server
  - Unique error messages per command with descriptions
  - Shows config-based roles (mod roles, reviewer role) and Discord permissions
  - Ephemeral embed with trace ID for debugging

- **"Is It Real?" Context Menu** - Right-click any message → Apps → "Is It Real?" to scan images for AI generation without typing the full command

- **Skull Mode** - Random skull emoji reactions on messages:
  - `/skullmode chance:N` - Set the odds (1-1000) for skull reactions
  - `/config set skullmode enabled:true/false` - Toggle skull mode on/off
  - Staff-only (requires mod roles configured via `/config set mod_roles`)

### Removed

- **"Modmail: Open" Context Menu** - Removed the right-click context menu for opening modmail threads

### Fixed

- **Welcome Card Retry Logic** - Added retry logic for transient network errors (e.g., "other side closed"):
  - Retries up to 3 times with linear backoff (500ms, 1000ms, 1500ms)
  - Handles undici socket errors (UND_ERR_SOCKET, connection resets, timeouts)
  - Logs retry attempts for debugging

- **Bot Dev Ping on Application** - Fixed `ping_dev_on_app` feature not working:
  - The setting was configurable via `/config set pingdevonapp` but pings were never sent
  - Now pings `bot_dev_role_id` when `ping_dev_on_app` is enabled on new application submissions

### Changed

- **`/update status` Clear Support** - Running `/update status` without text now clears the custom status instead of requiring text

- **AI Detection: Illuminarty → RapidAPI** - Replaced Illuminarty API with RapidAPI AI Art Detection:
  - New env var: `RAPIDAPI_KEY` (replaces `ILLUMINARTY_API_KEY`)
  - Signup: https://rapidapi.com/hammas.majeed/api/ai-generated-image-detection-api
  - `/config isitreal` updated with new service info and setup wizard
  - Detection module rewritten for RapidAPI endpoint format

---

## [4.7.1] - 2025-12-03

### Fixed

- **Help Command Interaction Routing** - Fixed autocomplete and select menu interactions being rejected:
  - Added `isAutocomplete()` to interaction router (was returning early as "other")
  - Added `isStringSelectMenu()` to interaction router (same issue)
  - Autocomplete now works correctly for `/help command:` option

### Changed

- **Help Command User Restriction** - Only the person who ran `/help` can use buttons and select menus on that message
- **Help Command Minimal Design** - Removed all emojis from help system for cleaner appearance:
  - Removed category emojis from buttons and embeds
  - Removed decorative emojis (book, lightbulb, search, error icons)

---

## [4.7.0] - 2025-12-03

### Added

- **Interactive Help System** - Comprehensive `/help` command with intelligent navigation and search:
  - **Full command coverage**: Detailed documentation for all 30+ commands with examples, options, and workflow tips
  - **Category browsing**: 9 categories (Gate, Config, Moderation, Queue, Analytics, Messaging, Roles, Artist, System)
  - **Intelligent search**: Full-text search across command names, aliases, descriptions, and subcommands
  - **Search modal**: Button-triggered modal for entering search queries
  - **Autocomplete**: Permission-filtered suggestions as you type in `/help command:`
  - **Permission-aware**: Commands filtered based on user roles - only shows what you can access
  - **Quick vs Full mode**: Toggle between concise overview and detailed documentation
  - **Smart workflow tips**: Contextual suggestions like "Check /listopen for your next review"
  - **Related commands**: One-click navigation to related commands
  - **Mobile-friendly**: All content in embed descriptions for optimal mobile display

- **Movie Attendance Intelligence** - Enhanced movie night tracking with crash recovery and manual adjustments:
  - **Late start handling**: Users already in the voice channel when `/movie start` is run are now automatically credited
  - **Crash recovery**: Sessions are persisted to database every 5 minutes and recovered on bot restart
  - **`/movie add @user <minutes> [reason]`**: Manually add minutes to a user's current event attendance
  - **`/movie credit @user <date> <minutes> [reason]`**: Credit attendance to any past event date
  - **`/movie bump @user [date] [reason]`**: Give a user full qualified credit for compensation
  - **`/movie resume`**: Check status of recovered session after bot restart
  - Audit logging for all manual adjustments with actor tracking and reason fields
  - New database tables: `active_movie_events`, `active_movie_sessions` for persistence
  - New columns in `movie_attendance`: `adjustment_type`, `adjusted_by`, `adjustment_reason`

- **AI Detection Setup Wizard** - New `/config isitreal` command for interactive API key configuration:
  - Visual dashboard showing all 4 services (Hive, Illuminarty, SightEngine, Optic) with health status
  - One-click setup buttons for each service with modal dialogs to enter API keys
  - Automatic key validation and testing before saving
  - Direct .env file injection with runtime hot-reload (no bot restart required)
  - Access limited to server owner, community managers (leadership role), and bot owner
  - Links to signup pages for each service

---

## [4.6.0] - 2025-12-03

### Added

- **AI Detection Command** - New `/isitreal` command to detect AI-generated images in messages using external APIs:
  - Hive Moderation, SightEngine, Optic AI Or Not (Illuminarty support planned)
  - Averages scores across all configured services
  - Shows per-service breakdown with visual score bars
  - Ephemeral response for staff-only visibility
  - Permission controlled via `mod_role_ids` guild config (same as other staff commands)
  - New environment variables: `HIVE_API_KEY`, `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET`, `OPTIC_API_KEY` (all optional)

### Documentation

- **Handbook Cross-Linking** - Added "Related Documentation" sections to all handbooks:
  - `BOT-HANDBOOK.md` - Links to MOD-HANDBOOK, MOD-QUICKREF, CHANGELOG
  - `docs/MOD-HANDBOOK.md` - Links to BOT-HANDBOOK, MOD-QUICKREF, CHANGELOG
  - `MOD-QUICKREF.md` - Links to both handbooks and changelog, added Audit & Detection Tools section
  - `docs/README.md` - Added Staff Handbooks section, fixed broken roadmap link
  - `docs/reference/slash-commands.md` - Added note pointing to BOT-HANDBOOK for user-friendly docs
- Fixed outdated permission reference in BOT-HANDBOOK (removed `/suggest` which was removed in v4.3.0)
- Updated "Last revised" dates

### Removed

- **Dead Code Cleanup** (~1,400 lines removed):
  - `src/lib/auditHelper.ts` - Never imported anywhere (~132 lines)
  - `src/lib/startupHealth.ts` - Never imported anywhere (~300 lines)
  - `src/lib/validation.ts` - Never imported anywhere (~132 lines, was added in 4.5.0 but never integrated)
  - `src/lib/retry.ts` - Removed unused `CircuitBreaker` class and `CircuitBreakerOpenError` (~240 lines)
  - `src/db/ensure.ts` - Removed `ensureActionLogAnalyticsIndex()` (duplicate of index created in db.ts)
  - `src/db/db.ts` - Removed obsolete `dm_bridge` table creation (superseded by `modmail_bridge`)
  - 14 obsolete `.sql` migration files (~639 lines) - Migration runner only processes `.ts` files
- Fixed duplicate migration number: renamed `034_drop_unused_tables.ts` to `035_drop_unused_tables.ts`
- Removed unused `PermissionFlagsBits` import from `src/commands/search.ts`

### Chores

- Removed 10 empty orphaned directories: `tests/ui`, `tests/components`, `tests/api`, `tests/events`, `tests/e2e`, `docs/plans`, `logs`, `.github/`, `authentication`, `src/commands/config/handlers`

---

## [4.5.0] - 2025-12-02

### Database

- **Prepared Statement Caching** (Audit 005) - Converted inline `db.prepare()` calls to module-level cached constants across 10 store files for improved query performance:
  - `src/store/flagsStore.ts` - 6 cached statements
  - `src/store/nsfwFlagsStore.ts` - 4 cached statements
  - `src/store/auditSessionStore.ts` - 8 cached statements
  - `src/config/loggingStore.ts` - 2 cached statements
  - `src/config/flaggerStore.ts` - 3 cached statements
  - `src/features/panicStore.ts` - 4 cached statements
  - `src/features/statusStore.ts` - 3 cached statements
  - `src/features/artJobs/store.ts` - 13 cached statements
  - `src/features/review/queries.ts` - 4 cached statements
  - `src/features/artistRotation/queue.ts` - 20 cached statements
- **Transaction Wrapping** (Audit 005) - Added `db.transaction()` wrapper to `removeArtist()` in `artistRotation/queue.ts` to ensure atomic DELETE + position reorder operations
- **Validation Helpers** (Audit 005) - New `src/lib/validation.ts` with:
  - `validateSnowflake(id, fieldName)` - Throws `ValidationError` if not a valid 17-20 digit Discord snowflake
  - `validateNonEmpty(value, fieldName)` - Throws `ValidationError` if empty or whitespace-only
  - `isValidSnowflake(id)` - Non-throwing boolean check
  - `isNonEmpty(value)` - Non-throwing boolean check
  - `ValidationError` class for distinguishing validation errors

### Security

- **SQL Injection Prevention** (Audit 002) - Added allowlist validation in `artJobs/store.ts` for dynamic column names in `updateJobStatus()`. Invalid field names now throw an error instead of being interpolated into SQL.
- **API Key Protection** (Audit 002) - Moved Google Vision API key from URL query parameter to `X-Goog-Api-Key` header in `googleVision.ts` to prevent accidental exposure in logs.
- **Database Recovery Authorization** (Audit 002) - Added admin/leadership permission check for `/database recover` command. Staff-level access is no longer sufficient for this destructive operation.
- **Command Injection Prevention** (Audit 002) - Added regex validation for `PM2_PROCESS_NAME`, `REMOTE_ALIAS`, and `REMOTE_PATH` environment variables in `env.ts` to prevent shell command injection.
- **Rate Limiting** (Audit 002) - Created `src/lib/rateLimiter.ts` module and applied rate limits to expensive operations:
  - `/audit nsfw` - 1 hour cooldown per guild
  - `/audit members` - 1 hour cooldown per guild
  - `/database check` - 5 minute cooldown per user
- **Input Validation** (Audit 002) - Added `MAX_REASON_LENGTH` (512 chars) validation to `/kick` and `/reject` commands to prevent database bloat.
- **Path Traversal Protection** (Audit 002) - Added `safeJoinPath()` function and `SAFE_FILENAME_REGEX` validation in `dbRecovery.ts` to prevent directory traversal attacks when handling backup filenames.

### Refactored
- **Architecture Cleanup** (Audit 001) - Consolidated scattered utility modules:
  - Merged `src/utils/` into `src/lib/`: `autoDelete.ts`, `dt.ts`, `owner.ts`, `typeGuards.ts`
  - Deleted duplicate `src/util/ensureEnv.ts` (functionality exists in `lib/env.ts`)
  - Moved `requireAdminOrLeadership` from `utils/requireAdminOrLeadership.ts` to `lib/config.ts`
  - Renamed `ApplicationRow` to `SearchResultRow` in `src/commands/search.ts` to avoid type collision with `review/types.ts`
  - Updated all import paths across ~15 files

### Changed
- **Error Handling Improvements** (Audit 006) - Fixed empty catch blocks and improved error handling:
  - `src/commands/audit.ts` - Added debug logging to 6 empty catch blocks
  - `src/commands/health.ts` - Added debug logging to timeout catch block
  - `src/commands/listopen.ts` - Added debug logging to pagination catch block
  - `src/commands/audit.ts` - Added user notification when background audits fail catastrophically
  - `src/features/googleVision.ts` - Added error classification and Sentry reporting for non-transient errors
  - `src/features/avatarNsfwMonitor.ts` - Added fallback DM to guild owner when alert channel fails
  - `src/index.ts` - Added user notification when modmail message routing fails

### Performance
- **N+1 Query Fix: Modstats Leaderboard** (Audit 003) - Batch fetch members instead of sequential API calls
  - Before: 15 sequential Discord API calls (50-200ms each) = 750-3000ms
  - After: 1 batch API call = 100-300ms
  - Location: `src/commands/modstats/leaderboard.ts`
- **N+1 Query Fix: Claim-to-Decision Time** (Audit 003) - Rewritten with SQL CTE and self-join
  - Before: N+1 queries (1 + N decisions = 50-750 queries per moderator)
  - After: 1 query per moderator
  - Location: `src/commands/modstats/helpers.ts` (`getAvgClaimToDecision`)
- **N+1 Query Fix: Submit-to-First-Claim Time** (Audit 003) - Rewritten with SQL CTE and self-join
  - Before: N+1 queries (1 + N submissions = 100+ queries)
  - After: 1 query total
  - Location: `src/commands/modstats/helpers.ts` (`getAvgSubmitToFirstClaim`)
- **NSFW Audit Batch Processing** (Audit 003) - Replaced sequential API calls with concurrent batching
  - Before: Sequential with 100ms sleep per member = 100+ seconds for 1000 members
  - After: 10 concurrent requests with 200ms between batches = ~15 seconds for 1000 members
  - Location: `src/commands/audit.ts` (`runNsfwAudit`)
- **New Performance Indexes** (Audit 003) - Added 5 composite indexes for common query patterns
  - `idx_action_log_app_action_time` - For claim-to-decision queries
  - `idx_action_log_actor_action_time` - For modstats actor queries
  - `idx_action_log_guild_app` - For guild+app_id queries
  - `idx_nsfw_flags_user` - For NSFW flag lookups
  - `idx_modmail_guild_status_user` - For modmail ticket queries
  - Location: `migrations/034_add_performance_indexes.ts`
- **Buffer Overflow Protection** (Audit 003) - Added max buffer size with oldest-message eviction
  - Prevents OOM during DB outages or traffic spikes
  - Max 10,000 entries (~1MB), drops oldest 10% when full
  - Location: `src/features/messageActivityLogger.ts`

### Cleanup
- **Dead Code Removal** (Audit 004) - Removed unused functions, constants, and prepared database table drop:
  - **Database:** Added migration `034_drop_unused_tables.ts` to drop empty tables: `ping_log`, `dm_bridge`, `suggestion`, `suggestion_vote`
  - **Artist Rotation:** Removed deprecated `IGNORED_ARTIST_USER_IDS` constant and `moveToEnd()` function (use `processAssignment()` instead)
  - **Command Sync:** Removed `syncGuildCommandsInProcess()` from `commandSync.ts` (use `scripts/deploy-commands.ts`)
  - **Error Helpers:** Removed unused `isInteractionExpired()`, `isAlreadyAcknowledged()`, `isDatabaseCorrupt()` from `errors.ts`
  - **Time Formatters:** Removed unused `formatAbsolute()`, `formatAbsoluteUtc()`, `toIso()` from `timefmt.ts`
  - **Percentiles:** Removed unused `computePercentile()` singular (plural version kept) from `percentiles.ts`
  - **PM2:** Removed unused `isPM2Available()` from `pm2.ts`
  - **Audit Session Store:** Removed unused `isUserScanned()`, `getScannedCount()` from `auditSessionStore.ts`
  - **NSFW Flags Store:** Removed unused `isNsfwFlagged()`, `getNsfwFlagCount()`, `getPendingNsfwFlags()` from `nsfwFlagsStore.ts`
  - **Constants:** Removed 9 unused constants from `constants.ts`: `DB_RECOVERY_OPERATION_DELAY_MS`, `SLOW_EVENT_THRESHOLD_MS`, `MS_PER_SECOND`, `SECONDS_PER_MINUTE`, `SECONDS_PER_HOUR`, `BANNER_SYNC_MIN_INTERVAL_MS`, `OAUTH_RATE_LIMIT_MAX_OAUTH_REQUESTS`, `OAUTH_STATE_TOKEN_EXPIRY_MS`, `RATE_LIMIT_CLEANUP_INTERVAL_MS`
  - **Tests:** Removed corresponding tests for deleted functions in `timefmt.test.ts` and `errors.test.ts`

---

## [4.4.4] - 2025-12-03

### Changed
- **Modmail Threads Full Decomposition** - Completed decomposition of `threads.ts` (1,709 LOC):
  - `threadState.ts` - In-memory OPEN_MODMAIL_THREADS set and hydration
  - `threadPerms.ts` - Permission checks, setup, and retrofit functions
  - `threadOpen.ts` - Thread opening with race condition protection
  - `threadClose.ts` - Thread closing and auto-close on decisions
  - `threadReopen.ts` - Thread reopening within 7-day window
  - `threads.ts` now barrel file re-exporting from modules
- **Modstats Decomposition** - Split `modstats.ts` (824 LOC) into modular structure:
  - `modstats/index.ts` - Command definition and execute router
  - `modstats/helpers.ts` - Time formatting and DB query utilities
  - `modstats/leaderboard.ts` - Leaderboard and CSV export handlers
  - `modstats/userStats.ts` - Individual moderator statistics handler
  - `modstats/reset.ts` - Reset handler with rate limiting
  - Original `modstats.ts` now barrel file re-exporting from modstats/
- **Gate Commands Decomposition** - Split `gate.ts` (1,405 LOC) into modular structure:
  - `gate/index.ts` - Re-exports all commands
  - `gate/shared.ts` - Shared imports and utilities
  - `gate/gateMain.ts` - Main /gate command (setup, reset, status, config, welcome)
  - `gate/accept.ts` - /accept command for approving applications
  - `gate/reject.ts` - /reject command with permanent rejection option
  - `gate/kick.ts` - /kick command for removing applicants
  - `gate/unclaim.ts` - /unclaim command for releasing claims
  - Original `gate.ts` now barrel file re-exporting from gate/
- **Config Commands Decomposition** - Split `config.ts` (2,525 LOC) into modular structure:
  - `config/index.ts` - Execute router
  - `config/data.ts` - SlashCommandBuilder definition
  - `config/shared.ts` - Shared imports and utilities
  - `config/setRoles.ts` - Role setting handlers (6 handlers)
  - `config/setChannels.ts` - Channel setting handlers (7 handlers)
  - `config/setFeatures.ts` - Feature toggle handlers (8 handlers)
  - `config/setAdvanced.ts` - Advanced/timing handlers (13 handlers)
  - `config/artist.ts` - Artist rotation handlers (3 handlers)
  - `config/movie.ts` - Movie night handlers (2 handlers)
  - `config/poke.ts` - Poke configuration handlers (5 handlers)
  - `config/get.ts` - View and getter handlers (3 handlers)
  - Original `config.ts` now barrel file re-exporting from config/
- **Decomposition Plan Completed** - All 5 large files decomposed (100%)
  - `handlers.ts` ✅ (v4.4.3)
  - `threads.ts` ✅ (v4.4.4)
  - `modstats.ts` ✅ (v4.4.4)
  - `gate.ts` ✅ (v4.4.4)
  - `config.ts` ✅ (v4.4.4)

---

## [4.4.3] - 2025-12-03

### Added
- **Decomposition Plan** (`docs/DECOMPOSITION-PLAN.md`) - Technical plan to break down 5 large files into smaller modules for better maintainability

### Changed
- **Review Handlers Decomposition** - Split `handlers.ts` (1,643 LOC) into modular structure:
  - `handlers/helpers.ts` - Helper functions and modal openers
  - `handlers/actionRunners.ts` - Approve/reject/kick action orchestration
  - `handlers/claimHandlers.ts` - Claim/unclaim handlers
  - `handlers/buttons.ts` - Button interaction handlers
  - `handlers/modals.ts` - Modal submission handlers
  - `handlers/index.ts` - Barrel file for re-exports
  - Original `handlers.ts` now re-exports from handlers/ for backward compatibility
- **Modmail Thread State** - Extracted `threadState.ts` from `threads.ts`:
  - OPEN_MODMAIL_THREADS set and hydration logic
  - Helper functions: addOpenThread, removeOpenThread, isOpenModmailThread

---

## [4.4.2] - 2025-12-03

### Changed
- **Banner Update Command** - Removed website references (website no longer exists)
  - Removed "Website background (via API)" from success message
  - Updated command description

---

## [4.4.1] - 2025-12-03

### Added
- **AI Image Detection Tools** in MOD-HANDBOOK — Links to Hive Moderation, Was It AI, and SightEngine for checking AI-generated content

---

## [4.4.0] - 2025-12-03

### Added
- **Real-time NSFW Avatar Monitor** - Automatic scanning when users change avatars
  - Listens to `guildMemberUpdate` events for avatar changes
  - Scans new avatars with Google Vision API (80% threshold)
  - Sends alert to logging channel with mod role ping
  - Includes reverse image search link
  - `src/features/avatarNsfwMonitor.ts` - New event listener
- **NSFW Audit Resume Functionality** - Resume interrupted audits
  - New `audit_sessions` and `audit_scanned_users` tables track progress
  - Detects incomplete sessions and offers Resume/Start Fresh options
  - Skips already-scanned users when resuming
  - `src/store/auditSessionStore.ts` - Session tracking functions
- **Health Command Enhancement** - Shows "Event Listeners" section
  - Displays "NSFW Avatar Monitor: Active" status

### Changed
- **NSFW Audit Progress** - Better real-time feedback
  - Progress bar now shows actual `current/total` (e.g., `500/2,500`)
  - Updates every 10 members instead of 50
  - Shows percentage completion
  - Progress saved to database (survives restarts)

---

## [4.3.0] - 2025-12-02

### Added
- **Audit Command Subcommands** - Split `/audit` into two subcommands:
  - `/audit members` - Bot detection audit (existing functionality)
  - `/audit nsfw` - NEW: Scan member avatars for NSFW content using Google Vision API
    - Scope options: "All members" or "Flagged members only"
    - Threshold: 80%+ (Hard Evidence) to flag
    - Includes reverse image search link for staff verification
    - New `nsfw_flags` table separate from bot detection flags
    - `src/store/nsfwFlagsStore.ts` - NSFW flag storage functions
    - `migrations/032_nsfw_flags.ts` - New table for NSFW flags

### Changed
- **Bot Account Audit System** - Refactored to use subcommand structure
  - `src/commands/audit.ts` - Now routes to `/audit members` or `/audit nsfw`
  - `src/lib/modalPatterns.ts` - Updated button patterns for new customId format
  - `src/store/flagsStore.ts` - Added `getFlaggedUserIds()` for NSFW audit scope

### Removed
- Suggestions feature (~1,700 lines) - unused, no guilds had configured it
  - `src/commands/suggest.ts`, `suggestion.ts`, `suggestions.ts`
  - `src/features/suggestions/` directory (embeds.ts, store.ts, voting.ts)

---

## [4.2.0] - 2025-12-01

### Added
- `migrations/031_add_configurable_settings.ts` (96 lines) - New configurable settings migration

### Changed
- Major expansion of `src/commands/config.ts` (+561 lines) - Extended configuration options
- Enhanced `src/lib/config.ts` (+19 lines)
- Updated `scripts/deploy.sh`

---

## [4.1.0] - 2025-12-01

### Changed
- Enhanced `src/commands/config.ts` (+292 lines) - New configuration options
- Enhanced `src/features/artistRotation/constants.ts` (+31 lines)
- Enhanced `src/commands/artistqueue.ts` (+10 lines)
- Enhanced `src/commands/backfill.ts` (+24 lines)
- Enhanced `src/features/gate.ts` (+15 lines)

---

## [4.0.3] - 2025-12-01

### Changed
- Minor BOT-HANDBOOK.md fixes (5 lines)

---

## [4.0.2] - 2025-12-01

### Changed
- Enhanced `BOT-HANDBOOK.md` (+223 lines) - Expanded documentation
- Enhanced `docs/MOD-HANDBOOK.md` (+10 lines)

---

## [4.0.1] - 2025-12-01

### Changed
- Enhanced `docs/MOD-HANDBOOK.md` (+3 lines)

---

## [4.0.0] - 2025-12-01

### Added
- **Art Jobs Tracking System** (1,535 lines)
  - `src/commands/art.ts` (759 lines) - `/art` command for tracking art commissions and requests
  - `src/features/artJobs/index.ts` (9 lines)
  - `src/features/artJobs/store.ts` (298 lines) - Art job database operations
  - `src/features/artJobs/types.ts` (62 lines) - Type definitions
- Art jobs schema in `src/db/db.ts` (+34 lines)

### Changed
- Enhanced `src/commands/search.ts` (+145 lines) - Art search integration
- Enhanced `docs/MOD-HANDBOOK.md` (+200 lines) - Art system documentation
- Enhanced `src/commands/artistqueue.ts` (+17 lines)
- Enhanced `src/features/artistRotation/handlers.ts` (+10 lines)

---

## [3.1.2] - 2025-11-30

### Added
- `docs/MOD-HANDBOOK.md` (753 lines) - Comprehensive moderator handbook

### Removed
- `src/commands/cage.ts` (175 lines) - Cage command removed
- Cage assets (cage.jpg, cage.png, cage.webp, cage_transparent.png)

### Changed
- Updated MOD-QUICKREF.md
- Updated buildCommands.ts

---

## [3.1.1] - 2025-11-30

### Removed
- 89 roadmap files (18,287 lines) - Consolidated into audit document

---

## [3.1.0] - 2025-11-30

### Added
- **Memory Leak Fixes**
  - `src/lib/lruCache.ts` (169 lines) - LRU cache implementation for bounded memory
  - `tests/lib/lruCache.test.ts` (372 lines)
- **Scheduler Health Monitoring**
  - `src/lib/schedulerHealth.ts` (157 lines) - Monitor scheduler health
  - `tests/lib/schedulerHealth.test.ts` (268 lines)
- `src/lib/auditHelper.ts` (131 lines) - Audit logging utilities
- `migrations/030_add_support_channel_id.ts` (55 lines)
- `scripts/cleanup-test-data.ts` (194 lines)
- `BACKEND_CHANGELOG.md` (59 lines)
- 40 new roadmap items (050-089) for additional audit findings

### Changed
- Enhanced `src/commands/config.ts` (+633 lines) - Many new configuration options
- Enhanced `src/features/review/handlers.ts` - Major refactoring
- Enhanced `src/web/linkedRoles.ts` (+190 lines) - OAuth improvements
- Enhanced all 3 schedulers with health monitoring integration
- Enhanced `src/commands/poke.ts` (+85 lines)
- Enhanced `src/commands/roles.ts` (+83 lines)
- Enhanced `src/features/analytics/command.ts` (+79 lines)
- Enhanced `src/features/artistRotation/constants.ts` (+102 lines)

### Fixed
- 40+ issues identified in codebase audit across 60+ files

---

## [3.0.0] - 2025-11-30

### Added
- **Comprehensive Codebase Audit** ([full report](docs/CODEBASE_AUDIT_2025-11-30.md))
  - Conducted by 5 parallel project-manager agents
  - Identified 48 issues (10 critical, 12 high, 15 medium, 11 low)
  - ~546 lines of dead code identified
- 49 roadmap items (001-049) from audit findings
- `src/commands/cage.ts` (175 lines) - Cage command
- `src/utils/requireAdminOrLeadership.ts` (83 lines) - Shared authentication helper
- `src/utils/typeGuards.ts` (53 lines) - Discord.js type guards
- `migrations/027_standardize_guild_config_timestamps.ts` (125 lines)
- `migrations/028_review_action_free_text.ts` (renamed/refactored)
- `migrations/029_add_movie_threshold.ts` (45 lines)
- `docs/reference/command-checklist.md` (62 lines)
- Asset files (bars.png, square1.png, square2.png, square3.png)
- `tests/features/modmail/routing.test.ts` (264 lines)

### Removed
- `src/events/forumThreadNotify.ts` (230 lines) - Dead code, superseded by forumPostNotify.ts
- `src/lib/tracer.ts` (56 lines) - Consolidated to reqctx system
- Old planning docs: Discussion.md, ERROR_HANDLING_PLAN.md, IMPROVEMENT_PLAN.md, roadmap.md (~2,400 lines)

### Changed
- Enhanced review system handlers (+296 lines)
- Enhanced error hints (+107 lines in tests)

### Fixed
- SQL injection vulnerability in `migrations/lib/helpers.ts` (+34 lines validation)
- Cache invalidation order in `loggingStore.ts`
- Artist rotation queue race conditions (+81 lines)
- Modmail routing memory leak (+74 lines)

### Security
- Added SQL identifier validation to migration helpers
- Fixed cache invalidation race condition
- Documented need for shared secure comparison utility

---

## [2.3.11] - 2025-11-29

### Changed
- BOT-HANDBOOK.md table of contents overhaul (+270 lines)
- Section reorganization for better navigation

---

## [2.3.10] - 2025-11-29

### Changed
- Enhanced BOT-HANDBOOK.md (+108 lines)

---

## [2.3.9] - 2025-11-29

### Added
- `BOT-HANDBOOK.md.backup` (1,180 lines)

### Changed
- Major BOT-HANDBOOK.md expansion (+1,358 lines)

---

## [2.3.8] - 2025-11-29

### Changed
- BOT-HANDBOOK.md content reorganization (+626 lines)
- Added detailed command documentation

---

## [2.3.3 - 2.3.7] - 2025-11-29

### Changed
- Multiple MOD-QUICKREF.md formatting and content updates

---

## [2.3.2] - 2025-11-29

### Added
- `MOD-QUICKREF.md` (115 lines) - Quick reference guide for moderators

### Changed
- Enhanced BOT-HANDBOOK.md (+8 lines)

---

## [2.3.1] - 2025-11-29

### Added
- `BOT-HANDBOOK.md` (697 lines) - Comprehensive staff documentation
  - Complete command reference
  - Gate system workflow documentation
  - Moderator tools guide
  - Configuration reference

### Changed
- Enhanced `src/commands/gate.ts` (+182 lines)

---

## [2.3.0] - 2025-11-29

### Added
- **Artist Rotation System** (2,398 lines)
  - `src/commands/artistqueue.ts` (535 lines) - Queue management
  - `src/commands/redeemreward.ts` (258 lines) - Reward redemption
  - `src/features/artistRotation/` directory:
    - `constants.ts` (44 lines)
    - `handlers.ts` (222 lines)
    - `index.ts` (12 lines)
    - `queue.ts` (426 lines)
    - `roleSync.ts` (150 lines)
    - `types.ts` (74 lines)
  - `docs/plans/ARTIST_ROTATION_SYSTEM.md` (581 lines)
- Artist rotation database schema (+50 lines in db.ts)

---

## [2.2.0] - 2025-11-28

### Added
- **Search System**
  - `src/commands/search.ts` (266 lines) - User and message search
- **Suggestions System** (later removed in 4.2.1)
  - `src/commands/suggest.ts` (164 lines)
  - `src/commands/suggestion.ts` (480 lines)
  - `src/commands/suggestions.ts` (176 lines)
  - `src/features/suggestions/embeds.ts` (242 lines)
  - `src/features/suggestions/store.ts` (437 lines)
  - `src/features/suggestions/voting.ts` (118 lines)
- **Approval Rate Analytics**
  - `src/commands/approvalRate.ts` (23 lines)
  - `src/features/analytics/approvalRate.ts` (269 lines)
  - `src/features/analytics/approvalRateCommand.ts` (196 lines)
- **Stale Application Checker**
  - `src/scheduler/staleApplicationCheck.ts` (364 lines)
- Roadmap docs for new features

### Changed
- Enhanced `src/commands/listopen.ts` (+180 lines)

---

## [2.1.0] - 2025-11-27

### Changed
- Moved scripts to `scripts/` directory
- Cleaned up root directory structure
- Renamed LICENSE to LICENSE.md

---

## [2.0.4] - 2025-11-26

### Added
- `tests/utils/contextFactory.ts` - Test context factory
- `tests/utils/dbFixtures.ts` - Database test fixtures
- `tests/utils/discordMocks.ts` - Discord.js mocks
- `tests/lib/retry.test.ts` - Retry utility tests

### Changed
- Enhanced multiple features with better error handling

---

## [2.0.3] - 2025-11-26

### Security
- Hardened `src/db/db.ts` - SQL injection prevention
- Hardened `src/features/gate.ts` - Input validation
- Hardened `src/lib/notifyLimiter.ts` - Rate limiting improvements
- Hardened `src/config/flaggerStore.ts`, `src/db/ensure.ts`

---

## [2.0.2] - 2025-11-26

### Changed
- Updated 22 test files with better mocking and assertions
- Enhanced flaggerStore and loggingStore documentation

---

## [2.0.1] - 2025-11-26

### Fixed
- Gate flow issues in `src/commands/gate.ts`
- Purge reliability in `src/commands/purge.ts`
- Banner sync, level rewards, metrics epoch issues
- cmdWrap, config, retry utility bugs

---

## [2.0.0] - 2025-11-26

### Added
- **Error Handling System** (5,016 lines added, 995 removed)
  - `src/lib/errors.ts` (439 lines) - Typed error system with categories
  - `src/lib/eventWrap.ts` (250 lines) - Event handler wrapper with timeouts
  - `src/lib/retry.ts` (355 lines) - Retry utilities with exponential backoff
  - `src/lib/startupHealth.ts` (328 lines) - Startup health checks
- `deploy.sh` - Deployment script
- `docs/ERROR_HANDLING_PLAN.md`
- `docs/IMPROVEMENT_PLAN.md`

### Changed
- Refactored 99 files with improved error handling patterns

---

## [1.1.5] - 2025-11-25

### Added
- `docs/ROLES.md` (259 lines) - Server role documentation
- `docs/SERVER_STRUCTURE.md` (912 lines) - Server structure documentation
- `scripts/fetch-channel.ts` (232 lines)
- `scripts/fetch-roles.ts` (99 lines)

---

## [1.1.4] - 2025-11-25

### Added
- `scripts/setup-level-rewards.ts` (95 lines)

---

## [1.1.3] - 2025-11-25

### Changed
- Enhanced `src/features/levelRewards.ts` (+38 lines)
- Enhanced `src/logging/pretty.ts` (+25 lines)

---

## [1.1.2] - 2025-11-25

### Added
- `tests/roleAutomation.test.ts` (266 lines)

---

## [1.1.1] - 2025-11-25

### Added
- `src/commands/panic.ts` (116 lines) - Emergency lockdown command
- `src/features/panicStore.ts` (41 lines) - Panic state management

### Changed
- Enhanced level rewards (+50 lines)

---

## [1.1.0] - 2025-11-25

### Added
- **Role Automation System** (1,893 lines)
  - `migrations/025_role_automation.ts` (174 lines)
  - `src/commands/movie.ts` (335 lines) - Movie night voting
  - `src/commands/roles.ts` (427 lines) - Role management
  - `src/features/levelRewards.ts` (137 lines) - XP-based rewards
  - `src/features/movieNight.ts` (332 lines) - Movie voting system
  - `src/features/roleAutomation.ts` (421 lines) - Automatic role assignment

---

## [1.0.0] - 2025-11-25

### Added
- **Initial Release** (61,869 lines) - Full codebase import

- **Gate System** (1,207 lines)
  - `/gate` command for processing applications
  - Multi-stage review process (pending → approved/denied/kicked)
  - Automatic role assignment on approval
  - Application search and filtering
  - Configurable gate channels and roles

- **Modmail System** (2,668 lines)
  - Thread-based conversations
  - Staff reply functionality
  - Modmail logging and transcripts
  - Ticket management

- **Review System** (3,144 lines)
  - Review cards with user information
  - Claim system for applications
  - Review actions tracking

- **Moderator Tools**
  - `/flag` - Flag users for review
  - `/modhistory` - View user moderation history
  - `/modstats` - Moderator performance statistics
  - `/purge` - Bulk message deletion
  - `/send` - Send messages as the bot
  - `/poke` - Ping inactive applications
  - `/listopen` - List open applications

- **Analytics System**
  - `/analytics` command with multiple report types
  - `/activity` - Activity tracking and heatmaps
  - Activity tracking aggregation
  - Performance dashboards

- **Infrastructure**
  - 21 database migrations
  - Full test suite
  - Comprehensive documentation
  - Banner sync
  - Google Vision integration
  - Welcome messages
  - Configuration system (`/config`)
  - Utility commands (`/health`, `/sync`, `/database`, `/backfill`, `/resetdata`, `/update`, `/unblock`, `/sample`)

---

[4.7.1]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.7.0...v4.7.1
[4.7.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.6.0...v4.7.0
[4.6.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.5.0...v4.6.0
[4.5.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.4.4...v4.5.0
[4.4.4]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.4.3...v4.4.4
[4.4.3]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.4.2...v4.4.3
[4.4.2]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.4.1...v4.4.2
[4.4.1]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.4.0...v4.4.1
[4.4.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.3.0...v4.4.0
[4.3.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.0.3...v4.1.0
[4.0.3]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.0.2...v4.0.3
[4.0.2]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.0.1...v4.0.2
[4.0.1]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v3.1.2...v4.0.0
[3.1.2]: https://github.com/pawtropolis/pawtropolis-tech/compare/v3.1.1...v3.1.2
[3.1.1]: https://github.com/pawtropolis/pawtropolis-tech/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.3.11...v3.0.0
[2.3.11]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.3.10...v2.3.11
[2.3.10]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.3.9...v2.3.10
[2.3.9]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.3.8...v2.3.9
[2.3.8]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.3.7...v2.3.8
[2.3.3 - 2.3.7]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.3.2...v2.3.7
[2.3.2]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.0.4...v2.1.0
[2.0.4]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/pawtropolis/pawtropolis-tech/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v1.1.5...v2.0.0
[1.1.5]: https://github.com/pawtropolis/pawtropolis-tech/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/pawtropolis/pawtropolis-tech/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/pawtropolis/pawtropolis-tech/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/pawtropolis/pawtropolis-tech/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/pawtropolis/pawtropolis-tech/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/pawtropolis/pawtropolis-tech/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/pawtropolis/pawtropolis-tech/releases/tag/v1.0.0
