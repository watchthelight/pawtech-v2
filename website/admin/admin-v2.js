// Admin Panel - Standalone
import { extractSeedWithFallback, buildDarkPalette } from "./theme-v2.js?v=1729622400";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const GUILD_ID = "896070888594759740"; // Default guild

// Store chart instances for theme updates
let chartInstances = {
  activity: null,
  latency: null,
};

// ---- API Helper --------------------------------------------------------------

const API = {
  async get(path, params = {}) {
    const url = new URL(path, location.origin);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }

    const res = await fetch(url, { credentials: "include" });

    // Handle auth errors
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Unauthorized: ${res.status}`);
    }

    if (!res.ok) {
      throw new Error(`GET ${path} → ${res.status}`);
    }

    return res.headers.get("content-type")?.includes("application/json") ? res.json() : res.text();
  },

  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Handle auth errors
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Unauthorized: ${res.status}`);
    }

    if (!res.ok) {
      throw new Error(`POST ${path} → ${res.status}`);
    }

    return res.json();
  },
};

// ---- Password Modal Helper ---------------------------------------------------

/**
 * Show password modal and return promise with password
 * @returns {Promise<string|null>} Password if entered, null if cancelled
 */
function showPasswordModal() {
  return new Promise((resolve) => {
    // Create modal overlay
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal glass">
        <div class="modal-header">
          <h3>🔐 Verification Required</h3>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="modal-description">This action requires the reset password to prevent accidental changes.</p>
          <label class="modal-label">
            <span>Reset Password</span>
            <input type="password" id="modal-password-input" class="modal-input" placeholder="Enter reset password" autocomplete="off" />
          </label>
          <p class="modal-hint">Same password used for <code>/gate reset</code> and <code>/resetdata</code></p>
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary modal-cancel">Cancel</button>
          <button class="btn btn--primary modal-confirm">Confirm</button>
        </div>
      </div>
    `;

    // Add to DOM
    document.body.appendChild(overlay);

    const input = overlay.querySelector("#modal-password-input");
    const confirmBtn = overlay.querySelector(".modal-confirm");
    const cancelBtn = overlay.querySelector(".modal-cancel");
    const closeBtn = overlay.querySelector(".modal-close");

    // Focus input
    setTimeout(() => input.focus(), 100);

    // Handle confirm
    const handleConfirm = () => {
      const password = input.value.trim();
      overlay.remove();
      resolve(password || null);
    };

    // Handle cancel
    const handleCancel = () => {
      overlay.remove();
      resolve(null);
    };

    // Event listeners
    confirmBtn.onclick = handleConfirm;
    cancelBtn.onclick = handleCancel;
    closeBtn.onclick = handleCancel;
    overlay.onclick = (e) => {
      if (e.target === overlay) handleCancel();
    };

    // Enter key to confirm
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };
  });
}

// ---- Identity Resolution & Caching -------------------------------------------

const identityCache = new Map();
const ID_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function resolveUsers(guildId, ids) {
  const now = Date.now();
  const toFetch = [];
  const result = {};

  ids.forEach((id) => {
    const hit = identityCache.get(id);
    if (hit && now - hit.t < ID_TTL_MS) {
      result[id] = hit.v;
    } else {
      toFetch.push(id);
    }
  });

  if (toFetch.length) {
    try {
      const url = `/api/users/resolve?guild_id=${encodeURIComponent(guildId)}&ids=${toFetch.join(",")}`;
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        (data.items || []).forEach((u) => {
          const v = {
            display: u.display_name || u.global_name || u.username || u.user_id,
            avatar:
              u.avatar_url ||
              `https://cdn.discordapp.com/embed/avatars/${+u.user_id % 5}.png?size=64`,
            id: u.user_id,
          };
          identityCache.set(u.user_id, { v, t: now });
          result[u.user_id] = v;
        });
      }
    } catch (err) {
      console.error("[resolveUsers] error:", err);
    }
  }

  return result;
}

function userTag(user) {
  const span = document.createElement("span");
  span.className = "user-tag";
  span.innerHTML = `
    <img class="avatar" src="${user.avatar}" alt="" />
    <span class="display">${escapeHtml(user.display)}</span>
  `;
  return span;
}

function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

// ---- Role Resolution & Caching -----------------------------------------------

const roleCache = new Map(); // key: `${guildId}:${roleId}` -> { v, t }
const ROLE_TTL_MS = 60 * 1000; // 60 seconds

