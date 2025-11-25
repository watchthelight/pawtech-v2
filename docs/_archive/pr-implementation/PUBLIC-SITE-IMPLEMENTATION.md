# Public Website & Tools Implementation Guide

## Completed

### ✅ Marketing Site Updates
- Changed "Admin Login" button to "Admin" linking to `/admin/`
- Added "Tools" button linking to `/tools/`
- Updated footer with proper links: Status, Changelog, Docs, Privacy, Contact
- Created `/status.html` with live health check integration

## Remaining Tasks

### 1. Create Placeholder Pages

Create these simple HTML pages in `website/` directory:

#### `changelog.html`
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Changelog — Pawtropolis</title>
  <link rel="stylesheet" href="/styles.css">
  <link rel="icon" type="image/png" href="/assets/avatar.png">
</head>
<body>
  <header class="hero" style="min-height: 200px;">
    <div class="hero__content">
      <h1 class="hero__title">Changelog</h1>
      <p class="hero__tagline"><a href="/" style="color: #5865F2;">← Back to Home</a></p>
    </div>
  </header>

  <main id="main-content" style="padding: 2rem; max-width: 800px; margin: 0 auto;">
    <article>
      <h2>v1.1.0 — October 2025</h2>
      <ul>
        <li>Added web control panel with OAuth2 authentication</li>
        <li>Implemented user resolution and caching</li>
        <li>Added public tools page</li>
        <li>SSL certificate setup with Let's Encrypt</li>
      </ul>

      <h2>v1.0.0 — Initial Release</h2>
      <ul>
        <li>Gatekeeper review flow</li>
        <li>Modmail system</li>
        <li>Audit logging</li>
        <li>ModStats analytics</li>
      </ul>
    </article>
  </main>

  <footer class="footer">
    <p class="footer__copyright">&copy; 2025 Pawtropolis</p>
  </footer>
</body>
</html>
```

#### `docs.html`
Simple documentation landing page with links to GitHub, API docs, etc.

#### `privacy.html`
Privacy policy placeholder (customize as needed)

### 2. Public Tools Page

Create `website/tools/` directory with:

#### `tools/index.html`
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tools — Pawtropolis</title>
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/tools/tools.css">
  <link rel="icon" type="image/png" href="/assets/avatar.png">
</head>
<body>
  <header class="hero" style="min-height: 200px;">
    <div class="hero__content">
      <h1 class="hero__title">Discord Tools</h1>
      <p class="hero__tagline">Free utilities for Discord developers and moderators</p>
      <p><a href="/" style="color: #5865F2;">← Back to Home</a></p>
    </div>
  </header>

  <main id="main-content" class="tools-container">
    <!-- Snowflake to Timestamp -->
    <section class="tool-card">
      <h2>Snowflake → Timestamp</h2>
      <p>Convert Discord snowflake IDs to readable timestamps</p>
      <input type="text" id="snowflake-input" placeholder="Enter snowflake ID" aria-label="Snowflake ID input">
      <button onclick="convertSnowflake()" class="btn btn--primary">Convert</button>
      <div id="snowflake-result" class="result"></div>
    </section>

    <!-- ID to Mention -->
    <section class="tool-card">
      <h2>ID → Mention</h2>
      <p>Generate Discord mention syntax from IDs</p>
      <select id="mention-type" aria-label="Mention type">
        <option value="user">User</option>
        <option value="channel">Channel</option>
        <option value="role">Role</option>
      </select>
      <input type="text" id="mention-input" placeholder="Enter ID" aria-label="ID input">
      <button onclick="generateMention()" class="btn btn--primary">Generate</button>
      <div id="mention-result" class="result"></div>
    </section>

    <!-- Embed Color Picker -->
    <section class="tool-card">
      <h2>Embed Color Picker</h2>
      <p>Convert hex colors to Discord embed integers</p>
      <input type="color" id="color-picker" value="#5865F2" aria-label="Color picker">
      <input type="text" id="hex-input" value="#5865F2" placeholder="#5865F2" aria-label="Hex color input">
      <button onclick="convertColor()" class="btn btn--primary">Convert</button>
      <div id="color-result" class="result"></div>
    </section>

    <!-- OAuth URL Builder -->
    <section class="tool-card">
      <h2>OAuth URL Builder</h2>
      <p>Generate Discord OAuth2 authorization URLs</p>
      <input type="text" id="client-id" placeholder="Client ID" aria-label="Client ID">
      <input type="text" id="redirect-uri" placeholder="Redirect URI" value="http://localhost:3000/callback" aria-label="Redirect URI">
      <label><input type="checkbox" value="identify" checked> identify</label>
      <label><input type="checkbox" value="guilds"> guilds</label>
      <label><input type="checkbox" value="guilds.members.read"> guilds.members.read</label>
      <button onclick="buildOAuthUrl()" class="btn btn--primary">Build URL</button>
      <div id="oauth-result" class="result"></div>
    </section>

    <!-- Status Card -->
    <section class="tool-card">
      <h2>Bot Status</h2>
      <p>Real-time Pawtropolis bot status</p>
      <div id="bot-status-card" class="status-card">
        <p>Loading...</p>
      </div>
    </section>
  </main>

  <footer class="footer">
    <p class="footer__copyright">&copy; 2025 Pawtropolis</p>
  </footer>

  <script src="/tools/tools.js"></script>
</body>
</html>
```

