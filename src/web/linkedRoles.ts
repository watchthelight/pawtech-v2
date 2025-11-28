/**
 * Pawtropolis Tech — src/web/linkedRoles.ts
 * WHAT: Minimal HTTP server for Discord Linked Roles OAuth2 flow.
 * WHY: Allows users to authorize the app and receive role connection metadata.
 * USAGE: npm run linked-roles:server
 *
 * FLOW:
 *   1. User visits /linked-roles → redirected to Discord OAuth2
 *   2. User authorizes → Discord redirects to /linked-roles/callback
 *   3. Server exchanges code for token, sets role connection metadata
 *   4. User now qualifies for the Linked Role in Discord
 *
 * DOCS:
 *   - OAuth2: https://discord.com/developers/docs/topics/oauth2
 *   - Role Connections: https://discord.com/developers/docs/resources/user#update-current-user-application-role-connection
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import http from "node:http";
import { URL, URLSearchParams } from "node:url";
import dotenv from "dotenv";
import path from "node:path";

// Load environment
dotenv.config({ path: path.join(process.cwd(), ".env") });

// Configuration
const PORT = parseInt(process.env.LINKED_ROLES_PORT ?? "3001", 10);
const CLIENT_ID = process.env.CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET?.trim();
const REDIRECT_URI = process.env.LINKED_ROLES_REDIRECT_URI?.trim() ?? `http://localhost:${PORT}/linked-roles/callback`;

// Validate required env vars
if (!CLIENT_ID) {
  console.error("Missing CLIENT_ID in .env");
  process.exit(1);
}
if (!CLIENT_SECRET) {
  console.error("Missing DISCORD_CLIENT_SECRET in .env");
  console.error("Get this from Discord Developer Portal → Your App → OAuth2 → Client Secret");
  process.exit(1);
}

// Discord API base
const DISCORD_API = "https://discord.com/api/v10";

/**
 * Generate Discord OAuth2 authorization URL
 */
function getAuthorizationUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify role_connections.write",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCode(code: string): Promise<{ access_token: string; token_type: string }> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * Get the current user's info (to display who authorized)
 */
async function getCurrentUser(accessToken: string): Promise<{ id: string; username: string; global_name?: string }> {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user: ${response.status}`);
  }

  return response.json();
}

/**
 * Set the user's role connection metadata
 * This is what makes them qualify for the Linked Role
 */
async function setRoleConnection(
  accessToken: string,
  username: string,
  metadata: Record<string, string | number | boolean>
): Promise<void> {
  const body = {
    platform_name: "Pawtropolis Tech",
    platform_username: username,
    metadata,
  };

  console.log("Sending role connection request:");
  console.log("  Body:", JSON.stringify(body));

  const response = await fetch(`${DISCORD_API}/users/@me/applications/${CLIENT_ID}/role-connection`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseData = await response.text();
  console.log("Role connection API response:", response.status);
  console.log("  Response:", responseData);

  if (!response.ok) {
    throw new Error(`Failed to set role connection: ${response.status} ${responseData}`);
  }
}

/**
 * Simple HTML response helper
 */
function sendHtml(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * Request handler
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

  // Health check
  if (pathname === "/" || pathname === "/health") {
    sendHtml(res, 200, `
      <html>
        <head><title>Linked Roles Server</title></head>
        <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
          <h1>Pawtropolis Tech - Linked Roles</h1>
          <p>Server is running on port ${PORT}</p>
          <p><a href="/linked-roles">Click here to authorize and get your Server Developer badge</a></p>
        </body>
      </html>
    `);
    return;
  }

  // OAuth2 flow - handles both start and callback on same route
  if (pathname === "/linked-roles" || pathname === "/linked-roles/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    // If no code/error, this is the start of the flow - redirect to Discord
    if (!code && !error) {
      const authUrl = getAuthorizationUrl();
      console.log(`Redirecting to Discord OAuth2...`);
      res.writeHead(302, { Location: authUrl });
      res.end();
      return;
    }

    // Handle OAuth2 error
    if (error) {
      console.error(`OAuth2 error: ${error}`);
      sendHtml(res, 400, `
        <html>
          <head><title>Authorization Failed</title></head>
          <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
            <h1>Authorization Failed</h1>
            <p>Error: ${error}</p>
            <p><a href="/linked-roles">Try again</a></p>
          </body>
        </html>
      `);
      return;
    }

    // Handle OAuth2 callback with code
    try {
      console.log("Exchanging code for token...");
      const tokens = await exchangeCode(code);

      console.log("Fetching user info...");
      const user = await getCurrentUser(tokens.access_token);
      console.log(`User: ${user.global_name ?? user.username} (${user.id})`);

      console.log("Setting role connection metadata...");
      await setRoleConnection(tokens.access_token, user.global_name ?? user.username, {
        is_developer: 1, // Boolean true = 1
      });

      console.log("Success! Role connection set.");

      sendHtml(res, 200, `
        <html>
          <head><title>Success!</title></head>
          <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #1e402f;">Success!</h1>
            <p>Welcome, <strong>${user.global_name ?? user.username}</strong>!</p>
            <p>Your role connection has been set. You are now verified as a <strong>Server Developer</strong>.</p>

            <h2>What happens now?</h2>
            <ol>
              <li>Go to your Discord server (Pawtropolis)</li>
              <li>Check your profile - you should see the <strong>Safety Third</strong> role</li>
              <li>The role will show "Connected as Server Developer on Pawtropolis Tech"</li>
            </ol>

            <h2>Don't see it?</h2>
            <p>Make sure the server admin has configured the Safety Third role as a Linked Role:</p>
            <ol>
              <li>Server Settings → Roles → Safety Third</li>
              <li>Click "Links" tab</li>
              <li>Add requirement: Pawtropolis Tech → Server Developer = true</li>
            </ol>

            <p style="margin-top: 2rem; color: #666;">You can close this window.</p>
          </body>
        </html>
      `);
    } catch (err) {
      console.error("Callback error:", err);
      sendHtml(res, 500, `
        <html>
          <head><title>Error</title></head>
          <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #c00;">Error</h1>
            <p>${err instanceof Error ? err.message : "Unknown error"}</p>
            <p><a href="/linked-roles">Try again</a></p>
          </body>
        </html>
      `);
    }
    return;
  }

  // 404
  sendHtml(res, 404, `
    <html>
      <head><title>Not Found</title></head>
      <body style="font-family: system-ui; padding: 2rem;">
        <h1>404 Not Found</h1>
        <p><a href="/">Go home</a></p>
      </body>
    </html>
  `);
}

// Create and start server
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("Unhandled error:", err);
    res.writeHead(500);
    res.end("Internal Server Error");
  });
});

server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  Linked Roles Server`);
  console.log(`========================================`);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`\nTo authorize yourself:`);
  console.log(`  1. Visit: http://localhost:${PORT}/linked-roles`);
  console.log(`  2. Authorize with Discord`);
  console.log(`  3. You'll be redirected back and your role connection will be set`);
  console.log(`\nRedirect URI configured: ${REDIRECT_URI}`);
  console.log(`Make sure this matches your Discord Developer Portal OAuth2 settings!`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
