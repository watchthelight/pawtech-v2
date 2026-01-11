#!/usr/bin/env npx tsx
/**
 * Pawtropolis Tech — scripts/inject-build-info.ts
 * WHAT: Generates build-time metadata and outputs environment variable exports.
 * WHY: Git SHA and build timestamp must be captured at build time, not runtime.
 *      At runtime, we might be in a container with no .git directory, or the
 *      working directory might have changed since the build.
 *
 * HOW IT WORKS:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. Script runs during build/deploy process
 *   2. Captures current git SHA and timestamp
 *   3. Outputs shell export statements OR writes to .env.build file
 *   4. These values are then available via process.env at runtime
 *
 * USAGE:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   # Option 1: Write to .env.build file (default)
 *   npx tsx scripts/inject-build-info.ts
 *   # Creates/overwrites .env.build with:
 *   #   BUILD_GIT_SHA=abc1234def5678901234567890123456789012
 *   #   BUILD_TIMESTAMP=2026-01-11T15:30:00.000Z
 *   #   BUILD_DEPLOY_ID=deploy-20260111-153000-abc1234
 *
 *   # Option 2: Output to stdout (for shell eval)
 *   npx tsx scripts/inject-build-info.ts --stdout
 *   # Outputs export statements that can be eval'd
 *
 *   # Option 3: Show current values (for debugging)
 *   npx tsx scripts/inject-build-info.ts --show
 *
 * INTEGRATION WITH deploy.sh:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   # In deploy.sh, before building:
 *   npx tsx scripts/inject-build-info.ts
 *
 *   # The .env.build file is then:
 *   #   1. Copied to the server alongside other files
 *   #   2. Sourced by PM2 ecosystem config or the start script
 *   #   3. Variables become available in process.env
 *
 * ENVIRONMENT VARIABLES GENERATED:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   BUILD_GIT_SHA      Full 40-character git commit hash
 *                      Example: "abc1234def5678901234567890123456789012"
 *
 *   BUILD_TIMESTAMP    ISO 8601 timestamp when this script ran
 *                      Example: "2026-01-11T15:30:00.000Z"
 *
 *   BUILD_DEPLOY_ID    Unique deployment identifier (sortable)
 *                      Format: "deploy-YYYYMMDD-HHMMSS-<short-sha>"
 *                      Example: "deploy-20260111-153000-abc1234"
 *
 * FALLBACK BEHAVIOR:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   If git is not available or we're not in a git repo:
 *   - BUILD_GIT_SHA will be "unknown"
 *   - The script will still generate timestamp and deploy ID
 *   - This allows building in environments without git (e.g., some CI systems)
 *
 * DOCS:
 *  - Git rev-parse: https://git-scm.com/docs/git-rev-parse
 *  - ISO 8601: https://en.wikipedia.org/wiki/ISO_8601
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { execSync } from "child_process";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const ENV_BUILD_FILE = resolve(PROJECT_ROOT, ".env.build");

// ─────────────────────────────────────────────────────────────────────────────
// GIT UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current git commit SHA.
 *
 * Returns the full 40-character hash for maximum precision.
 * The buildInfo.ts module will truncate to 7 chars for display.
 *
 * @returns Full SHA or "unknown" if git is unavailable
 */
