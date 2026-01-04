# Pawtropolis Tech

[![CI](https://github.com/watchthelight/pawtech-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/watchthelight/pawtech-v2/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)
![License](https://img.shields.io/badge/license-ANW--1.0-blue)

---

## 📚 Staff Docs

| Doc | What's in it |
|-----|--------------|
| **[BOT-HANDBOOK](docs/BOT-HANDBOOK.md)** | Every command, explained |
| **[MOD-QUICKREF](docs/MOD-QUICKREF.md)** | Quick cheat sheet |
| **[PERMS-MATRIX](docs/PERMS-MATRIX.md)** | Who can do what |

---

## What is this?

<!-- TODO: Fill this in with the actual vibe -->

Custom Discord bot for Pawtropolis. Handles member verification, modmail, avatar scanning, and mod tools.

Not a generic bot framework - this is purpose-built for one community.

---

## Dev Quick Start

```bash
git clone https://github.com/watchthelight/pawtech-v2.git
cd pawtech-v2
npm install
cp .env.example .env   # add DISCORD_TOKEN + CLIENT_ID
npm run dev
```

**Commands:**
- `npm run dev` - hot reload dev server
- `npm run check` - typecheck + lint + test
- `npm run deploy:cmds` - push slash commands
- `./deploy.sh` - deploy to prod

---

## License

[ANW-1.0](LICENSE) — use it, learn from it, don't just clone and rebrand it.

---

*[watchthelight](https://github.com/watchthelight)* · admin@watchthelight.org
