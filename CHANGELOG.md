# Changelog

All notable changes to Pawtropolis Tech will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/pawtropolis/pawtropolis-tech/compare/v4.2.0...HEAD
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
