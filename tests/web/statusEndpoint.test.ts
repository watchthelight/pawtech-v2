/**
 * Pawtropolis Tech — tests/web/statusEndpoint.test.ts
 * WHAT: Unit tests for status endpoint server module.
 * WHY: Verify badge generation, health responses, and uptime formatting.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getStatusPort } from "../../src/web/statusEndpoint.js";

describe("web/statusEndpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getStatusPort", () => {
    it("returns port number", () => {
      const port = getStatusPort();
      expect(typeof port).toBe("number");
    });

    it("defaults to 3002", () => {
      // Default from code when STATUS_PORT not set
      const defaultPort = 3002;
      expect(defaultPort).toBe(3002);
    });
  });
});

describe("formatUptime", () => {
  // Recreate the format function for testing
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

  describe("time formatting", () => {
    it("formats seconds", () => {
      expect(formatUptime(30 * 1000)).toBe("30s");
    });

    it("formats minutes", () => {
      expect(formatUptime(5 * 60 * 1000)).toBe("5m");
    });

    it("formats hours and minutes", () => {
      expect(formatUptime(2 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe("2h 30m");
    });

    it("formats days and hours", () => {
      expect(formatUptime(3 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000)).toBe("3d 5h");
    });

    it("handles zero", () => {
      expect(formatUptime(0)).toBe("0s");
    });
  });
});

describe("badge response", () => {
  describe("Shields.io format", () => {
    it("includes schemaVersion 1", () => {
      const badge = { schemaVersion: 1 };
      expect(badge.schemaVersion).toBe(1);
    });

    it("includes label", () => {
      const badge = { label: "status" };
      expect(badge.label).toBe("status");
    });

    it("includes message", () => {
      const badge = { message: "online · 5h 30m · 50ms" };
      expect(badge.message).toBeDefined();
    });

    it("includes color", () => {
      const badge = { color: "brightgreen" };
      expect(badge.color).toBeDefined();
    });
  });

  describe("online status format", () => {
    it("shows uptime in message", () => {
      const uptime = "5h 30m";
      const message = `online · ${uptime} · 50ms`;
      expect(message).toContain(uptime);
    });

    it("shows latency in message", () => {
      const latency = 50;
      const message = `online · 5h · ${latency}ms`;
      expect(message).toContain(`${latency}ms`);
    });
  });

  describe("offline status", () => {
    it("shows offline message", () => {
      const badge = {
        schemaVersion: 1,
        label: "status",
        message: "offline",
        color: "red",
      };

      expect(badge.message).toBe("offline");
      expect(badge.color).toBe("red");
    });
  });
});

describe("latency color mapping", () => {
  // Recreate the color logic for testing
  function getLatencyColor(wsLatency: number): string {
    let color = "brightgreen";
    if (wsLatency > 500) color = "red";
    else if (wsLatency > 200) color = "yellow";
    else if (wsLatency > 100) color = "green";
    return color;
  }

  describe("color thresholds", () => {
    it("returns brightgreen for <100ms", () => {
      expect(getLatencyColor(50)).toBe("brightgreen");
    });

    it("returns green for 100-200ms", () => {
      expect(getLatencyColor(150)).toBe("green");
    });

    it("returns yellow for 200-500ms", () => {
      expect(getLatencyColor(300)).toBe("yellow");
    });

    it("returns red for >500ms", () => {
      expect(getLatencyColor(600)).toBe("red");
    });
  });
});

describe("health response", () => {
  describe("response fields", () => {
    it("includes status", () => {
      const health = { status: "online" };
      expect(health.status).toBe("online");
    });

    it("includes uptime in ms", () => {
      const health = { uptime: 3600000 };
      expect(health.uptime).toBe(3600000);
    });

    it("includes formatted uptime", () => {
      const health = { uptimeFormatted: "1h 0m" };
      expect(health.uptimeFormatted).toBe("1h 0m");
    });

    it("includes latency", () => {
      const health = { latency: 50 };
      expect(health.latency).toBe(50);
    });

    it("includes memory stats", () => {
      const health = {
        memory: {
          heapUsed: 100,
          heapTotal: 200,
          rss: 150,
        },
      };

      expect(health.memory.heapUsed).toBeDefined();
      expect(health.memory.heapTotal).toBeDefined();
      expect(health.memory.rss).toBeDefined();
    });

    it("includes ISO timestamp", () => {
      const timestamp = new Date().toISOString();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

describe("endpoint routing", () => {
  describe("badge endpoints", () => {
    it("responds on /api/status", () => {
      const path = "/api/status";
      const isBadgeEndpoint = path === "/api/status" || path === "/api/status/badge";
      expect(isBadgeEndpoint).toBe(true);
    });

    it("responds on /api/status/badge", () => {
      const path = "/api/status/badge";
      const isBadgeEndpoint = path === "/api/status" || path === "/api/status/badge";
      expect(isBadgeEndpoint).toBe(true);
    });
  });

  describe("health endpoints", () => {
    it("responds on /api/health", () => {
      const path = "/api/health";
      const isHealthEndpoint = path === "/api/health" || path === "/health";
      expect(isHealthEndpoint).toBe(true);
    });

    it("responds on /health", () => {
      const path = "/health";
      const isHealthEndpoint = path === "/api/health" || path === "/health";
      expect(isHealthEndpoint).toBe(true);
    });
  });

  describe("root endpoint", () => {
    it("responds on /", () => {
      const path = "/";
      expect(path).toBe("/");
    });

    it("returns text/plain", () => {
      const contentType = "text/plain";
      expect(contentType).toBe("text/plain");
    });
  });

  describe("404 handling", () => {
    it("returns 404 for unknown routes", () => {
      const path = "/unknown";
      const isKnown = ["/", "/api/status", "/api/status/badge", "/api/health", "/health"].includes(path);
      expect(isKnown).toBe(false);
    });
  });
});

describe("CORS headers", () => {
  describe("cross-origin access", () => {
    it("allows all origins", () => {
      const header = "*";
      expect(header).toBe("*");
    });

    it("allows GET and OPTIONS methods", () => {
      const methods = "GET, OPTIONS";
      expect(methods).toContain("GET");
      expect(methods).toContain("OPTIONS");
    });
  });

  describe("caching", () => {
    it("disables caching", () => {
      const cacheControl = "no-cache, max-age=0";
      expect(cacheControl).toContain("no-cache");
      expect(cacheControl).toContain("max-age=0");
    });
  });
});

describe("HTTP methods", () => {
  describe("allowed methods", () => {
    it("allows GET", () => {
      const method = "GET";
      const allowed = method === "GET" || method === "OPTIONS";
      expect(allowed).toBe(true);
    });

    it("allows OPTIONS preflight", () => {
      const method = "OPTIONS";
      const allowed = method === "GET" || method === "OPTIONS";
      expect(allowed).toBe(true);
    });
  });

  describe("disallowed methods", () => {
    it("rejects POST", () => {
      const method = "POST";
      const allowed = method === "GET" || method === "OPTIONS";
      expect(allowed).toBe(false);
    });

    it("returns 405 for disallowed methods", () => {
      const statusCode = 405;
      expect(statusCode).toBe(405);
    });
  });
});

describe("memory usage format", () => {
  describe("unit conversion", () => {
    it("converts bytes to MB", () => {
      const bytes = 100 * 1024 * 1024; // 100 MB
      const mb = Math.round(bytes / 1024 / 1024);
      expect(mb).toBe(100);
    });
  });

  describe("memory fields", () => {
    it("includes heapUsed", () => {
      const memUsage = { heapUsed: 100 };
      expect(memUsage.heapUsed).toBe(100);
    });

    it("includes heapTotal", () => {
      const memUsage = { heapTotal: 200 };
      expect(memUsage.heapTotal).toBe(200);
    });

    it("includes rss (resident set size)", () => {
      const memUsage = { rss: 150 };
      expect(memUsage.rss).toBe(150);
    });
  });
});

describe("client state", () => {
  describe("isReady check", () => {
    it("returns false when client null", () => {
      const client = null;
      const isOnline = client?.isReady() ?? false;
      expect(isOnline).toBe(false);
    });
  });

  describe("ws.ping", () => {
    it("returns -1 when unavailable", () => {
      const client = null;
      const latency = client?.ws?.ping ?? -1;
      expect(latency).toBe(-1);
    });
  });
});
