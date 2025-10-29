#!/bin/bash
# Pawtropolis Tech - Apache Reverse Proxy Setup Script
# Ubuntu 22.04+ / Apache 2.4
# Run as: sudo bash setup-apache-proxy.sh

set -euo pipefail

# Script version
VERSION="1.1.0"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Configuration
readonly VHOST_NAME="pawtropolis.tech"
readonly VHOST_PATH="/etc/apache2/sites-available/${VHOST_NAME}.conf"
readonly BACKUP_PREFIX="/root/apache-backup"
readonly DOC_ROOT="/var/www/pawtropolis/website"
readonly NODE_PORT="3000"

# Flags
DRY_RUN=false

# Print usage information
usage() {
  cat <<EOF
${BLUE}Pawtropolis Apache Reverse Proxy Setup${NC}

USAGE:
  sudo bash setup-apache-proxy.sh [OPTIONS]

OPTIONS:
  --dry-run        Test configuration without applying changes
  --help, -h       Show this help message
  --version, -v    Show script version

DESCRIPTION:
  Automates Apache 2.4 reverse proxy configuration for Pawtropolis Tech.
  Sets up HTTPS→Node.js proxying for /api/* and /auth/* endpoints.

PREREQUISITES:
  - Ubuntu 22.04+ with Apache 2.4
  - SSL certificate at /etc/letsencrypt/live/${VHOST_NAME}/
  - Node.js app deployed and configured to run on port ${NODE_PORT}
  - Static website files at ${DOC_ROOT}

WHAT IT DOES:
  1. Backs up existing Apache config (if present)
  2. Installs new vhost configuration
  3. Enables required Apache modules (proxy, headers, rewrite, ssl)
  4. Tests configuration with apachectl
  5. Reloads Apache to apply changes

ROLLBACK:
  If anything fails, the script automatically restores the backup.
  Manual rollback: sudo cp ${BACKUP_PREFIX}-*/\${VHOST_NAME}.conf ${VHOST_PATH}

EXAMPLES:
  # Standard setup
  sudo bash setup-apache-proxy.sh

  # Test without applying
  sudo bash setup-apache-proxy.sh --dry-run

For more information, see deploy/APACHE-PROXY-SETUP.md

EOF
}

# Parse command line arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      --version|-v)
        echo "setup-apache-proxy.sh version ${VERSION}"
        exit 0
        ;;
      *)
        echo -e "${RED}ERROR: Unknown option: $1${NC}" >&2
        echo "Run with --help for usage information"
        exit 1
        ;;
    esac
  done
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Validate prerequisites
validate_prerequisites() {
  local errors=0

  echo -e "${BLUE}Validating prerequisites...${NC}"

  # Check if running as root
  if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}✗ ERROR: This script must be run as root (use sudo)${NC}"
    exit 1
  fi

  # Check for required commands
  for cmd in apache2 apachectl a2enmod a2ensite; do
    if ! command_exists "$cmd"; then
      echo -e "${RED}✗ Missing required command: $cmd${NC}"
      errors=$((errors + 1))
    fi
  done

  # Check if Apache service exists
  if ! systemctl list-unit-files apache2.service >/dev/null 2>&1; then
    echo -e "${RED}✗ Apache service not found (is Apache installed?)${NC}"
    errors=$((errors + 1))
  fi

  # Check SSL certificate (warn only, not fatal)
  if [[ ! -f "/etc/letsencrypt/live/${VHOST_NAME}/fullchain.pem" ]]; then
    echo -e "${YELLOW}⚠ Warning: SSL certificate not found at /etc/letsencrypt/live/${VHOST_NAME}/${NC}"
    echo -e "${YELLOW}  The Apache config includes SSL directives. Run 'sudo certbot --apache' after setup.${NC}"
  fi

  # Check document root (warn only)
  if [[ ! -d "$DOC_ROOT" ]]; then
    echo -e "${YELLOW}⚠ Warning: Document root not found: ${DOC_ROOT}${NC}"
    echo -e "${YELLOW}  Create it before serving static files: sudo mkdir -p ${DOC_ROOT}${NC}"
  fi

  if [[ $errors -gt 0 ]]; then
    echo -e "${RED}✗ Prerequisites check failed with ${errors} error(s)${NC}"
    exit 1
  fi

  echo -e "${GREEN}✓ Prerequisites validated${NC}"
}

# Create backup of existing configuration
create_backup() {
  local backup_dir="${BACKUP_PREFIX}-$(date +%Y%m%d-%H%M%S)"

  echo -e "${YELLOW}Step 1: Backing up existing Apache config...${NC}"

  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${BLUE}[DRY RUN] Would create backup at: ${backup_dir}${NC}"
    return 0
  fi

  mkdir -p "$backup_dir"

  if [[ -f "$VHOST_PATH" ]]; then
    cp "$VHOST_PATH" "$backup_dir/"
    echo -e "${GREEN}✓ Backed up to ${backup_dir}${NC}"
    echo "$backup_dir" > /tmp/apache-proxy-backup-location
  else
    echo -e "${YELLOW}No existing config found, creating new one${NC}"
  fi
}

