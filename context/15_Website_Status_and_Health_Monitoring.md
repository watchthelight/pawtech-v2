---
title: "Website Status and Health Monitoring"
slug: "15_Website_Status_and_Health_Monitoring"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Operations"
audience: "Operators • SRE • Engineers"
source_of_truth: ["src/commands/health.ts", "src/web/api/health.ts", "PM2 monitoring"]
related:
  - "02_System_Architecture_Overview"
  - "09_Troubleshooting_and_Runbook"
  - "17_Incident_Response_and_Postmortems"
summary: "Health check procedures, WebSocket ping monitoring, dashboard metrics interpretation, latency charts, and failure triage playbooks."
---

## Purpose & Outcomes

Provide operational visibility into system health:
- Bot uptime and connectivity status
- WebSocket ping latency (Discord gateway)
- Database query performance
- Web server responsiveness
- Dashboard API endpoint health
- Alert thresholds and escalation procedures

## Scope & Boundaries

### In Scope
- `/health` command outputs and interpretation
- WebSocket ping metrics (`ws_ping_ms`)
- Database health indicators (`PRAGMA quick_check`)
- Web server health endpoints (`GET /api/health`)
- PM2 process monitoring (`pm2 status`, `pm2 monit`)
- Latency graphs on admin dashboard
- Failure triage decision trees

### Out of Scope
- External monitoring services (UptimeRobot, Datadog, etc.)
- Infrastructure-level monitoring (CPU, memory, disk — use PM2 or system tools)
- Network-level monitoring (firewalls, DNS, load balancers)
- Client-side performance monitoring (browser metrics)

## Current State

**Health Command**: `/health` (Discord slash command)
**Health Endpoint**: `GET /api/health` (web API)
**PM2 Monitoring**: `pm2 status pawtropolis`, `pm2 monit`

**Key Metrics**:
- Bot Status: "Healthy" | "Degraded" | "Down"
- Uptime: Duration since last restart
- WS Ping: WebSocket latency to Discord gateway (ms)
- DB Health: SQLite integrity check status
- API Health: Fastify response time

**Health Check Output Example**:
```
✅ Pawtropolis Tech Health Status

Bot: Healthy
Uptime: 7d 12h 34m
WS Ping: 42ms

Database: ✅ OK (integrity check passed)
Web Server: ✅ Running on port 3000
API Latency: 3ms (p95: 12ms)

Last Check: 2025-10-30T12:00:00Z
```

## Key Flows

### Health Check Flow
```
1. /health command received
2. Check bot client status (ready state)
3. Measure WS ping (client.ws.ping)
4. Run DB integrity check (PRAGMA quick_check)
5. Check web server status (fetch /api/health)
6. Aggregate results
7. Reply with health embed
```

### Failure Detection Flow
```
1. Health check fails
2. Identify failing component (bot/DB/web)
3. Check PM2 logs for errors
4. Determine severity (P0/P1/P2/P3)
5. Execute triage playbook
6. Escalate if unresolved in 15 minutes
```

## Commands & Snippets

### Health Check Commands

#### Discord /health Command
```
/health
```
**Output**:
```
✅ System Health: Healthy

Bot Status: Connected
Uptime: 7 days, 12 hours
WS Ping: 42ms (-1ms from baseline)
Shard: 0/1

Database: ✅ Integrity OK
Web Server: ✅ Port 3000
API Latency: 3ms (p95: 12ms)

Last Updated: 5 seconds ago
```

#### PM2 Status Check
```bash
pm2 status pawtropolis

# Output:
# ┌─────┬────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┐
# │ id  │ name           │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │
# ├─────┼────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┤
# │ 0   │ pawtropolis    │ default     │ 1.1.0   │ fork    │ 12345    │ 7D     │ 0    │ online    │ 0.2%     │ 85.3mb   │ ubuntu   │
# └─────┴────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┘
```

#### PM2 Real-Time Monitoring
```bash
pm2 monit

# Output: Real-time CPU/memory graphs and logs
```

#### Web API Health Check
```bash
curl -s https://pawtropolis.tech/api/health | jq

# Output:
# {
#   "status": "healthy",
#   "uptime": 630000,
#   "timestamp": "2025-10-30T12:00:00Z",
#   "checks": {
#     "database": "ok",
#     "discord": "connected"
#   }
# }
```

#### Database Integrity Check
```bash
sqlite3 data/data.db "PRAGMA integrity_check"

# Output if healthy:
# ok

# Output if corrupted:
# *** in database main ***
# Page 1042: btreeInitPage() returns error code 11
```

### Interpreting Health Metrics

#### WebSocket Ping Interpretation
```
WS Ping: 42ms (-1ms)
         ^^   ^^^^
         |    |
         |    +-- Delta from baseline (negative = improvement)
         +-- Current latency
```

**Thresholds**:
- < 100ms: ✅ Excellent
- 100-200ms: ⚠️ Acceptable
- 200-500ms: ⚠️ Degraded
- > 500ms: ❌ Poor (investigate network issues)

