---
title: "Testing Strategy and Fixtures"
slug: "18_Testing_Strategy_and_Fixtures"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Engineering"
audience: "Engineers • QA • Contributors"
source_of_truth: ["tests/", "vitest.config.ts", "package.json test scripts"]
related:
  - "02_System_Architecture_Overview"
  - "07_Database_Schema_and_Migrations"
summary: "Vitest configuration, sample data generation, golden files for embeds, CLI test harness, test isolation best practices, and coverage targets."
---

## Purpose & Outcomes

Document testing practices:
- Vitest setup and configuration
- Test data fixtures and factories
- Golden file testing for embeds
- Database test isolation
- Coverage targets and measurement
- CI/CD integration

## Scope & Boundaries

### In Scope
- Unit tests (individual functions)
- Integration tests (multi-component workflows)
- Database test isolation (in-memory DBs)
- Discord.js mock patterns
- Vitest configuration
- Golden file comparisons
- Test coverage reporting

### Out of Scope
- End-to-end (E2E) tests with real Discord API
- Load testing / stress testing
- Security penetration testing
- Manual QA procedures

## Current State

**Test Framework**: Vitest 3.2.4
**Test Count**: ~185 tests (as of 2025-10-30)
**Coverage Target**: 80% (not enforced)
**Test Location**: `tests/` directory (mirrors `src/`)
**CI**: Not configured (run manually before commits)

**Test Files**:
```
tests/
├── modPerformance.test.ts     # Mod metrics calculations
├── web/
│   └── api.test.ts            # API endpoint tests
├── features/
│   ├── gate.test.ts           # Gate flow tests
│   └── review.test.ts         # Review workflow tests
└── sentry.test.ts             # Sentry integration
```

## Key Flows

### Test Execution Flow
```
1. Run vitest (npm test)
2. Load vitest.config.ts
3. Initialize test environment
4. Run test suites in parallel
5. Collect coverage
6. Report results
```

### Test Isolation Flow
```
1. Create in-memory database (:memory:)
2. Run migrations
3. Seed test data
4. Execute test
5. Clear database
6. Clear caches
```

## Commands & Snippets

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test tests/modPerformance.test.ts

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run tests with UI
npm test -- --ui
```

### Vitest Configuration

```typescript
// File: vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "tests/**",
        "**/*.test.ts",
      ],
    },
    testTimeout: 10000,  // 10 seconds per test
  },
});
```

### Test Data Fixtures

#### Sample Application
```typescript
// File: tests/fixtures/application.ts
export function createTestApplication(overrides = {}) {
  return {
    id: "01HQ8EXAMPLE",
    guild_id: "123456789",
    user_id: "987654321",
    status: "submitted",
    created_at: "2025-10-30T12:00:00Z",
    submitted_at: "2025-10-30T12:05:00Z",
    updated_at: null,
    ...overrides
  };
}
```

#### Sample Review Action
```typescript
// File: tests/fixtures/reviewAction.ts
export function createTestReviewAction(overrides = {}) {
  return {
    id: 1,
    app_id: "01HQ8EXAMPLE",
    action: "approve",
    moderator_id: "123456789",
    reason: "Meets all requirements",
    created_at: 1730217600,
    ...overrides
  };
}
```

#### Sample Mod Metrics
```typescript
// File: tests/fixtures/modMetrics.ts
export function createTestModMetrics(overrides = {}) {
  return {
    moderator_id: "123456789",
    guild_id: "987654321",
    total_claims: 100,
    total_accepts: 75,
    total_rejects: 20,
    total_kicks: 5,
    total_modmail_opens: 15,
    avg_response_time_s: 3600,
    p50_response_time_s: 3000,
    p95_response_time_s: 7200,
    updated_at: "2025-10-30T12:00:00Z",
    ...overrides
  };
}
```

### Database Test Isolation

#### In-Memory Database Setup
```typescript
// File: tests/setup.ts
import Database from "better-sqlite3";

export function createTestDatabase() {
  const db = new Database(":memory:");

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Run migrations
  db.exec(`
    CREATE TABLE application (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
    );

    CREATE TABLE review_action (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      action TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE mod_metrics (
      moderator_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      total_claims INTEGER NOT NULL DEFAULT 0,
      total_accepts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (moderator_id, guild_id)
    );
  `);

  return db;
}
```

#### Test Example with Isolation
```typescript
// File: tests/modPerformance.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "./setup.js";
import { recalcModMetrics } from "../src/features/modPerformance.js";

