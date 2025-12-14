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
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";
import { logger } from "../lib/logger.js";

// Load environment
dotenv.config({ path: path.join(process.cwd(), ".env") });

// Configuration
const PORT = parseInt(process.env.LINKED_ROLES_PORT ?? "3001", 10);
const CLIENT_ID = process.env.CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET?.trim();
const REDIRECT_URI = process.env.LINKED_ROLES_REDIRECT_URI?.trim() ?? `http://localhost:${PORT}/linked-roles/callback`;

// Validate required env vars
if (!CLIENT_ID) {
  logger.error({ requiredVar: "CLIENT_ID" }, "[linkedRoles] Missing required environment variable");
  process.exit(1);
}
if (!CLIENT_SECRET) {
  logger.error(
    { requiredVar: "DISCORD_CLIENT_SECRET", hint: "Get this from Discord Developer Portal -> Your App -> OAuth2 -> Client Secret" },
    "[linkedRoles] Missing required environment variable"
  );
  process.exit(1);
}

// Discord API base
const DISCORD_API = "https://discord.com/api/v10";

// CSRF state store for OAuth2 flow
// Bounded to prevent memory exhaustion - 1000 concurrent OAuth flows is plenty
// GOTCHA: This is in-memory, so a server restart invalidates all pending OAuth flows.
// Users mid-authorization will get "invalid state" errors. Not a huge deal since
// they can just try again, but worth knowing if you're debugging angry user reports.
const STATE_STORE_MAX_SIZE = 1000;
const stateStore = new Map<string, { created: number }>();

// ===== Rate Limiting =====

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/*
 * Rate limit constants - duplicated here instead of importing from ../lib/constants.ts
 * because this server is meant to be runnable standalone. Fewer imports = fewer things
 * that can break when you're just trying to debug OAuth at 2am.
 *
 * These numbers are conservative. 10 requests/minute is more than enough for normal
 * users, and 5 OAuth attempts per 5 minutes stops brute-force attempts without being
 * annoying to legitimate users who fat-finger something.
 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;
const OAUTH_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const OAUTH_RATE_LIMIT_MAX_REQUESTS = 5;
const STATE_TOKEN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// General rate limit for all endpoints
const RATE_LIMIT = {
  windowMs: RATE_LIMIT_WINDOW_MS,
  maxRequests: RATE_LIMIT_MAX_REQUESTS,
};

// Stricter rate limit for OAuth endpoints
const OAUTH_RATE_LIMIT = {
  windowMs: OAUTH_RATE_LIMIT_WINDOW_MS,
  maxRequests: OAUTH_RATE_LIMIT_MAX_REQUESTS,
};

// Separate stores for general and OAuth rate limits
// Bounded to prevent memory exhaustion from unique IPs
const RATE_LIMIT_MAX_SIZE = 10000;
const rateLimits = new Map<string, RateLimitEntry>();
const oauthRateLimits = new Map<string, RateLimitEntry>();

/**
 * Check if a request from the given IP is within rate limits.
 * Returns true if allowed, false if rate limited.
 */
