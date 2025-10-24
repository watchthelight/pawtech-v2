## Testing and Quality

Test strategy, test suite organization, coverage metrics, and quality tools.

---

## Test Framework

**Framework:** Vitest 3.x

**Config:** [vitest.config.ts](../vitest.config.ts)

**Setup file:** `tests/setup.ts`

**Run tests:**
```bash
npm test                    # Run all tests once
npm test -- --watch         # Watch mode
npm test -- --ui            # Visual UI
npm test -- --coverage      # Generate coverage report
```

---

## Test Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,              // No imports needed (describe, it, expect)
    environment: "node",        // Node.js environment
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,         // Auto-restore mocks after each test
    clearMocks: true,           // Auto-clear mock history
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
```

---

## Test Organization

**Structure:** Tests mirror `src/` directory structure

```
tests/
├── setup.ts                    # Global test setup
├── lib/
│   ├── cmdWrap.test.ts
│   ├── errorCard.test.ts
│   ├── errorHints.test.ts
│   └── timefmt.test.ts
├── review/
│   ├── approveFlow.test.ts
│   ├── avatarScanField.test.ts
│   ├── cardTime.test.ts
│   ├── claimGating.test.ts
│   ├── getScan.test.ts
│   ├── modalReject.test.ts
│   ├── postWelcomeMessage.test.ts
│   ├── reviewActionInserts.test.ts
│   ├── reviewActionMigration.test.ts
│   ├── reviewActionPerformance.test.ts
│   ├── reviewCard.test.ts
│   ├── slashCommands.test.ts
│   └── welcomeTemplate.test.ts
├── avatarScan/
│   ├── reverseLink.test.ts
│   ├── risk.test.ts
│   ├── scanner.test.ts
│   └── schemaEnsure.test.ts
├── gate/
│   └── gateEntryPayload.test.ts
├── commands/
│   └── send.test.ts
├── web/
│   ├── api.test.ts
│   └── auth.test.ts
├── config.test.ts
├── dashboard.test.ts
├── env.test.ts
├── flag.store.test.ts
├── logger.test.ts
├── modPerformance.test.ts
├── modstats.test.ts
├── router.modal.test.ts
└── sentry.test.ts
```

**Total test files:** 34 files, ~180+ test cases

---

## Test Categories

### Unit Tests

**Purpose:** Test individual functions in isolation

**Example:** [tests/lib/timefmt.test.ts](../tests/lib/timefmt.test.ts)

```typescript
import { describe, it, expect } from "vitest";
import { toDiscordAbs, toDiscordRel } from "../src/lib/timefmt.js";

describe("toDiscordAbs", () => {
  it("should format unix timestamp as Discord absolute time", () => {
    const ts = 1698765432;
    const result = toDiscordAbs(ts);
    expect(result).toBe("<t:1698765432:F>");
  });

  it("should handle custom format", () => {
    const ts = 1698765432;
    const result = toDiscordAbs(ts, "d");
    expect(result).toBe("<t:1698765432:d>");
  });
});
```

**Coverage:**
- Pure functions (no side effects)
- Utility libraries
- Data transformations
- Validation logic

---

### Integration Tests

**Purpose:** Test feature workflows end-to-end

**Example:** [tests/review/approveFlow.test.ts](../tests/review/approveFlow.test.ts)

```typescript
describe("approveFlow", () => {
  it("should approve application and assign roles", async () => {
    // Setup: Create test application
    const appId = createTestApplication();

    // Execute approval flow
    await approveFlow(mockGuild, appId, moderatorId);

    // Verify: Check database state
    const app = getApplication(appId);
    expect(app.status).toBe("approved");

    // Verify: Check role assignment
    const member = await mockGuild.members.fetch(userId);
    expect(member.roles.cache.has(verifiedRoleId)).toBe(true);

    // Verify: Check audit log
    const actions = getReviewActions(appId);
    expect(actions).toContainEqual(
      expect.objectContaining({ action: "approve" })
    );
  });
});
```

**Coverage:**
- Application submission flow
- Review card rendering
- Approval/rejection workflows
- Modmail routing
- Avatar scanning pipeline

---

### Database Tests

**Purpose:** Test schema migrations and data integrity

**Example:** [tests/avatarScan/schemaEnsure.test.ts](../tests/avatarScan/schemaEnsure.test.ts)

```typescript
describe("ensureAvatarScanSchema", () => {
  it("should create avatar_scan table if missing", () => {
    // Drop table if exists
    db.exec("DROP TABLE IF EXISTS avatar_scan");

    // Run migration
    ensureAvatarScanSchema();

    // Verify table exists
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='avatar_scan'"
    ).all();
    expect(tables).toHaveLength(1);

    // Verify columns
    const cols = db.prepare("PRAGMA table_info(avatar_scan)").all();
    expect(cols.map(c => c.name)).toContain("application_id");
    expect(cols.map(c => c.name)).toContain("nsfw_score");
  });
});
```

**Coverage:**
- Schema creation
- Column migrations
- Index creation
- Data preservation during migrations

---

### API Tests

**Purpose:** Test REST API endpoints

**Example:** [tests/web/api.test.ts](../tests/web/api.test.ts)

```typescript
describe("GET /api/logs", () => {
  it("should return action logs with pagination", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/logs?guild_id=123&limit=10&offset=0",
      cookies: { session: validSessionCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.logs).toBeInstanceOf(Array);
    expect(body.total).toBeGreaterThan(0);
    expect(body.has_more).toBe(false);
  });

  it("should reject unauthenticated requests", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/logs",
    });

    expect(response.statusCode).toBe(401);
  });
});
```

**Coverage:**
- Authentication flows
- Authorization checks
- Request validation
- Response formatting
- Error handling

---

## Test Fixtures

**Shared test data:** `tests/setup.ts`

```typescript
// Mock Discord objects
export const mockGuild = {
  id: "123456789012345678",
  name: "Test Guild",
  // ...
};

