#Requires -Version 5.0

<#
.SYNOPSIS
  Deploy Pawtropolis static site to remote Linux server with Apache and optional Let's Encrypt SSL.

.DESCRIPTION
  This script uploads the ./website directory to a remote server, installs/configures Apache2,
  creates a virtual host for pawtropolis.tech (+ www), and optionally obtains a Let's Encrypt
  certificate. The script is idempotent and safe to re-run.

.PARAMETER HostAlias
  SSH host alias (must be configured in ~/.ssh/config). Default: "pawtech"

.PARAMETER Domain
  Primary domain name. Default: "pawtropolis.tech"

.PARAMETER ServerIP
  Server IP address (used for DNS sanity checks; not applied on server).

.PARAMETER EnableSSL
  If present, attempt to obtain Let's Encrypt SSL certificate via certbot.

.PARAMETER Email
  Email address for Let's Encrypt registration. Required if -EnableSSL is used.

.EXAMPLE
  .\deploy.ps1 -HostAlias pawtech -Domain pawtropolis.tech -ServerIP 192.0.2.10
  Deploy without SSL.

.EXAMPLE
  .\deploy.ps1 -HostAlias pawtech -Domain pawtropolis.tech -ServerIP 192.0.2.10 -EnableSSL -Email admin@example.com
  Deploy with Let's Encrypt SSL.
#>

[CmdletBinding()]
param(
  [string]$HostAlias = "pawtech",
  [string]$Domain = "pawtropolis.tech",
  [string]$ServerIP = "",
  [switch]$EnableSSL,
  [string]$Email = ""
)

# ============================================
# Utility Functions
# ============================================

