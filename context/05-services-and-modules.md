## Services and Modules

Major feature modules, their responsibilities, and cross-module dependencies.

---

## Module Architecture

```
src/
├── commands/          # Slash command definitions & handlers
├── features/          # Core business logic modules
├── lib/               # Shared utilities & infrastructure
├── logging/           # Audit & pretty logging
├── scheduler/         # Background jobs
├── web/               # Fastify server & APIs
└── index.ts           # Bot entry point & router
```

---

## Feature Modules

### `features/gate.ts`

**Purpose:** Application form workflow (modals, draft persistence, submission)

**Key exports:**
```typescript
export async function handleStartButton(interaction: ButtonInteraction): Promise<void>
export async function handleGateModalSubmit(interaction: ModalSubmitInteraction, ctx: CmdCtx, pageIndex: number): Promise<void>
export async function handleDoneButton(interaction: ButtonInteraction): Promise<void>
export async function ensureGateEntry(guild: Guild, config: GuildConfig): Promise<EnsureGateEntryResult>
```

**Flow:**
1. User clicks "Start Verification" button in gate channel
2. `handleStartButton` → find/create draft application
3. Show modal with first 5 questions ([src/features/gate/questions.ts](../src/features/gate/questions.ts))
4. `handleGateModalSubmit` → save answers, show next page or finish
5. `handleDoneButton` → mark `status='submitted'`, trigger avatar scan

**Dependencies:**
- `review.ts` → `ensureReviewMessage()` to post staff review card
- `avatarScan.ts` → `scanAvatar()` for NSFW detection (async, non-blocking)
- `db/db.ts` → SQLite for draft persistence

**Reference:** Lines 1-850

---

### `features/review.ts`

**Purpose:** Staff review actions (approve, reject, kick, claim management)

**Key exports:**
```typescript
export async function handleReviewButton(interaction: ButtonInteraction): Promise<void>
export async function handleRejectModal(interaction: ModalSubmitInteraction): Promise<void>
export async function handlePermRejectButton(interaction: ButtonInteraction): Promise<void>
export async function ensureReviewMessage(appId: string): Promise<void>
export async function approveFlow(guild: Guild, appId: string, moderatorId: string): Promise<void>
export async function rejectFlow(guild: Guild, appId: string, moderatorId: string, reason: string): Promise<void>
export async function kickFlow(guild: Guild, appId: string, moderatorId: string, reason?: string): Promise<void>
```

**Flow (Approve):**
1. Staff clicks "Approve" button → `handleReviewButton`
2. Check claim lock (prevent double-approval)
3. Call `approveTx` (DB transaction: set status, insert review_action)
4. Call `approveFlow`:
   - Assign verified role, remove unverified role
   - Send approval DM to user
   - Post welcome message in guild
   - Close modmail thread
   - Log action to audit channel
5. Update review card embed (mark as "Approved")

**Permanent rejection:**
- Sets `application.permanently_rejected=1`
- Blocks future applications from same user
- Irreversible (requires manual SQL to undo)

**Dependencies:**
- `modmail.ts` → `closeModmailForApplication()` auto-close threads
- `welcome.ts` → `postWelcomeCard()` for welcome messages
- `logger.ts` → `logActionPretty()` for audit logs

**Reference:** Lines 1-1300

---

### `features/modmail.ts`

**Purpose:** Private thread DM bridge for staff-applicant communication

**Key exports:**
```typescript
export async function handleModmailOpenButton(interaction: ButtonInteraction): Promise<void>
export async function handleModmailCloseButton(interaction: ButtonInteraction): Promise<void>
export async function routeThreadToDm(message: Message, ticket: ModmailTicket, client: Client): Promise<void>
export async function routeDmToThread(message: Message, ticket: ModmailTicket, client: Client): Promise<void>
export async function closeModmailForApplication(appCode: string, guildId: string): Promise<void>
export async function retrofitAllGuildsOnStartup(client: Client): Promise<void>
```

**Flow (Open modmail):**
1. Staff clicks "Open Modmail" on review card
2. Check if thread already exists (race prevention via `open_modmail` table)
3. Create private thread in review channel
4. Add requesting moderator + all configured mod roles
5. Send starter embed with application context
6. DM applicant: "A moderator has opened a modmail thread"
7. Insert `modmail_ticket` row with `status='open'`

**Message routing:**
- **Thread → DM:** Bot forwards staff messages to applicant's DMs
- **DM → Thread:** Bot forwards applicant messages to private thread
- **Reply preservation:** `modmail_message` table maps message IDs for threading

**Thread closure:**
- Archive thread, set `status='closed'`
- Export transcript as `.txt` file, post to log channel
- DM applicant: "Modmail closed"

**Retrofit on startup:** ([src/features/modmail.ts](../src/features/modmail.ts) L1200-1350)
- Ensures parent channels grant `SendMessagesInThreads` to mod roles
- Fixes legacy threads created before permission system existed

**Dependencies:**
- `config.ts` → Get mod role IDs for thread membership
- `logger.ts` → Log modmail open/close actions

**Reference:** Lines 1-1400

