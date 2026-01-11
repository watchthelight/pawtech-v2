/**
 * Pawtropolis Tech — src/lib/buildInfo.ts
 * WHAT: Centralized build identity and deployment metadata.
 * WHY: Provides comprehensive context for debugging, logging, and error tracking.
 *      Correlates logs/errors to exact code version and deployment environment.
 *
 * BUILD IDENTITY PHILOSOPHY:
 * ─────────────────────────────────────────────────────────────────────────────
 * When something breaks in production, you need to answer these questions:
 *
 *   1. WHAT CODE WAS RUNNING?
 *      → Git SHA tells you the exact commit, so you can:
 *        - Find the code in version control
 *        - Check what changed since last deploy
 *        - Reproduce locally with `git checkout <sha>`
 *
 *   2. WHEN WAS IT BUILT?
 *      → Build timestamp tells you:
 *        - How old this deployment is
 *        - Whether a fix has been deployed yet
 *        - If you're looking at stale code
 *
 *   3. WHERE IS IT RUNNING?
 *      → Hostname + Node version tells you:
 *        - Which server/container is affected
 *        - Runtime environment differences
 *        - If it's a specific host issue
 *
 *   4. WHAT RELEASE IS THIS?
 *      → Sentry release + deploy ID lets you:
 *        - Group errors by deployment
 *        - Track error rates across releases
 *        - Correlate with deploy history
 *
 * This module provides ALL of that context in one place, accessible from
 * anywhere in the codebase via getBuildInfo().
 *
 * DATA FLOW:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   BUILD TIME (on developer machine or CI)
 *   ┌─────────────────────────────────────┐
 *   │  npm run build                      │
 *   │    ↓                                │
 *   │  scripts/inject-build-info.ts       │
 *   │    ↓                                │
 *   │  Writes to .env.build:              │
 *   │    BUILD_GIT_SHA=abc1234...         │
 *   │    BUILD_TIMESTAMP=2026-01-11T...   │
 *   │    BUILD_DEPLOY_ID=deploy-...       │
 *   └─────────────────────────────────────┘
 *
 *   DEPLOY TIME (on remote server)
 *   ┌─────────────────────────────────────┐
 *   │  deploy.sh                          │
 *   │    ↓                                │
 *   │  Copies .env.build to server        │
 *   │    ↓                                │
 *   │  PM2 restart loads new env          │
 *   └─────────────────────────────────────┘
 *
 *   RUNTIME (when bot starts)
 *   ┌─────────────────────────────────────┐
 *   │  getBuildInfo() called              │
 *   │    ↓                                │
 *   │  Reads from process.env:            │
 *   │    - BUILD_GIT_SHA                  │
 *   │    - BUILD_TIMESTAMP                │
 *   │    - BUILD_DEPLOY_ID                │
 *   │    ↓                                │
 *   │  Adds runtime info:                 │
 *   │    - process.version (Node)         │
 *   │    - os.hostname()                  │
 *   │    - NODE_ENV                       │
 *   │    ↓                                │
 *   │  Caches result (singleton)          │
 *   └─────────────────────────────────────┘
 *
 * CONSUMERS:
 * ─────────────────────────────────────────────────────────────────────────────
 *  - Wide Events: Every telemetry event includes build identity
 *  - Error Cards: Users see version + SHA in error embeds
 *  - Sentry: Release name includes SHA for precise error grouping
 *  - /health: Displays full build info for diagnostics
 *  - /developer trace: Shows build context for debugging
 *
 * ENVIRONMENT VARIABLES:
 * ─────────────────────────────────────────────────────────────────────────────
 *  BUILD_GIT_SHA      - Git commit hash (set at build time)
 *  BUILD_TIMESTAMP    - ISO 8601 build time (set at build time)
 *  BUILD_DEPLOY_ID    - Deployment identifier (set at deploy time)
 *  NODE_ENV           - Environment: production/development/test
 *
 * DOCS:
 *  - Sentry Releases: https://docs.sentry.io/product/releases/
 *  - Semantic Versioning: https://semver.org/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { hostname } from "os";
import { createRequire } from "module";

/**
 * BuildInfo contains all metadata about the current build and runtime environment.
 *
 * This interface is designed to answer the critical debugging questions:
 * - What exact code is running? (version, gitSha)
 * - When was it built/deployed? (buildTime, deployId)
 * - Where is it running? (hostname, nodeVersion, environment)
 *
 * All fields are either guaranteed to have values (version, nodeVersion, hostname,
 * environment) or explicitly nullable (gitSha, buildTime, deployId) to indicate
 * when build-time injection didn't happen (e.g., local development).
 */
export interface BuildInfo {
  /**
   * Package version from package.json.
   * Always available - read directly from package.json at runtime.
   *
   * @example "4.9.2"
   */
  version: string;

