#!/bin/bash
# Pawtropolis Tech - Apache Reverse Proxy Verification Script
# Ubuntu 22.04+ / Apache 2.4 / Node.js 20+
# Run as: bash verify-proxy-setup.sh

set -euo pipefail

# Script version
VERSION="1.1.0"

# Configuration
readonly DOMAIN="https://pawtropolis.tech"
readonly NODE_PORT="3000"
readonly PM2_APP="pawtropolis"
readonly CURL_TIMEOUT="10"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Flags
VERBOSE=false
QUIET=false

# Counters for results
TESTS_PASSED=0
TESTS_FAILED=0

# Print usage information
usage() {
  cat <<EOF
${BLUE}Pawtropolis Proxy Verification${NC}

USAGE:
  bash verify-proxy-setup.sh [OPTIONS]

OPTIONS:
  --verbose, -v    Show detailed output for each test
  --quiet, -q      Only show errors and final summary
  --help, -h       Show this help message
  --version        Show script version

DESCRIPTION:
  Verifies that Apache reverse proxy is correctly configured and working
  with the Pawtropolis Node.js application. Tests all critical endpoints
  including static files, OAuth redirects, API proxying, and SPA fallback.

PREREQUISITES:
  - Apache 2.4+ running with proxy modules enabled
  - Node.js app running on port ${NODE_PORT}
  - PM2 managing the application (name: ${PM2_APP})
  - SSL certificate configured for ${DOMAIN}

WHAT IT TESTS:
  1. Node app listening on port ${NODE_PORT}
  2. Apache service is active
  3. Static site (index.html) serves correctly
  4. Static assets (CSS, JS) load properly
  5. OAuth login redirects to Discord
  6. Auth endpoints are proxied to Node app
  7. API endpoints are proxied to Node app
  8. SPA fallback routing works

EXAMPLES:
  # Standard verification
  bash verify-proxy-setup.sh

  # Detailed output
  bash verify-proxy-setup.sh --verbose

  # Only show problems
  bash verify-proxy-setup.sh --quiet

EXIT CODES:
  0 - All tests passed
  1 - One or more tests failed
  2 - Critical prerequisite missing (Node app or Apache not running)

For troubleshooting, see deploy/APACHE-PROXY-SETUP.md

EOF
}

# Parse command line arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --verbose|-v)
        VERBOSE=true
        shift
        ;;
      --quiet|-q)
        QUIET=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      --version)
        echo "verify-proxy-setup.sh version ${VERSION}"
        exit 0
        ;;
      *)
        echo -e "${RED}ERROR: Unknown option: $1${NC}" >&2
        echo "Run with --help for usage information"
        exit 1
        ;;
    esac
  done

  # Quiet overrides verbose
  if [[ "$QUIET" == true ]]; then
    VERBOSE=false
  fi
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Print message based on verbosity
log_info() {
  if [[ "$QUIET" != true ]]; then
    echo -e "$@"
  fi
}

log_verbose() {
  if [[ "$VERBOSE" == true ]]; then
    echo -e "$@"
  fi
}

log_error() {
  echo -e "$@" >&2
}

