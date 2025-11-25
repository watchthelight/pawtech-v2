/**
 * Pawtropolis Tech — src/features/opsHealth.ts
 * WHAT: Operations health monitoring and alerting core logic
 * WHY: Provide real-time bot health visibility (WS ping, PM2, DB, queue metrics)
 * FLOWS:
 *  - getSummary() → current snapshot (WS ping, PM2, DB, queue, recent logs)
 *  - runCheck() → full health check + alert evaluation
 *  - ackAlert(alertId, actorId) → mark alert as acknowledged
 *  - resolveAlert(alertId, actorId) → mark alert as resolved
 * DOCS:
 *  - better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - Discord.js Client: https://discord.js.org/#/docs/discord.js/main/class/Client
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Client } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { getPM2Status, type PM2ProcessStatus } from "../lib/pm2.js";
import { env } from "../lib/env.js";
import { logActionPretty } from "../logging/pretty.js";

/**
 * Database integrity check result
 */
export interface DbIntegrity {
  ok: boolean;
  message: string;
  checkedAt: number;
}

/**
 * Queue metrics snapshot
 */
export interface QueueMetrics {
  backlog: number;
  p50Ms: number;
  p95Ms: number;
  throughputPerHour: number;
  timeseries: Array<{ ts: number; backlog: number; p95: number }>;
}

/**
 * Health alert
 */
export interface HealthAlert {
  id: number;
  alert_type: string;
  severity: "warn" | "critical";
  triggered_at: number;
  last_seen_at: number;
  acknowledged_by: string | null;
  acknowledged_at: number | null;
  resolved_by: string | null;
  resolved_at: number | null;
  meta: Record<string, any> | null;
}

/**
 * Action log row (subset)
 */
interface ActionLogRow {
  id: number;
  guild_id: string;
  actor_id: string;
  action: string;
  created_at_s: number;
  meta_json?: string;
}

/**
 * Health summary response
 */
export interface HealthSummary {
  wsPingMs: number;
  pm2: PM2ProcessStatus[];
  db: DbIntegrity;
  queue: QueueMetrics;
  lastActions: ActionLogRow[];
  activeAlerts: HealthAlert[];
}

/**
 * Health check result (includes triggered alerts)
 */
export interface HealthCheckResult {
  summary: HealthSummary;
  triggeredAlerts: HealthAlert[];
}

let _cachedClient: Client | null = null;

/**
 * WHAT: Set Discord client for health checks (called once at startup).
 * WHY: Client needed for WS ping checks.
 */
export function setHealthClient(client: Client): void {
  _cachedClient = client;
}

/**
 * WHAT: Get current WS ping in milliseconds.
 * WHY: Indicator of Discord connection health.
 */
function getWsPing(): number {
  if (!_cachedClient || !_cachedClient.ws.ping) {
    return -1;
  }
  return _cachedClient.ws.ping;
}

/**
 * WHAT: Run PRAGMA quick_check on database.
 * WHY: Fast integrity check (seconds vs minutes for full check).
 */
function checkDbIntegrity(): DbIntegrity {
  try {
    const result = db.prepare("PRAGMA quick_check").pluck().get() as string;
    const ok = result === "ok";

    return {
      ok,
      message: ok ? "ok" : result,
      checkedAt: Math.floor(Date.now() / 1000),
    };
  } catch (err: any) {
    logger.error({ err: err.message }, "[opshealth] DB integrity check failed");
    return {
      ok: false,
      message: err.message || "DB check failed",
      checkedAt: Math.floor(Date.now() / 1000),
    };
  }
}

/**
 * WHAT: Compute queue metrics (backlog, p50, p95, throughput).
 * WHY: Review queue health is critical for moderator workload visibility.
 */