  /**
   * Git commit SHA (short 7-char format).
   * Null if not injected at build time (e.g., local dev without running build script).
   *
   * This is the most critical field for debugging - it tells you EXACTLY what
   * code is running. With this, you can:
   *   - `git show <sha>` to see the commit
   *   - `git log <sha>..HEAD` to see what's changed since
   *   - `git checkout <sha>` to reproduce locally
   *
   * @example "abc1234"
   */
  gitSha: string | null;

  /**
   * ISO 8601 timestamp when the build was created.
   * Null if not injected at build time.
   *
   * Useful for:
   *   - Knowing how old a deployment is
   *   - Verifying a fix has been deployed ("built after the fix commit")
   *   - Debugging time-sensitive issues
   *
   * @example "2026-01-11T15:30:00.000Z"
   */
  buildTime: string | null;

  /**
   * Deployment identifier combining date and git SHA.
   * Null if not injected at deploy time.
   *
   * Format: "deploy-YYYYMMDD-HHMMSS-<sha>"
   *
   * This creates a unique, sortable identifier for each deployment.
   * Useful for:
   *   - Correlating logs across a deployment
   *   - Tracking deployment history
   *   - Rollback identification
   *
   * @example "deploy-20260111-153000-abc1234"
   */
  deployId: string | null;

  /**
   * Sentry release identifier.
   * Format: "pawtropolis-tech@<version>+<sha>" or "pawtropolis-tech@<version>" if no SHA.
   *
   * This matches Sentry's release format, enabling:
   *   - Error grouping by release
   *   - Release health tracking
   *   - Commit association in Sentry UI
   *
   * @example "pawtropolis-tech@4.9.2+abc1234"
   */
  sentryRelease: string;

  /**
   * Node.js version (without 'v' prefix).
   * Always available from process.version at runtime.
   *
   * Important for debugging:
   *   - V8 engine differences between versions
   *   - API availability (e.g., fetch in Node 18+)
   *   - Performance characteristics
   *
   * @example "20.10.0"
   */
  nodeVersion: string;

  /**
   * Hostname of the machine running the bot.
   * Always available from os.hostname() at runtime.
   *
   * Useful for:
   *   - Identifying which server has issues
   *   - Multi-instance deployments
   *   - Container identification
   *
   * @example "prod-server-1" or "ip-172-31-0-42"
   */
  hostname: string;

