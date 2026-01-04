/**
 * Generate badge metrics for Shields.io dynamic badges
 *
 * This script generates badge-data.json with metrics that can be
 * uploaded to a GitHub Gist for use with Shields.io endpoint badges.
 *
 * Run: node scripts/generate-badge-metrics.js
 * Output: badge-data.json (multiple JSON files for each badge)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

/**
 * Count total commands by parsing buildCommands.ts output
 */
function countCommands() {
  try {
    // Run the print:cmds script and count lines
    const output = execSync("npm run print:cmds 2>/dev/null || echo ''", {
      cwd: rootDir,
      encoding: "utf-8",
    });

    // Count command names (lines that start with /)
    const commands = output.split("\n").filter((line) => line.trim().startsWith("/"));
    return commands.length || 36; // Fallback to known count
  } catch {
    // Fallback: count .ts files in src/commands/ (rough estimate)
    try {
      const commandsDir = join(rootDir, "src/commands");
      const files = readdirSync(commandsDir).filter(
        (f) => f.endsWith(".ts") && !f.includes("index") && !f.includes("README")
      );
      return files.length;
    } catch {
      return 36; // Known count as fallback
    }
  }
}

/**
 * Count lines of code in src/ directory
 */
function countLinesOfCode() {
  let totalLines = 0;

  function countInDir(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          countInDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const lines = content.split("\n").filter((line) => {
              const trimmed = line.trim();
              // Count non-empty, non-comment lines
              return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*");
            });
            totalLines += lines.length;
          } catch {
            // Skip files that can't be read
          }
        }
      }
    } catch {
      // Skip directories that can't be read
    }
  }

  countInDir(join(rootDir, "src"));
  return totalLines;
}

/**
 * Count test files and parse coverage
 */
function getTestMetrics() {
  let testCount = 0;
  let coverage = 0;

  // Count test files
  function countTests(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          countTests(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
          testCount++;
        }
      }
    } catch {
      // Skip directories that can't be read
    }
  }

  countTests(join(rootDir, "tests"));

  // Parse coverage summary if available
  try {
    const coveragePath = join(rootDir, "coverage/coverage-summary.json");
    const coverageData = JSON.parse(readFileSync(coveragePath, "utf-8"));
    if (coverageData.total && coverageData.total.lines) {
      coverage = Math.round(coverageData.total.lines.pct);
    }
  } catch {
    // Coverage not available
    coverage = 0;
  }

  return { testCount, coverage };
}

/**
 * Get version from package.json
 */
function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Format number with K/M suffix
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "k";
  }
  return num.toString();
}

/**
 * Get color based on coverage percentage
 */
function getCoverageColor(pct) {
  if (pct >= 80) return "brightgreen";
  if (pct >= 60) return "green";
  if (pct >= 40) return "yellow";
  if (pct >= 20) return "orange";
  return "red";
}

// Generate metrics
console.log("Generating badge metrics...\n");

const commandCount = countCommands();
const loc = countLinesOfCode();
const { testCount, coverage } = getTestMetrics();
const version = getVersion();

console.log(`Commands: ${commandCount}`);
console.log(`Lines of Code: ${formatNumber(loc)}`);
console.log(`Test Files: ${testCount}`);
console.log(`Coverage: ${coverage}%`);
console.log(`Version: ${version}`);

// Generate individual badge JSON files for Shields.io endpoint format
const badges = {
  commands: {
    schemaVersion: 1,
    label: "commands",
    message: commandCount.toString(),
    color: "5865F2",
    namedLogo: "discord",
  },
  loc: {
    schemaVersion: 1,
    label: "lines of code",
    message: formatNumber(loc),
    color: "brightgreen",
  },
  tests: {
    schemaVersion: 1,
    label: "tests",
    message: `${testCount} files`,
    color: "success",
  },
  coverage: {
    schemaVersion: 1,
    label: "coverage",
    message: `${coverage}%`,
    color: getCoverageColor(coverage),
  },
  version: {
    schemaVersion: 1,
    label: "version",
    message: `v${version}`,
    color: "blue",
  },
};

// Write individual JSON files (Gist doesn't support nested JSON for endpoint badges)
for (const [name, data] of Object.entries(badges)) {
  writeFileSync(join(rootDir, `badge-${name}.json`), JSON.stringify(data, null, 2));
  console.log(`\nWrote badge-${name}.json`);
}

// Also write combined file for reference
writeFileSync(join(rootDir, "badge-data.json"), JSON.stringify(badges, null, 2));
console.log("\nWrote badge-data.json (combined)");

console.log("\nDone! Upload badge-*.json files to your GitHub Gist.");