function computeQueueMetrics(guildId: string): QueueMetrics {
  try {
    // Backlog: count of pending applications
    const backlog = db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM application
      WHERE guild_id = ? AND status = 'pending'
    `
      )
      .get(guildId) as { count: number };

    // Response times: compute from review actions in last 24h
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const reviewActions = db
      .prepare(
        `
      SELECT
        created_at_s,
        meta_json
      FROM action_log
      WHERE guild_id = ?
        AND action IN ('approve', 'reject', 'need_info')
        AND created_at_s >= ?
      ORDER BY created_at_s DESC
    `
      )
      .all(guildId, oneDayAgo) as Array<{ created_at_s: number; meta_json?: string }>;

    // Extract response times (milliseconds)
    const responseTimes: number[] = [];
    for (const row of reviewActions) {
      if (row.meta_json) {
        try {
          const meta = JSON.parse(row.meta_json);
          if (meta.response_time_ms && typeof meta.response_time_ms === "number") {
            responseTimes.push(meta.response_time_ms);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Compute percentiles (nearest-rank method)
    let p50Ms = 0;
    let p95Ms = 0;
    if (responseTimes.length > 0) {
      responseTimes.sort((a, b) => a - b);
      const p50Idx = Math.ceil(0.5 * responseTimes.length) - 1;
      const p95Idx = Math.ceil(0.95 * responseTimes.length) - 1;
      p50Ms = responseTimes[p50Idx] || 0;
      p95Ms = responseTimes[p95Idx] || 0;
    }

    // Throughput: apps processed per hour (last 24h)
    const throughputPerHour = reviewActions.length > 0 ? reviewActions.length / 24 : 0;

    // Timeseries: simplified hourly buckets for last 24h
    const timeseries: Array<{ ts: number; backlog: number; p95: number }> = [];
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 24; i++) {
      const hourStart = now - (24 - i) * 3600;
      // Simplified: use current backlog and p95 for all hours (real impl would query historical data)
      timeseries.push({
        ts: hourStart,
        backlog: backlog.count,
        p95: p95Ms,
      });
    }

    return {
      backlog: backlog.count,
      p50Ms: Math.round(p50Ms),
      p95Ms: Math.round(p95Ms),
      throughputPerHour: Math.round(throughputPerHour * 10) / 10,
      timeseries,
    };
  } catch (err: any) {
    logger.error({ err: err.message, guildId }, "[opshealth] failed to compute queue metrics");
    return {
      backlog: 0,
      p50Ms: 0,
      p95Ms: 0,
      throughputPerHour: 0,
      timeseries: [],
    };
  }
}

/**
 * WHAT: Get last N action_log items of interest (errors, review actions, modmail).
 * WHY: Recent activity log helps diagnose issues.
 */
function getRecentActions(guildId: string, limit: number = 10): ActionLogRow[] {
  try {
    const rows = db
      .prepare(
        `
      SELECT id, guild_id, actor_id, action, created_at_s, meta_json
      FROM action_log
      WHERE guild_id = ?
      ORDER BY created_at_s DESC
      LIMIT ?
    `
      )
      .all(guildId, limit) as ActionLogRow[];

    return rows;
  } catch (err: any) {
    logger.error({ err: err.message, guildId }, "[opshealth] failed to fetch recent actions");
    return [];
  }
}

/**
 * WHAT: Get active alerts (not resolved).
 * WHY: Dashboard needs to show current alerts.
 */
function getActiveAlerts(): HealthAlert[] {
  try {
    const rows = db
      .prepare(
        `
      SELECT
        id, alert_type, severity, triggered_at, last_seen_at,
        acknowledged_by, acknowledged_at, resolved_by, resolved_at, meta
      FROM health_alerts
      WHERE resolved_at IS NULL
      ORDER BY severity DESC, triggered_at DESC
    `
      )
      .all() as Array<{
      id: number;
      alert_type: string;
      severity: string;
      triggered_at: number;
      last_seen_at: number;
      acknowledged_by: string | null;
      acknowledged_at: number | null;
      resolved_by: string | null;
      resolved_at: number | null;
      meta: string | null;
    }>;

    return rows.map((row) => ({
      ...row,
      severity: row.severity as "warn" | "critical",
      meta: row.meta ? JSON.parse(row.meta) : null,
    }));
  } catch (err: any) {
    logger.error({ err: err.message }, "[opshealth] failed to fetch active alerts");
    return [];
  }
}

/**
 * WHAT: Get current health summary (no alert evaluation).
 * WHY: Fast snapshot for dashboard polling.
 */
export async function getSummary(guildId: string): Promise<HealthSummary> {
  const wsPingMs = getWsPing();

  // PM2 status (parse from env)
  const pm2ProcessNames = env.PM2_PROCESS_NAME.split(",").map((n) => n.trim()).filter(Boolean);
  const pm2 = await getPM2Status(pm2ProcessNames);

  // DB integrity
  const db = checkDbIntegrity();

  // Queue metrics
  const queue = computeQueueMetrics(guildId);

  // Recent actions
  const lastActions = getRecentActions(guildId, 10);

  // Active alerts
  const activeAlerts = getActiveAlerts();

  return {
    wsPingMs,
    pm2,
    db,
    queue,
    lastActions,
    activeAlerts,
  };
}

/**
 * WHAT: Run full health check + evaluate alert thresholds.
 * WHY: Automated checks trigger alerts when thresholds crossed.
 */
export async function runCheck(guildId: string, client: Client): Promise<HealthCheckResult> {
  logger.info({ guildId }, "[opshealth] running health check");

  const summary = await getSummary(guildId);
  const triggeredAlerts: HealthAlert[] = [];

  // Load thresholds from env (with defaults)
  const thresholds = {
    queueBacklog: parseInt(process.env.QUEUE_BACKLOG_ALERT || "200", 10),
    p95ResponseMs: parseInt(process.env.P95_RESPONSE_MS_ALERT || "2000", 10),
    wsPingMs: parseInt(process.env.WS_PING_MS_ALERT || "500", 10),
  };

  // Check: Queue backlog
  if (summary.queue.backlog >= thresholds.queueBacklog) {
    const alert = upsertAlert(
      "queue_backlog",
      summary.queue.backlog >= thresholds.queueBacklog * 2 ? "critical" : "warn",
      {
        threshold: thresholds.queueBacklog,
        actual: summary.queue.backlog,
      }
    );
    if (alert) {
      triggeredAlerts.push(alert);
      await notifyAlert(guildId, alert, client);
    }
  }

  // Check: P95 response time
  if (summary.queue.p95Ms >= thresholds.p95ResponseMs) {
    const alert = upsertAlert(
      "p95_response_high",
      summary.queue.p95Ms >= thresholds.p95ResponseMs * 2 ? "critical" : "warn",
      {
        threshold: thresholds.p95ResponseMs,
        actual: summary.queue.p95Ms,
      }
    );
    if (alert) {
      triggeredAlerts.push(alert);
      await notifyAlert(guildId, alert, client);
    }
  }

  // Check: WS ping
  if (summary.wsPingMs >= thresholds.wsPingMs && summary.wsPingMs > 0) {
    const alert = upsertAlert(
      "ws_ping_high",
      summary.wsPingMs >= thresholds.wsPingMs * 3 ? "critical" : "warn",
      {
        threshold: thresholds.wsPingMs,
        actual: summary.wsPingMs,
      }
    );
    if (alert) {
      triggeredAlerts.push(alert);
      await notifyAlert(guildId, alert, client);
    }
  }

  // Check: PM2 status
  for (const proc of summary.pm2) {
    if (proc.status === "stopped" || proc.status === "errored") {
      const alert = upsertAlert(
        `pm2_${proc.name}_down`,
        "critical",
        {
          process: proc.name,
          status: proc.status,
        }
      );
      if (alert) {
        triggeredAlerts.push(alert);
        await notifyAlert(guildId, alert, client);
      }
    }
  }

  // Check: DB integrity
  if (!summary.db.ok) {
    const alert = upsertAlert(
      "db_integrity_fail",
      "critical",
      {
        message: summary.db.message,
      }
    );
    if (alert) {
      triggeredAlerts.push(alert);
      await notifyAlert(guildId, alert, client);
    }
  }

  // Check: Orphaned modmail tickets
  // WHAT: Detect tickets in 'open' status but missing from open_modmail guard table
  // WHY: These tickets won't receive routed messages and block ticket slots
  // HOW: Compare modmail_ticket.status='open' with open_modmail.thread_id
  try {
    const orphanedTickets = db
      .prepare(
        `
      SELECT t.id, t.user_id, t.app_code, t.thread_id, t.created_at
      FROM modmail_ticket t
      WHERE t.guild_id = ? AND t.status = 'open'
        AND NOT EXISTS (
          SELECT 1 FROM open_modmail o WHERE o.thread_id = t.thread_id
        )
    `
      )
      .all(guildId) as Array<{
      id: number;
      user_id: string;
      app_code: string | null;
      thread_id: string | null;
      created_at: string;
    }>;

    if (orphanedTickets.length > 0) {
      const alert = upsertAlert(
        "modmail_orphaned_tickets",
        "warn",
        {
          count: orphanedTickets.length,
          ticket_ids: orphanedTickets.map((t) => t.id),
          oldest_ticket_id: orphanedTickets[0]?.id,
        }
      );
      if (alert) {
        triggeredAlerts.push(alert);
        await notifyAlert(guildId, alert, client);
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message, guildId }, "[opshealth] orphaned ticket check failed");
  }

  logger.info(
    { guildId, triggeredAlertsCount: triggeredAlerts.length },
    "[opshealth] health check complete"
  );

  return {
    summary,
    triggeredAlerts,
  };
}

/**
 * WHAT: Create or update alert (upsert logic).
 * WHY: Update last_seen_at for existing alerts, create new if not exists.
 *
 * @returns Alert if newly created or updated, null if no change
 */
function upsertAlert(
  alertType: string,
  severity: "warn" | "critical",
  meta: Record<string, any>
): HealthAlert | null {
  const now = Math.floor(Date.now() / 1000);

  try {
    // Check if alert exists (not resolved)
    const existing = db
      .prepare(
        `
      SELECT id, alert_type, severity, triggered_at, last_seen_at
      FROM health_alerts
      WHERE alert_type = ? AND resolved_at IS NULL
      ORDER BY triggered_at DESC
      LIMIT 1
    `
      )
      .get(alertType) as
      | { id: number; alert_type: string; severity: string; triggered_at: number; last_seen_at: number }
      | undefined;

    if (existing) {
      // Update last_seen_at
      db.prepare(
        `
        UPDATE health_alerts
        SET last_seen_at = ?, meta = ?
        WHERE id = ?
      `
      ).run(now, JSON.stringify(meta), existing.id);

      logger.debug({ alertId: existing.id, alertType }, "[opshealth] alert updated (last_seen_at)");
      return null; // Not a new alert
    }

    // Create new alert
    const result = db
      .prepare(
        `
      INSERT INTO health_alerts (alert_type, severity, triggered_at, last_seen_at, meta)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(alertType, severity, now, now, JSON.stringify(meta));

    logger.info({ alertId: result.lastInsertRowid, alertType, severity }, "[opshealth] new alert created");

    return {
      id: result.lastInsertRowid as number,
      alert_type: alertType,
      severity,
      triggered_at: now,
      last_seen_at: now,
      acknowledged_by: null,
      acknowledged_at: null,
      resolved_by: null,
      resolved_at: null,
      meta,
    };
  } catch (err: any) {
    logger.error({ err: err.message, alertType }, "[opshealth] failed to upsert alert");
    return null;
  }
}

