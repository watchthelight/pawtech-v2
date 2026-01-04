/**
 * Pawtropolis Tech — src/web/statusEndpoint.ts
 * WHAT: Simple HTTP server for bot status badge endpoint
 * WHY: Provides real-time status for Shields.io dynamic badge
 *
 * USAGE: Called from index.ts after bot is ready
 *
 * ENDPOINT: GET /api/status
 * RESPONSE: Shields.io endpoint badge JSON format
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import http from "node:http";
import { logger } from "../lib/logger.js";
import type { Client } from "discord.js";

// Default port for status endpoint
const STATUS_PORT = parseInt(process.env.STATUS_PORT ?? "3002", 10);

// Track bot start time
let botStartTime: number | null = null;
let discordClient: Client | null = null;

/**
 * Format uptime in human-readable form
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Generate Shields.io badge JSON response
 */
function generateBadgeResponse(): object {
  const isOnline = discordClient?.isReady() ?? false;
  const uptime = botStartTime ? Date.now() - botStartTime : 0;
  const wsLatency = discordClient?.ws.ping ?? -1;

  if (!isOnline) {
    return {
      schemaVersion: 1,
      label: "status",
      message: "offline",
      color: "red",
    };
  }

  // Determine color based on latency
  let color = "brightgreen";
  if (wsLatency > 500) color = "red";
  else if (wsLatency > 200) color = "yellow";
  else if (wsLatency > 100) color = "green";

  return {
    schemaVersion: 1,
    label: "status",
    message: `online · ${formatUptime(uptime)} · ${wsLatency}ms`,
    color,
  };
}

/**
 * Simple health check response
 */
function generateHealthResponse(): object {
  const isOnline = discordClient?.isReady() ?? false;
  const uptime = botStartTime ? Date.now() - botStartTime : 0;
  const wsLatency = discordClient?.ws.ping ?? -1;
  const memUsage = process.memoryUsage();

  return {
    status: isOnline ? "online" : "offline",
    uptime: uptime,
    uptimeFormatted: formatUptime(uptime),
    latency: wsLatency,
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * HTTP request handler
 */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // CORS headers for cross-origin badge requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-cache, max-age=0");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only allow GET
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${STATUS_PORT}`);

  // Route handling
  if (url.pathname === "/api/status" || url.pathname === "/api/status/badge") {
    // Shields.io badge endpoint
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(generateBadgeResponse()));
    return;
  }

  if (url.pathname === "/api/health" || url.pathname === "/health") {
    // Detailed health check
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(generateHealthResponse()));
    return;
  }

  if (url.pathname === "/") {
    // Root - simple text response
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Pawtropolis Tech Status API\n\nEndpoints:\n  GET /api/status - Shields.io badge\n  GET /api/health - Detailed health");
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

/**
 * Start the status endpoint server
 */
export function startStatusServer(client: Client): http.Server {
  discordClient = client;
  botStartTime = Date.now();

  const server = http.createServer(handleRequest);

  server.listen(STATUS_PORT, () => {
    logger.info({ port: STATUS_PORT }, "[status] Status endpoint server started");
  });

  server.on("error", (err) => {
    logger.error({ err, port: STATUS_PORT }, "[status] Status server error");
  });

  return server;
}

/**
 * Get the status port (for logging/documentation)
 */
export function getStatusPort(): number {
  return STATUS_PORT;
}
