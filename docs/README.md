# Pawtropolis Tech Documentation

> A production-ready Discord moderation bot for transparent, auditable community gating.

This documentation covers the architecture, configuration, operation, and development of the Pawtropolis Tech Gatekeeper bot.

---

## Quick Links

| Need to... | Go to |
|------------|-------|
| Get started | [Executive Summary](overview/executive-summary.md) |
| Understand the system | [System Architecture](architecture/system-overview.md) |
| Use commands | [Slash Commands Reference](reference/slash-commands.md) |
| Deploy the bot | [Deployment Config](operations/deployment-config.md) |
| Fix issues | [Troubleshooting](operations/troubleshooting.md) |

---

## Documentation Structure

### Overview

Introduction to the project and high-level concepts.

- [Executive Summary](overview/executive-summary.md) - Project goals, philosophy, and feature overview
- [License FAQ](overview/license-faq.md) - Licensing terms and usage rights

### Architecture

System design and technical architecture.

- [System Overview](architecture/system-overview.md) - Components, data flow, and design decisions

### Reference

Detailed feature and API documentation.

- [Slash Commands](reference/slash-commands.md) - Complete command reference with examples
- [Gate Review Flow](reference/gate-review-flow.md) - Application submission and review workflow
- [Modmail System](reference/modmail-system.md) - DM-to-thread routing and ticket lifecycle
- [Logging and ModStats](reference/logging-and-modstats.md) - Audit logging and moderator analytics
- [Database Schema](reference/database-schema.md) - SQLite schema and migration guide
- [Send Command](reference/send-command.md) - Anonymous staff messaging

### How-To Guides

Step-by-step tutorials for common tasks.

- [Modmail Guide](how-to/modmail-guide.md) - How to use the modmail system
- [Backfill Activity](how-to/backfill-activity.md) - Backfilling message activity data

### Operations

Deployment, configuration, and maintenance.

- [Deployment Config](operations/deployment-config.md) - Environment variables and configuration
- [Troubleshooting](operations/troubleshooting.md) - Common issues and solutions

### Roadmap

- [Roadmap and Open Issues](roadmap.md) - Future plans and known issues

---

## Inline Documentation

Additional documentation is located within source directories:

| Location | Purpose |
|----------|---------|
| [`/src/commands/README.md`](/src/commands/README.md) | Slash command implementation guide |
| [`/src/config/README.md`](/src/config/README.md) | Configuration store patterns |
| [`/src/constants/README.md`](/src/constants/README.md) | Sample data and constants |
| [`/src/db/README.md`](/src/db/README.md) | Database layer documentation |
| [`/migrations/README.md`](/migrations/README.md) | Database migration guide |

---

## Archived Documentation

Historical and implementation-specific documents are preserved in [`/_archive/`](_archive/README.md).

These include:
- PR implementation notes
- Deployment fix records
- One-time migration guides

---

## Contributing

See the main [README.md](/README.md) for contribution guidelines and development setup.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/watchthelight/pawtech-v2/issues)
- **Author**: watchthelight (Bash)
- **Email**: admin@watchthelight.org
