# Pawtropolis Tech Documentation

> Discord bot for community moderation and gating.

---

## For Staff

**Start here:** [BOT-HANDBOOK.md](BOT-HANDBOOK.md)

The Bot Handbook has everything you need - commands, features, and how to use them.

**Other Handbooks:**
- [MOD-HANDBOOK.md](MOD-HANDBOOK.md) - Staff policies and moderation rules
- [MOD-QUICKREF.md](MOD-QUICKREF.md) - Quick command reference
- [PERMS-MATRIX.md](PERMS-MATRIX.md) - Permission matrix for commands
- [INCIDENTS.md](INCIDENTS.md) - Production incidents log
- [CHANGELOG.md](../CHANGELOG.md) - Version history and updates

**By Role:**
- [GATEKEEPER-GUIDE.md](GATEKEEPER-GUIDE.md) - For Gatekeepers and Junior Mods
- [MODERATOR-GUIDE.md](MODERATOR-GUIDE.md) - For Moderators and Senior Mods
- [ADMIN-GUIDE.md](ADMIN-GUIDE.md) - For Admins and Senior Admins
- [LEADERSHIP-GUIDE.md](LEADERSHIP-GUIDE.md) - For CM, CDL, and Server Owner

---

## Technical Documentation

### Overview
- [Executive Summary](overview/executive-summary.md) - What this bot does and why
- [License FAQ](overview/license-faq.md) - License and usage rights

### Architecture
- [System Overview](architecture/system-overview.md) - How the bot works

### Reference
- [Slash Commands](reference/slash-commands.md) - All commands with examples
- [Gate Review Flow](reference/gate-review-flow.md) - How member applications work
- [Modmail System](reference/modmail-system.md) - DM routing and tickets
- [Logging and ModStats](reference/logging-and-modstats.md) - Audit logs and stats
- [Database Schema](reference/database-schema.md) - Database structure
- [Send Command](reference/send-command.md) - Anonymous staff messaging

### How-To Guides
- [Modmail Guide](how-to/modmail-guide.md) - Using the modmail system
- [Backfill Activity](how-to/backfill-activity.md) - Backfilling message data

### Operations
- [Deployment Config](operations/deployment-config.md) - Setup and environment
- [Troubleshooting](operations/troubleshooting.md) - Common problems and fixes

### Internal Server Info
- [Roles](internal-info/ROLES.md) - All server roles with permissions matrix
- [Channels](internal-info/CHANNELS.md) - All channels with permission overwrites
- [Security Conflicts](internal-info/CONFLICTS.md) - Permission conflicts and security issues
- [Server Info](internal-info/SERVER-INFO.md) - Server metadata and statistics

> **Re-generate:** Use `/audit security` in Discord or run `npx dotenvx run -- tsx scripts/audit-server-full.ts`

### Roadmap
- [Future Considerations](roadmap/THINK_ABOUT_LATER.md) - Future ideas
- [Rejected Ideas](roadmap/REJECTED.md) - Ideas we decided against

---

## More Documentation

**In the code:**
- [`src/commands/README.md`](../src/commands/README.md) - How to add commands
- [`src/constants/README.md`](../src/constants/README.md) - Sample data
- [`src/db/README.md`](../src/db/README.md) - Database layer

**Archived:**
- [`/_archive/`](_archive/README.md) - Old implementation notes and deployment records

---

## Support

- **Issues**: [GitHub Issues](https://github.com/watchthelight/pawtropolis-tech/issues)
- **Author**: watchthelight (Bash)
- **Email**: admin@watchthelight.org