async function resolveRoles(guildId, ids) {
  const now = Date.now();
  const toFetch = [];
  const result = {};

  ids.forEach((id) => {
    const key = `${guildId}:${id}`;
    const hit = roleCache.get(key);
    if (hit && now - hit.t < ROLE_TTL_MS) result[id] = hit.v;
    else toFetch.push(id);
  });

  if (toFetch.length) {
    try {
      const res = await fetch(
        `/api/roles/resolve?guild_id=${encodeURIComponent(guildId)}&ids=${toFetch.join(",")}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        (data.items || []).forEach((r) => {
          const v = {
            id: r.role_id,
            name: r.name,
            color: r.color_hex || null,
            emoji: r.emoji || null,
          };
          roleCache.set(`${guildId}:${r.role_id}`, { v, t: now });
          result[r.role_id] = v;
        });
      }
    } catch (err) {
      console.error("[resolveRoles] error:", err);
    }
  }
  return result;
}

// Tiny safe markdown renderer (supports **bold**, *italic*, `code`, [text](url))
function renderMarkdown(md = "") {
  if (!md) return '<p class="muted"><em>Not set</em></p>';
  const esc = (s) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const link = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let html = esc(md)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(link, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  return `<p>${html}</p>`;
}

function rolePill(role) {
  const color = role.color || null;
  const swatch = color ? `style="--role-color:${color}"` : "";
  const emoji = role.emoji ? `<span class="role-emoji">${role.emoji}</span>` : "";
  const name = escapeHtml(role.name || role.id);
  return `
    <span class="role-pill" ${swatch}>
      <span class="role-swatch" ${swatch}></span>
      ${emoji}<span class="role-name">${name}</span>
    </span>
  `;
}

// ---- Pretty Action Labels ----------------------------------------------------

const ACTION_LABELS = {
  app_submitted: "Application Submitted",
  claim: "Application Claimed",
  approve: "Application Approved",
  reject: "Application Rejected",
  perm_reject: "Application Rejected (Permanent)",
  kick: "User Kicked",
  modmail_open: "Modmail Opened",
  modmail_close: "Modmail Closed",
  member_join: "Member Joined",
  need_info: "Additional Info Requested",
  unclaim: "Application Unclaimed",
};

function prettyAction(a) {
  return ACTION_LABELS[a] || a;
}

// ========= Blur Text Utility (vanilla) =========
function mountBlurText(el, { delay = 60, duration = 0.6 } = {}) {
  if (!el || el.dataset.btReady === "1") return;
  const text = el.textContent;
  el.textContent = "";
  const frag = document.createDocumentFragment();
  [...text].forEach((ch) => {
    const span = document.createElement("span");
    span.className = "bt-char";
    span.textContent = ch;
    frag.appendChild(span);
  });
  el.appendChild(frag);
  el.dataset.btReady = "1";

  // Skip if GSAP missing or reduced motion
  const rmr = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof gsap === "undefined" || rmr) return;

  gsap.to(el.querySelectorAll(".bt-char"), {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    ease: "power3.out",
    duration,
    stagger: delay / 1000, // ms → s spacing between characters
  });
}

function autoMountBlurText(root = document) {
  root.querySelectorAll(".blur-text").forEach((el) => {
    // Animate when in view
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            mountBlurText(el, {
              delay: Number(el.dataset.btDelay || 40),
              duration: Number(el.dataset.btDuration || 0.6),
            });
            obs.unobserve(el);
          }
        });
      },
      { threshold: 0.25 }
    );
    io.observe(el);
  });
}

// ---- Chart Rendering ---------------------------------------------------------

async function renderActivityChart(canvas, guildId) {
  try {
    const url = `/api/metrics/timeseries?guild_id=${encodeURIComponent(guildId)}&window=30d&bucket=1d`;
    const res = await fetch(url, { credentials: "include" });
    const data = await res.json();

    const labels = data.buckets.map((b) =>
      new Date(b.t).toLocaleDateString([], { month: "short", day: "numeric" })
    );

    return new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: prettyAction("app_submitted"),
            data: data.buckets.map((b) => b.submissions || 0),
            cubicInterpolationMode: "monotone",
            tension: 0.38,
            spanGaps: true,
            borderColor: getThemeColor("graph-primary", "#5aa7ff"),
            backgroundColor: withAlpha(getThemeColor("graph-primary", "#5aa7ff"), 0.1),
          },
          {
            label: prettyAction("claim"),
            data: data.buckets.map((b) => b.mod_actions["claim"] || 0),
            cubicInterpolationMode: "monotone",
            tension: 0.38,
            spanGaps: true,
            borderColor: getThemeColor("graph-success", "#24a148"),
            backgroundColor: withAlpha(getThemeColor("graph-success", "#24a148"), 0.1),
          },
          {
            label: prettyAction("approve"),
            data: data.buckets.map((b) => b.mod_actions["approve"] || 0),
            cubicInterpolationMode: "monotone",
            tension: 0.38,
            spanGaps: true,
            borderColor: getThemeColor("graph-secondary", "#2db06f"),
            backgroundColor: withAlpha(getThemeColor("graph-secondary", "#2db06f"), 0.1),
          },
          {
            label: prettyAction("reject"),
            data: data.buckets.map((b) => b.mod_actions["reject"] || 0),
            cubicInterpolationMode: "monotone",
            tension: 0.38,
            spanGaps: true,
            borderColor: getThemeColor("graph-danger", "#e3b341"),
            backgroundColor: withAlpha(getThemeColor("graph-danger", "#e3b341"), 0.1),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { labels: { color: getThemeColor("text", "#e7ecf3") } },
        },
        scales: {
          x: {
            ticks: {
              color: getThemeColor("muted", "#a9b0c0"),
              callback: function (value, index, ticks) {
                // Show label every ~7 days
                return index % 7 === 0 ? this.getLabelForValue(value) : "";
              },
            },
            grid: { color: getThemeColor("border", "#2a303b") },
          },
          y: {
            ticks: { color: getThemeColor("muted", "#a9b0c0") },
            grid: { color: getThemeColor("border", "#2a303b") },
            beginAtZero: true,
          },
        },
      },
    });
  } catch (err) {
    console.error("[renderActivityChart] error:", err);
  }
}

async function renderLatencyChart(canvas, guildId) {
  try {
    const url = `/api/metrics/latency?guild_id=${encodeURIComponent(guildId)}&window=30d&bucket=1d`;
    const res = await fetch(url, { credentials: "include" });
    const data = await res.json();

    const labels = data.buckets.map((b) =>
      new Date(b.t).toLocaleDateString([], { month: "short", day: "numeric" })
    );

    return new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Median Response (P50)",
            data: data.buckets.map((b) => b.p50_response_time_s || 0),
            cubicInterpolationMode: "monotone",
            tension: 0.38,
            spanGaps: true,
            borderColor: getThemeColor("graph-primary", "#5865F2"),
            backgroundColor: withAlpha(getThemeColor("graph-primary", "#5865F2"), 0.1),
          },
          {
            label: "95th Percentile (P95)",
            data: data.buckets.map((b) => b.p95_response_time_s || 0),
            cubicInterpolationMode: "monotone",
            tension: 0.38,
            spanGaps: true,
            borderColor: getThemeColor("graph-tertiary", "#EB459E"),
            backgroundColor: withAlpha(getThemeColor("graph-tertiary", "#EB459E"), 0.1),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { labels: { color: getThemeColor("text", "#e7ecf3") } },
        },
        scales: {
          x: {
            ticks: {
              color: getThemeColor("muted", "#a9b0c0"),
              callback: function (value, index, ticks) {
                // Show label every ~7 days
                return index % 7 === 0 ? this.getLabelForValue(value) : "";
              },
            },
            grid: { color: getThemeColor("border", "#2a303b") },
          },
          y: {
            ticks: {
              color: getThemeColor("muted", "#a9b0c0"),
              callback: function (value) {
                return value + "s";
              },
            },
            grid: { color: getThemeColor("border", "#2a303b") },
            beginAtZero: true,
          },
        },
      },
    });
  } catch (err) {
    console.error("[renderLatencyChart] error:", err);
  }
}

// ---- Views -------------------------------------------------------------------

async function renderDashboard() {
  const el = $("#view-dashboard");
  el.innerHTML = '<div class="spinner-wrap"><span class="spinner"></span></div>';

  try {
    const [metricsRes, logsRes] = await Promise.all([
      fetch(`/api/metrics?guild_id=${GUILD_ID}&limit=10`, { credentials: "include" }),
      fetch(`/api/logs?guild_id=${GUILD_ID}&limit=10`, { credentials: "include" }),
    ]);

    const metricsData = await metricsRes.json();
    const logsData = await logsRes.json();

    const metrics = metricsData.items || [];
    const logs = logsData.items || [];
    const top = metrics[0];

    // Resolve identities for logs
    const modIds = [...new Set(logs.map((x) => x.moderator_id).filter(Boolean))];
    const idMap = await resolveUsers(GUILD_ID, modIds);

    el.innerHTML = `
      <h2 style="margin-bottom: 1.5rem;">Dashboard</h2>

      <div class="cards">
        <div class="card glass glass--card" data-glass="lens" data-intensity="0.5">
          <h3>Top Moderator</h3>
          <div class="card-value">${top ? top.total_accepts : "—"}</div>
          <div class="card-label">${top ? "approvals" : "No data"}</div>
        </div>
        <div class="card glass glass--card" data-glass="lens" data-intensity="0.5">
          <h3>Response Time (P50)</h3>
          <div class="card-value">${top && top.p50_response_time_s ? Math.round(top.p50_response_time_s) + "s" : "—"}</div>
          <div class="card-label">median</div>
        </div>
        <div class="card glass glass--card" data-glass="lens" data-intensity="0.5">
          <h3>Total Actions</h3>
          <div class="card-value">${logs.length}</div>
          <div class="card-label">recent</div>
        </div>
      </div>

      <div class="chart-card glass glass--card" data-glass="bar" data-intensity="0.4">
        <h3>Activity (30 days)</h3>
        <div class="chart-wrap"><canvas id="ch-activity"></canvas></div>
      </div>

      <div class="chart-card glass glass--card" data-glass="bar" data-intensity="0.4">
        <h3>Response Time Latency (30 days)</h3>
        <div class="chart-wrap"><canvas id="ch-latency"></canvas></div>
      </div>

      <h3 style="margin: 2rem 0 1rem;">Recent Activity</h3>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Moderator</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody id="recent-logs"></tbody>
      </table>
    `;

    // Populate logs table
    const tbody = $("#recent-logs");
    logs.forEach((log) => {
      const tr = document.createElement("tr");

      // app_submitted is performed BY the applicant, not a moderator
      const isApplicantAction = log.action === "app_submitted" || log.action === "member_join";

      const user =
        !isApplicantAction && log.moderator_id
          ? idMap[log.moderator_id] || {
              display: log.moderator_id,
              avatar: `https://cdn.discordapp.com/embed/avatars/${+log.moderator_id % 5}.png?size=64`,
            }
          : null;

      const actionClass = log.action.replace("_", "-");
      tr.innerHTML = `
        <td><span class="chip ${actionClass}">${prettyAction(log.action)}</span></td>
        <td></td>
        <td>${new Date(log.timestamp).toLocaleString()}</td>
      `;

      // Only add moderator tag if this is a moderator action
      if (user) {
        tr.children[1].appendChild(userTag(user));
      } else {
        tr.children[1].textContent = "—";
      }

      tbody.appendChild(tr);
    });

    // Render charts and store instances
    const [activityChart, latencyChart] = await Promise.all([
      renderActivityChart($("#ch-activity"), GUILD_ID),
      renderLatencyChart($("#ch-latency"), GUILD_ID),
    ]);

    chartInstances.activity = activityChart;
    chartInstances.latency = latencyChart;
  } catch (err) {
    console.error("[renderDashboard] error:", err);
    el.innerHTML = '<div class="empty">Error loading dashboard. Please try refreshing.</div>';
  }
}