# Test endpoint with timeout
test_endpoint() {
  local url=$1
  local expected_code=$2
  local description=$3
  local extra_curl_args=${4:-}

  log_verbose "  URL: $url"
  log_verbose "  Expected: HTTP $expected_code"

  local status
  if ! status=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time "$CURL_TIMEOUT" $extra_curl_args "$url" 2>&1); then
    log_error "${RED}✗ $description - Timeout or connection error${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi

  if [ "$status" = "$expected_code" ]; then
    log_info "${GREEN}✓ $description (HTTP $status)${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    log_error "${RED}✗ $description - Expected $expected_code, got $status${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Check if Node app is running
check_node_app() {
  log_info "${YELLOW}[1/8] Checking if Node app is running on port ${NODE_PORT}...${NC}"

  if ! command_exists ss; then
    log_error "${RED}✗ 'ss' command not found (install iproute2)${NC}"
    exit 2
  fi

  if ss -tlnp 2>/dev/null | grep -q ":${NODE_PORT}"; then
    log_info "${GREEN}✓ Node app is listening on port ${NODE_PORT}${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))

    if [[ "$VERBOSE" == true ]] && command_exists pm2; then
      log_verbose "\nPM2 Status:"
      pm2 list 2>/dev/null | grep -E "(${PM2_APP}|name)" || echo "  PM2 app not found"
    fi
  else
    log_error "${RED}✗ Node app is NOT running on port ${NODE_PORT}${NC}"
    log_error "  Start the app: pm2 start ecosystem.config.js"
    log_error "  Or manually: npm start"
    exit 2
  fi
  log_info ""
}

# Check Apache status
check_apache() {
  log_info "${YELLOW}[2/8] Checking Apache status...${NC}"

  if ! command_exists systemctl; then
    log_error "${RED}✗ 'systemctl' command not found (non-systemd system?)${NC}"
    exit 2
  fi

  if systemctl is-active --quiet apache2 2>/dev/null; then
    log_info "${GREEN}✓ Apache is running${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))

    if [[ "$VERBOSE" == true ]]; then
      log_verbose "\nApache Status:"
      systemctl status apache2 --no-pager -l 2>/dev/null | head -n 5
    fi
  else
    log_error "${RED}✗ Apache is not running${NC}"
    log_error "  Start Apache: sudo systemctl start apache2"
    log_error "  Check status: sudo systemctl status apache2"
    exit 2
  fi
  log_info ""
}

# Test static site
test_static_site() {
  log_info "${YELLOW}[3/8] Testing static site...${NC}"
  test_endpoint "$DOMAIN/" "200" "Homepage (index.html)"
  log_info ""
}

# Test static assets
test_static_assets() {
  log_info "${YELLOW}[4/8] Testing static assets...${NC}"
  test_endpoint "$DOMAIN/styles.css" "200" "Stylesheet (styles.css)"
  test_endpoint "$DOMAIN/app.js" "200" "JavaScript (app.js)"
  test_endpoint "$DOMAIN/app.css" "200" "App stylesheet (app.css)"
  log_info ""
}

# Test OAuth login redirect
test_oauth_redirect() {
  log_info "${YELLOW}[5/8] Testing OAuth login redirect...${NC}"

  log_verbose "  Checking if /auth/login redirects to Discord OAuth..."

  local auth_redirect
  if ! auth_redirect=$(curl -s -o /dev/null -w "%{redirect_url}" -L --max-time "$CURL_TIMEOUT" "$DOMAIN/auth/login" 2>&1); then
    log_error "${RED}✗ /auth/login - Timeout or connection error${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  elif [[ $auth_redirect == *"discord.com"* ]]; then
    log_info "${GREEN}✓ /auth/login redirects to Discord OAuth${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    log_verbose "  Redirect URL: $auth_redirect"
  else
    log_error "${RED}✗ /auth/login does not redirect to Discord${NC}"
    log_error "  Got: $auth_redirect"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
  log_info ""
}

# Test auth endpoints
test_auth_endpoints() {
  log_info "${YELLOW}[6/8] Testing authentication endpoints...${NC}"
  test_endpoint "$DOMAIN/auth/me" "401" "User info endpoint (expects 401 when not logged in)"
  log_info ""
}

# Test API endpoints
test_api_endpoints() {
  log_info "${YELLOW}[7/8] Testing API endpoints...${NC}"
  test_endpoint "$DOMAIN/api/metrics" "401" "Metrics API (expects 401 when not logged in)"
  test_endpoint "$DOMAIN/api/logs" "401" "Logs API (expects 401 when not logged in)"
  log_info ""
}

# Test SPA fallback
test_spa_fallback() {
  log_info "${YELLOW}[8/8] Testing SPA fallback...${NC}"
  test_endpoint "$DOMAIN/dashboard" "200" "SPA route (/dashboard → index.html)"
  test_endpoint "$DOMAIN/some-random-route" "200" "SPA fallback (random route → index.html)"
  log_info ""
}

# Print summary
print_summary() {
  local total_tests=$((TESTS_PASSED + TESTS_FAILED))

  log_info ""
  if [[ $TESTS_FAILED -eq 0 ]]; then
    log_info "${GREEN}=== All checks passed! ($TESTS_PASSED/$total_tests) ===${NC}"
  else
    log_error "${RED}=== Some checks failed! ($TESTS_FAILED/$total_tests failed) ===${NC}"
  fi
  log_info ""

  if [[ $TESTS_FAILED -eq 0 ]]; then
    log_info "Summary:"
    log_info "  ✓ Node app running on port ${NODE_PORT}"
    log_info "  ✓ Apache proxying /auth/* and /api/* to Fastify"
    log_info "  ✓ Static files serving correctly"
    log_info "  ✓ OAuth login redirects to Discord"
    log_info "  ✓ API endpoints protected (401 when not authenticated)"
    log_info "  ✓ SPA fallback to index.html working"
    log_info ""
    log_info "Next steps:"
    log_info "1. Test full OAuth flow:"
    log_info "   - Visit ${DOMAIN}/auth/login"
    log_info "   - Login with Discord"
    log_info "   - Verify admin panel appears"
    log_info ""
    log_info "2. Monitor logs:"
    log_info "   - Apache: tail -f /var/log/apache2/pawtropolis-error.log"
    log_info "   - Node: pm2 logs ${PM2_APP}"
  else
    log_error ""
    log_error "Troubleshooting:"
    log_error "1. Check Apache configuration:"
    log_error "   sudo apachectl configtest"
    log_error "   sudo apache2ctl -S"
    log_error ""
    log_error "2. Check Apache error logs:"
    log_error "   sudo tail -f /var/log/apache2/pawtropolis-error.log"
    log_error ""
    log_error "3. Check Node app logs:"
    log_error "   pm2 logs ${PM2_APP}"
    log_error ""
    log_error "4. Test Node app directly (bypass Apache):"
    log_error "   curl -I http://127.0.0.1:${NODE_PORT}/auth/login"
    log_error ""
    log_error "5. Re-run Apache setup:"
    log_error "   sudo bash deploy/setup-apache-proxy.sh"
    log_error ""
    log_error "For detailed troubleshooting, see deploy/APACHE-PROXY-SETUP.md"
  fi

  log_info ""
}

# Main execution
main() {
  parse_args "$@"

  if [[ "$QUIET" != true ]]; then
    echo -e "${BLUE}=== Pawtropolis Proxy Verification ===${NC}"
    echo ""
  fi

  # Run all checks
  check_node_app
  check_apache
  test_static_site
  test_static_assets
  test_oauth_redirect
  test_auth_endpoints
  test_api_endpoints
  test_spa_fallback

  # Print summary and exit with appropriate code
  print_summary

  if [[ $TESTS_FAILED -eq 0 ]]; then
    exit 0
  else
    exit 1
  fi
}

# Run main function with all arguments
main "$@"