function checkRateLimit(
  ip: string,
  store: Map<string, RateLimitEntry>,
  config: { windowMs: number; maxRequests: number }
): boolean {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    // Enforce size limit before adding new entry
    if (!store.has(ip)) {
      evictOldestEntries(store, RATE_LIMIT_MAX_SIZE - 1);
    }
    store.set(ip, { count: 1, resetAt: now + config.windowMs });
    return true;
  }

  if (entry.count >= config.maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Send a 429 Too Many Requests response
 */
function sendRateLimitResponse(res: http.ServerResponse, retryAfterSeconds: number): void {
  res.writeHead(429, {
    "Content-Type": "text/plain",
    "Retry-After": String(retryAfterSeconds),
  });
  res.end("Too Many Requests. Please try again later.");
}

/**
 * Evict oldest entries from a Map when it exceeds maxSize
 *
 * WHY we do a full sort instead of tracking insertion order separately:
 * Maps iterate in insertion order, but rate limit entries get updated in-place
 * (count++), so we can't rely on insertion order = age order. The sort overhead
 * is negligible since this only runs when we hit capacity (10k entries), and
 * even then we're sorting timestamps, not doing I/O.
 */
function evictOldestEntries<K, V extends { created?: number; resetAt?: number }>(
  map: Map<K, V>,
  maxSize: number
): void {
  if (map.size <= maxSize) return;

  // Sort by age (oldest first) and remove excess
  const entries = [...map.entries()].sort((a, b) => {
    const timeA = a[1].created ?? a[1].resetAt ?? 0;
    const timeB = b[1].created ?? b[1].resetAt ?? 0;
    return timeA - timeB;
  });

  const toRemove = map.size - maxSize;
  for (let i = 0; i < toRemove; i++) {
    map.delete(entries[i][0]);
  }
}

/**
 * Generate a cryptographically secure state token for CSRF protection
 */
function generateState(): string {
  const state = randomBytes(32).toString("hex");

  // Enforce size limit before adding new entry
  evictOldestEntries(stateStore, STATE_STORE_MAX_SIZE - 1);

  stateStore.set(state, { created: Date.now() });
  return state;
}

/**
 * Validate and consume a state token (single-use, expires after 10 minutes)
 */
function validateState(state: string): boolean {
  const entry = stateStore.get(state);
  if (!entry) return false;

  // Expire after configured duration
  if (Date.now() - entry.created > STATE_TOKEN_EXPIRY_MS) {
    stateStore.delete(state);
    return false;
  }

  stateStore.delete(state); // One-time use
  return true;
}

/**
 * Escape HTML special characters to prevent XSS attacks
 *
 * Yes, there are libraries for this. No, we don't need one for five replace() calls.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate Discord OAuth2 authorization URL with CSRF state parameter
 */
function getAuthorizationUrl(): string {
  const state = generateState();
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify role_connections.write",
    state,
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

  return response.json() as Promise<{ access_token: string; token_type: string }>;
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

  return response.json() as Promise<{ id: string; username: string; global_name?: string }>;
}

/**
 * Set the user's role connection metadata
 * This is what makes them qualify for the Linked Role
 *
 * GOTCHA: The metadata keys here must EXACTLY match what's registered in the
 * Discord Developer Portal under "Linked Roles". If you add a new key here
 * without registering it, Discord silently ignores it. No error, no warning,
 * just... nothing happens. Ask me how I know.
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

  logger.debug({ body }, "[linkedRoles] Sending role connection request");

  const response = await fetch(`${DISCORD_API}/users/@me/applications/${CLIENT_ID}/role-connection`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseData = await response.text();
  logger.debug({ status: response.status, responseData }, "[linkedRoles] Role connection API response");

  if (!response.ok) {
    throw new Error(`Failed to set role connection: ${response.status} ${responseData}`);
  }
}

/**
 * Simple HTML response helper with security headers
 *
 * The CSP is intentionally strict: no scripts, no external resources. We're just
 * serving static success/error pages. If someone complains they want analytics
 * or fancy JS on these pages, politely remind them this is an OAuth callback
 * endpoint, not a web app.
 */
function sendHtml(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline';",
  });
  res.end(html);
}

