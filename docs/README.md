# Pawtropolis Tech Documentation

This folder contains all documentation for the Pawtropolis Tech Discord bot project.

## 📁 Folder Structure

```
docs/
├── README.md                    # This file - documentation index
├── CONTRIBUTING.md              # How to contribute to the project
├── LICENSE                      # ANW-1.0 license text
├── LICENSE-FAQ.md               # Quick answers about license usage
├── NOTICE                       # Copyright and attribution notice
├── AVATAR_SCANNING.md           # User guide for avatar NSFW detection
├── AVATAR_SCANNING_ADMIN.md     # Admin guide for avatar scanning system
└── context/                     # Architecture documentation
    ├── 01_Exec_Summary_and_Goals.md
    ├── 02_System_Architecture_Overview.md
    ├── 03_Slash_Commands_and_UX.md
    ├── 04_Gate_and_Review_Flow.md
    ├── 05_Modmail_System.md
    ├── 06_Logging_Auditing_and_ModStats.md
    ├── 07_Database_Schema_and_Migrations.md
    ├── 08_Deployment_Config_and_Env.md
    ├── 09_Troubleshooting_and_Runbook.md
    └── 10_Roadmap_Open_Issues_and_Tasks.md
```

## 📚 Documentation Types

### For Contributors

- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Development setup, coding standards, PR process
- **[LICENSE](LICENSE)** and **[LICENSE-FAQ.md](LICENSE-FAQ.md)** - Legal terms and usage rights

### For Administrators

- **[AVATAR_SCANNING_ADMIN.md](AVATAR_SCANNING_ADMIN.md)** - Setup, configuration, and maintenance of NSFW detection
- **[context/08_Deployment_Config_and_Env.md](context/08_Deployment_Config_and_Env.md)** - Server deployment guide
- **[context/09_Troubleshooting_and_Runbook.md](context/09_Troubleshooting_and_Runbook.md)** - Common issues and fixes

### For Moderators

- **[AVATAR_SCANNING.md](AVATAR_SCANNING.md)** - How to interpret avatar risk scores
- **[context/03_Slash_Commands_and_UX.md](context/03_Slash_Commands_and_UX.md)** - Command reference
- **[context/04_Gate_and_Review_Flow.md](context/04_Gate_and_Review_Flow.md)** - Application review workflow

### For Developers

- **[context/02_System_Architecture_Overview.md](context/02_System_Architecture_Overview.md)** - System design and module map
- **[context/07_Database_Schema_and_Migrations.md](context/07_Database_Schema_and_Migrations.md)** - Database structure

## 🎯 Context Documentation (`context/`)

The `context/` directory contains comprehensive architecture documentation organized by topic:

| File                                                                                 | Purpose                              | Lines | Last Updated |
| ------------------------------------------------------------------------------------ | ------------------------------------ | ----- | ------------ |
| [01_Exec_Summary_and_Goals.md](context/01_Exec_Summary_and_Goals.md)                 | Project overview, KPIs, roadmap      | 140   | 2025-10-22   |
| [02_System_Architecture_Overview.md](context/02_System_Architecture_Overview.md)     | System design, components, data flow | 455   | 2025-10-22   |
| [03_Slash_Commands_and_UX.md](context/03_Slash_Commands_and_UX.md)                   | Command reference, usage examples    | 534   | -            |
| [04_Gate_and_Review_Flow.md](context/04_Gate_and_Review_Flow.md)                     | Application workflow, state machine  | 568   | -            |
| [05_Modmail_System.md](context/05_Modmail_System.md)                                 | Ticket system, thread management     | 354   | -            |
| [06_Logging_Auditing_and_ModStats.md](context/06_Logging_Auditing_and_ModStats.md)   | Audit logs, metrics, analytics       | 515   | -            |
| [07_Database_Schema_and_Migrations.md](context/07_Database_Schema_and_Migrations.md) | Tables, columns, migration process   | 439   | -            |
| [08_Deployment_Config_and_Env.md](context/08_Deployment_Config_and_Env.md)           | Environment variables, deployment    | 569   | -            |
| [09_Troubleshooting_and_Runbook.md](context/09_Troubleshooting_and_Runbook.md)       | Common issues, debugging steps       | 610   | -            |
| [10_Roadmap_Open_Issues_and_Tasks.md](context/10_Roadmap_Open_Issues_and_Tasks.md)   | Future features, known issues        | 575   | -            |

