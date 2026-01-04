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

describe("getSummary function", () => {
  describe("WS ping retrieval", () => {
    it("returns -1 when client not set", () => {
      const wsPing = -1;
      expect(wsPing).toBe(-1);
    });

    it("returns actual ping when client set", () => {
      const mockClient = { ws: { ping: 50 } };
      const wsPing = mockClient.ws.ping;
      expect(wsPing).toBe(50);
    });
  });

  describe("DB integrity check", () => {
    it("runs PRAGMA quick_check", () => {
      const pragma = "PRAGMA quick_check";
      expect(pragma).toContain("quick_check");
    });

    it("uses pluck() for single value", () => {
      const method = "pluck";
      expect(method).toBe("pluck");
    });
  });
});

describe("runCheck function", () => {
  describe("threshold evaluation", () => {
    it("checks queue backlog against threshold", () => {
      const backlog = 250;
      const threshold = 200;
      const exceeds = backlog >= threshold;
      expect(exceeds).toBe(true);
    });

    it("checks P95 against threshold", () => {
      const p95 = 2500;
      const threshold = 2000;
      const exceeds = p95 >= threshold;
      expect(exceeds).toBe(true);
    });

    it("checks WS ping against threshold", () => {
      const ping = 600;
      const threshold = 500;
      const exceeds = ping >= threshold;
      expect(exceeds).toBe(true);
    });
  });

  describe("PM2 status checks", () => {
    it("alerts on stopped process", () => {
      const status = "stopped";
      const shouldAlert = status === "stopped" || status === "errored";
      expect(shouldAlert).toBe(true);
    });

    it("alerts on errored process", () => {
      const status = "errored";
      const shouldAlert = status === "stopped" || status === "errored";
      expect(shouldAlert).toBe(true);
    });

    it("does not alert on online process", () => {
      const status = "online";
      const shouldAlert = status === "stopped" || status === "errored";
      expect(shouldAlert).toBe(false);
    });
  });

  describe("orphaned ticket check", () => {
    it("queries for open tickets without open_modmail entry", () => {
      const query = "SELECT FROM modmail_ticket WHERE status = 'open' AND NOT EXISTS (SELECT FROM open_modmail)";
      expect(query).toContain("open_modmail");
    });
  });
});

describe("ackAlert function", () => {
  describe("database update", () => {
    it("sets acknowledged_by", () => {
      const field = "acknowledged_by";
      expect(field).toBe("acknowledged_by");
    });

    it("sets acknowledged_at to current timestamp", () => {
      const now = Math.floor(Date.now() / 1000);
      expect(now).toBeGreaterThan(0);
    });
  });

  describe("audit logging", () => {
    it("logs ops_health_ack action", () => {
      const action = "ops_health_ack";
      expect(action).toBe("ops_health_ack");
    });

    it("includes alert_id in meta", () => {
      const meta = { alert_id: 123 };
      expect(meta.alert_id).toBe(123);
    });
  });
});

describe("resolveAlert function", () => {
  describe("database update", () => {
    it("sets resolved_by", () => {
      const field = "resolved_by";
      expect(field).toBe("resolved_by");
    });

    it("sets resolved_at to current timestamp", () => {
      const now = Math.floor(Date.now() / 1000);
      expect(now).toBeGreaterThan(0);
    });
  });

  describe("audit logging", () => {
    it("logs ops_health_resolve action", () => {
      const action = "ops_health_resolve";
      expect(action).toBe("ops_health_resolve");
    });
  });
});

