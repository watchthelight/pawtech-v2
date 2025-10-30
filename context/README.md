# Pawtropolis Tech Context Documentation

Complete technical documentation for the Pawtropolis Tech Discord gatekeeping bot. All documents follow a standardized 10-section format with YAML front-matter, real code paths, and cross-references.

---

## Document Organization

Documentation is organized into four thematic groups:

### 📘 Orientation (01–05)
High-level overviews, architecture, and core flows

### 🔧 Implementation (06–10)
Detailed technical specifications for features and data models

### ⚙️ Operations (11–15)
Runbooks, monitoring, and operational procedures

### 🛡️ Governance & Quality (16–20)
Security, testing, deployment, and architectural decisions

---

## Complete Document Index

### 📘 Orientation

#### [01_Exec_Summary_and_Goals.md](01_Exec_Summary_and_Goals.md)
**Purpose**: Project overview, tech stack, and success metrics
- High-level goals and target outcomes
- Scope boundaries (in/out of scope)
- Current tech stack (Node.js 20, Discord.js 14, SQLite, Fastify)
- Key features and deployment model

#### [02_System_Architecture_Overview.md](02_System_Architecture_Overview.md)
**Purpose**: System components, data flow, and integration points
- Discord bot client architecture
- Fastify web server + OAuth2
- SQLite database with WAL mode
- Banner sync system
- Deployment architecture (PM2 on Ubuntu)
- System diagrams and data flows

#### [03_Slash_Commands_and_UX.md](03_Slash_Commands_and_UX.md)
**Purpose**: User-facing command reference and interaction patterns
- Complete command catalog with usage examples
- Modal workflows (gate verification, reject reasons)
- Button interactions (claim, accept, reject)
- Ephemeral vs. public responses
- Error handling and user feedback

#### [04_Gate_and_Review_Flow.md](04_Gate_and_Review_Flow.md)
**Purpose**: Application submission and review workflows
- Gate verification flow (5-question modal)
- Draft persistence and recovery
- Review card generation
- Reviewer claim system (exclusive locks)
- Decision workflows (approve/reject/kick)
- DM notification system

#### [05_Modmail_System.md](05_Modmail_System.md)
**Purpose**: Private staff-applicant communication system
- Modmail thread lifecycle (open/close/reopen)
- Bidirectional message routing (DM ↔ thread)
- Transcript logging with .txt export
- Race-safe ticket creation
- Thread permissions and access control

---

### 🔧 Implementation

#### [06_Logging_Auditing_and_ModStats.md](06_Logging_Auditing_and_ModStats.md)
**Purpose**: Action logging, audit trails, and moderator analytics
- `action_log` and `mod_metrics` schemas
- Pretty embed logging to Discord
- Moderator performance tracking
- Response time percentiles (P50, P95)
- `/modstats` command implementation
- Logging channel resolution priority

#### [07_Database_Schema_and_Migrations.md](07_Database_Schema_and_Migrations.md)
**Purpose**: Complete SQLite schema reference
- All table schemas with foreign keys and indexes
- Migration system with TypeScript support
- Index strategies for performance
- Backup and recovery procedures
- Schema evolution best practices
- WAL mode configuration

#### [08_Deployment_Config_and_Env.md](08_Deployment_Config_and_Env.md)
**Purpose**: Environment configuration and deployment procedures
- All environment variables with Zod validation
- TypeScript build with tsup
- PM2 configuration and process management
- OAuth2 setup for web dashboard
- Apache reverse proxy configuration
- Remote SSH deployment patterns

#### [09_Troubleshooting_and_Runbook.md](09_Troubleshooting_and_Runbook.md)
**Purpose**: Operational runbook with incident playbooks
- Health check commands
- Common error patterns with root causes
- Step-by-step resolution playbooks
- Monitoring thresholds
- Log analysis procedures
- PM2 troubleshooting

#### [10_Roadmap_Open_Issues_and_Tasks.md](10_Roadmap_Open_Issues_and_Tasks.md)
**Purpose**: Project roadmap and issue tracking
- Completed work (PR1-PR8)
- In-progress features
- Planned roadmap (PR9-PR12)
- Known issues with workarounds
- Technical debt items
- Backlog prioritization

---

### ⚙️ Operations