#### `tools/tools.css`
```css
.tools-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 1.5rem;
}

.tool-card {
  background: #27272a;
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid #3f3f46;
}

.tool-card h2 {
  margin-top: 0;
  color: #f4f4f5;
  font-size: 1.25rem;
}

.tool-card p {
  color: #a1a1aa;
  margin-bottom: 1rem;
}

.tool-card input[type="text"],
.tool-card input[type="color"],
.tool-card select {
  width: 100%;
  padding: 0.75rem;
  margin: 0.5rem 0;
  background: #18181b;
  border: 1px solid #3f3f46;
  border-radius: 4px;
  color: #f4f4f5;
  font-size: 1rem;
}

.tool-card label {
  display: block;
  margin: 0.5rem 0;
  color: #f4f4f5;
}

.result {
  margin-top: 1rem;
  padding: 1rem;
  background: #18181b;
  border-radius: 4px;
  border-left: 3px solid #5865F2;
  font-family: 'Courier New', monospace;
  color: #10b981;
  word-break: break-all;
}

.result:empty {
  display: none;
}

.status-card {
  padding: 1rem;
  background: #18181b;
  border-radius: 4px;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

#### `tools/tools.js`
```javascript
// Snowflake to Timestamp
function convertSnowflake() {
  const input = document.getElementById('snowflake-input').value;
  const result = document.getElementById('snowflake-result');

  if (!input || !/^\d+$/.test(input)) {
    result.textContent = 'Invalid snowflake ID';
    result.style.borderColor = '#ef4444';
    return;
  }

  const timestamp = Number(BigInt(input) >> 22n) + 1420070400000;
  const date = new Date(timestamp);

  result.innerHTML = `
    <strong>Timestamp:</strong> ${date.toISOString()}<br>
    <strong>Local:</strong> ${date.toLocaleString()}<br>
    <strong>Unix:</strong> ${Math.floor(timestamp / 1000)}
  `;
  result.style.borderColor = '#5865F2';
}

// ID to Mention
function generateMention() {
  const type = document.getElementById('mention-type').value;
  const id = document.getElementById('mention-input').value;
  const result = document.getElementById('mention-result');

  if (!id || !/^\d+$/.test(id)) {
    result.textContent = 'Invalid ID';
    result.style.borderColor = '#ef4444';
    return;
  }

  const mentions = {
    user: `<@${id}>`,
    channel: `<#${id}>`,
    role: `<@&${id}>`
  };

  result.innerHTML = `
    <strong>Syntax:</strong> ${mentions[type]}<br>
    <button onclick="navigator.clipboard.writeText('${mentions[type]}').then(() => alert('Copied!'))" class="btn btn--secondary" style="margin-top: 0.5rem;">Copy</button>
  `;
  result.style.borderColor = '#5865F2';
}

// Embed Color Picker
function convertColor() {
  const hex = document.getElementById('hex-input').value.replace('#', '');
  const result = document.getElementById('color-result');

  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    result.textContent = 'Invalid hex color';
    result.style.borderColor = '#ef4444';
    return;
  }

  const decimal = parseInt(hex, 16);

  result.innerHTML = `
    <strong>Hex:</strong> #${hex.toUpperCase()}<br>
    <strong>Decimal:</strong> ${decimal}<br>
    <strong>RGB:</strong> (${(decimal >> 16) & 255}, ${(decimal >> 8) & 255}, ${decimal & 255})<br>
    <div style="width: 50px; height: 50px; background: #${hex}; border-radius: 4px; margin-top: 0.5rem;" aria-label="Color preview"></div>
  `;
  result.style.borderColor = '#5865F2';
}

// Color picker sync
document.getElementById('color-picker')?.addEventListener('input', (e) => {
  document.getElementById('hex-input').value = e.target.value;
  convertColor();
});

document.getElementById('hex-input')?.addEventListener('input', (e) => {
  const hex = e.target.value;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    document.getElementById('color-picker').value = hex;
  }
});

