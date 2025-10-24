## Glossary and Concepts

Project-specific terminology, design decisions, and architectural rationale.

---

## Project-Specific Terms

### Application Flow

**Application**
: A user's verification submission, tracked through the lifecycle: `draft` → `submitted` → `approved`/`rejected`/`kicked`.

**Draft**
: Partially completed application that persists across page refreshes. Allows users to save progress and continue later.

**Gate Entry**
: The "Start Verification" button posted in the configured gate channel. Entry point for new applicants.

**Review Card**
: Rich Discord embed posted to staff channel showing applicant info, answers, avatar risk, and action buttons (Approve/Reject/Kick).

**HEX6 Code**
: 6-character hexadecimal identifier for applications (e.g., `ABC123`). Human-friendly short code derived from ULID.
```typescript
// src/lib/ids.ts
export function shortCode(id: string): string {
  return id.slice(-6).toUpperCase();
}
```

**Claim**
: Exclusive lock acquired by a reviewer when clicking Approve/Reject/Kick. Prevents duplicate actions by multiple moderators.

**Permanent Rejection**
: Irreversible ban from reapplying. Sets `application.permanently_rejected=1`, blocking future submissions from the same user.

---

### Modmail System

**Modmail Thread**
: Private Discord thread that bridges staff and applicant DMs. Allows confidential communication without exposing staff personal DMs.

**Thread Routing**
: Bidirectional message forwarding:
  - Staff message in thread → Forwarded to applicant's DMs
  - Applicant DM → Forwarded to private thread

**Transcript**
: Plain text export of all modmail messages, posted to logging channel when thread closes. Format: `.txt` attachment.

**Retrofit**
: Startup process that grants `SendMessagesInThreads` permission to mod roles on parent channels. Fixes legacy threads created before permission system.

**Open Modmail Table**
: Race-prevention table with PRIMARY KEY `(guild_id, applicant_id)`. Ensures only one open modmail thread per user per guild.

---

### Avatar Scanning

**NSFW Score**
: Probability (0.0-1.0) from ONNX model that avatar contains explicit content. Trained on NSFW image dataset.

**Edge Score**
: Heuristic based on edge pixel count after grayscale conversion. Detects high-contrast skin tone boundaries (indicator of explicit content).

**Final Percentage**
: Weighted composite score: `(nsfw_score * 0.7) + (edge_score * 0.3) * 100`. Displayed on review cards as 0-100%.

**Furry/Scalie Score**
: Community-specific heuristics based on color distribution and edge patterns. Helps moderators identify art style.

**Google Lens Link**
: Reverse image search URL generated from avatar URL. Allows moderators to quickly check for stolen art or known NSFW sources.

---

### Permission System

**Owner**
: User IDs in `OWNER_IDS` env var. Bypass all permission checks (for bot developer/admin).

**Manage Guild**
: Discord permission `MANAGE_GUILD`. Grants full access to all bot commands.

**Reviewer**
: User with any role in `guild_config.mod_role_ids`. Can run review commands (approve, reject, modmail).

**Gatekeeper**
: Reserved role ID in `guild_config.gatekeeper_role_id`. Not yet implemented (planned for limited review permissions).

---

### Logging & Audit

**Action Log**
: High-level audit trail in `action_log` table. Stores: `app_submitted`, `claim`, `approve`, `reject`, `kick`, `modmail_open`, `member_join`.

**Review Action**
: Granular audit trail in `review_action` table. Stores moderator decisions with reasons, timestamps, and DM delivery status.

**Logging Channel**
: Configured Discord channel where pretty embeds are posted for all actions. Set via `/config set logging_channel_id`.

**Pretty Logging**
: Rich Discord embeds with color-coded severity, timestamps, and structured fields. Implemented in [src/logging/pretty.ts](../src/logging/pretty.ts).

**Trace ID**
: Unique identifier (ULID) per interaction. Used to correlate logs across multiple operations. Example: `01ARZ3NDEKTSV4RRFFQ69G5FAV`.

---

### Configuration

**Guild Config**
: Per-guild settings stored in `guild_config` table. Includes role IDs, channel IDs, and feature toggles.

**Env Var**
: Environment variable loaded from `.env` file. Instance-level configuration (e.g., `DISCORD_TOKEN`, `LOG_LEVEL`).

**dotenvx**
: Enhanced `.env` loader supporting encryption and environment-specific files (e.g., `.env.production`).