# Install vhost configuration
install_vhost() {
  echo -e "${YELLOW}Step 2: Installing Apache vhost configuration...${NC}"

  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${BLUE}[DRY RUN] Would write configuration to: ${VHOST_PATH}${NC}"
    return 0
  fi

  cat > "$VHOST_PATH" <<'EOF'
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

  ErrorLog ${APACHE_LOG_DIR}/pawtropolis-error.log
  CustomLog ${APACHE_LOG_DIR}/pawtropolis-access.log combined

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

  echo -e "${GREEN}✓ Vhost configuration written to ${VHOST_PATH}${NC}"
}

# Enable Apache modules
enable_modules() {
  echo -e "${YELLOW}Step 3: Enabling required Apache modules...${NC}"

  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${BLUE}[DRY RUN] Would enable modules: proxy proxy_http headers rewrite ssl${NC}"
    return 0
  fi

  # Enable modules (suppress already-enabled messages)
  a2enmod proxy proxy_http headers rewrite ssl 2>&1 | grep -v "already enabled" || true

  echo -e "${GREEN}✓ Modules enabled${NC}"
}

# Enable site configuration
enable_site() {
  echo -e "${YELLOW}Step 4: Enabling site configuration...${NC}"

  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${BLUE}[DRY RUN] Would enable site: ${VHOST_NAME}.conf${NC}"
    return 0
  fi

  a2ensite "${VHOST_NAME}.conf" >/dev/null 2>&1

  echo -e "${GREEN}✓ Site enabled${NC}"
}

# Test Apache configuration
test_config() {
  echo -e "${YELLOW}Step 5: Testing Apache configuration...${NC}"

  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${BLUE}[DRY RUN] Would test configuration with: apachectl configtest${NC}"
    return 0
  fi

  if apachectl configtest 2>&1 | grep -q "Syntax OK"; then
    echo -e "${GREEN}✓ Apache configuration is valid${NC}"
  else
    echo -e "${RED}✗ Apache configuration test failed!${NC}"
    restore_backup
    exit 1
  fi
}

# Reload Apache
reload_apache() {
  echo -e "${YELLOW}Step 6: Reloading Apache...${NC}"

  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${BLUE}[DRY RUN] Would reload Apache with: systemctl reload apache2${NC}"
    return 0
  fi

  if systemctl reload apache2; then
    echo -e "${GREEN}✓ Apache reloaded successfully${NC}"
  else
    echo -e "${RED}✗ Apache reload failed!${NC}"
    restore_backup
    exit 1
  fi
}

# Restore from backup on failure
restore_backup() {
  if [[ -f "/tmp/apache-proxy-backup-location" ]]; then
    local backup_dir
    backup_dir=$(cat /tmp/apache-proxy-backup-location)

    echo -e "${YELLOW}Restoring backup from ${backup_dir}...${NC}"

    if [[ -f "${backup_dir}/${VHOST_NAME}.conf" ]]; then
      cp "${backup_dir}/${VHOST_NAME}.conf" "$VHOST_PATH"
      systemctl reload apache2
      echo -e "${GREEN}✓ Backup restored${NC}"
    fi

    rm -f /tmp/apache-proxy-backup-location
  fi
}

# Print next steps
print_next_steps() {
  local backup_dir=""
  if [[ -f "/tmp/apache-proxy-backup-location" ]]; then
    backup_dir=$(cat /tmp/apache-proxy-backup-location)
    rm -f /tmp/apache-proxy-backup-location
  fi

  echo ""
  echo -e "${GREEN}=== Setup Complete! ===${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Verify Node app is running on port ${NODE_PORT}:"
  echo "   ss -tlnp | grep ${NODE_PORT}"
  echo ""
  echo "2. Check environment variables in your .env:"
  echo "   DASHBOARD_PORT=${NODE_PORT}"
  echo "   TRUST_PROXY=1"
  echo "   CORS_ORIGIN=https://${VHOST_NAME}"
  echo "   NODE_ENV=production"
  echo ""
  echo "3. Restart your Node app to apply proxy settings:"
  echo "   pm2 restart pawtropolis"
  echo ""
  echo "4. Test endpoints:"
  echo "   https://${VHOST_NAME}/ (static site)"
  echo "   https://${VHOST_NAME}/auth/login (Discord OAuth)"
  echo "   https://${VHOST_NAME}/api/metrics (API - requires auth)"
  echo ""
  echo "5. Run verification script:"
  echo "   bash deploy/verify-proxy-setup.sh"
  echo ""
  echo "Logs:"
  echo "  Apache Error: tail -f /var/log/apache2/pawtropolis-error.log"
  echo "  Apache Access: tail -f /var/log/apache2/pawtropolis-access.log"
  echo "  Node App: pm2 logs pawtropolis"

  if [[ -n "$backup_dir" ]]; then
    echo ""
    echo "Backup saved to: ${backup_dir}"
  fi

  echo ""
}

# Main execution
main() {
  parse_args "$@"

  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${BLUE}=== DRY RUN MODE ===${NC}"
  fi

  echo -e "${BLUE}=== Pawtropolis Apache Reverse Proxy Setup ===${NC}"
  echo ""

  validate_prerequisites
  create_backup
  install_vhost
  enable_modules
  enable_site
  test_config
  reload_apache
  print_next_steps
}

# Run main function with all arguments
main "$@"
