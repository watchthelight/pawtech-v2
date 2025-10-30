---
title: "Architecture Decisions Log (ADRs)"
slug: "20_Architecture_Decisions_Log_ADRs"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Engineering Leadership"
audience: "Engineers • Architects • Product"
source_of_truth: ["This document", "Git history", "Design discussions"]
related:
  - "01_Exec_Summary_and_Goals"
  - "02_System_Architecture_Overview"
summary: "Lightweight Architecture Decision Records documenting key technical choices: date, decision, alternatives considered, and consequences. Seed with 5 critical decisions from current design."
---

## Purpose & Outcomes

Document significant architectural decisions:
- Technology choices (SQLite vs. PostgreSQL, Discord.js vs. alternatives)
- Design patterns (synchronous DB vs. async, WAL mode)
- Security decisions (password hashing, session management)
- Infrastructure choices (PM2 vs. Docker, monolith vs. microservices)

## Scope & Boundaries

### In Scope
- Major technology selections
- Design pattern choices
- Security model decisions
- Infrastructure architecture
- Data model design
- API design patterns

### Out of Scope
- Minor refactoring decisions
- Code style preferences
- Individual feature implementations (unless architecturally significant)

## Current State

**ADR Count**: 5 (seeded)
**Format**: Lightweight (date, decision, alternatives, consequences)
**Location**: This document (can be split to separate files later)

---

## ADR-001: Use SQLite with better-sqlite3 (Synchronous)

**Date**: 2024-10-01
**Status**: Accepted
**Context**: Need persistent storage for application data, metrics, and configuration

**Decision**: Use SQLite with better-sqlite3 (synchronous Node.js driver) instead of PostgreSQL or other databases.

**Alternatives Considered**:

1. **PostgreSQL**
   - Pros: Industry standard, better concurrency, network access
   - Cons: Requires separate service, more complex deployment, overkill for workload

2. **MongoDB**
   - Pros: Flexible schema, good for JSON data
   - Cons: No foreign keys, eventual consistency issues, higher memory usage

3. **better-sqlite3 (Synchronous)**
   - Pros: Zero-config, serverless, fast for small/medium workloads, ACID guarantees
   - Cons: Limited concurrency (single writer), no network access, file-based

**Rationale**:
- Bot workload is read-heavy with low write volume (<100 writes/minute)
- Single-server deployment (no need for distributed database)
- Simplifies deployment (no separate DB service)
- better-sqlite3 is synchronous (simpler error handling, no async/await overhead)
- WAL mode enables concurrent reads + single writer (sufficient for use case)

**Consequences**:

✅ **Positive**:
- Zero configuration (no connection strings, no service setup)
- Fast queries (in-memory for reads, WAL for writes)
- Easy backups (copy single file)
- ACID guarantees without complexity

❌ **Negative**:
- Limited to single writer (PM2 cluster mode not supported)
- No horizontal scaling (vertical only)
- File-based (cannot access remotely without SSH)

**Mitigation**:
- Use WAL mode for better concurrency
- Keep queries fast (<10ms target)
- Regular backups to prevent data loss

---

## ADR-002: Use Discord.js v14 with Slash Commands

**Date**: 2024-10-05
**Status**: Accepted
**Context**: Need Discord bot framework for interactions and commands

**Decision**: Use Discord.js v14 with native slash commands instead of prefix commands or other libraries.

**Alternatives Considered**:

1. **discord.py (Python)**
   - Pros: Simple syntax, good documentation
   - Cons: Different ecosystem from Node.js/TypeScript

2. **Eris (JavaScript)**
   - Pros: Lower memory usage, faster
   - Cons: Less feature-rich, smaller community

3. **Discord.js v14 (TypeScript)**
   - Pros: Industry standard, excellent TypeScript support, slash commands built-in
   - Cons: Higher memory usage than alternatives

**Rationale**:
- Discord.js is most widely used (largest community, best documentation)
- Native TypeScript support (type safety for interactions)
- Slash commands are Discord's recommended approach (better UX than prefix)
- Interactions API provides buttons, modals, select menus (richer UX)

