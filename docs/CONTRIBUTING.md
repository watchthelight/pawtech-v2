# Contributing to Pawtropolis Tech Gatekeeper

Thank you for your interest in contributing to Pawtropolis Tech Gatekeeper! This guide will help you get started with development and understand our contribution workflow.

---

## Getting Started

### Prerequisites

- **Node.js**: Version 20.0.0 or higher
- **Git**: For version control
- **Discord Bot**: A test bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
- **Code Editor**: VSCode recommended (with ESLint and Prettier extensions)

### Development Setup

1. **Fork and clone the repository:**

   ```bash
   git clone https://github.com/YOUR-USERNAME/pawtropolis-tech.git
   cd pawtropolis-tech
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Create a `.env` file:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your test bot credentials:

   ```env
   DISCORD_TOKEN=your_test_bot_token
   CLIENT_ID=your_test_application_id
   GUILD_ID=your_test_guild_id
   DB_PATH=./data/dev.db
   NODE_ENV=development
   LOG_LEVEL=debug
   ```

4. **Run the development server:**

   ```bash
   npm run dev
   ```

---

## Development Workflow

### Branch Naming

Use descriptive branch names with prefixes:

- `feat/` - New features (e.g., `feat/modmail-attachments`)
- `fix/` - Bug fixes (e.g., `fix/review-card-timeout`)
- `refactor/` - Code refactoring (e.g., `refactor/db-queries`)
- `docs/` - Documentation updates (e.g., `docs/contributing-guide`)
- `chore/` - Maintenance tasks (e.g., `chore/dependency-updates`)
- `test/` - Test additions or fixes (e.g., `test/gate-validation`)

### Commit Style

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Examples:**

```
feat(modmail): add attachment forwarding support

Allows users to send images and files through modmail threads.
Attachments are forwarded to staff channels with proper embeds.

Closes #42
```

```
fix(review): prevent duplicate claim attempts

Added transaction lock to prevent race conditions when multiple
moderators try to claim the same application simultaneously.
```

**Common types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic changes)
- `refactor`: Code refactoring (no behavior changes)
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, configs)

### Code Quality

Before submitting a PR, ensure all checks pass:

```bash
# Run linter
npm run lint

# Run Prettier formatter
npm run format

# Run TypeScript type checking
npm run check

# Run tests
npm test

# Run full build
npm run build
```

**Pre-commit Checklist:**

- [ ] All tests pass (`npm test`)
- [ ] No linting errors (`npm run lint`)
- [ ] Code is formatted (`npm run format`)
- [ ] TypeScript compiles without errors (`npm run check`)
- [ ] Build succeeds (`npm run build`)
- [ ] Manual testing completed in test guild
- [ ] No console errors or warnings
- [ ] Database migrations tested (if applicable)

---

## Pull Request Process

### 1. Create a Feature Branch

```bash
git checkout -b feat/your-feature-name
```

### 2. Make Your Changes

- Write clear, self-documenting code
- Add JSDoc comments for public functions
- Include inline comments for complex logic
- Follow existing code style and patterns
- Keep changes focused and atomic

### 3. Add Tests

All new features and bug fixes should include tests:

```typescript
// tests/features/myFeature.test.ts
import { describe, it, expect } from "vitest";
import { myFunction } from "../src/features/myFeature.js";

describe("myFunction", () => {
  it("should handle valid input", () => {
    const result = myFunction("test");
    expect(result).toBe("expected output");
  });

  it("should reject invalid input", () => {
    expect(() => myFunction(null)).toThrow();
  });
});
```

### 4. Update Documentation

- Update README.md if adding user-facing features
- Add/update JSDoc comments for exported functions
- Update relevant context docs in `context/` directory
- Add migration notes if schema changes are included

### 5. Commit Your Changes

```bash
git add .
git commit -m "feat(scope): descriptive commit message"
```

### 6. Push to Your Fork

```bash
git push origin feat/your-feature-name
```

### 7. Open a Pull Request

Open a PR against the `main` branch with:

**Title:** Use conventional commit format

```
feat(modmail): add attachment forwarding
```

**Description Template:**

```markdown
## Summary

Brief description of what this PR does.

## Changes

- Added X feature
- Fixed Y bug
- Refactored Z component

## Test Plan