async function renderLogs() {
  const el = $("#view-logs");
  el.innerHTML = '<div class="spinner-wrap"><span class="spinner"></span></div>';

  try {
    const res = await fetch(`/api/logs?guild_id=${GUILD_ID}&limit=100`, { credentials: "include" });
    const data = await res.json();
    const logs = data.items || [];

    // Resolve identities for both moderators AND applicants
    const modIds = [...new Set(logs.map((x) => x.moderator_id).filter(Boolean))];
    const applicantIds = [...new Set(logs.map((x) => x.applicant_id).filter(Boolean))];
    const allIds = [...new Set([...modIds, ...applicantIds])];
    const idMap = await resolveUsers(GUILD_ID, allIds);

    el.innerHTML = `
      <h2 style="margin-bottom: 1.5rem;">Action Logs</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Action</th>
            <th>Moderator</th>
            <th>Applicant</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody id="logs-table"></tbody>
      </table>
    `;

    const tbody = $("#logs-table");
    logs.forEach((log) => {
      const tr = document.createElement("tr");

      // app_submitted is performed BY the applicant, not a moderator
      const isApplicantAction = log.action === "app_submitted";

      const moderator =
        !isApplicantAction && log.moderator_id
          ? idMap[log.moderator_id] || {
              display: log.moderator_id,
              avatar: `https://cdn.discordapp.com/embed/avatars/${+log.moderator_id % 5}.png?size=64`,
            }
          : null;

      const applicant = log.applicant_id
        ? idMap[log.applicant_id] || {
            display: log.applicant_id,
            avatar: `https://cdn.discordapp.com/embed/avatars/${+log.applicant_id % 5}.png?size=64`,
          }
        : null;

      const actionClass = log.action.replace("_", "-");
      tr.innerHTML = `
        <td>${log.app_code || log.id}</td>
        <td><span class="chip ${actionClass}">${prettyAction(log.action)}</span></td>
        <td></td>
        <td></td>
        <td>${new Date(log.timestamp).toLocaleString()}</td>
      `;

      // Moderator column: blank for app_submitted
      if (moderator) {
        tr.children[2].appendChild(userTag(moderator));
      } else {
        tr.children[2].textContent = "—";
      }

      // Applicant column
      if (applicant) {
        tr.children[3].appendChild(userTag(applicant));
      } else {
        tr.children[3].textContent = "—";
      }

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("[renderLogs] error:", err);
    el.innerHTML = '<div class="empty">Error loading logs. Please try refreshing.</div>';
  }
}

async function renderMetrics() {
  const el = $("#view-metrics");
  el.innerHTML = '<div class="spinner-wrap"><span class="spinner"></span></div>';

  try {
    const res = await fetch(`/api/metrics?guild_id=${GUILD_ID}&limit=50`, {
      credentials: "include",
    });
    const data = await res.json();
    const metrics = data.items || [];

    // Resolve identities
    const modIds = [...new Set(metrics.map((x) => x.moderator_id).filter(Boolean))];
    const idMap = await resolveUsers(GUILD_ID, modIds);

    el.innerHTML = `
      <h2 style="margin-bottom: 1.5rem;">Moderator Performance</h2>
      <table>
        <thead>
          <tr>
            <th>Moderator</th>
            <th>Accepts</th>
            <th>Rejects</th>
            <th>P50 (s)</th>
            <th>P95 (s)</th>
          </tr>
        </thead>
        <tbody id="metrics-table"></tbody>
      </table>
    `;

    const tbody = $("#metrics-table");
    // Filter to only show actual moderators (users with at least one moderation action)
    const actualModerators = metrics.filter(
      (m) => (m.total_accepts || 0) > 0 || (m.total_rejects || 0) > 0 || (m.total_claims || 0) > 0
    );

    actualModerators.forEach((metric) => {
      const tr = document.createElement("tr");
      const user = idMap[metric.moderator_id] || {
        display: metric.moderator_id,
        avatar: `https://cdn.discordapp.com/embed/avatars/${+metric.moderator_id % 5}.png?size=64)`,
      };

      tr.innerHTML = `
        <td></td>
        <td>${metric.total_accepts || 0}</td>
        <td>${metric.total_rejects || 0}</td>
        <td>${metric.p50_response_time_s ? Math.round(metric.p50_response_time_s) : "—"}</td>
        <td>${metric.p95_response_time_s ? Math.round(metric.p95_response_time_s) : "—"}</td>
      `;
      tr.children[0].appendChild(userTag(user));
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("[renderMetrics] error:", err);
    el.innerHTML = '<div class="empty">Error loading metrics. Please try refreshing.</div>';
  }
}

// ---- Config View -------------------------------------------------------------

async function renderConfig() {
  const el = $("#view-config");
  const guildId = GUILD_ID;
  el.innerHTML = `<span class="spinner" aria-label="Loading config"></span>`;

  try {
    const cfg = await API.get("/api/config", { guild_id: guildId });

    const loggingStatus =
      cfg.health?.logging_channel_ok && cfg.health?.logging_perms_ok
        ? `<span class="health health--ok">✓ Logging channel verified</span>`
        : `<span class="health health--warn">⚠ Logging channel needs attention</span>`;

    const flagsStatus =
      cfg.health?.flags_channel_ok && cfg.health?.flags_perms_ok
        ? `<span class="health health--ok">✓ Flags channel verified</span>`
        : cfg.flags_channel_id
          ? `<span class="health health--warn">⚠ Flags channel needs attention</span>`
          : `<span class="health health--muted">ℹ No flags channel configured</span>`;

    el.innerHTML = `
      <h2 class="view-title">Configuration</h2>

      <div class="cfg-grid">
        <!-- Left: Messages Editor -->
        <section class="card">
          <h3 class="card__title">Gate Message</h3>
          <div class="msg-preview">${renderMarkdown(cfg.gate_message_md)}</div>
          <p class="hint" style="margin-top: 0.5rem;">Hardcoded in bot - shows verification prompt</p>

          <hr class="sep"/>

          <h3 class="card__title">Welcome Message</h3>
          <p class="hint">Supports markdown and template variables like {applicant.mention}</p>
          <textarea id="welcome-template" class="cfg-textarea" rows="6" placeholder="Enter custom welcome message...">${escapeHtml(cfg.welcome_template || "")}</textarea>
          <button class="btn btn--secondary btn-sm" id="preview-welcome" type="button" style="margin-top: 0.5rem;">Preview</button>
          <div id="welcome-preview" class="msg-preview" style="display: none; margin-top: 0.5rem;"></div>
        </section>

        <!-- Right: Roles + Logging -->
        <section class="card">
          <h3 class="card__title">Moderator Roles</h3>
          <p class="hint">Enter role IDs (one per line). Names will auto-resolve.</p>
          <div id="role-inputs"></div>
          <button class="btn btn--secondary btn-sm" id="add-role" type="button" style="margin-top: 0.5rem;">+ Add Role</button>

          <hr class="sep"/>

          <h3 class="card__title">Logging Channel</h3>
          <p class="hint">Set a channel ID to override the default <code>LOGGING_CHANNEL</code>.</p>

          <label>
            <span>Channel ID</span>
            <input type="text" id="logging-channel" placeholder="1234567890" value="${cfg.logging_channel_id ?? ""}" inputmode="numeric" />
          </label>

          <hr class="sep"/>

          <h3 class="card__title">Silent-Since-Join Flagger (PR8)</h3>
          <p class="hint">Flag accounts that stay silent for N days before first message.</p>

          <label>
            <span>Flags Channel ID</span>
            <input type="text" id="flags-channel" placeholder="1234567890" value="${cfg.flags_channel_id ?? ""}" inputmode="numeric" />
          </label>

          <label style="margin-top: 0.75rem;">
            <span>Silent Days Threshold (7-365)</span>
            <input type="number" id="silent-days" placeholder="90" value="${cfg.silent_first_msg_days ?? 90}" min="7" max="365" />
          </label>

          <div class="inline-health" style="margin-top: 0.5rem;">${flagsStatus}</div>

          <div class="row" style="margin-top: 1rem;">
            <button class="btn btn--primary" id="save-config" type="button">Save All</button>
            <button class="btn btn--secondary" id="cfg-reload" type="button">Reload</button>
            <div class="grow"></div>
            <div class="inline-health">${loggingStatus} <span class="dot"></span>
              <span class="muted">${cfg.mod_role_ids?.length || 0} mod role(s)</span>
            </div>
          </div>
          <p id="cfg-status" class="status-line" aria-live="polite"></p>
        </section>
      </div>
    `;

    // Render role inputs
    const roleInputsContainer = $("#role-inputs");
    const currentRoleIds = cfg.mod_role_ids || [];

    async function renderRoleInputs() {
      roleInputsContainer.innerHTML = "";
      const roleIds = Array.from($$(".role-input"))
        .map((input) => input.value.trim())
        .filter(Boolean);
      const allIds = [...new Set([...currentRoleIds, ...roleIds])];

      if (allIds.length === 0) {
        roleInputsContainer.innerHTML = `<p class="muted">No roles configured. Click "+ Add Role" to add one.</p>`;
        return;
      }

      // Resolve current roles
      const resolvedRoles = await resolveRoles(guildId, allIds);

      for (const roleId of allIds) {
        const role = resolvedRoles[roleId];
        const div = document.createElement("div");
        div.className = "role-input-row";
        div.innerHTML = `
          <input type="text" class="role-input" value="${roleId}" placeholder="Role ID" />
          <span class="role-status">${role ? rolePill(role) : '<span class="muted">Resolving...</span>'}</span>
          <button class="btn-icon" type="button" data-remove="${roleId}">×</button>
        `;
        roleInputsContainer.appendChild(div);

        // Handle input changes
        const input = div.querySelector(".role-input");
        const status = div.querySelector(".role-status");
        let timeout;
        input.oninput = () => {
          clearTimeout(timeout);
          status.innerHTML = '<span class="muted">...</span>';
          timeout = setTimeout(async () => {
            const newId = input.value.trim();
            if (!newId) {
              status.innerHTML = "";
              return;
            }
            try {
              const resolved = await resolveRoles(guildId, [newId]);
              if (resolved[newId]) {
                status.innerHTML = rolePill(resolved[newId]);
              } else {
                status.innerHTML = '<span class="err">Invalid role ID</span>';
              }
            } catch (e) {
              status.innerHTML = '<span class="err">Error</span>';
            }
          }, 500);
        };

        // Handle remove
        const removeBtn = div.querySelector("[data-remove]");
        removeBtn.onclick = () => {
          div.remove();
        };
      }
    }

    await renderRoleInputs();

    // Add role button
    $("#add-role").onclick = () => {
      const div = document.createElement("div");
      div.className = "role-input-row";
      div.innerHTML = `
        <input type="text" class="role-input" placeholder="Role ID" />
        <span class="role-status"></span>
        <button class="btn-icon" type="button" data-remove="new">×</button>
      `;
      roleInputsContainer.appendChild(div);

      const input = div.querySelector(".role-input");
      const status = div.querySelector(".role-status");
      const removeBtn = div.querySelector("[data-remove]");

      let timeout;
      input.oninput = () => {
        clearTimeout(timeout);
        status.innerHTML = '<span class="muted">...</span>';
        timeout = setTimeout(async () => {
          const newId = input.value.trim();
          if (!newId) {
            status.innerHTML = "";
            return;
          }
          try {
            const resolved = await resolveRoles(guildId, [newId]);
            if (resolved[newId]) {
              status.innerHTML = rolePill(resolved[newId]);
            } else {
              status.innerHTML = '<span class="err">Invalid role ID</span>';
            }
          } catch (e) {
            status.innerHTML = '<span class="err">Error</span>';
          }
        }, 500);
      };

      removeBtn.onclick = () => div.remove();
      input.focus();
    };

    // Preview welcome message
    $("#preview-welcome").onclick = () => {
      const template = $("#welcome-template").value;
      const preview = $("#welcome-preview");
      if (template) {
        preview.innerHTML = renderMarkdown(template);
        preview.style.display = "block";
      } else {
        preview.style.display = "none";
      }
    };

    // Save all
    const status = $("#cfg-status");
    $("#save-config").onclick = async () => {
      const btn = $("#save-config");
      status.textContent = "";

      // Show password modal
      const password = await showPasswordModal();
      if (!password) {
        status.className = "status-line";
        status.textContent = "Save cancelled";
        return;
      }

      btn.disabled = true;
      btn.textContent = "Saving…";

      try {
        const welcomeTemplate = $("#welcome-template").value.trim() || null;
        const loggingChannelId = $("#logging-channel").value.trim() || null;
        const flagsChannelId = $("#flags-channel").value.trim() || null;
        const silentDays = parseInt($("#silent-days").value, 10);
        const roleIds = Array.from($$(".role-input"))
          .map((input) => input.value.trim())
          .filter(Boolean);

        // Validate silent days threshold
        if (silentDays && (silentDays < 7 || silentDays > 365)) {
          status.className = "status-line err";
          status.textContent = "✗ Silent days threshold must be between 7 and 365";
          return;
        }

        await API.post("/api/config", {
          guild_id: guildId,
          welcome_template: welcomeTemplate,
          logging_channel_id: loggingChannelId,
          flags_channel_id: flagsChannelId,
          silent_first_msg_days: silentDays || 90,
          mod_role_ids: roleIds,
          password: password,
        });

        status.className = "status-line ok";
        status.textContent = "✓ Configuration saved successfully";
        setTimeout(() => renderConfig(), 1000);
      } catch (err) {
        status.className = "status-line err";
        if (err.message.includes("403")) {
          status.textContent = "✗ Incorrect password";
        } else if (err.message.includes("401")) {
          status.textContent = "✗ Password required";
        } else {
          status.textContent = "✗ Failed to save: " + err.message;
        }
      } finally {
        btn.disabled = false;
        btn.textContent = "Save All";
      }
    };

    // Reload
    $("#cfg-reload").onclick = () => renderConfig();
  } catch (e) {
    console.error("[renderConfig] error:", e);
    el.innerHTML = `
      <h2 class="view-title">Configuration</h2>
      <div class="empty-state"><p>Failed to load configuration.</p><p class="muted">${e.message}</p></div>
    `;
  }
}

// ---- Tab Navigation ----------------------------------------------------------

function setupTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;

      // Update tab states
      $$(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // Update view states
      $$(".view").forEach((v) => v.classList.remove("active"));
      $(`#view-${view}`).classList.add("active");

      // Render view
      switch (view) {
        case "dashboard":
          renderDashboard();
          break;
        case "logs":
          renderLogs();
          break;
        case "metrics":
          renderMetrics();
          break;
        case "config":
          renderConfig();
          break;
      }

      // Dispatch event for glass islands to re-mount
      window.dispatchEvent(new CustomEvent("admin-view-change", { detail: { view } }));
    });
  });
}