---

### `features/avatarScan.ts`

**Purpose:** ONNX-based NSFW detection and risk scoring

**Key exports:**
```typescript
export async function scanAvatar(avatarUrl: string, applicationId: string): Promise<ScanResult>
export function getScan(applicationId: string): ScanResult | null
export function buildReverseImageUrl(avatarUrl: string): string
```

**Scan logic:** Lines 200-450
1. Download avatar image (max 5MB)
2. Resize to 224x224 for ONNX model input
3. Run NSFW classification model (outputs probability 0.0-1.0)
4. Calculate edge score (skin tone boundary detection via Sharp)
5. Compute `final_pct = (nsfw_score * 0.7) + (edge_score * 0.3)`
6. Apply heuristics (furry/scalie detection based on color distribution)
7. Upsert to `avatar_scan` table

**Risk thresholds:**
- 0-30%: Safe (green)
- 31-60%: Medium (yellow)
- 61-100%: High (red)

**Failure modes:**
- Network timeout → return null, log warning
- ONNX error → return null, mark as "Scan failed"
- Missing avatar → skip scan

**Non-blocking:** Called async on application submit, doesn't delay review card posting

**Dependencies:**
- `onnxruntime-node` → ML inference
- `sharp` → Image processing
- `axios` → Image download

**Reference:** Lines 1-550

---

### `features/modPerformance.ts`

**Purpose:** Mod metrics calculation (PR5 analytics)

**Key exports:**
```typescript
export function refreshModMetrics(guildId: string): void
export function getModMetrics(guildId: string, days?: number): ModMetricsRow[]
```

**Metrics computed:**
- Actions per moderator (approve, reject, kick, claim)
- Average review time (claim to decision)
- Response time distribution
- Daily/weekly/monthly aggregates

**Storage:** Results cached in `mod_metrics` table

**Scheduler:** Refreshed every 15 minutes via [src/scheduler/modMetricsScheduler.ts](../src/scheduler/modMetricsScheduler.ts)

**Reference:** Lines 1-300

---

### `features/analytics/command.ts`

**Purpose:** Application analytics and exports

**Key exports:**
```typescript
export async function executeAnalyticsCommand(interaction: ChatInputCommandInteraction): Promise<void>
export async function executeAnalyticsExportCommand(interaction: ChatInputCommandInteraction): Promise<void>
```

**Analytics included:**
- Application volume over time
- Approval/rejection rates
- Average review times
- Hourly submission patterns
- Moderator performance comparisons

**Export format:** CSV with columns: timestamp, user_id, status, moderator_id, review_time_minutes

**Reference:** Lines 1-350

---

### `features/logger.ts`

**Purpose:** Centralized action logging to Discord channels

**Key exports:**
```typescript
export async function getLoggingChannel(guild: Guild): Promise<TextChannel | null>
export async function logAction(guild: Guild, action: LogAction): Promise<void>
```

**Log types:**
- Application submissions
- Approvals/rejections/kicks
- Modmail open/close
- Config changes
- Member joins

**Output formats:**
- **Discord embed:** Posted to configured logging channel (see [src/logging/pretty.ts](../src/logging/pretty.ts))
- **JSON log:** Written to stdout (Pino logger)
- **Database:** Inserted into `action_log` table

**Reference:** Lines 1-200

---

## Shared Utilities (`lib/`)

### `lib/config.ts`

**Purpose:** Guild configuration access and permission checks

**Key exports:**
```typescript
export function getConfig(guildId: string): GuildConfig
export function hasManageGuild(member: GuildMember): boolean
export function isReviewer(member: GuildMember): boolean
export function canRunAllCommands(member: GuildMember): boolean
```

**Permission hierarchy:**
1. Owners (via `OWNER_IDS` env var) → bypass all checks
2. Manage Guild permission → full access
3. Reviewer role (in `mod_role_ids`) → review commands only

**Reference:** Lines 1-250

---

### `lib/cmdWrap.ts`

**Purpose:** Command wrapper for consistent error handling and deferred replies

**Key exports:**
```typescript
export function wrapCommand<T extends ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction>(
  name: string,
  handler: (ctx: CmdCtx) => Promise<void>
): (interaction: T) => Promise<void>

export async function ensureDeferred(interaction: RepliableInteraction): Promise<void>
export async function replyOrEdit(interaction: RepliableInteraction, options: InteractionReplyOptions): Promise<void>
```

**Features:**
- Auto-defer for long-running commands (3s timeout)
- SQL query wrapping with error logging
- Trace ID injection for observability
- Error card rendering on failure

**Reference:** Lines 1-350

---

### `lib/sentry.ts`

**Purpose:** Sentry error tracking integration

**Key exports:**
```typescript
export function initializeSentry(): void
export function captureException(error: Error, context?: Record<string, any>): void
export function addBreadcrumb(breadcrumb: Breadcrumb): void
export function setUser(user: { id: string; username: string }): void
```

**Breadcrumbs tracked:**
- Interaction flow (slash commands, buttons, modals)
- SQL queries (if `DB_TRACE=1`)
- External API calls