**Baseline**: Rolling 5-minute average

#### Uptime Format
```
Uptime: 7d 12h 34m
        ^^ ^^^ ^^^
        |  |   |
        |  |   +-- Minutes
        |  +-- Hours
        +-- Days
```

#### API Latency Metrics
```
API Latency: 3ms (p95: 12ms)
             ^^      ^^^^
             |       |
             |       +-- 95th percentile (5% of requests slower)
             +-- Median response time
```

**Thresholds**:
- Median < 10ms: ✅ Excellent
- Median 10-50ms: ⚠️ Acceptable
- Median 50-100ms: ⚠️ Degraded
- Median > 100ms: ❌ Investigate slow queries

### Dashboard Health Monitoring

#### Viewing Latency Charts
1. Navigate to dashboard: `https://pawtropolis.tech/admin`
2. Click "Dashboard" tab
3. Scroll to "Response Times" graph
4. Interpret chart:
   - **Green line**: P50 (median)
   - **Orange line**: P95 (95th percentile)
   - **X-axis**: Time (hourly or daily buckets)
   - **Y-axis**: Seconds

#### Alert Thresholds (Dashboard)
- P50 > 3600s (1 hour): ⚠️ Slow response times
- P95 > 7200s (2 hours): ❌ Critical bottleneck
- Queue depth > 50: ⚠️ Backlog accumulating
- Error rate > 5%: ❌ High failure rate

## Interfaces & Data

### Health Check Response (TypeScript)
```typescript
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;  // milliseconds
  timestamp: string;  // ISO 8601
  checks: {
    bot: 'connected' | 'disconnected';
    database: 'ok' | 'error';
    webServer: 'running' | 'stopped';
  };
  metrics: {
    ws_ping_ms: number;
    ws_ping_delta_ms: number;
    api_latency_p50_ms: number;
    api_latency_p95_ms: number;
  };
}
```

### Health Endpoint Response (JSON)
```json
{
  "status": "healthy",
  "uptime": 630000,
  "timestamp": "2025-10-30T12:00:00Z",
  "checks": {
    "database": "ok",
    "discord": "connected",
    "webServer": "running"
  },
  "metrics": {
    "ws_ping_ms": 42,
    "api_latency_ms": 3
  }
}
```

## Ops & Recovery

### Triage Playbook: Bot Down

**Symptoms**: `/health` command not responding, PM2 shows "stopped" or "errored"

**Resolution**:
```bash
# 1. Check PM2 status
pm2 status pawtropolis

# 2. If stopped, check logs
pm2 logs pawtropolis --lines 100 --err

# 3. Restart bot
pm2 restart pawtropolis

# 4. Monitor logs for successful startup
pm2 logs pawtropolis --lines 20 | grep "Bot ready"

# 5. Verify health
# Run /health in Discord
```

### Triage Playbook: High WS Ping

**Symptoms**: WS ping > 200ms consistently

**Resolution**:
```bash
# 1. Check network connectivity
ping discord.com

# 2. Check Discord status page
curl -s https://discordstatus.com/api/v2/status.json | jq .status.indicator
# Expected: "none" (no incidents)

# 3. Restart bot to reconnect
pm2 restart pawtropolis

# 4. Monitor WS ping
# Run /health every 30 seconds, observe trend
```

### Triage Playbook: Database Corruption

**Symptoms**: Database health check fails

**Resolution**:
```bash
# 1. Stop bot
pm2 stop pawtropolis

# 2. Run integrity check
sqlite3 data/data.db "PRAGMA integrity_check"

# 3. If corrupted, restore from backup
# See: 11_Runtime_Database_Recovery_Guide.md

# 4. Restart bot
pm2 start pawtropolis

# 5. Verify health
/health
```

## Security & Privacy

### Health Endpoint Access Control
- `GET /api/health`: No authentication required (safe to expose)
- Returns only aggregate metrics, no PII
- No sensitive configuration exposed

### PM2 Access Control
- SSH key-based authentication only
- No password authentication
- PM2 logs may contain user IDs (redact before sharing)

## FAQ / Gotchas

**Q: What does "WS ping -1ms" mean?**
A: Current ping is 1ms faster than the 5-minute rolling average (improvement).

**Q: Why is WS ping sometimes -1 (negative)?**
A: Discord.js returns -1 when heartbeat not yet received. Wait 30 seconds and retry.

**Q: How often should I run /health?**
A: Manually: As needed. Automated: Every 5 minutes via monitoring service.

**Q: What's the difference between "degraded" and "down"?**
A:
- **Degraded**: Some components failing but bot still operational
- **Down**: Bot completely offline, all checks failing

**Q: Can I disable health checks?**
A: No, health checks are always available. To hide from users, restrict `/health` command to admin-only.

## Changelog

- 2025-10-30: Initial creation with complete health check procedures