export const mockUser = {
  id: "987654321098765432",
  username: "testuser",
  // ...
};

// Mock database
export function setupTestDb() {
  // Create in-memory SQLite
  const db = new Database(":memory:");
  // Run migrations
  // Return db instance
}
```

**Usage:**
```typescript
import { setupTestDb, mockGuild } from "./setup.js";

describe("myFeature", () => {
  let db;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("should work", () => {
    // Test using db and mockGuild
  });
});
```

---

## Mocking Strategy

### Discord.js Mocks

**Mock interaction objects:**

```typescript
import { vi } from "vitest";

const mockInteraction = {
  reply: vi.fn(),
  deferReply: vi.fn(),
  editReply: vi.fn(),
  user: mockUser,
  guildId: mockGuild.id,
  channelId: "111222333444555666",
};
```

**Mock client:**

```typescript
const mockClient = {
  guilds: {
    cache: new Map([[mockGuild.id, mockGuild]]),
  },
  user: {
    id: "bot_user_id",
    tag: "TestBot#0000",
  },
};
```

---

### Database Mocks

**In-memory SQLite for speed:**

```typescript
const db = new Database(":memory:");
db.exec(`CREATE TABLE application (...)`);
```

**Benefits:**
- Fast (no disk I/O)
- Isolated (no test pollution)
- Realistic (real SQLite engine)

---

### HTTP Mocks

**Fastify test injection:**

```typescript
import { createWebServer } from "../src/web/server.js";

const app = await createWebServer();

const response = await app.inject({
  method: "GET",
  url: "/api/logs",
  headers: {
    cookie: "session=valid_session_id",
  },
});
```

**No network requests** - all handled in-memory.

---

## Coverage Metrics

**Generate coverage report:**
```bash
npm test -- --coverage
```

**Output:**
```
 % Coverage report from v8
----------------------------|---------|----------|---------|---------|
File                        | % Stmts | % Branch | % Funcs | % Lines |
----------------------------|---------|----------|---------|---------|
All files                   |   78.45 |    65.32 |   80.12 |   78.98 |
 src/                       |   85.23 |    72.14 |   88.56 |   85.67 |
  index.ts                  |   92.34 |    80.45 |   95.12 |   92.89 |
 src/features/              |   76.89 |    63.21 |   78.45 |   77.23 |
  gate.ts                   |   82.45 |    70.12 |   84.23 |   82.78 |
  review.ts                 |   80.67 |    68.34 |   82.11 |   81.05 |
  modmail.ts                |   65.23 |    52.45 |   68.12 |   65.89 |
