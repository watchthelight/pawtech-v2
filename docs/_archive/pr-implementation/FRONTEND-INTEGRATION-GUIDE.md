# Frontend Integration Guide - Identity & Charts

## Status

**Completed:**
- ✅ Tools page redesigned and separated (website/tools/)
- ✅ Color system upgraded (dark theme, chips, focus rings)
- ✅ Identity resolution system added to app.js (resolveUsers, userTag, identityCache)
- ✅ Chart rendering functions added to app.js (renderActivityChart, renderLatencyChart)
- ✅ CSS styles for user-tag and chart-card added to app.css
- ✅ Chart.js CDN loaded in index.html

**Remaining Integration:**

### 1. Dashboard View Integration

In `app.js` around line 189 (renderDashboard function), add charts after the cards section:

```javascript
async function renderDashboard() {
  const el = $("#view-dashboard");
  el.innerHTML = `<span class="spinner"></span>`;

  try {
    const guildId = window.GUILD_ID || "896070888594759740";

    const [metricsData, logsData] = await Promise.all([
      API.get("/api/metrics", { guild_id: guildId, limit: 10 }),
      API.get("/api/logs", { guild_id: guildId, limit: 10 }),
    ]);

    const metrics = metricsData?.items || [];
    const logs = logsData?.items || [];

    // Resolve identities for logs
    const logModIds = [...new Set(logs.map(x => x.moderator_id).filter(Boolean))];
    const idMap = await resolveUsers(guildId, logModIds);

    el.innerHTML = `
      <h2>Dashboard</h2>

      <!-- Existing cards here -->
      <div class="cards">...</div>

      <!-- ADD CHARTS HERE -->
      <div class="chart-card">
        <h3>Activity (7d)</h3>
        <div class="chart-wrap"><canvas id="ch-activity"></canvas></div>
      </div>
      <div class="chart-card">
        <h3>Latency (7d)</h3>
        <div class="chart-wrap"><canvas id="ch-latency"></canvas></div>
      </div>

      <!-- Recent Activity with identities -->
      <h3>Recent Activity</h3>
      <table class="table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Moderator</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody id="dashboard-logs"></tbody>
      </table>
    `;

    // Render logs table with identities
    const tbody = document.getElementById('dashboard-logs');
    logs.forEach(log => {
      const tr = document.createElement('tr');
      const user = idMap[log.moderator_id] || { display: log.moderator_id, avatar: `https://cdn.discordapp.com/embed/avatars/${(+log.moderator_id % 5)}.png?size=64` };

      tr.innerHTML = `
        <td><span class="chip ${log.action}">${log.action}</span></td>
        <td></td>
        <td>${new Date(log.timestamp).toLocaleString()}</td>
      `;
      tr.children[1].appendChild(userTag(user));
      tbody.appendChild(tr);
    });

    // Render charts
    await Promise.all([
      renderActivityChart(document.getElementById('ch-activity'), guildId),
      renderLatencyChart(document.getElementById('ch-latency'), guildId),
    ]);

  } catch (err) {
    console.error(err);
    el.innerHTML = `<p>Error loading dashboard</p>`;
  }
}
```

### 2. Logs View Integration

In `renderLogs()` function, add identity resolution:

```javascript
async function renderLogs() {
  // ... existing code ...

  const guildId = window.GUILD_ID || "896070888594759740";
  const logsData = await API.get("/api/logs", { guild_id: guildId, limit: 100 });
  const logs = logsData?.items || [];

  // Resolve identities
  const modIds = [...new Set(logs.map(x => x.moderator_id).filter(Boolean))];
  const idMap = await resolveUsers(guildId, modIds);

  // Render table with identities
  logs.forEach(log => {
    const tr = document.createElement('tr');
    const user = idMap[log.moderator_id] || { display: log.moderator_id, avatar: `https://cdn.discordapp.com/embed/avatars/${(+log.moderator_id % 5)}.png?size=64` };

    tr.innerHTML = `
      <td>${log.id}</td>
      <td><span class="chip ${log.action}">${log.action}</span></td>
      <td></td>
      <td>${new Date(log.timestamp).toLocaleString()}</td>
    `;
    tr.children[2].appendChild(userTag(user));
    tbody.appendChild(tr);
  });
}
```

### 3. Metrics View Integration

Similarly add identity resolution to metrics leaderboard.

## Testing

1. Open /admin/ when logged in
2. Check Dashboard tab - should see two charts
3. Check logs table - should see avatars + display names
4. Check that chips are colored (approve=green, reject=red, etc.)
5. Verify focus rings are visible when tabbing through UI

## Backend API Requirements

These endpoints must be working:
- GET /api/users/resolve?guild_id=X&ids=1,2,3
- GET /api/metrics/timeseries?guild_id=X&window=7d&bucket=1h
- GET /api/metrics/latency?guild_id=X&window=7d&bucket=1h
- GET /api/logs?guild_id=X&limit=100
- GET /api/metrics?guild_id=X&limit=100
