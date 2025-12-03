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

/*
 * GOTCHA: We show enough of the token to identify it (first 6 chars)
 * but not enough to be useful to anyone shoulder-surfing your terminal.
 * Discord tokens are base64-encoded snowflakes, so 6 chars is ~4-5 bits
 * of the user ID portion - sufficient to distinguish between tokens
 * but useless for authentication.
 */
function maskToken(t?: string) {
  if (!t) return "(missing)";
  return `${t.slice(0, 6)}...(${t.length})`;
}
async function main() {
  console.log("[auth:whoami] Checking Discord token authentication...");
  console.log("[auth:whoami] Token (masked):", maskToken(env.DISCORD_TOKEN));
  console.log("[auth:whoami] Expected CLIENT_ID:", env.CLIENT_ID);

  // WHY @me instead of /applications/{id}? Because if CLIENT_ID is wrong,
  // we'd just get a 404 and learn nothing. This way we discover WHICH
  // app the token actually belongs to. Saved me two hours of debugging once.
  const res = await globalThis.fetch("https://discord.com/api/v10/oauth2/applications/@me", {
    headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` },
  });
  // Exit code 2: Token is garbage. Most common cause: trailing newline in .env
  // or someone copy-pasted from Slack which helpfully "formatted" the token.
  if (res.status === 401) {
    console.error("\n[auth:whoami] 401 Unauthorized. The DISCORD_TOKEN is invalid for any app.");
    console.error("   - Check .env for typos/whitespace, or rotate the token in the dev portal.");
    console.error("   - Token (masked):", maskToken(env.DISCORD_TOKEN));
    console.error("   - Token length:", (env.DISCORD_TOKEN || "").length);
    process.exit(2);
  }
  // Exit code 3: Something weird. Rate limit? Discord down? Solar flare?
  // We truncate to 200 chars because Discord's error JSONs can be novels.
  if (!res.ok) {
    console.error(`\n[auth:whoami] HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error("   Response:", text.slice(0, 200));
    process.exit(3);
  }
  // Discord's API returns way more fields but we only care about id and name.
  // The rest is OAuth scope/redirect config we don't need for this check.
  const json = (await res.json()) as { id?: string; name?: string };
  const returnedId = json?.id;
  const appName = json?.name;
  // Exit code 4: Discord returned 200 OK but no id. I've never seen this happen
  // but I've learned to trust nothing that comes from an external API.
  if (!returnedId) {
    console.error("\n[auth:whoami] No application id returned in payload.");
    process.exit(4);
  }
  const expected = env.CLIENT_ID;
  console.log(`\n[auth:whoami] Token belongs to application: "${appName}" (id: ${returnedId})`);
  console.log(`[auth:whoami] Expected CLIENT_ID: ${expected}`);
  /*
   * Exit code 5: The token works, but it's for a different bot than CLIENT_ID.
   * This happens when you have multiple bots and copy-pasted the wrong token.
   * Ask me how I know. Actually, don't.
   */
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
// Exit code 10: The catch-all. Network down, DNS failed, Node exploded.
// If you're seeing this, the problem is probably not in this script.
main().catch((err) => {
  console.error("\n[auth:whoami] Unexpected error:", err);
  process.exit(10);
});