// ---- Theme Extraction & Application ------------------------------------------

// Theme state
let currentPalette = null;
const THEME_STORAGE_KEY = "pawtropolis-custom-theme-enabled";

/**
 * Check if custom theme is enabled (default: true)
 */
function isCustomThemeEnabled() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

/**
 * Set custom theme enabled state
 */
function setCustomThemeEnabled(enabled) {
  localStorage.setItem(THEME_STORAGE_KEY, enabled.toString());
  updateThemeToggleButton(enabled);

  if (enabled && currentPalette) {
    applyTheme(currentPalette);
  } else if (!enabled) {
    resetToDefaultTheme();
  }
}

/**
 * Update theme toggle button active state
 */
function updateThemeToggleButton(enabled) {
  const toggleBtn = $("#theme-toggle");
  if (toggleBtn) {
    if (enabled) {
      toggleBtn.classList.add("active");
      toggleBtn.title = "Custom theme enabled (click to disable)";
    } else {
      toggleBtn.classList.remove("active");
      toggleBtn.title = "Custom theme disabled (click to enable)";
    }
  }
}

/**
 * Reset to default theme colors
 */
function resetToDefaultTheme() {
  console.log("[theme] Resetting to default theme");

  document.body.classList.add("theme-transition");

  const root = document.documentElement;
  const defaults = {
    bg: "#0b0f14",
    panel: "#121821",
    text: "#e6eaf2",
    muted: "#a6b0c0",
    accent: "#6ea8ff",
    "accent-2": "#9b6bff",
    danger: "#ff5d73",
    ok: "#4cd97b",
    ring: "rgba(110, 168, 255, 0.35)",
    border: "#2a303b",
    brand: "#6ea8ff",
  };

  for (const [key, value] of Object.entries(defaults)) {
    root.style.setProperty(`--${key}`, value);
  }

  // Refresh charts with default colors
  refreshCharts();

  setTimeout(() => {
    document.body.classList.remove("theme-transition");
    console.log("[theme] Default theme applied");
  }, 400);
}