- [ ] Tested in development environment
- [ ] Verified all existing tests pass
- [ ] Added new tests for new functionality
- [ ] Manually tested edge cases

## Breaking Changes

None / List any breaking changes

## Related Issues

Closes #123
```

### 8. Code Review

- Address reviewer feedback promptly
- Keep discussions focused and constructive
- Update your branch if main has moved forward:
  ```bash
  git fetch upstream
  git rebase upstream/main
  git push -f origin feat/your-feature-name
  ```

---

## Code Style Guidelines

### TypeScript

- Use strict typing (avoid `any` when possible)
- Prefer `const` over `let`
- Use async/await over raw Promises
- Use optional chaining (`?.`) and nullish coalescing (`??`)

**Good:**

```typescript
const user = await db.getUser(userId);
const displayName = user?.displayName ?? "Unknown User";
```

**Avoid:**

```typescript
let user: any;
user = await db.getUser(userId);
const displayName = user ? user.displayName : "Unknown User";
```

### File Organization

- One feature per file
- Group related functions together
- Export only what's needed
- Keep files under 500 lines when possible

### Naming Conventions

- **Functions:** camelCase (`getUserById`)
- **Classes:** PascalCase (`ApplicationManager`)
- **Constants:** SCREAMING_SNAKE_CASE (`MAX_RETRIES`)
- **Types/Interfaces:** PascalCase (`ApplicationRow`)
- **Files:** kebab-case (`avatar-scan.ts`)

### Comments

Use JSDoc for exported functions:

```typescript
/**
 * Fetches an application by its ID.
 *
 * @param appId - Application ID to fetch
 * @returns Application row or null if not found
 */
export function getApplicationById(appId: string): ApplicationRow | null {
  // Implementation
}
```

---

## Database Migrations

When adding database schema changes:

1. **Create a migration file:**

   ```bash
   touch migrations/009_your_migration_name.ts
   ```

2. **Write the migration:**

   ```typescript
   import type Database from "better-sqlite3";

   export function migrate009YourMigrationName(db: Database.Database): void {
     db.exec(`
       ALTER TABLE applications
       ADD COLUMN new_field TEXT DEFAULT NULL;
     `);

     console.log("✅ Added new_field to applications table");
   }
   ```

3. **Test locally:**

   ```bash
   npm run migrate:dry  # Preview changes
   npm run migrate      # Apply migration
   ```

4. **Update schema docs:**
   Update `context/07_Database_Schema_and_Migrations.md`

---

## Testing Guidelines

### Unit Tests

- Test individual functions in isolation
- Mock external dependencies (Discord.js, database)
- Cover happy path and edge cases

### Integration Tests

- Test feature workflows end-to-end
- Use in-memory database for consistency
- Clean up test data after each test

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test tests/features/gate.test.ts

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

---

## Project Structure

```
pawtropolis-tech/
├── src/
│   ├── commands/        # Slash command handlers
│   ├── features/        # Feature modules (gate, review, modmail)
│   ├── lib/             # Shared utilities
│   ├── logging/         # Logging and audit utilities
│   ├── web/             # Web server and API routes
│   ├── config.ts        # Configuration loader
│   └── index.ts         # Bot entry point
├── migrations/          # Database migrations
├── scripts/             # Utility scripts
├── tests/               # Test files (mirrors src/)
├── website/             # Static web assets
├── context/             # Architecture documentation
└── docs/                # Additional documentation
```

---

## Common Tasks

### Deploying Slash Commands

After adding/modifying slash commands:

```bash
npm run deploy:cmds
```

### Viewing Logs

```bash
# Pretty logs in development
npm run dev

# JSON logs in production
npm start | pino-pretty
```

### Database Inspection

```bash
sqlite3 data/data.db
```

```sql
-- View all tables
.tables

-- Inspect schema
.schema applications

-- Query data
SELECT * FROM applications LIMIT 10;
```

### Resetting Development Database

```bash
rm data/data.db
npm run migrate
```

---

## Getting Help

- **Documentation:** Check `context/` directory for architecture docs
- **Issues:** Browse [existing issues](https://github.com/watchthelight/pawtech-v2/issues)
- **Questions:** Open a GitHub Discussion or issue

---

## License

By contributing to Pawtropolis Tech Gatekeeper, you agree that your contributions will be licensed under the project's [ANW-1.0 License](LICENSE).

---

**Thank you for contributing!** 🚀
