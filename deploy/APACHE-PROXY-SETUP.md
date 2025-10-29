# Apache Reverse Proxy Setup for Pawtropolis Tech

This guide sets up Apache to serve static files and proxy `/auth/*` and `/api/*` to the Fastify Node.js app.

## Architecture

```
User → Apache (443) → Static files (/var/www/pawtropolis/website)
                    → Proxy /auth/* → Fastify (127.0.0.1:3000)
                    → Proxy /api/*  → Fastify (127.0.0.1:3000)
```

## Prerequisites

- Ubuntu 22.04+ server with Apache 2.4
- Domain: `pawtropolis.tech` with DNS pointing to server
- SSL certificate installed (certbot/Let's Encrypt)
- Node.js app deployed at `/home/ubuntu/pawtech-v2`
- Static website files at `/var/www/pawtropolis/website`

## Quick Setup (Automated)

1. **Copy deployment scripts to server:**

   ```bash
   # On your local machine
   scp deploy/setup-apache-proxy.sh ubuntu@pawtropolis.tech:/tmp/
   scp deploy/verify-proxy-setup.sh ubuntu@pawtropolis.tech:/tmp/
   ```

2. **Run setup script on server:**

   ```bash
   # SSH into server
   ssh ubuntu@pawtropolis.tech

   # Run Apache setup
   sudo bash /tmp/setup-apache-proxy.sh
   ```

3. **Update environment variables:**

   ```bash
   cd ~/pawtech-v2
   nano .env
   ```

   Ensure these are set:

   ```bash
   NODE_ENV=production
   DASHBOARD_PORT=3000
   TRUST_PROXY=1
   CORS_ORIGIN=https://pawtropolis.tech,https://www.pawtropolis.tech
   ```

4. **Restart Node app:**

   ```bash
   pm2 restart pawtech-v2
   # OR
   npm run start
   ```

5. **Verify setup:**
   ```bash
   bash /tmp/verify-proxy-setup.sh
   ```

## Manual Setup

If you prefer manual setup, follow these steps:

### 1. Create Apache vhost configuration

```bash
sudo nano /etc/apache2/sites-available/pawtropolis.tech.conf
```

Paste the configuration from `deploy/apache-vhost.conf`.

### 2. Enable required Apache modules

```bash
sudo a2enmod proxy proxy_http headers rewrite ssl
```

### 3. Enable the site

```bash
sudo a2ensite pawtropolis.tech.conf
```

### 4. Test and reload Apache

```bash
sudo apachectl configtest
sudo systemctl reload apache2
```

### 5. Check Apache status

```bash
systemctl status apache2
sudo tail -f /var/log/apache2/pawtropolis-error.log
```

## Verification Checklist

Run each test manually:

- [ ] Node app listening on port 3000: `ss -tlnp | grep 3000`
- [ ] Apache running: `systemctl status apache2`
- [ ] Homepage loads: `curl -I https://pawtropolis.tech/`
- [ ] Static assets load: `curl -I https://pawtropolis.tech/styles.css`
- [ ] OAuth redirects: `curl -L https://pawtropolis.tech/auth/login` (should redirect to Discord)
- [ ] API protected: `curl https://pawtropolis.tech/api/metrics` (should return 401)
- [ ] SPA fallback: `curl -I https://pawtropolis.tech/dashboard` (should return 200)

## Testing OAuth Flow

1. Open browser: `https://pawtropolis.tech/`
2. Click "Admin Login" button
3. Should redirect to Discord OAuth
4. After login, should redirect to `/dashboard`
5. Admin panel should appear
6. Test API endpoints in browser console:
   ```javascript
   fetch("https://pawtropolis.tech/api/metrics", { credentials: "include" })
     .then((r) => r.json())
     .then(console.log);
   ```

## Troubleshooting

### 404 on /auth/login

**Symptom:** `/auth/login` returns 404

**Cause:** Apache is not proxying the request to Node

**Fix:**

```bash
# Check if proxy modules are enabled
sudo apache2ctl -M | grep proxy

# If not shown, enable them
sudo a2enmod proxy proxy_http
sudo systemctl reload apache2
```

### 502 Bad Gateway

**Symptom:** `/auth/login` returns 502

**Cause:** Node app is not running or not listening on port 3000

**Fix:**

```bash
# Check if Node is running
ss -tlnp | grep 3000

# If not, start it
cd ~/pawtech-v2
pm2 start ecosystem.config.js
# OR
npm run start
```

### Cookies not working (401 after login)

**Symptom:** OAuth succeeds but `/auth/me` returns 401

**Cause:** Fastify not trusting proxy headers, secure cookies rejected

**Fix:**

```bash
# Ensure environment variables are set
cd ~/pawtech-v2
grep -E "TRUST_PROXY|NODE_ENV|CORS_ORIGIN" .env

# Should show:
# NODE_ENV=production
# TRUST_PROXY=1
# CORS_ORIGIN=https://pawtropolis.tech

# Restart Node app
pm2 restart pawtech-v2
```

### CORS errors in browser console

**Symptom:** Browser shows CORS policy errors

**Cause:** CORS_ORIGIN mismatch

**Fix:**

```bash
# Update CORS_ORIGIN in .env
CORS_ORIGIN=https://pawtropolis.tech,https://www.pawtropolis.tech

# Restart app
pm2 restart pawtech-v2
```

## Rollback

If something goes wrong, restore the previous configuration:

```bash
# List backups
ls -la /root/apache-backup-*/

# Restore from backup
sudo cp /root/apache-backup-YYYYMMDD-HHMMSS/pawtropolis.tech.conf \
        /etc/apache2/sites-available/pawtropolis.tech.conf

# Reload Apache
sudo apachectl configtest
sudo systemctl reload apache2
```

## File Locations

- **Apache vhost:** `/etc/apache2/sites-available/pawtropolis.tech.conf`
- **Static files:** `/var/www/pawtropolis/website/`
- **Node app:** `/home/ubuntu/pawtech-v2/`
- **Apache logs:**
  - Error: `/var/log/apache2/pawtropolis-error.log`
  - Access: `/var/log/apache2/pawtropolis-access.log`
- **Node logs:** `pm2 logs pawtech-v2`

## Security Notes

1. **SSL/TLS:** Ensure certbot auto-renews certificates

   ```bash
   sudo certbot renew --dry-run
   ```

2. **Firewall:** Only ports 80, 443, and 22 should be open

   ```bash
   sudo ufw status
   ```

3. **Session secrets:** Ensure `FASTIFY_SESSION_SECRET` is set to a random 32+ char string

   ```bash
   # Generate a new secret
   openssl rand -base64 32
   ```

4. **Admin roles:** Verify `ADMIN_ROLE_ID` is set to correct Discord role IDs
   ```bash
   grep ADMIN_ROLE_ID ~/pawtech-v2/.env
   ```

## Performance Monitoring

Monitor Apache and Node performance:

```bash
# Apache status
sudo apache2ctl status

# Active connections
sudo netstat -an | grep :443 | wc -l

# Node memory usage
pm2 monit

# Apache access logs (requests per minute)
sudo tail -f /var/log/apache2/pawtropolis-access.log | grep --line-buffered "/api/"
```

## Support

If issues persist:

1. Check Apache error logs: `sudo tail -100 /var/log/apache2/pawtropolis-error.log`
2. Check Node logs: `pm2 logs pawtech-v2 --lines 100`
3. Verify DNS: `dig pawtropolis.tech`
4. Test local Node app: `curl http://127.0.0.1:3000/auth/login`
