#!/bin/bash
# Pawtropolis Tech - Remote Deployment Script
# Ubuntu 22.04+ / Node.js 20+ / PM2
# Run as: bash remote-deploy.sh

set -Eeuo pipefail

# Script version
VERSION="1.1.0"

# Configuration
readonly DEFAULT_REPO_DIR="/home/ubuntu/pawtech-v2"
readonly DEFAULT_PM2_APP="pawtropolis"
readonly NODE_PORT="3000"
readonly PUBLIC_URL="https://pawtropolis.tech"
readonly HEALTH_CHECK_RETRIES=3
readonly HEALTH_CHECK_DELAY=2

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# User-configurable via env vars or flags
REPO_DIR="${REPO_DIR:-$DEFAULT_REPO_DIR}"
PM2_APP="${PM2_APP:-$DEFAULT_PM2_APP}"
SKIP_GIT_PULL=false
SKIP_RESTART=false

# Print usage information
usage() {
  cat <<EOF
${BLUE}Pawtropolis Remote Deployment${NC}

USAGE:
  bash remote-deploy.sh [OPTIONS]

OPTIONS:
  --no-pull         Skip git pull (use local changes only)
  --skip-restart    Build without restarting the app
  --app NAME        PM2 app name (default: ${DEFAULT_PM2_APP})
  --dir PATH        Repository directory (default: ${DEFAULT_REPO_DIR})
  --help, -h        Show this help message
  --version, -v     Show script version

DESCRIPTION:
  Automates deployment of Pawtropolis Tech on the remote server.
  Performs git pull, npm install, build, and PM2 restart with health checks.

PREREQUISITES:
  - Node.js 20+ installed
  - PM2 installed globally (npm i -g pm2)
  - Git repository cloned to ${DEFAULT_REPO_DIR}
  - .env file configured with production values
  - Apache reverse proxy configured (see setup-apache-proxy.sh)

WHAT IT DOES:
  1. Changes to repository directory
  2. Pulls latest code from git (unless --no-pull)
  3. Installs dependencies (npm ci)
  4. Builds the application (npm run build)
  5. Ensures PM2 is installed
  6. Restarts or starts the app with PM2
  7. Performs health checks on public endpoints
  8. Shows recent logs for verification

ENVIRONMENT VARIABLES:
  REPO_DIR          Override default repository directory
  PM2_APP           Override default PM2 app name

EXAMPLES:
  # Standard deployment
  bash remote-deploy.sh

  # Deploy local changes without pulling
  bash remote-deploy.sh --no-pull

  # Build without restarting
  bash remote-deploy.sh --skip-restart

  # Use custom app name
  bash remote-deploy.sh --app my-bot

EXIT CODES:
  0 - Deployment succeeded
  1 - Deployment failed (build error, health check failed, etc.)
  2 - Prerequisites missing or invalid configuration

For troubleshooting, see deploy/REMOTE-CONTROL.md

EOF
}

# Parse command line arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-pull)
        SKIP_GIT_PULL=true
        shift
        ;;
      --skip-restart)
        SKIP_RESTART=true
        shift
        ;;
      --app)
        PM2_APP="$2"
        shift 2
        ;;
      --dir)
        REPO_DIR="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      --version|-v)
        echo "remote-deploy.sh version ${VERSION}"
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
  echo -e "${BLUE}[remote] Validating prerequisites...${NC}"

  local errors=0

  # Check required commands
  for cmd in git npm node; do
    if ! command_exists "$cmd"; then
      echo -e "${RED}✗ Missing required command: $cmd${NC}"
      errors=$((errors + 1))
    fi
  done

  # Check if directory exists
  if [[ ! -d "$REPO_DIR" ]]; then
    echo -e "${RED}✗ Repository directory not found: $REPO_DIR${NC}"
    echo "  Clone the repo first: git clone <repo-url> $REPO_DIR"
    errors=$((errors + 1))
  fi

  # Check if .env exists
  if [[ ! -f "$REPO_DIR/.env" ]]; then
    echo -e "${YELLOW}⚠ Warning: .env file not found in $REPO_DIR${NC}"
    echo "  Make sure environment variables are configured"
  fi

  if [[ $errors -gt 0 ]]; then
    echo -e "${RED}✗ Prerequisites check failed with ${errors} error(s)${NC}"
    exit 2
  fi

  echo -e "${GREEN}✓ Prerequisites validated${NC}"
}