/**
 * Request handler
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;
  // GOTCHA: If you're behind a reverse proxy (nginx, cloudflare, etc.), this is
  // the proxy's IP, not the user's. You'd need to trust X-Forwarded-For instead.
  // We don't do that here because we're running this standalone on a non-proxied port.
  const clientIp = req.socket.remoteAddress || "unknown";

  logger.info({ method: req.method, pathname }, "[linkedRoles] HTTP request");

  // Apply general rate limiting to all requests
  if (!checkRateLimit(clientIp, rateLimits, RATE_LIMIT)) {
    logger.warn({ clientIp, pathname }, "[linkedRoles] Rate limit exceeded (general)");
    sendRateLimitResponse(res, 60);
    return;
  }

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
    // Apply stricter OAuth rate limiting
    if (!checkRateLimit(clientIp, oauthRateLimits, OAUTH_RATE_LIMIT)) {
      logger.warn({ clientIp, pathname }, "[linkedRoles] Rate limit exceeded (OAuth)");
      sendRateLimitResponse(res, 300); // 5 minutes
      return;
    }

    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    // If no code/error, this is the start of the flow - redirect to Discord
    if (!code && !error) {
      const authUrl = getAuthorizationUrl();
      logger.info("[linkedRoles] Redirecting to Discord OAuth2");
      res.writeHead(302, { Location: authUrl });
      res.end();
      return;
    }

    // Handle OAuth2 error
    if (error) {
      logger.error({ error }, "[linkedRoles] OAuth2 error");
      sendHtml(res, 400, `
        <html>
          <head><title>Authorization Failed</title></head>
          <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
            <h1>Authorization Failed</h1>
            <p>Error: ${escapeHtml(error)}</p>
            <p><a href="/linked-roles">Try again</a></p>
          </body>
        </html>
      `);
      return;
    }

    // Validate CSRF state parameter
    const state = url.searchParams.get("state");
    if (!state || !validateState(state)) {
      logger.warn({ stateStatus: state ? "expired/invalid" : "missing" }, "[linkedRoles] Invalid or expired state parameter");
      sendHtml(res, 400, `
        <html>
          <head><title>Invalid Request</title></head>
          <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
            <h1>Invalid or Expired State Parameter</h1>
            <p>This authorization request has expired or is invalid. Please try again.</p>
            <p><a href="/linked-roles">Start over</a></p>
          </body>
        </html>
      `);
      return;
    }

    // Handle OAuth2 callback with code
    // TypeScript can't prove that code is non-null here because it doesn't track
    // the relationship between the early returns above. This is a known limitation.
    // The check is basically dead code, but it makes tsc happy without needing
    // a non-null assertion that would be harder to audit.
    if (!code) {
      sendHtml(res, 400, "<html><body>Invalid request: missing code</body></html>");
      return;
    }

    try {
      logger.debug("[linkedRoles] Exchanging code for token");
      const tokens = await exchangeCode(code);

      logger.debug("[linkedRoles] Fetching user info");
      const user = await getCurrentUser(tokens.access_token);
      logger.info({ username: user.global_name ?? user.username, userId: user.id }, "[linkedRoles] User authenticated");

      logger.debug("[linkedRoles] Setting role connection metadata");
      // WHY is_developer = 1 and not true? Discord's metadata API uses integers
      // for boolean fields (1 = true, 0 = false). Don't ask, just accept it.
      await setRoleConnection(tokens.access_token, user.global_name ?? user.username, {
        is_developer: 1,
      });

      logger.info({ username: user.global_name ?? user.username }, "[linkedRoles] Role connection set successfully");

      sendHtml(res, 200, `
        <html>
          <head><title>Success!</title></head>
          <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #1e402f;">Success!</h1>
            <p>Welcome, <strong>${escapeHtml(user.global_name ?? user.username)}</strong>!</p>
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
      // Log detailed error server-side for debugging
      logger.error({ err }, "[linkedRoles] Callback error");
      // Generic message to user - don't expose internal error details
      // which could contain API URLs, tokens, or other sensitive info
      sendHtml(res, 500, `
        <html>
          <head><title>Authorization Failed</title></head>
          <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #c00;">Authorization Failed</h1>
            <p>Something went wrong during authorization. Please try again.</p>
            <p>If this problem persists, please contact the server administrator.</p>
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
    logger.error({ err }, "[linkedRoles] Unhandled error");
    res.writeHead(500);
    res.end("Internal Server Error");
  });
});

/*
 * Periodic cleanup of expired entries. Without this, the Maps would only grow
 * (entries get added on every request, but only removed when checked or evicted).
 * The cleanup runs every minute which is aggressive, but these are tiny objects
 * and the iteration is cheap. Better to clean up often than accumulate garbage.
 *
 * .unref() is crucial - without it, this interval keeps the process alive forever.
 */
const cleanupInterval = setInterval(() => {
  const now = Date.now();

  // Clean up expired state tokens
  for (const [state, entry] of stateStore) {
    if (now - entry.created > STATE_TOKEN_EXPIRY_MS) {
      stateStore.delete(state);
    }
  }

  // Clean up expired rate limit entries
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) {
      rateLimits.delete(ip);
    }
  }

  // Clean up expired OAuth rate limit entries
  for (const [ip, entry] of oauthRateLimits) {
    if (now > entry.resetAt) {
      oauthRateLimits.delete(ip);
    }
  }
}, CLEANUP_INTERVAL_MS);
cleanupInterval.unref();

// Graceful shutdown handler
// NOTE: Only handles SIGTERM, not SIGINT (Ctrl+C). PM2 sends SIGTERM, so that's
// what we care about in production. If you're testing locally and Ctrl+C doesn't
// shut down cleanly, that's why.
process.on("SIGTERM", () => {
  logger.info("[linkedRoles] Received SIGTERM, shutting down");
  clearInterval(cleanupInterval);
  server.close(() => {
    logger.info("[linkedRoles] Server closed");
    process.exit(0);
  });
});

server.listen(PORT, () => {
  logger.info(
    {
      port: PORT,
      redirectUri: REDIRECT_URI,
      authUrl: `http://localhost:${PORT}/linked-roles`,
    },
    "[linkedRoles] Server started"
  );
});