  /**
   * Runtime environment.
   * One of: "production", "development", "test"
   *
   * Determines:
   *   - Logging verbosity
   *   - Error reporting behavior
   *   - Feature flags
   *
   * @example "production"
   */
  environment: "production" | "development" | "test";
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON CACHE
// ─────────────────────────────────────────────────────────────────────────────
//
// Build info is computed once at startup and cached. This is safe because:
// 1. Build-time values (SHA, timestamp) never change during runtime
// 2. Runtime values (hostname, node version) don't change either
// 3. Computing it repeatedly would waste CPU cycles
//
// The cache is populated on first call to getBuildInfo().

let _buildInfoCache: BuildInfo | null = null;

/**
 * Reads the package version from package.json.
 *
 * We use createRequire() because we're in ESM and can't use require() directly.
 * This reads the actual package.json file, not a bundled version, so it's
 * always accurate even after npm version bumps.
 *
 * GOTCHA: This assumes package.json is in the expected location relative to
 * the compiled output. If you change the build output structure, this might break.
 */
function getPackageVersion(): string {
  try {
    // createRequire gives us a require function that works in ESM
    const require = createRequire(import.meta.url);
    // Navigate up from dist/lib/ to project root where package.json lives
    const pkg = require("../../package.json");
    return pkg.version || "0.0.0";
  } catch {
    // If package.json can't be read (shouldn't happen in normal operation),
    // return a fallback that makes it obvious something is wrong
    return "0.0.0-unknown";
  }
}

/**
 * Determines the runtime environment with proper type narrowing.
 *
 * Defaults to "development" if NODE_ENV is not set or not recognized.
 * This is safer than defaulting to "production" - we don't want to
 * accidentally report dev errors to Sentry in production mode.
 */
function getEnvironment(): "production" | "development" | "test" {
  const env = process.env.NODE_ENV?.toLowerCase();
  if (env === "production") return "production";
  if (env === "test") return "test";
  return "development";
}

/**
 * Builds the Sentry release identifier.
 *
 * Format follows Sentry's convention: "project@version+sha"
 * The +sha suffix is optional but highly recommended - it allows Sentry to
 * associate commits with releases and show which commits introduced errors.
 *
 * @see https://docs.sentry.io/product/releases/
 */
function buildSentryRelease(version: string, gitSha: string | null): string {
  const base = `pawtropolis-tech@${version}`;
  // Only append SHA if we have it - local dev might not
  return gitSha ? `${base}+${gitSha}` : base;
}

/**
 * Get comprehensive build and runtime identity information.
 *
 * This is the main entry point for build identity. Call this from anywhere
 * you need build context - it's cached so repeated calls are essentially free.
 *
 * @returns BuildInfo object with all available metadata
 *
 * @example
 * ```typescript
 * import { getBuildInfo } from "../lib/buildInfo.js";
 *
 * const info = getBuildInfo();
 * console.log(`Running ${info.version} (${info.gitSha ?? 'dev'})`);
 * // Output: "Running 4.9.2 (abc1234)"
 *
 * // In error handling:
 * logger.error({
 *   ...getBuildInfo(),
 *   error: err.message,
 * }, "Something went wrong");
 *
 * // In embeds:
 * embed.setFooter({
 *   text: `v${info.version}${info.gitSha ? `+${info.gitSha}` : ''}`
 * });
 * ```
 */
export function getBuildInfo(): BuildInfo {
  // Return cached value if available (singleton pattern)
  if (_buildInfoCache !== null) {
    return _buildInfoCache;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GATHER BUILD-TIME VALUES
  // These are injected by scripts/inject-build-info.ts at build time.
  // They may be null in local development or if the build script wasn't run.
  // ───────────────────────────────────────────────────────────────────────────

  // Git SHA: The commit hash identifying the exact code version.
  // Short format (7 chars) is sufficient for uniqueness in most repos.
  const gitSha = process.env.BUILD_GIT_SHA?.slice(0, 7) || null;

  // Build timestamp: When this build was created.
  // ISO 8601 format for consistency and easy parsing.
  const buildTime = process.env.BUILD_TIMESTAMP || null;

  // Deploy ID: Unique identifier for this deployment.
  // Combines date and SHA for sortability and uniqueness.
  const deployId = process.env.BUILD_DEPLOY_ID || null;

  // ───────────────────────────────────────────────────────────────────────────
  // GATHER RUNTIME VALUES
  // These are always available from the Node.js process.
  // ───────────────────────────────────────────────────────────────────────────

  // Package version: Read from package.json
  const version = getPackageVersion();

  // Node version: Strip the leading 'v' from process.version
  const nodeVersion = process.version.replace(/^v/, "");

  // Hostname: The machine's hostname (useful for multi-server deployments)
  const hostName = hostname();

  // Environment: production/development/test
  const environment = getEnvironment();

  // ───────────────────────────────────────────────────────────────────────────
  // BUILD COMPOSITE VALUES
  // ───────────────────────────────────────────────────────────────────────────

  // Sentry release: Follows Sentry's naming convention
  const sentryRelease = buildSentryRelease(version, gitSha);

  // ───────────────────────────────────────────────────────────────────────────
  // CACHE AND RETURN
  // ───────────────────────────────────────────────────────────────────────────

  _buildInfoCache = {
    version,
    gitSha,
    buildTime,
    deployId,
    sentryRelease,
    nodeVersion,
    hostname: hostName,
    environment,
  };

  return _buildInfoCache;
}

/**
 * Get a short human-readable build identifier.
 *
 * Useful for footers, status messages, and other places where you want
 * a compact representation of the build.
 *
 * @returns String like "v4.9.2 (abc1234)" or "v4.9.2 (dev)" if no SHA
 *
 * @example
 * ```typescript
 * embed.setFooter({ text: getShortBuildId() });
 * // Footer: "v4.9.2 (abc1234)"
 * ```
 */
export function getShortBuildId(): string {
  const info = getBuildInfo();
  const shaOrDev = info.gitSha ?? "dev";
  return `v${info.version} (${shaOrDev})`;
}

/**
 * Get relative time since build (e.g., "2h ago", "3d ago").
 *
 * Useful for showing how old a deployment is. Returns null if build time
 * is not available.
 *
 * @returns Human-readable relative time or null
 *
 * @example
 * ```typescript
 * const age = getBuildAge();
 * if (age) {
 *   console.log(`Built ${age}`); // "Built 2h ago"
 * }
 * ```
 */
export function getBuildAge(): string | null {
  const info = getBuildInfo();
  if (!info.buildTime) return null;

  const buildDate = new Date(info.buildTime);
  const now = new Date();
  const diffMs = now.getTime() - buildDate.getTime();

  // Convert to appropriate unit
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHour > 0) return `${diffHour}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return `${diffSec}s ago`;
}

/**
 * Reset the build info cache.
 *
 * This is primarily for testing - you shouldn't need to call this in
 * production code. It allows tests to verify behavior with different
 * environment variables.
 *
 * @internal
 */
export function _resetBuildInfoCache(): void {
  _buildInfoCache = null;
}