**Consequences**:

✅ **Positive**:
- Rich interaction components (buttons, modals, dropdowns)
- Type-safe API with TypeScript
- Large community (easy to find solutions)
- Future-proof (Discord investing in slash commands)

❌ **Negative**:
- Higher memory usage (~85MB for bot)
- Command registration required (deploy step)
- Global commands take up to 1 hour to propagate

**Mitigation**:
- Use guild-specific commands for dev (instant)
- Optimize memory usage with appropriate intents

---

## ADR-003: Use PM2 for Process Management (Not Docker)

**Date**: 2024-10-10
**Status**: Accepted
**Context**: Need production deployment strategy for Node.js bot

**Decision**: Use PM2 for process management instead of Docker containers or systemd.

**Alternatives Considered**:

1. **Docker + Docker Compose**
   - Pros: Reproducible builds, container isolation
   - Cons: Overhead for single-process bot, more complex deployment

2. **systemd (native Linux service)**
   - Pros: Built-in to Linux, no dependencies
   - Cons: More complex configuration, no cross-platform support

3. **PM2 (Node.js process manager)**
   - Pros: Simple, built for Node.js, auto-restart, log management
   - Cons: Not container-based, requires Node.js on host

**Rationale**:
- Single-server deployment (no orchestration needed)
- PM2 designed for Node.js (better DX than Docker for this use case)
- Auto-restart on crash (reliability)
- Built-in log management (pm2 logs)
- Simple deployment (scp + pm2 restart)

**Consequences**:

✅ **Positive**:
- Simple deployment (no container build step)
- Easy log access (pm2 logs pawtropolis)
- Auto-restart on failure
- Low overhead (no container runtime)

❌ **Negative**:
- Not containerized (less reproducible than Docker)
- Requires Node.js on host (version mismatch risk)
- No built-in secrets management

**Mitigation**:
- Use nvm or similar to lock Node.js version
- Use .env file for secrets (gitignored)
- Document deployment process in runbook

---

## ADR-004: Use Fastify for Web Server (Not Express)

**Date**: 2024-11-01
**Status**: Accepted
**Context**: Need web server for OAuth2 dashboard and API endpoints

**Decision**: Use Fastify v5 instead of Express or other web frameworks.

**Alternatives Considered**:

1. **Express.js**
   - Pros: Most popular, huge ecosystem
   - Cons: Slower, callback-based (not async/await native)

2. **Koa.js**
   - Pros: Modern async/await API, lightweight
   - Cons: Smaller ecosystem, less middleware

3. **Fastify**
   - Pros: Fastest Node.js framework, schema validation, TypeScript-first
   - Cons: Smaller community than Express

**Rationale**:
- Performance: Fastify is 2-3x faster than Express (benchmarks)
- TypeScript-first design (better DX)
- Built-in schema validation (via JSON Schema)
- Modern API (async/await native)
- Plugin ecosystem growing rapidly

**Consequences**:

✅ **Positive**:
- High performance (low latency for dashboard)
- Type-safe routes with TypeScript
- Built-in validation (no need for Joi/Yup)
- Modern codebase (async/await everywhere)

❌ **Negative**:
- Smaller community than Express (fewer StackOverflow answers)
- Some Express middleware requires adapters
- Less familiar to developers coming from Express

**Mitigation**:
- Document Fastify patterns in codebase
- Use official plugins where available
- Leverage TypeScript for self-documenting code

---

## ADR-005: Use Zod for Environment Validation (Fail-Fast)

**Date**: 2024-11-05
**Status**: Accepted
**Context**: Need to validate environment variables at startup

**Decision**: Use Zod for environment variable validation with fail-fast behavior (exit on invalid env).

**Alternatives Considered**:

1. **No validation (just process.env access)**
   - Pros: Simplest approach
   - Cons: Runtime errors if env vars missing

2. **dotenv-safe (checks for required vars)**
   - Pros: Simple, just checks existence
   - Cons: No type validation, no custom rules

