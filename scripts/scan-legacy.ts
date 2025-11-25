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
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      return;
    }

    // Skip lines where __old appears in strings, regex, or messages
    // Check if __old appears within quotes or after common message patterns
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
        context: line.trim().slice(0, 80),
      });
    }
  });

  return results;
}

function scanDirectory(dir: string): ScanResult[] {
  const results: ScanResult[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath));
    } else if (entry.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry.name)) {
      results.push(...scanFile(fullPath));
    }
  }

  return results;
}

function main() {
  console.log("[build] legacy_scan: scanning src/ for __old* tokens...");

  const results = scanDirectory(SRC_DIR);

  if (results.length === 0) {
    console.log("[build] legacy_scan: src ok");
    process.exit(0);
  }

  console.error(`[build] legacy_scan: found ${results.length} legacy token(s):`);
  for (const result of results) {
    console.error(`  ${result.file}:${result.line} - ${result.token}`);
    console.error(`    ${result.context}`);
  }

  process.exit(1);
}

main();