// OAuth URL Builder
function buildOAuthUrl() {
  const clientId = document.getElementById('client-id').value;
  const redirectUri = document.getElementById('redirect-uri').value;
  const result = document.getElementById('oauth-result');

  if (!clientId) {
    result.textContent = 'Client ID is required';
    result.style.borderColor = '#ef4444';
    return;
  }

  const scopes = Array.from(document.querySelectorAll('#oauth-result input[type="checkbox"]:checked'))
    .map(cb => cb.value)
    .join(' ');

  const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}`;

  result.innerHTML = `
    <strong>URL:</strong><br>
    <a href="${url}" target="_blank" style="color: #5865F2; word-break: break-all;">${url}</a><br>
    <button onclick="navigator.clipboard.writeText('${url}').then(() => alert('Copied!'))" class="btn btn--secondary" style="margin-top: 0.5rem;">Copy URL</button>
  `;
  result.style.borderColor = '#5865F2';
}

// Bot Status Card
fetch('/health')
  .then(res => res.json())
  .then(data => {
    const card = document.getElementById('bot-status-card');
    if (data.ok) {
      card.innerHTML = `
        <div style="color: #10b981; font-size: 1.5rem; margin-bottom: 0.5rem;">✓</div>
        <strong>Online</strong><br>
        <small style="color: #a1a1aa;">Version: ${data.version}</small><br>
        <small style="color: #a1a1aa;">Uptime: ${Math.floor(data.uptime_s / 3600)}h ${Math.floor((data.uptime_s % 3600) / 60)}m</small>
      `;
      card.style.background = '#064e3b';
    } else {
      card.innerHTML = '<div style="color: #ef4444; font-size: 1.5rem;">⚠</div><strong>Offline</strong>';
      card.style.background = '#7f1d1d';
    }
  })
  .catch(() => {
    const card = document.getElementById('bot-status-card');
    card.innerHTML = '<div style="color: #f59e0b;">⚠</div><strong>Unknown</strong>';
    card.style.background = '#7c2d12';
  });
```

### 3. Backend /health Endpoint

Add to `src/web/server.ts` or create `src/web/api/health.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { version } from "../../package.json";

const startTime = Date.now();

export async function registerHealthRoutes(fastify: FastifyInstance) {
  // GET /health - Public endpoint for status monitoring
  fastify.get("/health", async (request, reply) => {
    const uptime_s = Math.floor((Date.now() - startTime) / 1000);

    return {
      ok: true,
      version,
      uptime_s,
      timestamp: new Date().toISOString(),
    };
  });
}
```

Register in server.ts:
```typescript
import { registerHealthRoutes } from "./api/health.js";

// In createWebServer function:
await registerHealthRoutes(fastify); // Add before auth routes
```

### 4. Apache Rewrite Rules

Update `/etc/apache2/sites-available/pawtropolis-le-ssl.conf`:

```apache
<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName pawtropolis.tech
    ServerAlias www.pawtropolis.tech

    DocumentRoot /var/www/pawtropolis/website

    <Directory "/var/www/pawtropolis/website">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    # Proxy API and Auth routes to Fastify
    ProxyPreserveHost On
    ProxyPass /api/ http://127.0.0.1:3000/api/
    ProxyPassReverse /api/ http://127.0.0.1:3000/api/
    ProxyPass /auth/ http://127.0.0.1:3000/auth/
    ProxyPassReverse /auth/ http://127.0.0.1:3000/auth/
    ProxyPass /health http://127.0.0.1:3000/health
    ProxyPassReverse /health http://127.0.0.1:3000/health

    # Improved SPA rewrite rules
    RewriteEngine On

    # Don't rewrite if file/directory exists
    RewriteCond %{REQUEST_FILENAME} -f [OR]
    RewriteCond %{REQUEST_FILENAME} -d
    RewriteRule ^ - [L]

    # Already proxied above, skip rewrite
    RewriteCond %{REQUEST_URI} ^/(api|auth|health)/
    RewriteRule ^ - [L]

    # Fallback to index.html for SPA
    RewriteRule ^ /index.html [L]

    ErrorLog /var/log/apache2/pawtropolis-error.log
    CustomLog /var/log/apache2/pawtropolis-access.log combined

    Include /etc/letsencrypt/options-ssl-apache.conf
    SSLCertificateFile /etc/letsencrypt/live/pawtropolis.tech/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/pawtropolis.tech/privkey.pem
</VirtualHost>
</IfModule>
```

## Deployment Steps

1. **Create all placeholder HTML files**
2. **Create tools directory and files**
3. **Add /health endpoint to backend**
4. **Build locally:** `npm run build`
5. **Upload to server:**
   - `website/` files
   - `dist/` files
6. **Update Apache config** (run as sudo on server)
7. **Restart services:**
   ```bash
   sudo systemctl reload apache2
   pm2 restart pawtropolis
   ```
8. **Test endpoints:**
   - https://pawtropolis.tech/
   - https://pawtropolis.tech/tools/
   - https://pawtropolis.tech/status.html
   - https://pawtropolis.tech/health

## Accessibility Checklist

- ✅ All form inputs have aria-label
- ✅ Color chips have text alternatives
- ✅ prefers-reduced-motion CSS added
- ✅ Semantic HTML throughout
- ✅ Skip links for keyboard navigation
- ✅ Proper heading hierarchy