----------------------------|---------|----------|---------|---------|
```

**Coverage goals:**
- Core features: >80%
- Utilities: >90%
- Overall: >75%

**Current coverage:** ~78% (as of 2025-01-23)

---

## Code Quality Tools

### ESLint

**Run:**
```bash
npm run lint
```

**Config:** [eslint.config.js](../eslint.config.js)

**Rules:**
- All errors demoted to warnings (non-blocking)
- TypeScript-aware
- Prettier-compatible

**Auto-fix:**
```bash
npm run lint -- --fix
```

---

### Prettier

**Run:**
```bash
npm run format
```

**Settings:**
- 2-space indentation
- Single quotes
- Semicolons always
- Trailing commas (ES5)

**VSCode integration:**
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

---

### TypeScript Strict Mode

**Enabled checks:**
- `strict: true` (all strict checks)
- `noFallthroughCasesInSwitch: true`
- `forceConsistentCasingInFileNames: true`

**Planned (TODO in [tsconfig.json](../tsconfig.json) L12-14):**
- `noUnusedLocals: true`
- `noUnusedParameters: true`

---

## Testing Best Practices

### Test Structure

**AAA pattern:**
```typescript
it("should do something", () => {
  // Arrange
  const input = setupTestData();

  // Act
  const result = functionUnderTest(input);

  // Assert
  expect(result).toBe(expected);
});
```

---

### Test Isolation

**DO:**
```typescript
describe("myFeature", () => {
  let db;

  beforeEach(() => {
    db = setupCleanDatabase();  // Fresh DB per test
  });

  afterEach(() => {
    db.close();  // Cleanup
  });
});
```

**DON'T:**
```typescript
// Shared state across tests (bad)
const db = setupDatabase();

it("test1", () => { /* uses db */ });
it("test2", () => { /* uses same db, polluted by test1 */ });
```

---

### Async Testing

**DO:**
```typescript
it("should handle async operations", async () => {
  const result = await asyncFunction();
  expect(result).toBe(expected);
});
```

**DON'T:**
```typescript
it("should handle async operations", () => {
  asyncFunction().then(result => {
    expect(result).toBe(expected);  // May not run before test ends
  });
});
```

---

### Mock Verification

**DO:**
```typescript
it("should call interaction.reply", async () => {
  const mockReply = vi.fn();
  const interaction = { reply: mockReply };

  await handleCommand(interaction);

  expect(mockReply).toHaveBeenCalledWith({
    content: "Success",
    flags: MessageFlags.Ephemeral,
  });
});
```

---

## Running Tests

### All Tests

```bash
npm test
```

**Output:**
```
 ✓ tests/lib/timefmt.test.ts (8 tests) 12ms
 ✓ tests/review/approveFlow.test.ts (15 tests) 234ms
 ✓ tests/avatarScan/risk.test.ts (12 tests) 156ms

Test Files  34 passed (34)
     Tests  184 passed (184)
  Start at  12:34:56
  Duration  5.23s
```

---

### Specific Test File

```bash
npm test tests/review/approveFlow.test.ts
```

---

### Watch Mode

```bash
npm test -- --watch
```

**Reruns tests on file changes** - great for TDD workflow.

---

### Coverage Report

```bash
npm test -- --coverage
```

**Output:**
- Terminal summary
- HTML report: `coverage/index.html`
- JSON report: `coverage/coverage.json`

---

### UI Mode

```bash
npm test -- --ui
```

**Opens browser-based test UI** with:
- File tree
- Test results
- Coverage visualization
- Watch mode controls

---

## Troubleshooting Tests

### Tests Hang Indefinitely

**Problem:** Tests don't finish

**Solution:**
```bash
# Check for missing await
# Check for infinite loops
# Add timeout
npm test -- --testTimeout=10000  # 10 second timeout
```

---

### Database Lock Errors

**Problem:** `SQLITE_BUSY` in tests

**Solution:**
```typescript
// Use separate DB per test
beforeEach(() => {
  db = new Database(":memory:");
});

afterEach(() => {
  db.close();
});
```

---

### Mock Not Working

**Problem:** Mock function not called

**Solution:**
```typescript
// Ensure mock is passed to function
const mockFn = vi.fn();
functionUnderTest(mockFn);  // Not: functionUnderTest(realFn)

// Check call count
expect(mockFn).toHaveBeenCalledTimes(1);
```

---

### Coverage Not Generated

**Problem:** `npm test -- --coverage` fails

**Solution:**
```bash
# Install v8 coverage provider
npm install -D @vitest/coverage-v8

# Or use c8
npm install -D c8
```

---

## Quality Metrics

**Current stats (as of 2025-01-23):**
- **Test files:** 34
- **Test cases:** 184 (180 passing, 4 skipped)
- **Code coverage:** 78.45%
- **Lint warnings:** 0 errors, ~20 warnings
- **Build time:** ~2.5s
- **Test time:** ~5-15s (varies by machine)

---

## Next Steps

- Review test examples: Browse `tests/` directory
- Add new tests: Follow AAA pattern, mirror `src/` structure
- Improve coverage: Run `npm test -- --coverage` and target uncovered lines
- Set up CI: See [07-build-and-ci.md](07-build-and-ci.md)