/**
 * Apply theme to CSS variables with smooth transition
 */
function applyTheme(palette) {
  if (!palette) return;

  // Store palette for later use
  currentPalette = palette;

  // Check if custom theme is enabled
  if (!isCustomThemeEnabled()) {
    console.log("[theme] Custom theme disabled, skipping application");
    return;
  }

  console.log("[theme] Applying palette:", {
    source: palette.source,
    seed: palette.seedHex,
    contrastRatios: palette.contrastRatios,
  });

  // Add transition class BEFORE changing variables
  document.body.classList.add("theme-transition");

  const root = document.documentElement;

  // Apply all base theme variables
  const keys = [
    "bg",
    "panel",
    "text",
    "muted",
    "accent",
    "accent2",
    "accent3",
    "ring",
    "border",
    "brand",
    "danger",
    "ok",
    "warning",
  ];

  for (const key of keys) {
    if (palette[key]) {
      const cssKey = key === "accent2" ? "accent-2" : key === "accent3" ? "accent-3" : key;
      root.style.setProperty(`--${cssKey}`, palette[key]);
    }
  }

  // Apply graph colors if available
  if (palette.graph) {
    root.style.setProperty("--graph-primary", palette.graph.primary);
    root.style.setProperty("--graph-secondary", palette.graph.secondary);
    root.style.setProperty("--graph-tertiary", palette.graph.tertiary);
    root.style.setProperty("--graph-success", palette.graph.success);
    root.style.setProperty("--graph-danger", palette.graph.danger);
    root.style.setProperty("--graph-neutral", palette.graph.neutral);
  }

  // Update Chart.js defaults if available
  if (typeof Chart !== "undefined") {
    updateChartDefaults(palette);
  }

  // Refresh charts with new theme colors (only if they exist)
  // On initial load, charts don't exist yet and will be created with correct colors
  refreshCharts();

  // Remove transition class after animation
  setTimeout(() => {
    document.body.classList.remove("theme-transition");
    console.log("[theme] Theme applied successfully (including graphs)");
  }, 400);
}

