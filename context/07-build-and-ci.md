## Build and CI

Build process, compilation, bundling, and deployment automation.

---

## Build System

**Build tool:** tsup (esbuild-based TypeScript bundler)

**Config:** [tsup.config.ts](../tsup.config.ts)

**Build command:** `npm run build`

---

## Build Configuration

### Main Bot Bundle

```typescript
// tsup.config.ts
{
  entry: ["src/index.ts"],
  splitting: false,           // Single bundle (no code splitting)
  sourcemap: true,            // Generate .map files for debugging
  clean: true,                // Remove dist/ before build
  format: ["esm"],            // ES modules (import/export)
  target: "node20",           // Node.js 20 features
  outDir: "dist",             // Output directory
  minify: false,              // Readable stack traces
}
```

**Output:** `dist/index.js` + `dist/index.js.map`

---

### Scripts Bundle

```typescript
// tsup.config.ts
{
  entry: ["scripts/commands.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist/scripts",
  minify: false,
}
```

**Output:** `dist/scripts/commands.js`

**Usage:** Command sync script for deployments

---

## Build Process

### Development Build

```bash
npm run dev
```

**Steps:**
1. tsx watch mode (no compilation, runs TypeScript directly)
2. Hot reload on file changes
3. Source maps inline
4. No bundling overhead

**Speed:** Instant startup (~500ms)

---

### Production Build

```bash
npm run build
```

**Steps:**
1. Clean `dist/` directory
2. Compile TypeScript → JavaScript (ES2022)
3. Bundle dependencies (node_modules excluded)
4. Generate source maps
5. Run legacy SQL scanner (`npm run scan:legacy`)

**Output files:**
```
dist/
├── index.js           # Main bot bundle (~500KB)
├── index.js.map       # Source map
└── scripts/
    └── commands.js    # Command sync script
```

**Speed:** ~2-3 seconds on modern hardware

---

### Build Artifacts

**Included in build:**
- Compiled JavaScript (ES modules)
- Source maps for debugging
- Type declarations (if enabled)

**Excluded from build:**
- `node_modules/` (installed separately on server)
- TypeScript source files
- Test files
- Configuration files (except `package.json`)

---

## TypeScript Compilation

**Compiler:** tsc (type checking only, no emit)

**Config:** [tsconfig.json](../tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2022",             // Modern JS features
    "module": "NodeNext",           // ESM with .js extensions
    "moduleResolution": "NodeNext",
    "strict": true,                 // Strict type checking
    "skipLibCheck": true,           // Skip .d.ts checks (faster)
    "esModuleInterop": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "scripts"]
}
```

**Type checking only:**
```bash
npm run check
```

**Notes:**
- **No emit:** tsup handles compilation
- **Strict mode:** All strict checks enabled
- **TODO comments:** Stricter checks planned (L12-14)

---

## Quality Checks

### Linting

**Tool:** ESLint 9 with TypeScript parser

**Config:** [eslint.config.js](../eslint.config.js)

**Run:**
```bash
npm run lint
```

**Rules:**
- All errors demoted to warnings (non-blocking)
- Prettier compatibility
- TypeScript-specific rules

**Fix auto-fixable issues:**
```bash
npm run lint -- --fix
```

---

### Formatting

**Tool:** Prettier 3.x

**Config:** Inferred from `.editorconfig` and defaults

**Run:**
```bash
npm run format
```

**Settings:**
- 2-space indentation
- Single quotes (JS/TS)
- Semicolons always
- Trailing commas (ES5)
- Line width: 100 characters

---

### Type Checking

```bash
npm run check
```

**Checks:**
- Type errors
- Unused imports (if enabled)
- Missing return types (if enabled)

**Speed:** ~3-5 seconds

---

## CI/CD Pipeline

**Status:** No automated CI/CD (manual deployment)

**Planned:** GitHub Actions workflows for:
- PR linting + tests
- Automated releases
- Dependency updates

---

## Manual Deployment Flow

### 1. Pre-deploy Checks

```bash
# Run all quality checks
npm run lint
npm run check
npm test
npm run build

# Verify build output
ls -la dist/
node dist/index.js --version  # (if --version flag exists)
```

---

### 2. Build Artifact

```bash
npm run build
```

**Creates:**
- `dist/index.js` - Main bot
- `dist/scripts/commands.js` - Command sync

---

### 3. Package for Deployment

**PowerShell script:** [deploy.ps1](../deploy.ps1)

```powershell
# Build locally
npm run build

# Create tarball
tar -czf deploy.tar.gz dist/ package.json package-lock.json

# SCP to server
scp deploy.tar.gz user@server:/path/to/bot/

# SSH to extract
ssh user@server "cd /path/to/bot && tar -xzf deploy.tar.gz"

# Restart PM2
ssh user@server "pm2 restart pawtropolis-tech"
```

**Includes:**
- `dist/` directory
- `package.json` (for npm install)
- `package-lock.json` (lock versions)

**Excludes:**
- `.env` (already on server)
- `src/` (source not needed)
- `node_modules/` (reinstall on server)

---

### 4. Server-Side Steps

```bash
# On remote server
cd /path/to/pawtropolis-tech