---

### Database

**ULID**
: Universally Unique Lexicographically Sortable Identifier. 26-character, base32-encoded, sortable by creation time. Used for `application.id`.

**UPSERT**
: SQL pattern: `INSERT ... ON CONFLICT DO UPDATE`. Used for idempotent operations (e.g., avatar scan results).

**WAL Mode**
: Write-Ahead Logging. SQLite journaling mode that improves concurrency. Enabled by default in [src/db/db.ts](../src/db/db.ts) L31.

**Schema Self-Heal**
: Idempotent migrations run on every startup via [src/db/ensure.ts](../src/db/ensure.ts). Adds missing columns/indexes without recreating tables.

---

## Design Decisions

### Why Synchronous SQLite (better-sqlite3)?

**Rationale:**
- Simpler error handling (try/catch vs async/await + .catch)
- Faster for bot workloads (no async overhead)
- Better transaction semantics (synchronous = atomic)

**Trade-off:**
- Blocks event loop during queries (mitigated by keeping queries fast)

**Decision date:** Initial project setup (2024-01)

**Alternatives considered:**
- `node-sqlite3` (rejected: slower, callback hell)
- PostgreSQL (rejected: too much ops overhead for single-server deployment)

---

### Why Per-Guild Command Registration?

**Rationale:**
- Instant command availability (vs 1 hour for global commands)
- Easier testing (no wait for propagation)
- Guild-specific configs (future: different commands per guild)

**Trade-off:**
- More API calls on bot startup (one per guild)
- Not scalable to 1000+ guilds (use global commands at scale)

**Decision date:** 2024-03

**Implementation:** [src/index.ts](../src/index.ts) L339-344

---

### Why HEX6 Short Codes Instead of ULIDs?

**Rationale:**
- Easier for humans to type (`/accept ABC123` vs `/accept 01ARZ3NDEKTSV4RRFFQ69G5FAV`)
- Fits in Discord button custom IDs (100 char limit)
- Still globally unique (derived from ULID suffix)

**Trade-off:**
- Slight collision risk if applications created in same millisecond (extremely rare)

**Decision date:** 2024-02

**Implementation:** [src/lib/ids.ts](../src/lib/ids.ts) L10-15

---

### Why Idempotent Schema Migrations on Every Startup?

**Rationale:**
- No migration tooling needed (Knex, Sequelize, etc.)
- No version tracking table
- Always self-healing (works after manual schema edits)

**Trade-off:**
- Slower startup (~50ms for all checks)
- Can't rollback migrations (only additive)

**Decision date:** 2024-01

**Implementation:** [src/db/ensure.ts](../src/db/ensure.ts)

---

### Why No Formal Message Queue?

**Rationale:**
- Bot workload is low-volume (<100 events/minute)
- Discord.js handles Gateway events in-order
- Avatar scanning is async but non-critical (can fail gracefully)

**Trade-off:**
- Can't defer expensive operations (e.g., batch avatar scans)
- No retry mechanism for failed background jobs

**Decision date:** 2024-03

**Future consideration:** Add Redis-backed queue if volume exceeds 1000 events/minute

---

### Why Fastify Over Express?

**Rationale:**
- 2-3x faster routing (matters for dashboard API)
- First-class TypeScript support (better DX)
- Schema validation built-in (Zod/JSON Schema)
- Modern async/await design (no callback hell)

**Trade-off:**
- Smaller ecosystem than Express
- Fewer Stack Overflow answers

**Decision date:** 2024-08 (web panel added)

**Implementation:** [src/web/server.ts](../src/web/server.ts)

---

## Open Questions & TODOs

### Code TODOs

**From [tsconfig.json](../tsconfig.json) L12-14:**
```json
// TODO: Enable these stricter checks in a future PR
// "noUnusedLocals": true,
// "noUnusedParameters": true,
```

**Rationale:** Existing code has many unused parameters (e.g., Discord.js event handlers). Enabling would require large refactor.

**Effort:** ~4-8 hours to fix all violations

---

**From [src/features/review.ts](../src/features/review.ts) L5:**
```typescript
// Dear future me: I'm sorry about the state machine
```

**Context:** Approval/rejection flow has complex branching (DM delivery, role assignment, welcome message, modmail closure). Could benefit from explicit state machine library (XState).

**Effort:** ~16-24 hours to refactor with XState