# Change to repository directory
change_directory() {
  echo -e "${YELLOW}[remote] Changing to repository directory...${NC}"
  echo "  Directory: $REPO_DIR"

  if ! cd "$REPO_DIR"; then
    echo -e "${RED}✗ Failed to change to directory: $REPO_DIR${NC}"
    exit 2
  fi

  echo -e "${GREEN}✓ Working directory: $(pwd)${NC}"
}

# Pull latest code from git
pull_code() {
  if [[ "$SKIP_GIT_PULL" == true ]]; then
    echo -e "${BLUE}[remote] Skipping git pull (--no-pull flag)${NC}"
    return 0
  fi

  echo -e "${YELLOW}[remote] Pulling latest code from git...${NC}"

  # Check if there are uncommitted changes
  if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo -e "${YELLOW}⚠ Warning: Working directory has uncommitted changes${NC}"
    echo "  Stash changes before pulling: git stash"
  fi

  # Attempt fast-forward pull
  if git pull --ff-only 2>&1; then
    echo -e "${GREEN}✓ Git pull successful${NC}"
  else
    echo -e "${YELLOW}⚠ Git pull failed or not fast-forward - continuing with local code${NC}"
  fi
}

# Install dependencies
install_dependencies() {
  echo -e "${YELLOW}[remote] Installing dependencies...${NC}"

  if ! npm ci; then
    echo -e "${RED}✗ npm ci failed${NC}"
    echo "  Try: rm -rf node_modules package-lock.json && npm install"
    exit 1
  fi

  echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# Build application
build_application() {
  echo -e "${YELLOW}[remote] Building application...${NC}"

  if ! npm run build; then
    echo -e "${RED}✗ Build failed${NC}"
    echo "  Check build logs above for errors"
    exit 1
  fi

  # Verify dist directory was created
  if [[ ! -d "dist" ]]; then
    echo -e "${RED}✗ Build output (dist/) not found${NC}"
    exit 1
  fi

  echo -e "${GREEN}✓ Build successful${NC}"
}

# Ensure PM2 is installed
ensure_pm2() {
  echo -e "${YELLOW}[remote] Ensuring PM2 is installed...${NC}"

  if ! command_exists pm2; then
    echo "  Installing PM2 globally..."
    if npm i -g pm2; then
      echo -e "${GREEN}✓ PM2 installed${NC}"
      # Install log rotation
      pm2 install pm2-logrotate 2>/dev/null || echo "  Note: pm2-logrotate installation skipped"
    else
      echo -e "${RED}✗ Failed to install PM2${NC}"
      echo "  Install manually: npm i -g pm2"
      exit 2
    fi
  else
    echo -e "${GREEN}✓ PM2 is already installed${NC}"
  fi
}

# Restart application with PM2
restart_application() {
  if [[ "$SKIP_RESTART" == true ]]; then
    echo -e "${BLUE}[remote] Skipping app restart (--skip-restart flag)${NC}"
    return 0
  fi

  echo -e "${YELLOW}[remote] Restarting application with PM2...${NC}"
  echo "  App name: $PM2_APP"

  # Check if app is already running
  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    echo "  App exists, restarting..."
    if pm2 restart "$PM2_APP" --update-env; then
      echo -e "${GREEN}✓ App restarted${NC}"
    else
      echo -e "${RED}✗ PM2 restart failed${NC}"
      exit 1
    fi
  else
    echo "  App doesn't exist, starting for first time..."
    # Use the "start" script from package.json
    if pm2 start npm --name "$PM2_APP" -- start; then
      echo -e "${GREEN}✓ App started${NC}"
    else
      echo -e "${RED}✗ PM2 start failed${NC}"
      exit 1
    fi
  fi

  # Save PM2 process list
  pm2 save >/dev/null 2>&1 || echo "  Note: pm2 save skipped"

  # Wait for app to initialize
  echo "  Waiting ${HEALTH_CHECK_DELAY}s for app to initialize..."
  sleep "$HEALTH_CHECK_DELAY"
}

# Show PM2 status
show_pm2_status() {
  echo -e "${YELLOW}[remote] PM2 status:${NC}"
  pm2 status "$PM2_APP" 2>/dev/null || echo "  Warning: Could not get PM2 status"
  echo ""
}

# Check if port is listening
check_port() {
  echo -e "${YELLOW}[remote] Checking if app is listening on port ${NODE_PORT}...${NC}"

  if ss -tlnp 2>/dev/null | grep -q ":${NODE_PORT}"; then
    echo -e "${GREEN}✓ App is listening on port ${NODE_PORT}${NC}"
    return 0
  else
    echo -e "${RED}✗ App is NOT listening on port ${NODE_PORT}${NC}"
    return 1
  fi
}

# Health check with retries
health_check() {
  echo -e "${YELLOW}[remote] Running health checks...${NC}"

  local retry=0
  local max_retries=$HEALTH_CHECK_RETRIES

  while [[ $retry -lt $max_retries ]]; do
    if [[ $retry -gt 0 ]]; then
      echo "  Retry $retry/$max_retries after ${HEALTH_CHECK_DELAY}s..."
      sleep "$HEALTH_CHECK_DELAY"
    fi

    # Test OAuth login endpoint (should redirect to Discord)
    echo -n "  Testing /auth/login... "
    local auth_status
    auth_status=$(curl -skI "${PUBLIC_URL}/auth/login" 2>/dev/null | head -n 1 | awk '{print $2}')
    if [[ "$auth_status" == "302" ]]; then
      echo -e "${GREEN}✓ HTTP $auth_status${NC}"
    else
      echo -e "${RED}✗ HTTP ${auth_status:-000}${NC}"
      retry=$((retry + 1))
      continue
    fi

    # Test /auth/me endpoint (should return 401 when not logged in)
    echo -n "  Testing /auth/me... "
    local me_status
    me_status=$(curl -sk -o /dev/null -w "%{http_code}" "${PUBLIC_URL}/auth/me" 2>/dev/null)
    if [[ "$me_status" == "401" ]]; then
      echo -e "${GREEN}✓ HTTP $me_status${NC}"
      echo -e "${GREEN}✓ Health checks passed${NC}"
      return 0
    else
      echo -e "${RED}✗ HTTP ${me_status:-000}${NC}"
      retry=$((retry + 1))
    fi
  done

  echo -e "${RED}✗ Health checks failed after $max_retries attempts${NC}"
  return 1
}

# Show recent logs
show_logs() {
  echo -e "${YELLOW}[remote] Recent application logs (last 20 lines):${NC}"
  echo "----------------------------------------"
  pm2 logs "$PM2_APP" --lines 20 --nostream 2>/dev/null || echo "  Warning: Could not retrieve logs"
  echo "----------------------------------------"
  echo ""
}

# Print summary
print_summary() {
  local status=$1

  echo ""
  if [[ $status -eq 0 ]]; then
    echo -e "${GREEN}=== Deployment Successful! ===${NC}"
    echo ""
    echo "Summary:"
    echo "  ✓ Code pulled from git"
    echo "  ✓ Dependencies installed"
    echo "  ✓ Application built"
    echo "  ✓ PM2 app restarted"
    echo "  ✓ Health checks passed"
    echo ""
    echo "Next steps:"
    echo "1. Test the application:"
    echo "   ${PUBLIC_URL}/"
    echo ""
    echo "2. Monitor logs:"
    echo "   pm2 logs $PM2_APP"
    echo "   tail -f /var/log/apache2/pawtropolis-error.log"
    echo ""
    echo "3. Check PM2 status:"
    echo "   pm2 status"
  else
    echo -e "${RED}=== Deployment Failed ===${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check PM2 logs:"
    echo "   pm2 logs $PM2_APP"
    echo ""
    echo "2. Check PM2 status:"
    echo "   pm2 status"
    echo ""
    echo "3. Test app directly (bypass Apache):"
    echo "   curl -I http://127.0.0.1:${NODE_PORT}/auth/login"
    echo ""
    echo "4. Restart manually:"
    echo "   pm2 restart $PM2_APP"
    echo ""
    echo "5. Check for port conflicts:"
    echo "   ss -tlnp | grep ${NODE_PORT}"
  fi
  echo ""
}

# Main execution
main() {
  parse_args "$@"

  echo -e "${BLUE}=== Pawtropolis Remote Deployment ===${NC}"
  echo ""

  # Validate and prepare
  validate_prerequisites
  change_directory

  # Build process
  pull_code
  install_dependencies
  build_application

  # PM2 process management
  ensure_pm2
  restart_application
  show_pm2_status

  # Verification
  local deployment_status=0
  if ! check_port; then
    deployment_status=1
  elif ! health_check; then
    deployment_status=1
  fi

  # Show logs and summary
  show_logs
  print_summary "$deployment_status"

  exit "$deployment_status"
}

# Run main function with all arguments
main "$@"