# Extract deployment
tar -xzf deploy.tar.gz

# Install dependencies (production only)
npm ci --omit=dev

# Restart bot
pm2 restart pawtropolis-tech

# Verify startup
pm2 logs pawtropolis-tech --lines 50
```

---

## Deployment Scripts

### Windows Deployment (PowerShell)

**File:** [deploy.ps1](../deploy.ps1)

**Usage:**
```powershell
.\deploy.ps1
```

**Steps:**
1. Build locally: `npm run build`
2. Create tarball: `tar -czf deploy.tar.gz ...`
3. SCP to server
4. SSH + extract + restart PM2

**Requirements:**
- SSH access to server
- PM2 installed on server
- `.env` file already on server

---

### Local Start Scripts

**Development (watch mode):**
```bash
npm run dev
```

**Production (manual):**
```bash
npm run build
npm start
```

**Production (PM2):**
```powershell
# Windows
.\start.ps1

# Manual PM2
pm2 start dist/index.js --name pawtropolis-tech
pm2 save
```

---

## Versioning Strategy

**Version:** Stored in [package.json](../package.json) L3

**Format:** Semantic versioning (`MAJOR.MINOR.PATCH`)

**Current:** `1.1.0`

**Release process:**
1. Update version in `package.json`
2. Git tag: `git tag v1.1.0`
3. Push: `git push origin v1.1.0`
4. Deploy to production

**Changelog:** Not automated (manual updates)

---

## Build Troubleshooting

### Build Fails with Type Errors

**Problem:** `npm run build` exits with TypeScript errors

**Solution:**
```bash
# Check type errors
npm run check

# Fix errors, then rebuild
npm run build
```

---

### Module Not Found at Runtime

**Problem:** `Error [ERR_MODULE_NOT_FOUND]: Cannot find module './config.js'`

**Solution:**
- Ensure imports use `.js` extension (required for ESM)
- Check `tsconfig.json` has `"module": "NodeNext"`
- Rebuild: `npm run build`

---

### Source Maps Not Working

**Problem:** Stack traces show minified code

**Solution:**
- Verify `sourcemap: true` in [tsup.config.ts](../tsup.config.ts)
- Check `dist/index.js.map` exists
- Ensure Node.js 20+ (native source map support)

---

### Build Too Slow

**Problem:** `npm run build` takes >10 seconds

**Solution:**
```bash
# Skip legacy SQL scan for faster builds
npx tsup

# Or modify package.json:
# "build": "tsup"  (remove && npm run scan:legacy)
```

---

### PM2 Process Not Restarting

**Problem:** `pm2 restart pawtropolis-tech` fails

**Solution:**
```bash
# Check PM2 status
pm2 status

# Delete and recreate process
pm2 delete pawtropolis-tech
pm2 start dist/index.js --name pawtropolis-tech
pm2 save
```

---

## Build Performance

**Metrics (typical hardware):**

| Task | Time | Notes |
|------|------|-------|
| `npm run dev` (startup) | ~500ms | No compilation |
| `npm run build` | ~2-3s | Full bundle + source maps |
| `npm run check` | ~3-5s | Type checking only |
| `npm run lint` | ~2-4s | All files |
| `npm test` | ~5-15s | 180+ tests |

**Optimization tips:**
- Use `npm run dev` for development (fastest)
- Skip `scan:legacy` during rapid iteration
- Run `npm run check` before `build` to catch errors early

---

## Dependency Management

### Production Dependencies

**Install:**
```bash
npm ci --omit=dev
```

**Size:** ~150MB (includes native bindings for `onnxruntime-node`, `sharp`, `better-sqlite3`)

**Key dependencies:**
- `discord.js` v14.16.3 - Discord API client
- `better-sqlite3` v12.4.1 - SQLite driver
- `fastify` v5.6.1 - Web server
- `onnxruntime-node` v1.20.1 - ML inference
- `sharp` v0.34.4 - Image processing

See [09-dependencies-and-integrations.md](09-dependencies-and-integrations.md) for full list.

---

### Development Dependencies

**Install:**
```bash
npm install
```

**Includes:**
- TypeScript compiler
- tsup bundler
- Vitest test runner
- ESLint + Prettier

**Not needed on production server.**

---

## Continuous Improvement

### Planned CI/CD

**GitHub Actions workflow (draft):**

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm run check
      - run: npm test
      - run: npm run build
```

**Benefits:**
- Catch errors before merge
- Automated release builds
- Dependency security scanning

---

## Next Steps

- Set up PM2: [02-setup-and-running.md](02-setup-and-running.md)
- Review test suite: [08-testing-and-quality.md](08-testing-and-quality.md)
- Understand dependencies: [09-dependencies-and-integrations.md](09-dependencies-and-integrations.md)
