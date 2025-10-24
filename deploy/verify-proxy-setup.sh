#!/bin/bash
# Pawtropolis Tech - Apache Reverse Proxy Verification Script
# Tests all endpoints to ensure proxy is working correctly

set -euo pipefail

DOMAIN="https://pawtropolis.tech"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== Pawtropolis Proxy Verification ==="
echo ""

# Function to test endpoint
test_endpoint() {
    local url=$1
    local expected_code=$2
    local description=$3

    echo -n "Testing $description... "

    status=$(curl -s -o /dev/null -w "%{http_code}" -L "$url" 2>/dev/null || echo "000")

    if [ "$status" = "$expected_code" ]; then
        echo -e "${GREEN}✓ $status${NC}"
        return 0
    else
        echo -e "${RED}✗ Expected $expected_code, got $status${NC}"
        return 1
    fi
}

# Test 1: Node app is running
echo -e "${YELLOW}[1/8] Checking if Node app is running on port 3000...${NC}"
if ss -tlnp | grep -q ":3000"; then
    echo -e "${GREEN}✓ Node app is listening on port 3000${NC}"
else
    echo -e "${RED}✗ Node app is NOT running on port 3000${NC}"
    echo "Start the app first: pm2 start ecosystem.config.js"
    exit 1
fi
echo ""

# Test 2: Apache is running
echo -e "${YELLOW}[2/8] Checking Apache status...${NC}"
if systemctl is-active --quiet apache2; then
    echo -e "${GREEN}✓ Apache is running${NC}"
else
    echo -e "${RED}✗ Apache is not running${NC}"
    echo "Start Apache: sudo systemctl start apache2"
    exit 1
fi
echo ""

# Test 3: Static site serves index.html
echo -e "${YELLOW}[3/8] Testing static site...${NC}"
test_endpoint "$DOMAIN/" "200" "Homepage (index.html)"
echo ""

# Test 4: Static assets load
echo -e "${YELLOW}[4/8] Testing static assets...${NC}"
test_endpoint "$DOMAIN/styles.css" "200" "Stylesheet (styles.css)"
test_endpoint "$DOMAIN/app.js" "200" "JavaScript (app.js)"
test_endpoint "$DOMAIN/app.css" "200" "App stylesheet (app.css)"
echo ""

# Test 5: OAuth login redirects to Discord
echo -e "${YELLOW}[5/8] Testing OAuth login redirect...${NC}"
auth_redirect=$(curl -s -o /dev/null -w "%{redirect_url}" -L "$DOMAIN/auth/login" 2>/dev/null || echo "")
if [[ $auth_redirect == *"discord.com"* ]]; then
    echo -e "${GREEN}✓ /auth/login redirects to Discord OAuth${NC}"
else
    echo -e "${RED}✗ /auth/login does not redirect to Discord${NC}"
    echo "  Got: $auth_redirect"
fi
echo ""

# Test 6: Auth endpoints are proxied (expect 401 when not logged in)
echo -e "${YELLOW}[6/8] Testing API authentication...${NC}"
test_endpoint "$DOMAIN/auth/me" "401" "User info endpoint (expects 401 when not logged in)"
echo ""

# Test 7: API endpoints are proxied (expect 401 when not logged in)
echo -e "${YELLOW}[7/8] Testing API endpoints...${NC}"
test_endpoint "$DOMAIN/api/metrics" "401" "Metrics API (expects 401 when not logged in)"
test_endpoint "$DOMAIN/api/logs" "401" "Logs API (expects 401 when not logged in)"
echo ""

# Test 8: SPA fallback works
echo -e "${YELLOW}[8/8] Testing SPA fallback...${NC}"
test_endpoint "$DOMAIN/dashboard" "200" "SPA route (/dashboard → index.html)"
test_endpoint "$DOMAIN/some-random-route" "200" "SPA fallback (random route → index.html)"
echo ""

echo -e "${GREEN}=== All checks passed! ===${NC}"
echo ""
echo "Summary:"
echo "  ✓ Node app running on port 3000"
echo "  ✓ Apache proxying /auth/* and /api/* to Fastify"
echo "  ✓ Static files serving correctly"
echo "  ✓ OAuth login redirects to Discord"
echo "  ✓ API endpoints protected (401 when not authenticated)"
echo "  ✓ SPA fallback to index.html working"
echo ""
echo "Next steps:"
echo "1. Test full OAuth flow:"
echo "   - Visit https://pawtropolis.tech/auth/login"
echo "   - Login with Discord"
echo "   - Verify admin panel appears"
echo ""
echo "2. Monitor logs:"
echo "   - Apache: tail -f /var/log/apache2/pawtropolis-error.log"
echo "   - Node: pm2 logs"