**Reference:** Lines 1-150

---

### `lib/logger.ts`

**Purpose:** Structured JSON logging with Pino

**Key exports:**
```typescript
export const logger: Logger
```

**Log levels:**
- `trace`: Verbose debugging
- `debug`: Development info
- `info`: Normal operations
- `warn`: Recoverable errors
- `error`: Failures
- `fatal`: Critical failures

**Reference:** Lines 1-50

---

## Background Jobs (`scheduler/`)

### `scheduler/modMetricsScheduler.ts`

**Purpose:** Periodic refresh of mod performance metrics

**Exports:**
```typescript
export function startModMetricsScheduler(client: Client): NodeJS.Timeout
export function stopModMetricsScheduler(intervalId: NodeJS.Timeout): void
```

**Interval:** 15 minutes (900,000ms)

**Reference:** Lines 1-100

---

## Web Server (`web/`)

### `web/server.ts`

**Purpose:** Fastify app factory and startup

**Key exports:**
```typescript
export async function createWebServer(): FastifyInstance
export async function startWebServer(port: number): FastifyInstance
```

**Plugins registered:**
- `@fastify/cookie` - Cookie parsing
- `@fastify/session` - Session management
- `@fastify/cors` - CORS headers
- `@fastify/rate-limit` - Rate limiting
- `@fastify/static` - Static file serving

**Reference:** Lines 1-150

---

### `web/auth.ts`

**Purpose:** Discord OAuth2 authentication

**Routes:**
- `GET /auth/login` - Initiate OAuth2 flow
- `GET /auth/callback` - Handle OAuth2 callback
- `GET /auth/whoami` - Get session user
- `POST /auth/logout` - Destroy session

**Reference:** Lines 1-300

---

### `web/api/index.ts`

**Purpose:** API route aggregator

**Registers:**
- `/api/logs` - Action logs
- `/api/metrics` - Analytics
- `/api/config` - Guild config
- `/api/users` - User lookup
- `/api/admin` - Admin actions
- `/api/guild` - Guild info
- `/api/roles` - Role list
- `/api/banner` - Bot banner image

**Reference:** Lines 1-50

---

## Cross-Module Dependencies

```
index.ts (router)
  ├─→ commands/gate.ts
  │     ├─→ features/gate.ts
  │     │     ├─→ features/review.ts (ensureReviewMessage)
  │     │     └─→ features/avatarScan.ts (scanAvatar)
  │     └─→ features/review.ts
  │           ├─→ features/modmail.ts (closeModmailForApplication)
  │           ├─→ features/welcome.ts (postWelcomeCard)
  │           └─→ features/logger.ts (logActionPretty)
  ├─→ commands/modstats.ts
  │     └─→ features/modPerformance.ts
  ├─→ features/analytics/command.ts
  │     └─→ features/analytics/queries.ts
  └─→ web/server.ts
        ├─→ web/auth.ts
        └─→ web/api/index.ts
              ├─→ web/api/logs.ts
              ├─→ web/api/metrics.ts
              └─→ web/api/config.ts
```

---

## Event Topics

**Discord Gateway events handled:**

| Event | Handler | Purpose |
|-------|---------|---------|
| `ready` | [src/index.ts](../src/index.ts) L144-345 | Schema migrations, command sync, startup checks |
| `interactionCreate` | [src/index.ts](../src/index.ts) L435-960 | Route slash commands, buttons, modals |
| `messageCreate` | [src/index.ts](../src/index.ts) L962-1032 | Modmail routing, first message tracking |
| `guildCreate` | [src/index.ts](../src/index.ts) L347-353 | Sync commands to new guild |
| `guildDelete` | [src/index.ts](../src/index.ts) L357-369 | Clear commands from removed guild |
| `guildMemberAdd` | [src/index.ts](../src/index.ts) L375-403 | Log member joins, track join timestamp |
| `threadDelete` | [src/index.ts](../src/index.ts) L408-433 | Clean up orphaned modmail entries |

---

## Module Initialization Order

1. **Sentry** ([src/lib/sentry.ts](../src/lib/sentry.ts)) - First, to capture startup errors
2. **Environment** ([src/lib/env.ts](../src/lib/env.ts)) - Load and validate env vars
3. **Database** ([src/db/db.ts](../src/db/db.ts)) - Open SQLite, set PRAGMAs
4. **Discord Client** ([src/index.ts](../src/index.ts)) - Connect to Gateway
5. **Schema migrations** ([src/db/ensure.ts](../src/db/ensure.ts)) - On `ready` event
6. **Web server** ([src/web/server.ts](../src/web/server.ts)) - After Discord ready
7. **Schedulers** ([src/scheduler/modMetricsScheduler.ts](../src/scheduler/modMetricsScheduler.ts)) - After web server

---

## Next Steps

- Review interaction routing: See [src/index.ts](../src/index.ts) L435-960
- Understand approval flow: See [src/features/review.ts](../src/features/review.ts) L400-600
- Explore modmail routing: See [src/features/modmail.ts](../src/features/modmail.ts) L600-900