describe("modPerformance", () => {
  let db;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("should calculate metrics correctly", () => {
    // Seed test data
    db.prepare(`
      INSERT INTO review_action (app_id, action, moderator_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run("01HQ8", "approve", "123456789", 1730217600);

    // Run calculation
    const metrics = recalcModMetrics("987654321", db);

    // Assert
    expect(metrics).toMatchObject({
      moderator_id: "123456789",
      total_accepts: 1
    });
  });
});
```

### Golden File Testing

#### Embed Golden File
```typescript
// File: tests/embeds/reviewCard.golden.json
{
  "title": "Application Review — TestUser",
  "description": "**Q1:** What is your age?\n```md\n25\n```",
  "color": 1973790,
  "fields": [
    {
      "name": "Status",
      "value": "Pending Review",
      "inline": true
    }
  ],
  "footer": {
    "text": "App ID: 01HQ8... | Code: ABC123"
  }
}
```

#### Golden File Test
```typescript
// File: tests/embeds/reviewCard.test.ts
import { describe, it, expect } from "vitest";
import { buildReviewEmbed } from "../src/ui/reviewCard.js";
import goldenEmbed from "./reviewCard.golden.json";

describe("reviewCard", () => {
  it("should match golden file", () => {
    const embed = buildReviewEmbed({
      app: createTestApplication(),
      answers: [{ q_index: 1, question: "What is your age?", answer: "25" }]
    });

    expect(embed.data).toMatchObject(goldenEmbed);
  });
});
```

### Mocking Discord.js

```typescript
// File: tests/mocks/discord.ts
import { vi } from "vitest";

export function createMockInteraction(overrides = {}) {
  return {
    user: { id: "123456789", username: "TestUser" },
    guildId: "987654321",
    member: {
      permissions: {
        has: vi.fn().mockReturnValue(true)
      },
      roles: {
        cache: new Map()
      }
    },
    reply: vi.fn(),
    editReply: vi.fn(),
    deferReply: vi.fn(),
    ...overrides
  };
}
```

## Interfaces & Data

### Test Coverage Report

```bash
npm test -- --coverage

# Output:
# --------------------------|---------|----------|---------|---------|-------------------
# File                      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
# --------------------------|---------|----------|---------|---------|-------------------
# All files                 |   85.4  |   78.2   |   82.1  |   85.4  |
#  src/features             |   90.2  |   85.3   |   88.7  |   90.2  |
#   modPerformance.ts       |   95.1  |   92.3   |   96.0  |   95.1  | 145-148
#   review.ts               |   88.3  |   80.1   |   85.2  |   88.3  | 230-245, 310-320
#  src/lib                  |   82.5  |   75.4   |   78.9  |   82.5  |
#   config.ts               |   80.0  |   70.0   |   75.0  |   80.0  | 45-50, 78-82
# --------------------------|---------|----------|---------|---------|-------------------
```

## Ops & Recovery

### Fixing Failing Tests

```bash
# 1. Run tests to identify failures
npm test

# 2. Run specific failing test
npm test tests/modPerformance.test.ts

# 3. Enable verbose output
npm test -- --reporter=verbose

# 4. Run with watch mode to iterate
npm test -- --watch
```

### Updating Golden Files

```bash
# 1. Run test to see diff
npm test tests/embeds/reviewCard.test.ts

# 2. If change is intentional, update golden file
cp tests/embeds/reviewCard.actual.json tests/embeds/reviewCard.golden.json

# 3. Re-run test to verify
npm test tests/embeds/reviewCard.test.ts
```

## Security & Privacy

- No real Discord tokens in tests (use mocks)
- No real database in tests (use :memory:)
- Test data anonymized (synthetic user IDs)

## FAQ / Gotchas

**Q: Why are tests failing in CI but passing locally?**
A: Likely test isolation issue. Ensure `beforeEach` clears all state.

**Q: How do I debug a failing test?**
A: Add `console.log` statements or use `--reporter=verbose`.

**Q: Can I run a single test?**
A: Yes: `npm test -- --grep "should calculate metrics"`

**Q: What's the coverage target?**
A: 80% statement coverage (not enforced, aspirational).

## Changelog

- 2025-10-30: Initial creation with Vitest setup and fixture examples