#### [11_Runtime_Database_Recovery_Guide.md](11_Runtime_Database_Recovery_Guide.md)
**Purpose**: Hands-on database recovery procedures
- WAL/SHM file semantics
- Integrity checks (`PRAGMA integrity_check`)
- Backup candidate selection
- Hash comparison and verification
- Local and remote restore procedures
- Safety protocols (never delete backups)
- Recovery playbooks for corruption and data loss

#### [12_ModStats_Data_Model_and_Queries.md](12_ModStats_Data_Model_and_Queries.md)
**Purpose**: Moderator performance metrics specification
- `mod_metrics` table schema
- Aggregation queries for leaderboards
- Percentile calculation (nearest-rank algorithm)
- Caching strategy with 5-minute TTL
- `/resetdata` security model (timing-safe password comparison)
- Timeseries API endpoints
- Response time measurement

#### [13_Embeds_Design_System.md](13_Embeds_Design_System.md)
**Purpose**: Discord embed design specification
- Review card structure
- Code-block answer formatting
- Decision reason blocks
- Discord timestamp formats
- Color palette (status-based borders)
- Mobile constraints (80-char line length)
- Action button layouts

#### [14_Slash_Commands_Registry_and_Permissions.md](14_Slash_Commands_Registry_and_Permissions.md)
**Purpose**: Complete command registry with permissions
- Full command list (14 commands)
- Discord permission requirements
- Role-based access control (ADMIN_ROLE_ID, mod_role_ids)
- Environment variable guards
- Command deployment procedures
- Permission matrix

#### [15_Website_Status_and_Health_Monitoring.md](15_Website_Status_and_Health_Monitoring.md)
**Purpose**: Health checks and monitoring procedures
- `/health` command output interpretation
- WebSocket ping metrics (ws_ping_ms)
- Database health indicators
- Web server health endpoints
- PM2 process monitoring
- Latency graph interpretation
- Failure triage playbooks

---

### 🛡️ Governance & Quality

#### [16_Security_Secrets_and_Access_Control.md](16_Security_Secrets_and_Access_Control.md)
**Purpose**: Security best practices and secret management
- `.env` file structure and validation (Zod schema)
- Discord bot token security
- OAuth2 client secrets
- SSH key management
- Password hashing (timing-safe comparison)
- Log redaction procedures
- Access control matrix

#### [17_Incident_Response_and_Postmortems.md](17_Incident_Response_and_Postmortems.md)
**Purpose**: Incident classification and response procedures
- Severity levels (SEV0-SEV3)
- Communication templates
- Evidence collection (PM2 logs, database snapshots)
- Timeline capture procedures
- Postmortem template
- Root cause analysis (RCA)

#### [18_Testing_Strategy_and_Fixtures.md](18_Testing_Strategy_and_Fixtures.md)
**Purpose**: Test framework and best practices
- Vitest configuration
- Test data fixtures and factories
- Golden file testing for embeds
- Database test isolation (in-memory DBs)
- Discord.js mock patterns
- Coverage targets (80% aspirational)

#### [19_Operations_CLI_and_Scripts.md](19_Operations_CLI_and_Scripts.md)
**Purpose**: Operational scripts reference
- `start.cmd` unified start/stop/deploy script
- `start.ps1` PowerShell remote deployment
- Database sync workflows (pull, push, recover)
- Common flag combinations
- PM2 remote control
- NPM scripts reference

#### [20_Architecture_Decisions_Log_ADRs.md](20_Architecture_Decisions_Log_ADRs.md)
**Purpose**: Architectural decision records
- ADR-001: SQLite with better-sqlite3 (synchronous)
- ADR-002: Discord.js v14 with slash commands
- ADR-003: PM2 for process management (not Docker)
- ADR-004: Fastify for web server (not Express)
- ADR-005: Zod for environment validation (fail-fast)
- ADR-006: Nearest-rank percentile (no interpolation)
- ADR template for future decisions

---

## Document Standards

All context documents follow these conventions:

### YAML Front-Matter
```yaml
---
title: "Document Title"
slug: "NN_Document_Name"
status: "active"
last_reviewed: "YYYY-MM-DD"
owner: "Team Name"
audience: "Role1 • Role2 • Role3"
source_of_truth: ["file1.ts", "file2.ts"]
related:
  - "01_Related_Doc_One"
  - "02_Related_Doc_Two"
summary: "One-sentence description of document contents."
---
```