/**
 * Update Chart.js default colors to match theme
 */
function updateChartDefaults(palette) {
  if (!palette.graph) return;

  try {
    Chart.defaults.color = palette.text;
    Chart.defaults.borderColor = palette.border;
    Chart.defaults.backgroundColor = palette.panel;

    // Update global defaults
    Chart.defaults.plugins.legend.labels.color = palette.text;
    Chart.defaults.scales.linear.ticks.color = palette.muted;
    Chart.defaults.scales.linear.grid.color = palette.border;

    console.log("[theme] Chart.js defaults updated");
  } catch (err) {
    console.warn("[theme] Failed to update Chart.js defaults:", err);
  }
}

/**
 * Refresh existing charts with current theme colors
 * Updates chart colors without re-fetching data
 */
function refreshCharts() {
  console.log("[theme] refreshCharts() called, instances:", {
    activity: !!chartInstances.activity,
    latency: !!chartInstances.latency,
  });

  if (!chartInstances.activity && !chartInstances.latency) {
    console.log("[theme] No charts to refresh yet");
    return;
  }

  try {
    // Activity chart colors
    if (chartInstances.activity) {
      const activityChart = chartInstances.activity;
      activityChart.data.datasets[0].borderColor = getThemeColor("graph-primary", "#5aa7ff");
      activityChart.data.datasets[0].backgroundColor = withAlpha(
        getThemeColor("graph-primary", "#5aa7ff"),
        0.1
      );
      activityChart.data.datasets[1].borderColor = getThemeColor("graph-success", "#24a148");
      activityChart.data.datasets[1].backgroundColor = withAlpha(
        getThemeColor("graph-success", "#24a148"),
        0.1
      );
      activityChart.data.datasets[2].borderColor = getThemeColor("graph-secondary", "#2db06f");
      activityChart.data.datasets[2].backgroundColor = withAlpha(
        getThemeColor("graph-secondary", "#2db06f"),
        0.1
      );
      activityChart.data.datasets[3].borderColor = getThemeColor("graph-danger", "#e3b341");
      activityChart.data.datasets[3].backgroundColor = withAlpha(
        getThemeColor("graph-danger", "#e3b341"),
        0.1
      );

      // Update axis colors
      activityChart.options.plugins.legend.labels.color = getThemeColor("text", "#e7ecf3");
      activityChart.options.scales.x.ticks.color = getThemeColor("muted", "#a9b0c0");
      activityChart.options.scales.x.grid.color = getThemeColor("border", "#2a303b");
      activityChart.options.scales.y.ticks.color = getThemeColor("muted", "#a9b0c0");
      activityChart.options.scales.y.grid.color = getThemeColor("border", "#2a303b");

      activityChart.update("none"); // Update without animation
    }

    // Latency chart colors
    if (chartInstances.latency) {
      const latencyChart = chartInstances.latency;
      latencyChart.data.datasets[0].borderColor = getThemeColor("graph-primary", "#5865F2");
      latencyChart.data.datasets[0].backgroundColor = withAlpha(
        getThemeColor("graph-primary", "#5865F2"),
        0.1
      );
      latencyChart.data.datasets[1].borderColor = getThemeColor("graph-tertiary", "#EB459E");
      latencyChart.data.datasets[1].backgroundColor = withAlpha(
        getThemeColor("graph-tertiary", "#EB459E"),
        0.1
      );

      // Update axis colors
      latencyChart.options.plugins.legend.labels.color = getThemeColor("text", "#e7ecf3");
      latencyChart.options.scales.x.ticks.color = getThemeColor("muted", "#a9b0c0");
      latencyChart.options.scales.x.grid.color = getThemeColor("border", "#2a303b");
      latencyChart.options.scales.y.ticks.color = getThemeColor("muted", "#a9b0c0");
      latencyChart.options.scales.y.grid.color = getThemeColor("border", "#2a303b");

      latencyChart.update("none"); // Update without animation
    }

    console.log("[theme] Charts refreshed with new colors");
  } catch (err) {
    console.warn("[theme] Failed to refresh charts:", err);
  }
}

