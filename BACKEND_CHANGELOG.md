# Backend Changelog

## November 2025 - Major Code Cleanup

### Removed Unused Code
- Deleted unused files and functions (380+ lines total)
- Removed old tracer, event wrappers, and forum notification code
- Cleaned up unused UI helper functions

### Security
- Fixed SQL injection risks with input validation
- Fixed cross-site scripting (XSS) in linked roles
- Added CSRF protection to OAuth login
- Added rate limits to prevent abuse
- Added permission checks before changing roles

### Memory & Performance
- Fixed memory leaks in modmail tracking (limited to 500KB)
- Fixed memory leaks in background timers
- Added LRU caches to prevent unlimited memory growth
- Added database indexes for faster queries
- Fixed slow gate shortcode lookups

### Error Handling
- Added better error tracking to catch blocks
- Improved logging throughout the bot
- Added retry support for failed operations
- Added health checks for scheduled tasks

### Code Quality
- Removed duplicate code
- Fixed unsafe type conversions
- Made timestamp handling consistent
- Moved hardcoded values to constants

### Configuration
- Moved artist rotation settings to database
- Moved category IDs to database
- Removed hardcoded role and guild IDs
- Made more settings configurable per server

### Bug Fixes
- Fixed race condition in artist rotation queue
- Fixed status inconsistencies in applications
- Added panic mode support to gate verification
- Improved error handling in analytics
