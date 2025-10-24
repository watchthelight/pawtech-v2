#!/bin/bash
# Pawtropolis Tech - Apache Reverse Proxy Setup Script
# Ubuntu 22.04+ / Apache 2.4
# Run as: sudo bash setup-apache-proxy.sh

set -euo pipefail

echo "=== Pawtropolis Apache Reverse Proxy Setup ==="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}ERROR: This script must be run as root (use sudo)${NC}"
   exit 1
fi

echo -e "${YELLOW}Step 1: Backing up existing Apache config...${NC}"
BACKUP_DIR="/root/apache-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
if [ -f /etc/apache2/sites-available/pawtropolis.tech.conf ]; then
    cp /etc/apache2/sites-available/pawtropolis.tech.conf "$BACKUP_DIR/"
    echo -e "${GREEN}✓ Backed up to $BACKUP_DIR${NC}"
else
    echo -e "${YELLOW}No existing config found, creating new one${NC}"
fi

echo -e "${YELLOW}Step 2: Installing Apache vhost configuration...${NC}"
cat > /etc/apache2/sites-available/pawtropolis.tech.conf <<'EOF'
<VirtualHost *:443>
  ServerName pawtropolis.tech
  ServerAlias www.pawtropolis.tech

  # --- Static site root ---
  DocumentRoot /var/www/pawtropolis/website
  <Directory "/var/www/pawtropolis/website">
    Options Indexes FollowSymLinks
    AllowOverride All
    Require all granted
  </Directory>

  # --- Security headers (safe defaults) ---
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"

  # --- Reverse proxy to Fastify (API & Auth) ---
  ProxyPreserveHost On
  ProxyPass        /api/  http://127.0.0.1:3000/api/
  ProxyPassReverse /api/  http://127.0.0.1:3000/api/
  ProxyPass        /auth/ http://127.0.0.1:3000/auth/
  ProxyPassReverse /auth/ http://127.0.0.1:3000/auth/

  # --- SPA fallback: all non-asset, non-API/AUTH paths → index.html ---
  RewriteEngine On
  # Bypass rewrite for API/AUTH and static assets
  RewriteCond %{REQUEST_URI} ^/(api|auth)/ [OR]
  RewriteCond %{REQUEST_URI} \.(css|js|png|webp|jpg|jpeg|svg|ico|txt|json|map|webmanifest)$ [NC]
  RewriteRule ^ - [L]

  # Fallback everything else to the SPA entrypoint
  RewriteRule ^ /index.html [L]

  ErrorLog \${APACHE_LOG_DIR}/pawtropolis-error.log
  CustomLog \${APACHE_LOG_DIR}/pawtropolis-access.log combined

  # SSL Configuration (certbot manages these)
  SSLEngine on
  SSLCertificateFile /etc/letsencrypt/live/pawtropolis.tech/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/pawtropolis.tech/privkey.pem
  Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>

# HTTP to HTTPS redirect
<VirtualHost *:80>
  ServerName pawtropolis.tech
  ServerAlias www.pawtropolis.tech

  RewriteEngine On
  RewriteCond %{HTTPS} off
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>
EOF

echo -e "${GREEN}✓ Vhost configuration written${NC}"

echo -e "${YELLOW}Step 3: Enabling required Apache modules...${NC}"
a2enmod proxy proxy_http headers rewrite ssl 2>&1 | grep -v "already enabled" || true
echo -e "${GREEN}✓ Modules enabled${NC}"

echo -e "${YELLOW}Step 4: Enabling site configuration...${NC}"
a2ensite pawtropolis.tech.conf
echo -e "${GREEN}✓ Site enabled${NC}"

echo -e "${YELLOW}Step 5: Testing Apache configuration...${NC}"
if apachectl configtest; then
    echo -e "${GREEN}✓ Apache configuration is valid${NC}"
else
    echo -e "${RED}✗ Apache configuration test failed!${NC}"
    echo -e "${YELLOW}Restoring backup...${NC}"
    if [ -f "$BACKUP_DIR/pawtropolis.tech.conf" ]; then
        cp "$BACKUP_DIR/pawtropolis.tech.conf" /etc/apache2/sites-available/pawtropolis.tech.conf
    fi
    exit 1
fi

echo -e "${YELLOW}Step 6: Reloading Apache...${NC}"
systemctl reload apache2
echo -e "${GREEN}✓ Apache reloaded${NC}"

echo ""
echo -e "${GREEN}=== Setup Complete! ===${NC}"
echo ""
echo "Next steps:"
echo "1. Verify Node app is running on port 3000:"
echo "   ss -tlnp | grep 3000"
echo ""
echo "2. Check environment variables in your .env:"
echo "   DASHBOARD_PORT=3000"
echo "   TRUST_PROXY=1"
echo "   CORS_ORIGIN=https://pawtropolis.tech"
echo "   NODE_ENV=production"
echo ""
echo "3. Restart your Node app to apply proxy settings"
echo ""
echo "4. Test endpoints:"
echo "   https://pawtropolis.tech/ (static site)"
echo "   https://pawtropolis.tech/auth/login (Discord OAuth)"
echo "   https://pawtropolis.tech/api/metrics (API - requires auth)"
echo ""
echo "Logs:"
echo "  Apache: tail -f /var/log/apache2/pawtropolis-error.log"
echo "  Access: tail -f /var/log/apache2/pawtropolis-access.log"
echo ""
echo "Backup saved to: $BACKUP_DIR"