function getGitSha(): string {
  try {
    // --short=40 ensures we get the full hash (default is already full, but explicit is better)
    // trim() removes the trailing newline
    const sha = execSync("git rev-parse HEAD", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      // Suppress stderr to avoid noise if git isn't available
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Validate it looks like a SHA (40 hex characters)
    if (/^[a-f0-9]{40}$/i.test(sha)) {
      return sha;
    }

    console.warn("[inject-build-info] Git SHA doesn't look valid:", sha);
    return "unknown";
  } catch (err) {
    // This is expected in some environments (no git, not a repo, etc.)
    console.warn("[inject-build-info] Could not get git SHA:", (err as Error).message);
    return "unknown";
  }
}

/**
 * Get the short git SHA (7 characters).
 *
 * Used for the deploy ID where we want something human-readable.
 */
function getShortSha(fullSha: string): string {
  if (fullSha === "unknown") return "unknown";
  return fullSha.slice(0, 7);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMESTAMP UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current timestamp in ISO 8601 format.
 *
 * This is the "build time" - when the build script ran.
 * In practice, this is close enough to when the code was compiled.
 */
function getBuildTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Generate a sortable deploy ID.
 *
 * Format: "deploy-YYYYMMDD-HHMMSS-<short-sha>"
 *
 * This format is:
 *   - Human readable
 *   - Sortable (lexicographically = chronologically)
 *   - Unique (timestamp + SHA combo)
 *
 * @example "deploy-20260111-153000-abc1234"
 */
function generateDeployId(timestamp: string, shortSha: string): string {
  // Parse the ISO timestamp to extract date/time components
  const date = new Date(timestamp);

  // Format date as YYYYMMDD
  const dateStr = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");

  // Format time as HHMMSS
  const timeStr = [
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ].join("");

  return `deploy-${dateStr}-${timeStr}-${shortSha}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

interface BuildMetadata {
  gitSha: string;
  timestamp: string;
  deployId: string;
}

/**
 * Collect all build metadata.
 */
function collectBuildMetadata(): BuildMetadata {
  const gitSha = getGitSha();
  const shortSha = getShortSha(gitSha);
  const timestamp = getBuildTimestamp();
  const deployId = generateDeployId(timestamp, shortSha);

  return { gitSha, timestamp, deployId };
}

/**
 * Format metadata as environment variable assignments.
 *
 * Output format is compatible with both:
 *   - Shell sourcing: `source .env.build`
 *   - dotenv parsing: Loaded by dotenv or similar
 */
function formatAsEnvFile(meta: BuildMetadata): string {
  const lines = [
    "# Auto-generated by scripts/inject-build-info.ts",
    "# DO NOT EDIT - This file is overwritten on each build",
    `# Generated at: ${meta.timestamp}`,
    "",
    `BUILD_GIT_SHA=${meta.gitSha}`,
    `BUILD_TIMESTAMP=${meta.timestamp}`,
    `BUILD_DEPLOY_ID=${meta.deployId}`,
    "",
  ];

  return lines.join("\n");
}

/**
 * Format metadata as shell export statements.
 *
 * For use with: eval "$(npx tsx scripts/inject-build-info.ts --stdout)"
 */
function formatAsExports(meta: BuildMetadata): string {
  return [
    `export BUILD_GIT_SHA="${meta.gitSha}"`,
    `export BUILD_TIMESTAMP="${meta.timestamp}"`,
    `export BUILD_DEPLOY_ID="${meta.deployId}"`,
  ].join("\n");
}

/**
 * Format metadata for human display.
 */
function formatForDisplay(meta: BuildMetadata): string {
  return [
    "",
    "┌─────────────────────────────────────────────────────────────┐",
    "│                      BUILD METADATA                         │",
    "├─────────────────────────────────────────────────────────────┤",
    `│  Git SHA:     ${meta.gitSha.padEnd(44)} │`,
    `│  Short SHA:   ${getShortSha(meta.gitSha).padEnd(44)} │`,
    `│  Timestamp:   ${meta.timestamp.padEnd(44)} │`,
    `│  Deploy ID:   ${meta.deployId.padEnd(44)} │`,
    "└─────────────────────────────────────────────────────────────┘",
    "",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  // Parse command line arguments
  const showOnly = args.includes("--show");
  const toStdout = args.includes("--stdout");
  const help = args.includes("--help") || args.includes("-h");

  if (help) {
    console.log(`
Usage: npx tsx scripts/inject-build-info.ts [options]

Options:
  --stdout    Output export statements to stdout (for shell eval)
  --show      Display current build metadata without writing
  --help, -h  Show this help message

Default behavior (no options):
  Writes build metadata to .env.build file

Examples:
  # Write to .env.build (default)
  npx tsx scripts/inject-build-info.ts

  # Use with shell eval
  eval "$(npx tsx scripts/inject-build-info.ts --stdout)"

  # Check current values
  npx tsx scripts/inject-build-info.ts --show
`);
    process.exit(0);
  }

  // Collect metadata
  const meta = collectBuildMetadata();

  if (showOnly) {
    // Just display, don't write anything
    console.log(formatForDisplay(meta));
    process.exit(0);
  }

  if (toStdout) {
    // Output export statements for shell eval
    console.log(formatAsExports(meta));
    process.exit(0);
  }

  // Default: write to .env.build file
  const envContent = formatAsEnvFile(meta);

  // Check if file exists and has different content
  if (existsSync(ENV_BUILD_FILE)) {
    const existing = readFileSync(ENV_BUILD_FILE, "utf-8");
    // Extract just the values (ignore comments) for comparison
    const extractValues = (content: string) =>
      content
        .split("\n")
        .filter((line) => line.startsWith("BUILD_"))
        .sort()
        .join("\n");

    if (extractValues(existing) === extractValues(envContent)) {
      console.log("[inject-build-info] .env.build is up to date (same SHA)");
      process.exit(0);
    }
  }

  // Write the file
  writeFileSync(ENV_BUILD_FILE, envContent, "utf-8");
  console.log("[inject-build-info] Wrote .env.build:");
  console.log(formatForDisplay(meta));
}

// Run the script
main();