---

### Feature Requests

**From codebase exploration:**

1. **UI for configuring guild questions** (current: manual SQL inserts)
   - **Effort:** 8-16 hours
   - **Benefit:** Easier onboarding for new servers

2. **Bulk approval/rejection** (current: one-by-one)
   - **Effort:** 4-8 hours
   - **Benefit:** Faster queue processing during raids

3. **Application search/filter in web dashboard**
   - **Effort:** 8-12 hours
   - **Benefit:** Better analytics, find specific applications

4. **Configurable avatar scan thresholds per guild**
   - **Effort:** 2-4 hours
   - **Benefit:** Different communities have different risk tolerance

5. **Webhooks for external integrations** (e.g., post to external log aggregator)
   - **Effort:** 4-6 hours
   - **Benefit:** Integration with Grafana, Datadog, etc.

---

### Known Issues

**From code comments:**

**Modmail thread permissions** (fixed in PR, but noted for history):
- Private threads require BOTH thread membership AND parent channel `SendMessagesInThreads`
- Legacy threads created before permission system needed manual fix
- **Solution:** `retrofitAllGuildsOnStartup()` runs on every bot start

**Avatar scan false positives:**
- Edge detection heuristic triggers on high-contrast anime art
- **Mitigation:** Show risk % but don't block submission
- **Future:** Train custom model on furry/anime art dataset

**Web dashboard caching issues** (noted in known issues docs):
- CloudFlare aggressively caches `.js`/`.css` files despite `no-cache` headers
- **Mitigation:** Force `Cache-Control: no-cache` in [src/web/server.ts](../src/web/server.ts) L86-92
- **Future:** Implement asset fingerprinting (e.g., `app.abc123.js`)

---

## Architectural Patterns

### Command Wrapper Pattern

**File:** [src/lib/cmdWrap.ts](../src/lib/cmdWrap.ts)

**Purpose:** Wrap all command handlers with consistent error handling, deferred replies, and trace ID injection.

**Pattern:**
```typescript
export function wrapCommand<T>(
  name: string,
  handler: (ctx: CmdCtx) => Promise<void>
): (interaction: T) => Promise<void> {
  return async (interaction: T) => {
    const traceId = newTraceId();
    try {
      await ensureDeferred(interaction);
      await handler({ interaction, traceId });
    } catch (err) {
      await postErrorCard(interaction, { err, traceId });
    }
  };
}
```

**Benefits:**
- DRY (no repeated error handling in every command)
- Automatic deferred replies (prevents "Unknown interaction" errors)
- Centralized observability (trace IDs, Sentry breadcrumbs)

---

### Schema Self-Heal Pattern

**File:** [src/db/ensure.ts](../src/db/ensure.ts)

**Purpose:** Idempotent migrations that run on every startup.

**Pattern:**
```typescript
export function ensureMyFeature() {
  // 1. Check if table exists
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='my_table'"
  ).get();

  if (!tableExists) {
    // 2. Create table
    db.exec("CREATE TABLE my_table (...)");
    return;
  }

  // 3. Check if column exists
  const cols = db.prepare("PRAGMA table_info(my_table)").all();
  if (!cols.some(c => c.name === "new_column")) {
    // 4. Add missing column
    db.exec("ALTER TABLE my_table ADD COLUMN new_column TEXT");
  }
}
```

**Benefits:**
- No version tracking needed
- Self-healing after manual schema edits
- Safe to run multiple times

---

### Modal Pagination Pattern

**File:** [src/features/gate.ts](../src/features/gate.ts)

**Purpose:** Split long question lists into paginated modals (5 questions per page).

**Pattern:**
```typescript
// Page 0: Questions 0-4
// Page 1: Questions 5-9
// Page 2: Questions 10-14

const pages = chunk(questions, 5);  // [[Q0-Q4], [Q5-Q9], ...]

for (const [pageIndex, pageQuestions] of pages.entries()) {
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:${pageIndex}:${code}`)
    .setTitle(`Application (Page ${pageIndex + 1}/${pages.length})`);

  for (const q of pageQuestions) {
    modal.addComponents(createTextInput(q));
  }

  await interaction.showModal(modal);
}
```

**Benefits:**
- Works around Discord's 5 input limit per modal
- Preserves draft state between pages
- Clear progress indicator for users

---

### Race-Safe Modmail Pattern

**File:** [src/features/modmail.ts](../src/features/modmail.ts) L200-300

**Purpose:** Prevent duplicate modmail threads when multiple mods click simultaneously.

**Pattern:**
```sql
-- Table with PRIMARY KEY prevents duplicates
CREATE TABLE open_modmail (
  guild_id TEXT NOT NULL,
  applicant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, applicant_id)
);

