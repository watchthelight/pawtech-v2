/**
 * Pawtropolis Tech — scripts/auth-check.ts
 * WHAT: Quick CLI to verify DISCORD_TOKEN belongs to CLIENT_ID.
 * WHY: Saves time debugging mismatched tokens during setup.
 * FLOWS: load env → call /oauth2/applications/@me → compare id → exit codes
 * DOCS:
 *  - Discord OAuth2 apps: https://discord.com/developers/docs/topics/oauth2#oauth2
 *  - Node ESM: https://nodejs.org/api/esm.html
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper - Auth Diagnostic
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import { env } from "../src/lib/env.js";
function maskToken(t?: string) {
  if (!t) return "(missing)";
  return `${t.slice(0, 6)}...(${t.length})`;
}
async function main() {
  console.log("[auth:whoami] Checking Discord token authentication...");
  console.log("[auth:whoami] Token (masked):", maskToken(env.DISCORD_TOKEN));
  console.log("[auth:whoami] Expected CLIENT_ID:", env.CLIENT_ID);
  const res = await globalThis.fetch("https://discord.com/api/v10/oauth2/applications/@me", {
    headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` },
  });
  if (res.status === 401) {
    console.error("\n[auth:whoami] 401 Unauthorized. The DISCORD_TOKEN is invalid for any app.");
    console.error("   - Check .env for typos/whitespace, or rotate the token in the dev portal.");
    console.error("   - Token (masked):", maskToken(env.DISCORD_TOKEN));
    console.error("   - Token length:", (env.DISCORD_TOKEN || "").length);
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`\n[auth:whoami] HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error("   Response:", text.slice(0, 200));
    process.exit(3);
  }
  const json = (await res.json()) as { id?: string; name?: string };
  const returnedId = json?.id;
  const appName = json?.name;
  if (!returnedId) {
    console.error("\n[auth:whoami] No application id returned in payload.");
    process.exit(4);
  }
  const expected = env.CLIENT_ID;
  console.log(`\n[auth:whoami] Token belongs to application: "${appName}" (id: ${returnedId})`);
  console.log(`[auth:whoami] Expected CLIENT_ID: ${expected}`);
  if (returnedId !== expected) {
    console.error("\n[auth:whoami] Token belongs to a DIFFERENT application than CLIENT_ID.");
    console.error(`   - Token is for application ID: ${returnedId}`);
    console.error(`   - .env CLIENT_ID is set to: ${expected}`);
    console.error(
      "   - Update .env CLIENT_ID to",
      returnedId,
      "OR use the correct bot token for",
      expected
    );
    process.exit(5);
  }
  console.log("\n[auth:whoami] OK: Token matches CLIENT_ID.");
  console.log("   - Application:", appName);
  console.log("   - Token length:", (env.DISCORD_TOKEN || "").length);
  console.log("   - All authentication checks passed!");
}
main().catch((err) => {
  console.error("\n[auth:whoami] Unexpected error:", err);
  process.exit(10);
});