function Write-Step {
  param([string]$Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Success {
  param([string]$Message)
  Write-Host "    [OK] $Message" -ForegroundColor Green
}

function Write-Warning {
  param([string]$Message)
  Write-Host "    [WARNING] $Message" -ForegroundColor Yellow
}

function Write-ErrorMsg {
  param([string]$Message)
  Write-Host "    [ERROR] $Message" -ForegroundColor Red
}

function Test-CommandExists {
  param([string]$Command)
  $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# ============================================
# Pre-flight Checks
# ============================================

Write-Step "Running pre-flight checks..."

# Check for ssh/scp
if (-not (Test-CommandExists "ssh")) {
  Write-ErrorMsg "ssh command not found. Please install OpenSSH or Git for Windows."
  exit 1
}
if (-not (Test-CommandExists "scp")) {
  Write-ErrorMsg "scp command not found. Please install OpenSSH or Git for Windows."
  exit 1
}
Write-Success "ssh and scp are available"

# Check website directory
$websiteDir = Join-Path $PSScriptRoot "website"
if (-not (Test-Path $websiteDir)) {
  Write-ErrorMsg "Website directory not found: $websiteDir"
  exit 1
}
if (-not (Test-Path (Join-Path $websiteDir "index.html"))) {
  Write-ErrorMsg "index.html not found in $websiteDir"
  exit 1
}
Write-Success "Website directory exists with index.html"

# Validate SSL requirements
if ($EnableSSL -and [string]::IsNullOrWhiteSpace($Email)) {
  Write-ErrorMsg "-Email parameter is required when -EnableSSL is specified"
  exit 1
}

if ($EnableSSL) {
  Write-Success "SSL will be enabled using email: $Email"
} else {
  Write-Warning "SSL is disabled. Use -EnableSSL -Email <email> to enable HTTPS"
}

# ============================================
# Upload Website Files
# ============================================

Write-Step "Uploading website files to $HostAlias..."

# Create remote temp directory and upload
$scpCommand = "scp -r `"$websiteDir\*`" ${HostAlias}:/tmp/pawtropolis_site/"

# First create the remote directory
ssh $HostAlias "mkdir -p /tmp/pawtropolis_site" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-ErrorMsg "Failed to create remote temp directory"
  exit 1
}

# Upload files
Invoke-Expression $scpCommand 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-ErrorMsg "Failed to upload files via scp"
  exit 1
}

Write-Success "Files uploaded to /tmp/pawtropolis_site/"

# ============================================
# Remote Server Configuration
# ============================================

Write-Step "Configuring Apache on remote server..."

# Build the remote script with variable substitution
$enableSSLValue = if ($EnableSSL) { "True" } else { "False" }

$remoteScript = @"
set -eu

echo "Installing Apache and dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq 2>&1
apt-get install -y apache2 curl dnsutils 2>&1 | grep -v "^Reading\|^Building\|^The following"

if [ "$enableSSLValue" = "True" ]; then
  echo "Installing certbot..."
  # Use apt for Ubuntu 24.04 (snap can be problematic on ARM64)
  if ! command -v certbot > /dev/null 2>&1; then
    apt-get install -y certbot python3-certbot-apache 2>&1 | grep -v "^Reading\|^Building\|^The following"
  fi
  echo "Certbot installed"
fi

echo "Creating document root..."
mkdir -p /var/www/$Domain/public_html

echo "Copying website files..."
rsync -a --delete /tmp/pawtropolis_site/ /var/www/$Domain/public_html/
chown -R www-data:www-data /var/www/$Domain

echo "Enabling Apache modules..."
a2enmod rewrite headers ssl > /dev/null 2>&1 || true

echo "Creating virtual host configuration..."
cat > /etc/apache2/sites-available/$Domain.conf <<VHOST
<VirtualHost *:80>
    ServerName $Domain
    ServerAlias www.$Domain
    ServerAdmin webmaster@$Domain

    DocumentRoot /var/www/$Domain/public_html

    <Directory /var/www/$Domain/public_html>
        Options -Indexes +FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    # Security headers
    Header always set X-Content-Type-Options "nosniff"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    Header always set X-Frame-Options "SAMEORIGIN"

    ErrorLog \`${APACHE_LOG_DIR}/$Domain-error.log
    CustomLog \`${APACHE_LOG_DIR}/$Domain-access.log combined
</VirtualHost>
VHOST

echo "Enabling site..."
a2ensite $Domain > /dev/null 2>&1
a2dissite 000-default > /dev/null 2>&1 || true

echo "Testing Apache configuration..."
if ! apache2ctl configtest 2>&1 | grep -q "Syntax OK"; then
  echo "ERROR: Apache configuration test failed"
  apache2ctl configtest 2>&1
  exit 1
fi

echo "Reloading Apache..."
if ! systemctl reload apache2 2>&1; then
  echo "ERROR: Apache reload failed"
  systemctl status apache2 --no-pager
  exit 1
fi
echo "Apache reloaded successfully"

if [ "$enableSSLValue" = "True" ]; then
  echo "Checking DNS resolution..."
  if command -v dig > /dev/null 2>&1; then
    RESOLVED_IP=`$(dig +short A $Domain | head -n1)
    if [ -n "$ServerIP" ] && [ -n "`${RESOLVED_IP}" ] && [ "`${RESOLVED_IP}" != "$ServerIP" ]; then
      echo "WARNING: DNS mismatch! $Domain resolves to `${RESOLVED_IP} but expected $ServerIP"
      echo "Let's Encrypt will fail if DNS is not pointing to this server."
      echo "Press Ctrl+C to abort or wait 10 seconds to continue..."
      sleep 10
    elif [ -n "`${RESOLVED_IP}" ]; then
      echo "DNS check passed (resolved to `${RESOLVED_IP})"
    else
      echo "WARNING: Could not resolve DNS for $Domain"
    fi
  else
    echo "WARNING: dig not available, skipping DNS check"
    if [ -n "$ServerIP" ]; then
      echo "Make sure $Domain points to $ServerIP before continuing"
      sleep 5
    fi
  fi

  echo "Obtaining Let's Encrypt certificate..."
  certbot --apache \
    -d $Domain \
    -d www.$Domain \
    -m "$Email" \
    --agree-tos \
    --no-eff-email \
    --redirect \
    --non-interactive 2>&1

  if [ `$? -eq 0 ]; then
    echo "SSL certificate obtained successfully"
    systemctl reload apache2
  else
    echo "ERROR: Certbot failed. Check DNS and try again."
    exit 1
  fi
fi

# Configure firewall if ufw is installed
if command -v ufw > /dev/null 2>&1; then
  echo "Configuring firewall..."
  ufw allow 'Apache Full' 2>&1 | grep -v "^Skipping\|^Rules updated" || true
  # Don't enable ufw if it's not already enabled (could lock you out)
  if ufw status 2>&1 | grep -q "Status: active"; then
    echo "Firewall rules updated"
  else
    echo "Firewall not active, skipping..."
  fi
fi

echo "Deployment complete!"
"@

# Execute remote script
Write-Host "    Running remote installation (this may take a few minutes)..." -ForegroundColor Gray

# Convert Windows line endings to Unix
$unixScript = $remoteScript -replace "`r`n", "`n"
$unixScript = $unixScript -replace "`r", "`n"

# Base64 encode to avoid shell escaping issues
$scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($unixScript)
$scriptBase64 = [Convert]::ToBase64String($scriptBytes)

try {
  # Decode and execute on remote server
  # Use printf to avoid echo interpretation issues
  ssh $HostAlias "printf '%s' '$scriptBase64' | base64 -d | sudo bash" 2>&1 |
    ForEach-Object {
      $line = $_.ToString()
      if ($line -match "ERROR|failed|Failed") {
        Write-Host "    $_" -ForegroundColor Red
      } elseif ($line -match "WARNING|Warning") {
        Write-Host "    $_" -ForegroundColor Yellow
      } elseif ($line -match "OK|Success|complete") {
        Write-Host "    $_" -ForegroundColor Green
      } else {
        Write-Host "    $_" -ForegroundColor Gray
      }
    }
} catch {
  Write-ErrorMsg "SSH execution failed: $_"
  exit 1
}

if ($LASTEXITCODE -ne 0) {
  Write-ErrorMsg "Remote configuration failed"
  exit 1
}

Write-Success "Apache configured successfully"

# ============================================
# Post-Deployment Smoke Tests
# ============================================

Write-Step "Running smoke tests..."

Start-Sleep -Seconds 2

# Test HTTP
try {
  $httpUrl = "http://$Domain"
  $response = Invoke-WebRequest -Uri $httpUrl -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  if ($response.StatusCode -eq 200) {
    Write-Success "HTTP check passed: $httpUrl (Status: 200)"
  } else {
    Write-Warning "HTTP returned status: $($response.StatusCode)"
  }
} catch {
  Write-Warning "HTTP check failed: $($_.Exception.Message)"
  Write-Warning "This may be a DNS propagation issue. Try accessing http://$ServerIP directly."
}

# Test HTTPS if SSL enabled
if ($EnableSSL) {
  try {
    $httpsUrl = "https://$Domain"
    $response = Invoke-WebRequest -Uri $httpsUrl -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
      Write-Success "HTTPS check passed: $httpsUrl (Status: 200)"
    } else {
      Write-Warning "HTTPS returned status: $($response.StatusCode)"
    }
  } catch {
    Write-Warning "HTTPS check failed: $($_.Exception.Message)"
    Write-Warning "SSL certificate may still be propagating or DNS may not be fully configured."
  }
}

# ============================================
# Final Summary
# ============================================

Write-Host "`n" -NoNewline
Write-Host "========================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

Write-Host "`nSite Details:" -ForegroundColor Cyan
Write-Host "  Domain:        $Domain" -ForegroundColor White
Write-Host "  Server:        $HostAlias" -ForegroundColor White
Write-Host "  Document Root: /var/www/$Domain/public_html" -ForegroundColor White

Write-Host "`nAccess URLs:" -ForegroundColor Cyan
Write-Host "  HTTP:  http://$Domain" -ForegroundColor White
if ($EnableSSL) {
  Write-Host "  HTTPS: https://$Domain (redirects enabled)" -ForegroundColor White
}

Write-Host "`nNext Steps:" -ForegroundColor Cyan
Write-Host "  1. Verify DNS: Ensure $Domain points to $ServerIP" -ForegroundColor White
Write-Host "  2. Test in browser: Visit http://$Domain" -ForegroundColor White
if ($EnableSSL) {
  Write-Host "  3. Verify SSL: Check https://$Domain and certificate details" -ForegroundColor White
  Write-Host "  4. (Optional) Enable Cloudflare proxy after SSL is confirmed" -ForegroundColor White
} else {
  Write-Host "  3. Enable SSL: Re-run with -EnableSSL -Email <email>" -ForegroundColor White
}
Write-Host "  5. Update content: Edit ./website/* and re-run this script" -ForegroundColor White

Write-Host "`nTo redeploy:" -ForegroundColor Cyan
Write-Host "  .\deploy.ps1 -HostAlias $HostAlias -Domain $Domain -ServerIP $ServerIP" -ForegroundColor Yellow
if ($EnableSSL) {
  Write-Host "               -EnableSSL -Email $Email" -ForegroundColor Yellow
}

Write-Host "`nTroubleshooting:" -ForegroundColor Cyan
Write-Host "  - Check Apache logs: ssh $HostAlias 'sudo tail -f /var/log/apache2/$Domain-error.log'" -ForegroundColor White
Write-Host "  - Check Apache status: ssh $HostAlias 'sudo systemctl status apache2'" -ForegroundColor White
Write-Host "  - Verify DNS: nslookup $Domain" -ForegroundColor White
if ($EnableSSL) {
  Write-Host "  - Check certbot: ssh $HostAlias 'sudo certbot certificates'" -ForegroundColor White
}

Write-Host ""