-- Insert attempt fails if row exists
INSERT INTO open_modmail (guild_id, applicant_id, thread_id)
VALUES (?, ?, ?);
-- If this throws SQLITE_CONSTRAINT, another mod already opened thread
```

**Benefits:**
- Database-level race prevention (no application-level locks)
- Works across bot restarts
- Simple to reason about (one row = one open thread)

---

## Abbreviations & Acronyms

| Term | Meaning |
|------|---------|
| **ANW-1.0** | Attribution–No Wholesale Copying License (custom license) |
| **API** | Application Programming Interface |
| **CORS** | Cross-Origin Resource Sharing |
| **CSV** | Comma-Separated Values |
| **DM** | Direct Message (Discord private message) |
| **ESM** | ECMAScript Modules (import/export syntax) |
| **HEX6** | 6-character hexadecimal code (e.g., ABC123) |
| **NSFW** | Not Safe For Work (explicit content) |
| **OAuth2** | Open Authorization 2.0 (authentication protocol) |
| **ONNX** | Open Neural Network Exchange (ML model format) |
| **ORM** | Object-Relational Mapping |
| **PM2** | Process Manager 2 (Node.js process manager) |
| **PR** | Pull Request |
| **ULID** | Universally Unique Lexicographically Sortable Identifier |
| **UUID** | Universally Unique Identifier |
| **WAL** | Write-Ahead Logging (SQLite journaling mode) |

---

## Key File Locations

Quick reference for commonly edited files:

| File | Purpose |
|------|---------|
| [.env](.env) | Environment variables (not in repo) |
| [package.json](../package.json) | Dependencies, scripts, metadata |
| [tsconfig.json](../tsconfig.json) | TypeScript compiler config |
| [vitest.config.ts](../vitest.config.ts) | Test framework config |
| [eslint.config.js](../eslint.config.js) | Linting rules |
| [src/index.ts](../src/index.ts) | Bot entry point, event router |
| [src/db/db.ts](../src/db/db.ts) | Database connection, schema bootstrap |
| [src/db/ensure.ts](../src/db/ensure.ts) | Schema migrations |
| [src/features/gate.ts](../src/features/gate.ts) | Application submission flow |
| [src/features/review.ts](../src/features/review.ts) | Approval/rejection logic |
| [src/features/modmail.ts](../src/features/modmail.ts) | Modmail thread management |
| [src/web/server.ts](../src/web/server.ts) | Web server factory |
| [src/lib/config.ts](../src/lib/config.ts) | Configuration access |
| [src/lib/env.ts](../src/lib/env.ts) | Environment variable schema |

---

## Related Documentation

- **Setup guide:** [02-setup-and-running.md](02-setup-and-running.md)
- **Database schema:** [03-domain-and-data-models.md](03-domain-and-data-models.md)
- **API reference:** [04-apis-and-endpoints.md](04-apis-and-endpoints.md)
- **Module overview:** [05-services-and-modules.md](05-services-and-modules.md)
- **Environment vars:** [06-config-and-environments.md](06-config-and-environments.md) or [ENV_REFERENCE.md](../ENV_REFERENCE.md)
- **Build process:** [07-build-and-ci.md](07-build-and-ci.md)
- **Testing:** [08-testing-and-quality.md](08-testing-and-quality.md)
- **Dependencies:** [09-dependencies-and-integrations.md](09-dependencies-and-integrations.md)
- **Contributing:** [CONTRIBUTING.md](../CONTRIBUTING.md)
- **README:** [README.md](../README.md)

---

## Contributing to this Glossary

When adding new terms:
1. Use **definition list syntax** (`:` after term)
2. Include file/line references for code concepts
3. Link to relevant context docs
4. Add abbreviations to acronym table
5. Update "Key File Locations" if adding new core files

**Example:**
```markdown
**My New Feature**
: Brief description of the feature and why it exists.

**Implementation:** [src/features/myFeature.ts](../src/features/myFeature.ts) L100-200

**Decision rationale:** (explain why this approach was chosen)
```
