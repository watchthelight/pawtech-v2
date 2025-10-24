# Pawtropolis Web Panel — Editing Guide

This is the "Coming Soon" landing page for the Pawtropolis Discord bot web panel.

## Quick Start

Open `index.html` in a browser to preview locally, or use a local server:

```bash
# Python
python -m http.server 8000

# Node.js
npx serve .

# VS Code Live Server extension
# Right-click index.html → "Open with Live Server"
```

Visit `http://localhost:8000`

## File Structure

```
website/
├── index.html          # Main landing page
├── styles.css          # Styles with light/dark theme support
├── robots.txt          # Search engine directives (disallow until launch)
├── site.webmanifest    # PWA manifest
├── assets/
│   ├── avatar.png      # Bot avatar (used as logo/favicon)
│   ├── banner.webp     # Hero background image
│   ├── favicon.svg     # (Legacy - not currently used)
│   └── og-image.png    # (Legacy - not currently used)
└── README.md           # This file
```

## How to Edit

### Update Text Content

Edit `index.html`:

**Tagline** (line 44):

```html
<p class="hero__tagline">A playful, practical Discord moderation toolkit.</p>
```

**Feature Cards** (lines 72-135):

- Each `<article class="feature-card">` contains a title and description
- Update the `<h3>` and `<p>` elements to change feature text

**Status Message** (lines 143-144):

```html
<p class="status__message">Web panel is under active development. Follow updates in our Discord.</p>
```

### Update CTA Button Links

Edit `index.html` lines 47-51:

```html
<a href="#" class="btn btn--primary">Invite Bot</a>
<a href="#" class="btn btn--secondary">Join Server</a>
```

Replace `href="#"` with your Discord invite URLs:

- **Invite Bot**: Your bot invite URL from Discord Developer Portal
- **Join Server**: Your Discord server invite URL (e.g., `https://discord.gg/YOURCODE`)

### Replace Images

**Banner Image** (`assets/banner.webp`):

- Replace with a 1920×600px (or similar wide aspect) banner image
- Supported formats: `.webp`, `.png`, `.jpg`, `.jpeg`
- If you change the filename or format, update `styles.css` line 141:
  ```css
  url('/assets/banner.webp');
  ```

**Avatar/Logo** (`assets/avatar.png`):

- Replace with your bot's avatar (512×512px recommended)
- Supported formats: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`
- If you change the filename or format, update:
  - `index.html` line 42: `<img src="/assets/avatar.png" ...>`
  - `index.html` line 25: `<link rel="icon" ... href="/assets/avatar.png">`
  - `site.webmanifest` lines 10-22: Update both icon entries

### Change Colors

Edit `styles.css` CSS variables (lines 4-24 for light theme, lines 31-43 for dark theme):

**Discord Blurple** (default accent):

```css
--accent: #5865f2;
--accent-hover: #4752c4;
```

**Other Discord Colors**:

- Green: `#57F287`
- Yellow: `#FEE75C`
- Fuchsia: `#EB459E`
- Red: `#ED4245`

**Background Colors**:

```css
--bg: #ffffff; /* Page background */
--bg-secondary: #f2f3f5; /* Footer background */
--card-bg: #ffffff; /* Feature card background */
```

### Enable Admin Login Button

Edit `index.html` line 49:

**Before** (disabled):

```html
<button class="btn btn--disabled" aria-disabled="true" tabindex="-1" disabled>
  Admin Login (Coming Soon)
</button>
```

**After** (enabled with OAuth link):

```html
<a href="YOUR_DISCORD_OAUTH_URL" class="btn btn--primary"> Admin Login </a>
```

Replace `YOUR_DISCORD_OAUTH_URL` with your Discord OAuth2 authorization URL.

## Going Live Checklist

When ready to launch the web panel:

### 1. Update robots.txt

Edit `robots.txt` to allow indexing:

```
User-agent: *
Allow: /
Sitemap: https://pawtropolis.tech/sitemap.xml
```

### 2. Remove noindex meta tag

Edit `index.html` line 8:

**Before**:

```html
<meta name="robots" content="noindex, nofollow" />
```

**After** (remove the line entirely or comment it out):

```html
<!-- <meta name="robots" content="noindex, nofollow"> -->
```

### 3. Update CTA links

Replace all `href="#"` placeholder links in `index.html` with real URLs:

- Invite Bot URL
- Join Server URL
- Admin Login OAuth URL (if ready)

### 4. Test responsiveness

Check the page on:

- Desktop (1920px+)
- Tablet (768px)
- Mobile (375px, 414px)
- Dark mode (system preference or browser DevTools)

### 5. Validate HTML

Use the [W3C Validator](https://validator.w3.org/) to check for errors.

### 6. Deploy

Upload all files to your web server, ensuring:

- `index.html` is at the root or accessible at your domain
- `assets/` folder is uploaded with all images
- HTTPS is enabled (use Let's Encrypt via Certbot)

## Accessibility Features

This page includes:

- **Skip link** for keyboard navigation
- **Semantic HTML** (`<header>`, `<main>`, `<footer>`, `<nav>`, `<article>`)
- **ARIA labels** for icon-only elements
- **Focus visible** outlines for keyboard users
- **Prefers-reduced-motion** support (disables animations)
- **Color contrast** meeting WCAG AA standards

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile Safari 14+
- Chrome Android 90+

Older browsers will receive a degraded but functional experience.

## Troubleshooting

**Images not loading**:

- Check file paths match exactly (case-sensitive on Linux servers)
- Verify images exist in `assets/` folder
- Check browser console for 404 errors

**Styles not applying**:

- Clear browser cache (Ctrl+Shift+R / Cmd+Shift+R)
- Check `styles.css` is in the same directory as `index.html`
- Verify no syntax errors in CSS

**Dark mode not working**:

- Set system theme to dark in OS settings
- Or use browser DevTools → Rendering → Emulate CSS media `prefers-color-scheme: dark`

---

Built for the Pawtropolis Discord moderation bot.