/**
 * Get theme-aware colors for charts
 * Returns CSS variable value or fallback color
 */
function getThemeColor(varName, fallback) {
  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue(`--${varName}`).trim();
  const result = value || fallback;

  // Debug: log first few calls to see what's happening
  if (!window._themeColorLogCount) window._themeColorLogCount = 0;
  if (window._themeColorLogCount < 5) {
    console.log(
      `[theme] getThemeColor('${varName}') = '${result}' (CSS var: '${value}', fallback: '${fallback}')`
    );
    window._themeColorLogCount++;
  }

  return result;
}

/**
 * Create semi-transparent version of a color
 */
function withAlpha(color, alpha) {
  // Parse rgb(r, g, b) or hex color
  if (color.startsWith("rgb")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  } else if (color.startsWith("#")) {
    const hex = color.replace("#", "");
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

/**
 * DEPRECATED: Old k-means extraction (kept for fallback)
 * @deprecated Use Material Color Utilities instead
 */
async function extractColorsFromImage(imageUrl, sampleSize = 1000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Scale down for performance
        const maxDim = 200;
        const scale = Math.min(maxDim / img.width, maxDim / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = [];

        // Sample pixels (skip transparent and near-black/white)
        const step = Math.max(1, Math.floor(imageData.data.length / (sampleSize * 4)));
        for (let i = 0; i < imageData.data.length; i += step * 4) {
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          const a = imageData.data[i + 3];

          // Skip transparent, near-black, and near-white pixels
          if (a < 128) continue;
          const brightness = (r + g + b) / 3;
          if (brightness < 15 || brightness > 240) continue;

          pixels.push([r, g, b]);
        }

        if (pixels.length === 0) {
          resolve([]);
          return;
        }

        // Simple k-means clustering (k=5)
        const clusters = kMeansClustering(pixels, 5);
        resolve(clusters);
      } catch (err) {
        console.warn("[theme] Canvas extraction failed (CORS?):", err);
        resolve([]);
      }
    };

    img.onerror = () => {
      console.warn("[theme] Image load failed:", imageUrl);
      resolve([]);
    };

    img.src = imageUrl;
  });
}