**Total**: ~4,759 lines of architecture documentation

## 🔍 Finding Information

### Quick Links

- **Getting started?** → [CONTRIBUTING.md](CONTRIBUTING.md)
- **Bot not working?** → [context/09_Troubleshooting_and_Runbook.md](context/09_Troubleshooting_and_Runbook.md)
- **Need to understand code?** → [context/02_System_Architecture_Overview.md](context/02_System_Architecture_Overview.md)
- **Adding a command?** → [context/03_Slash_Commands_and_UX.md](context/03_Slash_Commands_and_UX.md)
- **Database changes?** → [context/07_Database_Schema_and_Migrations.md](context/07_Database_Schema_and_Migrations.md)
- **Deploying to production?** → [context/08_Deployment_Config_and_Env.md](context/08_Deployment_Config_and_Env.md)

### Search Tips

```bash
# Find all mentions of a feature
grep -r "modmail" docs/

# Search context docs for a term
grep -r "OAuth2" docs/context/

# List all command references
grep -r "^###.*/" docs/context/03_Slash_Commands_and_UX.md
```

## 📝 Documentation Standards

### Markdown Style

- Use ATX headers (`#`, `##`, `###`)
- Code blocks must specify language (`typescript, `bash, ```sql)
- Lists use `-` for bullets, numbers for ordered
- Include trailing newline at end of file

### Content Standards

- **Date all updates**: Include "Last Updated: YYYY-MM-DD" in headers
- **Link generously**: Cross-reference related docs
- **Examples over theory**: Show code snippets, not just descriptions
- **Keep current**: Update docs when code changes

### File Naming

- Use `SCREAMING_SNAKE_CASE.md` for top-level guides (e.g., `AVATAR_SCANNING.md`)
- Use `NN_Title_With_Underscores.md` for context docs (e.g., `01_Exec_Summary_and_Goals.md`)
- Keep filenames descriptive and searchable

## 🔧 Maintaining Documentation

### When to Update

- **Adding a feature**: Update relevant context docs + CONTRIBUTING.md
- **Changing commands**: Update `03_Slash_Commands_and_UX.md`
- **Database migrations**: Update `07_Database_Schema_and_Migrations.md`
- **New environment variables**: Update `08_Deployment_Config_and_Env.md`
- **Fixing a bug**: Add troubleshooting entry to `09_Troubleshooting_and_Runbook.md`

### Review Checklist

- [ ] All code examples tested and working
- [ ] Links point to existing files/sections
- [ ] Screenshots current (if included)
- [ ] Formatting consistent with other docs
- [ ] No sensitive data (tokens, passwords)
- [ ] Spelling and grammar checked

## 🤝 Contributing to Docs

Documentation improvements are always welcome! Follow these steps:

1. **Find the right file**: Use the structure guide above
2. **Make your changes**: Follow markdown standards
3. **Test links**: Verify all `[text](path)` links resolve
4. **Submit PR**: Title format: `docs: improve [topic] documentation`

See [CONTRIBUTING.md](CONTRIBUTING.md) for full contribution guidelines.

## 📄 License

Documentation licensed under [ANW-1.0](LICENSE). See [LICENSE-FAQ.md](LICENSE-FAQ.md) for usage questions.

---

**Questions?** Open an issue at [github.com/watchthelight/pawtech-v2/issues](https://github.com/watchthelight/pawtech-v2/issues)
