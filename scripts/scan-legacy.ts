/**
 * Pawtropolis Tech — scripts/scan-legacy.ts
 * WHAT: Scans source code for legacy __old* tokens and fails build if found.
 * WHY: Prevent accidentally shipping legacy/debug code to production.
 * USAGE: npm run scan:legacy (run as part of CI/build pipeline)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import * as fs from "node:fs";
import * as path from "node:path";

const SRC_DIR = path.join(process.cwd(), "src");
// WHY: This pattern catches __oldFoo, __old_bar, __oldWhateverYouThoughtWasTemporary.
// Named this way because past-me thought "I'll just prefix it with __old, I'll definitely
// remove it later." Reader, I did not remove it later. Hence this scanner.
const LEGACY_TOKEN_PATTERN = /__old\w*/g;

interface ScanResult {
  file: string;
  line: number;
  token: string;
  context: string;
}

function scanFile(filePath: string): ScanResult[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const results: ScanResult[] = [];

  lines.forEach((line, index) => {
    // Skip comment lines (both // and /* */)
    // GOTCHA: This also skips JSDoc lines starting with *, which is intentional.
    // If you're documenting your __old function, you've already lost.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      return;
    }

    /*
     * Skip lines where __old appears in strings, regex, or messages.
     * This is ugly but necessary: we want to catch actual __old variable usage,
     * not error messages complaining about __old variables.
     * Yes, someone could game this by wrapping their legacy code in a string literal.
     * That person will be dealt with during code review.
     */
    if (
      /"[^"]*__old[^"]*"/.test(line) || // Double-quoted string
      /'[^']*__old[^']*'/.test(line) || // Single-quoted string
      /`[^`]*__old[^`]*`/.test(line) || // Template literal
      /\/__old/.test(line) || // Regex pattern
      /logger\.(warn|info|error|debug).*__old/.test(line) || // Logger message
      /return\s+"[^"]*__old/.test(line) // Return string
    ) {
      return;
    }

    const matches = line.matchAll(LEGACY_TOKEN_PATTERN);
    for (const match of matches) {
      results.push({
        file: path.relative(process.cwd(), filePath),
        line: index + 1,
        token: match[0],
        // 80 chars is plenty for context. If you need more, you're already lost.
        context: line.trim().slice(0, 80),
      });
    }
  });

  return results;
}

// Recursively walks the directory tree. No symlink handling because if you've
// symlinked legacy code into your project, that's a you problem.
function scanDirectory(dir: string): ScanResult[] {
  const results: ScanResult[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath));
    } else if (entry.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry.name)) {
      // No .d.ts exclusion - if you put legacy tokens in your type definitions,
      // I genuinely want to know about it
      results.push(...scanFile(fullPath));
    }
  }

  return results;
}

function main() {
  console.log("[build] legacy_scan: scanning src/ for __old* tokens...");

  const results = scanDirectory(SRC_DIR);

  if (results.length === 0) {
    // The rare happy path. Savor this moment.
    console.log("[build] legacy_scan: src ok");
    process.exit(0);
  }

  // Judgment time
  console.error(`[build] legacy_scan: found ${results.length} legacy token(s):`);
  for (const result of results) {
    console.error(`  ${result.file}:${result.line} - ${result.token}`);
    console.error(`    ${result.context}`);
  }

  // Exit 1 fails the build. You will fix this or you will not ship. Choose wisely.
  process.exit(1);
}

main();