### Standard Sections (10 Required)
1. **Purpose & Outcomes**: What this document achieves
2. **Scope & Boundaries**: What's included/excluded
3. **Current State**: Technology and status summary
4. **Key Flows**: Process diagrams and workflows
5. **Commands & Snippets**: Runnable examples with real paths
6. **Interfaces & Data**: Schemas and type definitions
7. **Ops & Recovery**: Operational procedures
8. **Security & Privacy**: Access control and data handling
9. **FAQ / Gotchas**: Common questions and edge cases
10. **Changelog**: Document revision history

### Cross-References
- Use relative paths: `[07_Database_Schema](07_Database_Schema_and_Migrations.md)`
- Include file/line numbers: `[src/features/modmail.ts:123](../src/features/modmail.ts#L123)`
- Link to related sections: `[Database Recovery](11_Runtime_Database_Recovery_Guide.md#recovery-playbooks)`

### Code Snippets
- Always include file paths: `// File: src/commands/gate.ts`
- Provide expected outputs in comments
- Use real paths (no placeholders like `<YOUR_PATH>`)
- Add usage examples for every command

---

## Quick Start Guides

### For New Engineers
**Read First**:
1. [01_Exec_Summary_and_Goals](01_Exec_Summary_and_Goals.md)
2. [02_System_Architecture_Overview](02_System_Architecture_Overview.md)
3. [08_Deployment_Config_and_Env](08_Deployment_Config_and_Env.md)
4. [19_Operations_CLI_and_Scripts](19_Operations_CLI_and_Scripts.md)

**Then Dive Into**:
- [04_Gate_and_Review_Flow](04_Gate_and_Review_Flow.md) — Core workflow
- [14_Slash_Commands_Registry_and_Permissions](14_Slash_Commands_Registry_and_Permissions.md) — Command reference
- [18_Testing_Strategy_and_Fixtures](18_Testing_Strategy_and_Fixtures.md) — Testing practices

### For Operators/SRE
**Read First**:
1. [15_Website_Status_and_Health_Monitoring](15_Website_Status_and_Health_Monitoring.md)
2. [09_Troubleshooting_and_Runbook](09_Troubleshooting_and_Runbook.md)
3. [11_Runtime_Database_Recovery_Guide](11_Runtime_Database_Recovery_Guide.md)
4. [19_Operations_CLI_and_Scripts](19_Operations_CLI_and_Scripts.md)

**For Incidents**:
- [17_Incident_Response_and_Postmortems](17_Incident_Response_and_Postmortems.md) — Incident playbooks

### For Product/PM
**Read First**:
1. [01_Exec_Summary_and_Goals](01_Exec_Summary_and_Goals.md)
2. [03_Slash_Commands_and_UX](03_Slash_Commands_and_UX.md)
3. [10_Roadmap_Open_Issues_and_Tasks](10_Roadmap_Open_Issues_and_Tasks.md)

**For Analytics**:
- [06_Logging_Auditing_and_ModStats](06_Logging_Auditing_and_ModStats.md) — Performance metrics
- [12_ModStats_Data_Model_and_Queries](12_ModStats_Data_Model_and_Queries.md) — Metrics queries

---

## Maintenance

### Review Schedule
- **Quarterly**: All operational docs (11-15)
- **After Major Release**: Implementation docs (06-10)
- **After Incidents**: Update runbooks (09, 11, 17)
- **Annually**: Governance docs (16-20)

### Updating Documents
1. Edit document with changes
2. Update `last_reviewed` date in YAML front-matter
3. Add entry to `Changelog` section at bottom
4. Update cross-references if structure changed
5. Verify all code paths are still valid

### Document Owners
- **Orientation (01-05)**: Engineering Leadership
- **Implementation (06-10)**: Platform Team
- **Operations (11-15)**: SRE + Operations
- **Governance (16-20)**: Security + Engineering Leadership

---

## Contributing

See [docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md) for contribution guidelines.

When adding new context documents:
1. Follow the 10-section standard format
2. Add YAML front-matter with all required fields
3. Update this README with new document entry
4. Cross-reference from at least 2 related documents
5. Use real code paths and working examples

---

## Document Statistics

**Total Documents**: 20
- Orientation: 5
- Implementation: 5
- Operations: 5
- Governance & Quality: 5

**Total Lines**: ~18,000 (as of 2025-10-30)

**Last Full Review**: 2025-10-30

---

**Maintained by**: Pawtropolis Tech Engineering Team
**Contact**: admin@watchthelight.org
**Repository**: https://github.com/watchthelight/pawtech-v2
