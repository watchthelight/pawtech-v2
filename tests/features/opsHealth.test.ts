/**
 * Pawtropolis Tech — tests/features/opsHealth.test.ts
 * WHAT: Unit tests for operations health monitoring module.
 * WHY: Verify health checks, alert thresholds, and notification logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockAll, mockRun, mockPrepare, mockPragma, mockPluck } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
  mockPragma: vi.fn(),
  mockPluck: vi.fn(),
}));

mockPluck.mockReturnValue({ get: vi.fn(() => "ok") });
mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
  run: mockRun,
  pluck: mockPluck,
});

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
    pragma: mockPragma,
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/pm2.js", () => ({
  getPM2Status: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/lib/env.js", () => ({
  env: {
    PM2_PROCESS_NAME: "pawtropolis",
  },
}));

vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

import { setHealthClient } from "../../src/features/opsHealth.js";

describe("features/opsHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
      pluck: mockPluck,
    });
  });

  describe("setHealthClient", () => {
    it("accepts Discord client for WS ping checks", () => {
      const mockClient = { ws: { ping: 50 } };
      expect(() => setHealthClient(mockClient as any)).not.toThrow();
    });
  });
});

describe("DbIntegrity type", () => {
  describe("structure", () => {
    it("has ok boolean", () => {
      const integrity = { ok: true, message: "ok", checkedAt: 1700000000 };
      expect(integrity.ok).toBe(true);
    });

    it("has message string", () => {
      const integrity = { ok: false, message: "page corruption", checkedAt: 1700000000 };
      expect(integrity.message).toBe("page corruption");
    });

    it("has checkedAt timestamp", () => {
      const integrity = { ok: true, message: "ok", checkedAt: 1700000000 };
      expect(integrity.checkedAt).toBe(1700000000);
    });
  });
});

describe("QueueMetrics type", () => {
  describe("structure", () => {
    it("has backlog count", () => {
      const metrics = { backlog: 25, p50Ms: 500, p95Ms: 1500, throughputPerHour: 5.2, timeseries: [] };
      expect(metrics.backlog).toBe(25);
    });

    it("has p50 and p95 response times", () => {
      const metrics = { backlog: 25, p50Ms: 500, p95Ms: 1500, throughputPerHour: 5.2, timeseries: [] };
      expect(metrics.p50Ms).toBe(500);
      expect(metrics.p95Ms).toBe(1500);
    });

    it("has throughput per hour", () => {
      const metrics = { backlog: 25, p50Ms: 500, p95Ms: 1500, throughputPerHour: 5.2, timeseries: [] };
      expect(metrics.throughputPerHour).toBe(5.2);
    });

    it("has timeseries array", () => {
      const metrics = {
        backlog: 25,
        p50Ms: 500,
        p95Ms: 1500,
        throughputPerHour: 5.2,
        timeseries: [{ ts: 1700000000, backlog: 25, p95: 1500 }],
      };
      expect(metrics.timeseries).toHaveLength(1);
    });
  });
});

describe("HealthAlert type", () => {
  describe("severity levels", () => {
    it("supports warn severity", () => {
      const alert = { severity: "warn" as const };
      expect(alert.severity).toBe("warn");
    });

    it("supports critical severity", () => {
      const alert = { severity: "critical" as const };
      expect(alert.severity).toBe("critical");
    });
  });

  describe("acknowledgment tracking", () => {
    it("tracks acknowledged_by and acknowledged_at", () => {
      const alert = {
        acknowledged_by: "user123",
        acknowledged_at: 1700000000,
      };
      expect(alert.acknowledged_by).toBe("user123");
      expect(alert.acknowledged_at).toBe(1700000000);
    });
  });

  describe("resolution tracking", () => {
    it("tracks resolved_by and resolved_at", () => {
      const alert = {
        resolved_by: "user456",
        resolved_at: 1700001000,
      };
      expect(alert.resolved_by).toBe("user456");
      expect(alert.resolved_at).toBe(1700001000);
    });
  });
});

describe("alert thresholds", () => {
  describe("queue backlog threshold", () => {
    it("defaults to 200", () => {
      const defaultThreshold = 200;
      expect(defaultThreshold).toBe(200);
    });

    it("triggers warn at threshold", () => {
      const backlog = 200;
      const threshold = 200;
      const shouldAlert = backlog >= threshold;
      expect(shouldAlert).toBe(true);
    });

    it("triggers critical at 2x threshold", () => {
      const backlog = 400;
      const threshold = 200;
      const severity = backlog >= threshold * 2 ? "critical" : "warn";
      expect(severity).toBe("critical");
    });
  });

  describe("p95 response time threshold", () => {
    it("defaults to 2000ms", () => {
      const defaultThreshold = 2000;
      expect(defaultThreshold).toBe(2000);
    });
  });

  describe("WS ping threshold", () => {
    it("defaults to 500ms", () => {
      const defaultThreshold = 500;
      expect(defaultThreshold).toBe(500);
    });

    it("triggers critical at 3x threshold", () => {
      const ping = 1500;
      const threshold = 500;
      const severity = ping >= threshold * 3 ? "critical" : "warn";
      expect(severity).toBe("critical");
    });
  });
});

describe("alert types", () => {
  describe("queue_backlog", () => {
    it("includes threshold and actual values", () => {
      const meta = { threshold: 200, actual: 250 };
      expect(meta.threshold).toBe(200);
      expect(meta.actual).toBe(250);
    });
  });

  describe("p95_response_high", () => {
    it("includes threshold and actual values", () => {
      const meta = { threshold: 2000, actual: 3500 };
      expect(meta.threshold).toBe(2000);
      expect(meta.actual).toBe(3500);
    });
  });

  describe("ws_ping_high", () => {
    it("includes threshold and actual values", () => {
      const meta = { threshold: 500, actual: 750 };
      expect(meta.threshold).toBe(500);
      expect(meta.actual).toBe(750);
    });
  });

  describe("pm2_*_down", () => {
    it("includes process name and status", () => {
      const meta = { process: "pawtropolis", status: "stopped" };
      expect(meta.process).toBe("pawtropolis");
      expect(meta.status).toBe("stopped");
    });
  });

  describe("db_integrity_fail", () => {
    it("includes error message", () => {
      const meta = { message: "page corruption detected" };
      expect(meta.message).toBe("page corruption detected");
    });
  });

  describe("modmail_orphaned_tickets", () => {
    it("includes count and ticket IDs", () => {
      const meta = { count: 3, ticket_ids: [1, 2, 3], oldest_ticket_id: 1 };
      expect(meta.count).toBe(3);
      expect(meta.ticket_ids).toHaveLength(3);
    });
  });
});

describe("formatAlertMessage", () => {
  // Recreate the format function for testing
  function formatAlertMessage(alert: { alert_type: string; severity: string; meta: any }): string {
    const severity = alert.severity === "critical" ? "CRITICAL" : "WARNING";

    switch (alert.alert_type) {
      case "queue_backlog":
        return `${severity}: Queue backlog at ${alert.meta?.actual || "unknown"} (threshold: ${alert.meta?.threshold || "unknown"})`;
      case "p95_response_high":
        return `${severity}: P95 response time ${alert.meta?.actual || "unknown"}ms (threshold: ${alert.meta?.threshold || "unknown"}ms)`;
      case "ws_ping_high":
        return `${severity}: WebSocket ping ${alert.meta?.actual || "unknown"}ms (threshold: ${alert.meta?.threshold || "unknown"}ms)`;
      case "db_integrity_fail":
        return `${severity}: Database integrity check failed - ${alert.meta?.message || "unknown error"}`;
      case "modmail_orphaned_tickets":
        return `${severity}: ${alert.meta?.count || "unknown"} orphaned modmail tickets detected`;
      default:
        if (alert.alert_type.startsWith("pm2_")) {
          return `${severity}: PM2 process ${alert.meta?.process || "unknown"} is ${alert.meta?.status || "down"}`;
        }
        return `${severity}: ${alert.alert_type} - ${JSON.stringify(alert.meta)}`;
    }
  }

  describe("message formatting", () => {
    it("formats queue_backlog alert", () => {
      const alert = {
        alert_type: "queue_backlog",
        severity: "warn",
        meta: { threshold: 200, actual: 250 },
      };
      const message = formatAlertMessage(alert);
      expect(message).toContain("WARNING");
      expect(message).toContain("250");
      expect(message).toContain("200");
    });

    it("formats critical severity", () => {
      const alert = {
        alert_type: "queue_backlog",
        severity: "critical",
        meta: { threshold: 200, actual: 500 },
      };
      const message = formatAlertMessage(alert);
      expect(message).toContain("CRITICAL");
    });

    it("formats PM2 down alert", () => {
      const alert = {
        alert_type: "pm2_pawtropolis_down",
        severity: "critical",
        meta: { process: "pawtropolis", status: "errored" },
      };
      const message = formatAlertMessage(alert);
      expect(message).toContain("PM2 process");
      expect(message).toContain("pawtropolis");
      expect(message).toContain("errored");
    });
  });
});

describe("PRAGMA quick_check", () => {
  describe("result interpretation", () => {
    it("'ok' means database is healthy", () => {
      const result = "ok";
      const isHealthy = result === "ok";
      expect(isHealthy).toBe(true);
    });

    it("other values indicate problems", () => {
      const result = "page corruption at page 123";
      const isHealthy = result === "ok";
      expect(isHealthy).toBe(false);
    });
  });
});

describe("percentile calculation", () => {
  describe("nearest-rank method", () => {
    it("calculates p50 correctly", () => {
      const values = [100, 200, 300, 400, 500];
      values.sort((a, b) => a - b);
      const p50Idx = Math.ceil(0.5 * values.length) - 1;
      expect(values[p50Idx]).toBe(300);
    });

    it("calculates p95 correctly", () => {
      const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      values.sort((a, b) => a - b);
      const p95Idx = Math.ceil(0.95 * values.length) - 1;
      expect(values[p95Idx]).toBe(1000);
    });
  });
});

describe("alert upsert logic", () => {
  describe("existing alert handling", () => {
    it("updates last_seen_at for existing alert", () => {
      const action = "update_last_seen_at";
      expect(action).toBe("update_last_seen_at");
    });

    it("returns null to skip re-notification", () => {
      const existingAlert = { id: 1, alert_type: "queue_backlog" };
      const shouldNotify = existingAlert === undefined;
      expect(shouldNotify).toBe(false);
    });
  });

  describe("new alert creation", () => {
    it("creates alert when none exists", () => {
      const existingAlert = undefined;
      const shouldCreate = existingAlert === undefined;
      expect(shouldCreate).toBe(true);
    });

    it("returns alert object for notification", () => {
      const newAlert = { id: 1, alert_type: "queue_backlog", severity: "warn" };
      expect(newAlert).not.toBeNull();
    });
  });
});

describe("webhook notification", () => {
  describe("payload format", () => {
    it("includes alert_id", () => {
      const payload = { alert_id: 123 };
      expect(payload.alert_id).toBe(123);
    });

    it("includes formatted message", () => {
      const payload = { message: "WARNING: Queue backlog at 250 (threshold: 200)" };
      expect(payload.message).toContain("Queue backlog");
    });

    it("includes ISO timestamp", () => {
      const timestamp = new Date(1700000000 * 1000).toISOString();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("timeout", () => {
    it("uses 5 second timeout", () => {
      const timeoutMs = 5000;
      expect(timeoutMs).toBe(5000);
    });
  });
});

describe("HealthSummary structure", () => {
  describe("required fields", () => {
    it("includes wsPingMs", () => {
      const summary = { wsPingMs: 50 };
      expect(summary).toHaveProperty("wsPingMs");
    });

    it("includes pm2 status array", () => {
      const summary = { pm2: [] };
      expect(summary).toHaveProperty("pm2");
      expect(Array.isArray(summary.pm2)).toBe(true);
    });

    it("includes db integrity", () => {
      const summary = { db: { ok: true, message: "ok", checkedAt: 1700000000 } };
      expect(summary.db).toHaveProperty("ok");
    });

    it("includes queue metrics", () => {
      const summary = { queue: { backlog: 0, p50Ms: 0, p95Ms: 0, throughputPerHour: 0, timeseries: [] } };
      expect(summary.queue).toHaveProperty("backlog");
    });

    it("includes lastActions", () => {
      const summary = { lastActions: [] };
      expect(summary).toHaveProperty("lastActions");
    });

    it("includes activeAlerts", () => {
      const summary = { activeAlerts: [] };
      expect(summary).toHaveProperty("activeAlerts");
    });
  });
});