3. **Zod (schema validation library)**
   - Pros: Full schema validation, TypeScript types, custom rules
   - Cons: Additional dependency, more verbose

**Rationale**:
- Fail-fast principle: Catch misconfigurations at startup (not at runtime)
- Type safety: Generate TypeScript types from schema
- Validation: Ensure URLs are valid, passwords meet length requirements
- Developer experience: Clear error messages for missing/invalid env vars

**Consequences**:

✅ **Positive**:
- Catch env errors immediately (before bot starts)
- Type-safe env access (autocomplete in IDE)
- Clear error messages (e.g., "DISCORD_TOKEN missing")
- Prevents runtime errors from misconfiguration

❌ **Negative**:
- Additional dependency (Zod)
- Slightly slower startup (<10ms overhead)
- More verbose than simple checks

**Mitigation**:
- Document .env.example with all required vars
- Use Zod's detailed error messages for debugging

---

## ADR-006: Use Nearest-Rank Percentile (No Interpolation)

**Date**: 2024-11-10
**Status**: Accepted
**Context**: Need to calculate P50/P95 response times for moderator metrics

**Decision**: Use nearest-rank percentile algorithm (always returns observed value) instead of linear interpolation.

**Alternatives Considered**:

1. **Linear Interpolation (Excel/R method)**
   - Pros: Smooth percentiles, "more accurate"
   - Cons: Returns non-observed values, more complex

2. **Nearest-Rank (Wikipedia method)**
   - Pros: Always returns actual observed value, deterministic, simple
   - Cons: Slightly less smooth for small datasets

**Rationale**:
- Simplicity: Easy to understand and implement (8 lines of code)
- Determinism: Same input always produces same output (no rounding issues)
- Interpretability: P95 is an actual observed response time (not interpolated)
- Performance: O(n log n) due to sort, acceptable for typical datasets

**Consequences**:

✅ **Positive**:
- Simple implementation (easy to debug)
- Deterministic (no floating-point issues)
- Returns real observed values (easier to interpret)

❌ **Negative**:
- Less smooth for small datasets (<20 values)
- P95 may jump more between recalculations

**Mitigation**:
- Document percentile method in code comments
- Show sample size alongside percentiles in dashboard

---

## Adding New ADRs

### Template

```markdown
## ADR-XXX: [Title]

**Date**: YYYY-MM-DD
**Status**: Proposed | Accepted | Deprecated | Superseded
**Context**: [Why is this decision needed?]

**Decision**: [What did we decide?]

**Alternatives Considered**:

1. **Option A**
   - Pros: [...]
   - Cons: [...]

2. **Option B**
   - Pros: [...]
   - Cons: [...]

**Rationale**: [Why did we choose this option?]

**Consequences**:

✅ **Positive**:
- [Benefit 1]
- [Benefit 2]

❌ **Negative**:
- [Cost 1]
- [Cost 2]

**Mitigation**: [How do we address negative consequences?]
```

### Process

1. Create new ADR section with sequential number
2. Fill out template with context and alternatives
3. Discuss with team (if applicable)
4. Mark status as "Accepted" when finalized
5. Reference ADR number in code comments where relevant

---

## FAQ / Gotchas

**Q: When should I create an ADR?**
A: When making a decision that:
- Affects system architecture
- Has significant tradeoffs
- Is difficult to reverse
- Needs explanation for future maintainers

**Q: Can ADRs be changed?**
A: Accepted ADRs should not be edited (preserve history). Instead:
- Mark original as "Superseded by ADR-XXX"
- Create new ADR with updated decision

**Q: Do ADRs need approval?**
A: For solo projects: No. For teams: Yes (via PR review or meeting).

**Q: What if an ADR becomes obsolete?**
A: Mark status as "Deprecated" and explain why in a note.

## Changelog

- 2025-10-30: Initial creation with 6 seed ADRs
- Documented SQLite, Discord.js, PM2, Fastify, Zod, percentile decisions