/**
 * Simple k-means clustering for color extraction
 * @param {Array} pixels - Array of [r, g, b] pixels
 * @param {number} k - Number of clusters
 * @returns {Array} Array of clusters [r, g, b, count]
 */
function kMeansClustering(pixels, k) {
  if (pixels.length === 0) return [];

  // Initialize centroids randomly
  const centroids = [];
  for (let i = 0; i < Math.min(k, pixels.length); i++) {
    centroids.push([...pixels[Math.floor(Math.random() * pixels.length)]]);
  }

  // Iterate 10 times
  for (let iter = 0; iter < 10; iter++) {
    const clusters = Array(centroids.length)
      .fill(0)
      .map(() => []);

    // Assign pixels to nearest centroid
    for (const pixel of pixels) {
      let minDist = Infinity;
      let bestCluster = 0;

      for (let i = 0; i < centroids.length; i++) {
        const dist = colorDistance(pixel, centroids[i]);
        if (dist < minDist) {
          minDist = dist;
          bestCluster = i;
        }
      }

      clusters[bestCluster].push(pixel);
    }

    // Update centroids
    for (let i = 0; i < centroids.length; i++) {
      if (clusters[i].length === 0) continue;

      const sum = clusters[i].reduce(
        (acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]],
        [0, 0, 0]
      );
      centroids[i] = sum.map((v) => Math.round(v / clusters[i].length));
    }
  }

  // Return centroids with cluster sizes
  const clusters = Array(centroids.length)
    .fill(0)
    .map(() => []);
  for (const pixel of pixels) {
    let minDist = Infinity;
    let bestCluster = 0;
    for (let i = 0; i < centroids.length; i++) {
      const dist = colorDistance(pixel, centroids[i]);
      if (dist < minDist) {
        minDist = dist;
        bestCluster = i;
      }
    }
    clusters[bestCluster].push(pixel);
  }

  return centroids.map((c, i) => [...c, clusters[i].length]);
}

/**
 * Calculate color distance (Euclidean in RGB space)
 */
function colorDistance(c1, c2) {
  return Math.sqrt(
    Math.pow(c1[0] - c2[0], 2) + Math.pow(c1[1] - c2[1], 2) + Math.pow(c1[2] - c2[2], 2)
  );
}

/**
 * Load and apply user theme from Discord assets
 * Uses Material Color Utilities for perceptually accurate palette generation
 */
async function loadUserTheme() {
  try {
    console.log("[theme] Loading user assets from /api/users/@me");
    const userData = await API.get("/api/users/@me");

    // Update user chip in header
    const avatarEl = $("#user-avatar");
    const nameEl = $("#user-name");

    if (avatarEl && userData.avatar_url) {
      avatarEl.src = userData.avatar_url;
    }

    if (nameEl) {
      nameEl.textContent = userData.global_name || userData.username;
    }

    // Extract seed with fallback strategy (banner → avatar → accent_color → default)
    console.log("[theme] Extracting seed color...");
    const seedResult = await extractSeedWithFallback(
      userData.banner_url,
      userData.avatar_url,
      userData.accent_color
    );

    console.log("[theme] Seed extracted:", {
      source: seedResult.source,
      rgb: seedResult.rgb,
    });

    // Build dark palette from seed using Material You's HCT
    const palette = buildDarkPalette(seedResult.argb, seedResult.source);

    // Apply palette to CSS variables
    applyTheme(palette);
  } catch (err) {
    console.error("[theme] Failed to load user theme:", err);
    // Silently fail - defaults will be used
  }
}

// ---- Init --------------------------------------------------------------------

async function init() {
  try {
    // Check auth
    const res = await fetch("/auth/me", { credentials: "include" });
    const data = await res.json();

    if (!data.user) {
      // Not authenticated - redirect to login
      window.location.href = "/auth/login";
      return;
    }

    // Load user theme FIRST (must complete before rendering charts)
    await loadUserTheme().catch((err) => console.warn("[theme] Theme load failed:", err));

    // Setup theme toggle button
    const themeToggle = $("#theme-toggle");
    if (themeToggle) {
      // Set initial state
      updateThemeToggleButton(isCustomThemeEnabled());

      // Add click handler
      themeToggle.addEventListener("click", () => {
        const currentState = isCustomThemeEnabled();
        setCustomThemeEnabled(!currentState);
        console.log("[theme] Toggle clicked, new state:", !currentState);
      });
    }

    // Setup tabs
    setupTabs();

    // Render initial view (charts will now use theme colors)
    renderDashboard();

    // Initialize blur text animations
    autoMountBlurText();
  } catch (err) {
    console.error("[init] error:", err);
    document.body.innerHTML =
      '<div class="empty" style="padding: 3rem; text-align: center;">Error loading admin panel. <a href="/auth/login">Login</a></div>';
  }
}

// Start
init();
