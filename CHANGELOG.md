# Changelog

All changes to Pawtropolis Tech are tracked here.

**Versions:** [Unreleased](#unreleased) | [4.8.0](#480---2025-12-08) | [4.7.1](#471---2025-12-03) | [4.7.0](#470---2025-12-03) | [4.6.0](#460---2025-12-03) | [4.5.0](#450---2025-12-02) | [4.4.4](#444---2025-12-03) | [4.4.3](#443---2025-12-03) | [4.4.2](#442---2025-12-03) | [4.4.1](#441---2025-12-03) | [4.4.0](#440---2025-12-03) | [4.3.0](#430---2025-12-02) | [4.2.0](#420---2025-12-01) | [4.1.0](#410---2025-12-01) | [4.0.3](#403---2025-12-01) | [4.0.2](#402---2025-12-01) | [4.0.1](#401---2025-12-01) | [4.0.0](#400---2025-12-01) | [Earlier versions](#earlier-versions)

## [Unreleased]

### Added

- **Unclaim Button** - Review cards have an "Unclaim" button that requires typing "UNCLAIM" to confirm. Only the person who claimed it can unclaim.
- **Incident Log** - Added `INCIDENTS.md` to track production incidents and resolutions
- **Game Night Tracking** - New `/event game` command for game night attendance tracking with percentage-based qualification:
  - `/event game start #channel` - Start tracking attendance in a voice channel
  - `/event game end` - End event and calculate qualification based on % of event duration attended
  - `/event game attendance` - View attendance stats (live during event, historical after)
  - `/event game add/credit/bump` - Manual attendance adjustments
  - `/config set game_threshold` - Configure qualification percentage (default: 50%)
  - `/config get game_config` - View game night configuration
- **Game Night Tier Roles** - Automatic tier role rewards for game night attendance:
  - `/roles add-game-tier` - Configure tier roles (e.g., 1 game = T1, 5 games = T2)
  - `/roles remove-game-tier` - Remove a game tier
  - `/roles list` - View configured game tiers
  - Automatically assigns roles when users qualify, removes lower tiers
  - DMs users with progress updates after each game night
- **Unified Event System** - `/event movie` now mirrors `/movie` (which is deprecated). Both movie and game nights use the same underlying tracking system.
- **Combined Event Stats** - Movie and game night attendance tracked in same database for unified statistics

### Security

- **Guild Allowlist** - Bot now only operates in Pawtropolis (guild ID `896070888594759740`). Automatically leaves any other server it's added to. See INC-001 in `INCIDENTS.md`.

### Fixed

- **Movie Night DM Role Display** - DMs now show the actual role name (e.g., "Movie Buff") instead of "@unknown-role" since role mentions don't render in DMs

### Changed

- **Modmail Open Message** - Now includes clearer instructions: explains that replies go to staff only, are confidential, and verification continues after modmail closes
- **Permission System Redesign** - Commands now use specific role names instead of generic "staff" permissions. Each command requires a minimum role level. Bot owners and server devs can bypass all restrictions. Error messages show which roles you need. See `PERMS-MATRIX.md` for details.
- **Analytics Command Consolidation** - Unified analytics commands under `/stats`:
  - `/activity` → `/stats activity`
  - `/approval-rate` → `/stats approval-rate`
  - `/modstats leaderboard` → `/stats leaderboard`
  - `/modstats user` → `/stats user`
  - `/modstats export` → `/stats export`
  - `/modstats reset` → `/stats reset`
  - `/modhistory` → `/stats history`

### Removed

- **`/activity`** - Replaced by `/stats activity`
- **`/approval-rate`** - Replaced by `/stats approval-rate`
- **`/modstats`** - Replaced by `/stats`
- **`/modhistory`** - Replaced by `/stats history`
- **`/analytics`** and **`/analytics-export`** - Replaced by `/stats activity`

### Deprecated

- **`/movie` command** - Use `/event movie` instead. The `/movie` command still works but will be removed in a future version.

### Security

- Added cooldowns to prevent spam and abuse:
  - Avatar NSFW scans: 1 hour per user
  - `/search`: 30 seconds per user, 50ms delay between API calls
  - `/backfill`: 30 minutes per server
  - `/purge`: 5 minutes per user
  - `/flag`: 15 seconds (increased from 2)
  - `/artistqueue sync`: 5 minutes per server
- Added 30-second lockout after wrong passwords on `/resetdata` and `/purge`
- Hide sensitive data in error messages and logs
- Added input validation to prevent malicious code injection
- Limited modmail memory to 10,000 entries to prevent crashes
- Limited flagged user queries to 10,000 entries

---

## [4.8.0] - 2025-12-08

### Added

- **Better Permission Errors** - Permission denied messages now show which roles you need to use a command
- **"Is It Real?" Context Menu** - Right-click any message → Apps → "Is It Real?" to check if images are AI-generated
- **Skull Mode** - Random skull emoji reactions. Use `/skullmode chance:N` to set odds, `/config set skullmode` to toggle on/off

### Removed

- Removed right-click context menu for opening modmail threads

### Fixed

- **Welcome Card Retry Logic** - Welcome cards now retry up to 3 times when network errors occur
- **Bot Dev Ping** - Fixed bug where bot devs weren't getting pinged on new applications even when enabled

### Changed

- `/update status` without text now clears the status instead of showing an error
- **AI Detection API Switch** - Switched from Illuminarty to RapidAPI. Update your `.env` file with `RAPIDAPI_KEY`

---

## [4.7.1] - 2025-12-03

### Fixed

- Fixed autocomplete and select menus not working in `/help` command

### Changed

- Only the person who ran `/help` can use its buttons and menus
- Removed all emojis from help system for a cleaner look

---

## [4.7.0] - 2025-12-03

### Added

- **Interactive Help System** - New `/help` command with search, categories, autocomplete, and navigation. Only shows commands you have permission to use.

- **Movie Night Improvements**:
  - Users already in voice chat get credit when `/movie start` runs
  - Sessions save every 5 minutes and recover after bot restarts
  - New commands: `/movie add`, `/movie credit`, `/movie bump` for manual attendance adjustments
  - Use `/movie resume` to check recovered session status

- **AI Detection Setup Wizard** - New `/config isitreal` command to set up API keys with a visual dashboard. Test keys before saving. No restart needed.

---

## [4.6.0] - 2025-12-03

### Added

- **AI Detection Command** - New `/isitreal` command checks if images are AI-generated using Hive, SightEngine, and Optic APIs. Shows average score and breakdown per service. Staff-only.

### Documentation

- Added cross-links between all handbooks
- Fixed outdated references and dates

### Removed

- Removed ~1,400 lines of unused code and 14 old migration files
- Fixed duplicate migration numbers
- Cleaned up 10 empty folders

---

## [4.5.0] - 2025-12-02

### Database

- Improved database query speed by caching prepared statements across 10 files
- Added transaction wrapping to ensure atomic operations
- Added validation helpers for Discord IDs and empty values

### Security

- Prevented SQL injection attacks with input validation
- Moved API keys out of URLs to prevent log exposure
- Added permission checks for dangerous `/database recover` command
- Added rate limiting to expensive commands
- Prevented path manipulation attacks in file handling
- Limited reason text to 512 characters to prevent bloat

### Refactored

- Cleaned up file structure by merging scattered utilities
- Fixed naming conflicts between types
- Updated import paths across 15 files

### Changed

- Better error handling with debug logging instead of silent failures
- Notify users when critical operations fail

### Performance

- **Much faster queries**: Fixed slow database patterns that were making too many requests
- **Faster NSFW audits**: Changed from one-at-a-time to batch processing (100+ seconds → ~15 seconds for 1000 members)
- **New database indexes**: Added 5 indexes to speed up common searches
- **Memory protection**: Added limits to prevent crashes during high traffic

### Cleanup

- Removed unused code and functions
- Dropped empty database tables
- Cleaned up unused test files

---

## [4.4.4] - 2025-12-03

### Changed

- Split large files into smaller, easier-to-maintain modules:
  - Modmail threads code split into 5 files
  - Modstats split into 5 files
  - Gate commands split into 7 files
  - Config commands split into 11 files

---

## [4.4.3] - 2025-12-03

### Changed

- Split review handlers into 6 smaller files
- Extracted modmail thread state code

---

## [4.4.2] - 2025-12-03

### Changed

- Removed website references (website no longer exists)

---

## [4.4.1] - 2025-12-03

### Added

- Added AI detection tool links to moderator handbook

---

## [4.4.0] - 2025-12-03

### Added

- **Auto NSFW Avatar Scan** - Bot now scans avatars automatically when users change them. Alerts go to logging channel.
- **Resume NSFW Audits** - Can now resume interrupted audits. Progress saves to database.
- `/health` command now shows active event listeners

### Changed

- NSFW audit progress updates more frequently with better feedback

---

## [4.3.0] - 2025-12-02

### Added

- **New `/audit nsfw` command** - Scan avatars for NSFW content using Google Vision API. Can scan all members or only flagged users.

### Changed

- Split `/audit` into `/audit members` and `/audit nsfw` subcommands

### Removed

- Removed unused suggestions feature (~1,700 lines of code)

---

## [4.2.0] - 2025-12-01

### Changed

- Added many new configuration options to `/config` command

---

## [4.1.0] - 2025-12-01

### Changed

- More configuration options and improvements

---

## [4.0.3] - 2025-12-01

### Changed

- Minor handbook fixes

---

## [4.0.2] - 2025-12-01

### Changed

- Expanded documentation

---

## [4.0.1] - 2025-12-01

### Changed

- Minor documentation updates

---

## [4.0.0] - 2025-12-01

### Added

- **Art Jobs System** - New `/art` command to track commissions and requests. Fully integrated with search.

---

## Earlier Versions

### [3.1.2] - 2025-11-30
- Added moderator handbook
- Removed cage command

### [3.1.1] - 2025-11-30
- Cleaned up 89 roadmap files

### [3.1.0] - 2025-11-30
- Fixed memory leaks with LRU cache
- Added scheduler health monitoring
- Fixed 40+ bugs from codebase audit

### [3.0.0] - 2025-11-30
- Full codebase audit (48 issues found and fixed)
- Fixed SQL injection bug
- Fixed memory leaks
- Security improvements

### [2.3.1 - 2.3.11] - 2025-11-29
- Created BOT-HANDBOOK and MOD-QUICKREF documentation

### [2.3.0] - 2025-11-29
- **Artist Rotation System** - Queue management for rotating artist role

### [2.2.0] - 2025-11-28
- Added `/search` command
- Added suggestions system (later removed)
- Added approval rate analytics
- Added stale application checker

### [2.1.0] - 2025-11-27
- Cleaned up project structure

### [2.0.0 - 2.0.4] - 2025-11-26
- **Major error handling overhaul**
- Added comprehensive error system
- Security hardening
- Bug fixes

### [1.1.0 - 1.1.5] - 2025-11-25
- Added role automation system
- Added `/movie` command for movie night voting
- Added `/panic` emergency lockdown
- Added documentation

### [1.0.0] - 2025-11-25
- **Initial release**
- Gate system for application review
- Modmail system
- Review system with claim tracking
- Mod tools (`/flag`, `/modstats`, `/purge`, etc.)
- Analytics and activity tracking
- Full configuration system