/**
 * WHAT: Send alert notification (action_log + optional webhook).
 * WHY: Alert operators of critical issues.
 */
async function notifyAlert(guildId: string, alert: HealthAlert, client: Client): Promise<void> {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn({ guildId }, "[opshealth] guild not found for alert notification");
      return;
    }

    // Log to action_log + pretty embed
    await logActionPretty(guild, {
      actorId: client.user?.id || "system",
      action: "ops_health_alert",
      meta: {
        alert_type: alert.alert_type,
        severity: alert.severity,
        ...alert.meta,
      },
    });

    // Optional: send to HEALTH_ALERT_WEBHOOK if configured
    const webhookUrl = process.env.HEALTH_ALERT_WEBHOOK;
    if (webhookUrl) {
      // TODO: implement webhook notification (future enhancement)
      logger.debug({ alertId: alert.id }, "[opshealth] webhook notification skipped (not implemented)");
    }
  } catch (err: any) {
    logger.error({ err: err.message, alertId: alert.id }, "[opshealth] failed to notify alert");
  }
}

/**
 * WHAT: Acknowledge an alert.
 * WHY: Record human acknowledgement of alert.
 */
export async function ackAlert(alertId: number, actorId: string, guildId: string, client: Client): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  try {
    db.prepare(
      `
      UPDATE health_alerts
      SET acknowledged_by = ?, acknowledged_at = ?
      WHERE id = ?
    `
    ).run(actorId, now, alertId);

    logger.info({ alertId, actorId }, "[opshealth] alert acknowledged");

    // Log action
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      await logActionPretty(guild, {
        actorId,
        action: "ops_health_ack",
        meta: { alert_id: alertId },
      });
    }
  } catch (err: any) {
    logger.error({ err: err.message, alertId }, "[opshealth] failed to acknowledge alert");
    throw err;
  }
}

/**
 * WHAT: Resolve an alert.
 * WHY: Mark alert as resolved (no longer active).
 */
export async function resolveAlert(alertId: number, actorId: string, guildId: string, client: Client): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  try {
    db.prepare(
      `
      UPDATE health_alerts
      SET resolved_by = ?, resolved_at = ?
      WHERE id = ?
    `
    ).run(actorId, now, alertId);

    logger.info({ alertId, actorId }, "[opshealth] alert resolved");

    // Log action
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      await logActionPretty(guild, {
        actorId,
        action: "ops_health_resolve",
        meta: { alert_id: alertId },
      });
    }
  } catch (err: any) {
    logger.error({ err: err.message, alertId }, "[opshealth] failed to resolve alert");
    throw err;
  }
}