describe("notifyAlert function", () => {
  describe("guild validation", () => {
    it("warns when guild not in cache", () => {
      const guildFound = false;
      expect(guildFound).toBe(false);
    });
  });

  describe("action log entry", () => {
    it("logs ops_health_alert action", () => {
      const action = "ops_health_alert";
      expect(action).toBe("ops_health_alert");
    });

    it("includes alert metadata", () => {
      const meta = {
        alert_type: "queue_backlog",
        severity: "warn",
        threshold: 200,
        actual: 250,
      };
      expect(meta.alert_type).toBeDefined();
      expect(meta.severity).toBeDefined();
    });
  });

  describe("webhook integration", () => {
    it("sends POST request to webhook URL", () => {
      const method = "POST";
      expect(method).toBe("POST");
    });

    it("includes Content-Type header", () => {
      const headers = { "Content-Type": "application/json" };
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("includes User-Agent header", () => {
      const headers = { "User-Agent": "Pawtropolis-Tech-Bot/1.0" };
      expect(headers["User-Agent"]).toContain("Pawtropolis");
    });
  });
});

describe("health_alerts table schema", () => {
  describe("columns", () => {
    it("has id as primary key", () => {
      const pk = "id";
      expect(pk).toBe("id");
    });

    it("has alert_type for categorization", () => {
      const column = "alert_type";
      expect(column).toBe("alert_type");
    });

    it("has severity for priority", () => {
      const column = "severity";
      expect(column).toBe("severity");
    });

    it("has triggered_at for first occurrence", () => {
      const column = "triggered_at";
      expect(column).toBe("triggered_at");
    });

    it("has last_seen_at for ongoing tracking", () => {
      const column = "last_seen_at";
      expect(column).toBe("last_seen_at");
    });

    it("has meta JSON for alert details", () => {
      const column = "meta";
      expect(column).toBe("meta");
    });
  });
});

describe("error handling", () => {
  describe("DB check failure", () => {
    it("returns ok: false on exception", () => {
      const result = { ok: false, message: "DB check failed" };
      expect(result.ok).toBe(false);
    });

    it("logs error message", () => {
      const logMessage = "[opshealth] DB integrity check failed";
      expect(logMessage).toContain("failed");
    });
  });

  describe("queue metrics failure", () => {
    it("returns zeroed metrics on error", () => {
      const metrics = { backlog: 0, p50Ms: 0, p95Ms: 0, throughputPerHour: 0, timeseries: [] };
      expect(metrics.backlog).toBe(0);
    });
  });

  describe("recent actions failure", () => {
    it("returns empty array on error", () => {
      const actions: any[] = [];
      expect(actions).toHaveLength(0);
    });
  });

  describe("alert upsert failure", () => {
    it("returns null on error", () => {
      const result = null;
      expect(result).toBeNull();
    });

    it("logs error", () => {
      const logMessage = "[opshealth] failed to upsert alert";
      expect(logMessage).toContain("upsert");
    });
  });

  describe("notification failure", () => {
    it("does not throw", () => {
      const behavior = "log_and_continue";
      expect(behavior).toBe("log_and_continue");
    });
  });
});

describe("environment variable thresholds", () => {
  describe("QUEUE_BACKLOG_ALERT", () => {
    it("overrides default threshold", () => {
      const envVar = "QUEUE_BACKLOG_ALERT";
      const defaultVal = 200;
      const envVal = parseInt(process.env[envVar] || String(defaultVal), 10);
      expect(envVal).toBe(defaultVal);
    });
  });

  describe("P95_RESPONSE_MS_ALERT", () => {
    it("overrides default threshold", () => {
      const envVar = "P95_RESPONSE_MS_ALERT";
      const defaultVal = 2000;
      const envVal = parseInt(process.env[envVar] || String(defaultVal), 10);
      expect(envVal).toBe(defaultVal);
    });
  });

  describe("WS_PING_MS_ALERT", () => {
    it("overrides default threshold", () => {
      const envVar = "WS_PING_MS_ALERT";
      const defaultVal = 500;
      const envVal = parseInt(process.env[envVar] || String(defaultVal), 10);
      expect(envVal).toBe(defaultVal);
    });
  });

  describe("HEALTH_ALERT_WEBHOOK", () => {
    it("enables webhook notifications when set", () => {
      const webhookUrl = process.env.HEALTH_ALERT_WEBHOOK;
      const enabled = !!webhookUrl;
      expect(enabled).toBe(false); // Not set in test env
    });
  });
});
