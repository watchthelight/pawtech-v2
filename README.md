# Pawtropolis Tech Gatekeeper

![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/discord.js-v14.16.3-5865F2?logo=discord&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5.4-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-ANW--1.0-blue)
![Code Style](https://img.shields.io/badge/code%20style-prettier-ff69b4?logo=prettier&logoColor=white)

A production-ready Discord moderation bot designed for transparent, auditable community gating. Built with TypeScript and discord.js v14, this bot provides interactive application workflows, reviewer dashboards, modmail management, and automated avatar risk analysis.

---

## Dev Quick Start

```bash
# 1. Clone and install
git clone https://github.com/watchthelight/pawtech-v2.git
cd pawtech-v2
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DISCORD_TOKEN and CLIENT_ID

# 3. Run all checks (typecheck + lint + format + test)
npm run check

# 4. Start development server
npm run dev
```

**Key Scripts:**
- `npm run dev` — Development mode with hot reload
- `npm run build` — Build for production
- `npm run test` — Run test suite
- `npm run check` — Run all quality checks (typecheck, lint, format, test)
- `npm run lint` — Check code with ESLint
- `npm run format` — Format code with Prettier
- `npm run deploy:cmds` — Deploy slash commands to Discord

**Database Backups:** Automatic backups are saved to `data/backups/` (not committed to git)

---

## Overview

Pawtropolis Tech Gatekeeper is a server-owned verification system that modernizes community onboarding through structured application flows. It replaces manual DM-based screening with an elegant, permission-gated workflow that keeps staff accountable and applicants informed.

**Core Philosophy:**

- Transparency over opacity
- Auditability over trust
- Minimal surface area over feature bloat

This bot was built for communities that take moderation seriously and want their tooling to reflect that.

---

## Features

### Application Gating

- Interactive modal forms with multi-page question flows and draft persistence
- Configurable per-guild questions via SQLite schema
- Draft recovery for incomplete applications
- Submission validation with required field enforcement

### Review & Decision Making

- Reviewer dashboards with rich embeds, applicant context, and action buttons
- Claim system to prevent review collisions via exclusive locks
- Full audit trail of approve/reject/kick decisions
- Permanent rejection feature to block repeat applications

### Modmail System

- Private thread bridge for staff-applicant DM routing
- Automatic transcript logging as .txt exports to configured channels
- Bidirectional message forwarding with reply threading
- Auto-close on decision when applications are resolved

### Avatar Risk Analysis

- ONNX-based NSFW detection for content moderation
- Edge score analysis for skin tone boundary detection
- Community-specific furry/scalie classification heuristics
- Google Lens integration for one-click reverse image search

### Deployment & Operations

- PowerShell-based remote deployment via slash commands
- Health monitoring with uptime checks and diagnostics
- Sentry integration for error tracking with breadcrumbs and user context
- Pino-based structured JSON logging with trace IDs

---

## Installation & Setup

### Prerequisites

- Node.js 20.0.0 or higher
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- SQLite 3 (bundled via better-sqlite3)

### Installation

```bash
# Clone the repository
git clone https://github.com/watchthelight/pawtropolis-tech.git
cd pawtropolis-tech

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### Configuration

Edit `.env` with your bot credentials:

```env
# Required: Bot authentication
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here

# Optional: Guild-specific deployment (leave empty for global)
GUILD_ID=

# Optional: Sentry error tracking
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_ENVIRONMENT=production

# Optional: Logging
LOG_LEVEL=info

# Optional: Avatar scanning
GATE_SHOW_AVATAR_RISK=1

# Optional: Reset password for /gate reset
RESET_PASSWORD=choose-a-strong-password
```

### Database Schema

The bot auto-creates SQLite tables on first run:

- `guild_config`: Per-guild settings (channels, roles, thresholds)
- `guild_question`: Application questions
- `application`: Applicant submissions and drafts
- `application_response`: Question answers
- `review_card`: Reviewer dashboard message tracking
- `modmail_ticket`: Modmail thread state
- `avatar_scan`: Avatar risk analysis results

Schema migrations run automatically via [src/db/ensure.ts](src/db/ensure.ts).

---

## Running Locally

### Development Mode

```bash
# Run with hot reload
npm run dev
```

### Production Build

```bash
# Build the project
npm run build

# Start the bot
npm start
```

### Deploy Commands

```bash
# Register slash commands (required after code changes)
npm run deploy:cmds
```

### Testing

```bash
# Run all checks (recommended before committing)
npm run check

# Individual checks
npm test              # Run test suite
npm run typecheck     # TypeScript type checking
npm run lint          # ESLint code analysis
npm run format        # Format code with Prettier
npm run format:check  # Check formatting without modifying files
```

---

## Environment Variables

| Variable                | Required | Description                                                        |
| ----------------------- | -------- | ------------------------------------------------------------------ |
| `DISCORD_TOKEN`         | Yes      | Bot token from Discord Developer Portal                            |
| `CLIENT_ID`             | Yes      | Application ID from Discord Developer Portal                       |
| `GUILD_ID`              | No       | Guild ID for per-guild command registration (faster than global)   |
| `NODE_ENV`              | No       | `development` or `production` (default: `development`)             |
| `DB_PATH`               | No       | SQLite database file path (default: `./data/data.db`)              |
| `SENTRY_DSN`            | No       | Sentry error tracking DSN                                          |
| `SENTRY_ENVIRONMENT`    | No       | Sentry environment label (default: `production`)                   |
| `LOG_LEVEL`             | No       | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `GATE_SHOW_AVATAR_RISK` | No       | Show NSFW risk percentage on review cards (1=show, 0=hide)         |
| `RESET_PASSWORD`        | No       | Password for `/gate reset` and `/modstats reset` commands          |

---

## Quick Start

After deployment and command registration, configure the gate system:

### Initial Setup

```bash
# 1. Run /gate setup in your server
/gate setup review_channel:#staff-review gate_channel:#gate general_channel:#general accepted_role:@Verified

# 2. Customize gate questions (optional)
/gate set-questions q1:"What is your age?" q2:"How did you find us?" q3:"Why do you want to join?"

# 3. Preview current questions
/gate set-questions

# 4. Test the welcome message
/gate welcome preview
```

### Common Commands

**Gate Management:**
- `/gate setup` — Initialize guild configuration
- `/gate set-questions` — Update verification questions (q1..q5)
- `/gate status` — View application statistics
- `/gate config` — Display current configuration
- `/gate welcome set` — Update welcome message template

**Review Workflow:**
- `/accept @user [reason]` — Approve application
- `/reject @user reason:"Account too new"` — Reject with reason
- `/kick @user reason:"Spam"` — Reject and kick
- `/unclaim @user` — Release claimed application

**Moderation:**
- `/modstats` — View personal moderator statistics
- `/modstats leaderboard` — View top moderators
- `/send channel:#general message:"..."` — Send anonymous staff message

**Admin Operations:**
- `/modstats reset password:"..."` — Clear and rebuild moderator statistics cache
  - Requires `RESET_PASSWORD` environment variable to be set
  - Password is validated using constant-time comparison (secure against timing attacks)
  - Rate-limited to 1 attempt per 30 seconds per user
  - All attempts are audit-logged to the configured logging channel
  - The provided password is never logged or persisted

For full command reference, see [docs/BOT-HANDBOOK.md](docs/BOT-HANDBOOK.md).

---

## Remote Deployment

The bot includes PowerShell-based remote deployment automation for Windows servers.

### Deployment Prerequisites

- WinRM enabled on remote server
- PowerShell remoting configured
- PM2 installed on remote server

### Deployment Workflow

1. Build the project locally: `npm run build`
2. Transfer `dist/` to remote server via rsync/scp
3. Restart PM2 process via PowerShell remoting

See [scripts/deploy-commands.ts](scripts/deploy-commands.ts) for implementation details.

---

## Troubleshooting

### Commands Not Appearing

- Run `npm run deploy:cmds` to register slash commands
- Check that the bot has `applications.commands` scope
- Verify `CLIENT_ID` matches your application ID

### Modmail Not Routing

- Ensure bot has `ManageThreads` and `SendMessagesInThreads` permissions
- Configure `mod_role_ids` via `/config set mod_role_ids role1,role2`
- Check that modmail threads are created in a text channel (not DMs)

### Avatar Scanning Fails

- Verify ONNX runtime dependencies are installed: `npm rebuild onnxruntime-node`
- Check that user avatars are accessible (not blocked by privacy settings)
- Review logs for model loading errors

### Permission Errors

Bot must be invited with `Administrator` or granular permissions:

- `Manage Roles`
- `Manage Channels`
- `Manage Messages`
- `Manage Threads`
- `View Channels`
- `Send Messages`
- `Embed Links`
- `Attach Files`
- `Read Message History`
- `Use External Emojis`

### Database Corruption

- Backup your database regularly: `cp data/data.db data/data.db.backup`
- Use SQLite integrity check: `sqlite3 data/data.db "PRAGMA integrity_check;"`
- Schema migrations are idempotent and safe to re-run

---

## License & Credits

This project is licensed under the **Attribution–No Wholesale Copying License (ANW-1.0)**.

**Pawtropolis Tech Gatekeeper**
© 2025 watchthelight / Bash
<[https://github.com/watchthelight/pawtropolis-tech](https://github.com/watchthelight/pawtech-v2?tab=readme-ov-file)>

You are free to:

- Use and modify the code for your own projects
- Redistribute modified versions with proper attribution

You may not:

- Redistribute the entire project as-is without modification
- Rebrand or resell this project as your own work

See [LICENSE](LICENSE) for full terms.

---

## Contributing

This is a private project built for specific community needs. While contributions are not actively solicited, bug reports and security disclosures are welcome via [GitHub Issues](https://github.com/watchthelight/pawtech-v2/issues).

---

## Notice

AI is partially used in this project: It is used to make immediate repairs on CRITICAL errors, where time is of the essence, and then I go back and manually review the changes made. It is used to locate and clean (remove) dead dependencies and code.

**THE CODE IS HUMAN.**

## Contact

**Author:** watchthelight (Bash)
**Email:** <admin@watchthelight.org>
**Repository:** <https://github.com/watchthelight/pawtech-v2>
**Website:** <https://watchthelight.org>

---

**Built with care for communities that care about moderation.**
