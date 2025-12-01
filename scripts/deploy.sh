#!/bin/bash
# =============================================================================
# Pawtropolis Tech - Bot Deployment Script
# =============================================================================
# Usage:
#   ./deploy.sh              Deploy code and restart bot
#   ./deploy.sh --restart    Just restart PM2 (no code deploy)
#   ./deploy.sh --logs       Show PM2 logs after deploy
#   ./deploy.sh --status     Check remote PM2 status
# =============================================================================

set -e

# Configuration
REMOTE_ALIAS="pawtech"
REMOTE_PATH="/home/ubuntu/pawtropolis-tech"
PM2_NAME="pawtropolis"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
RESTART_ONLY=false
SHOW_LOGS=false
STATUS_ONLY=false

for arg in "$@"; do
    case $arg in
        --restart)
            RESTART_ONLY=true
            ;;
        --logs)
            SHOW_LOGS=true
            ;;
        --status)
            STATUS_ONLY=true
            ;;
        --help|-h)
            echo "Usage: ./deploy.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --restart    Just restart PM2 (no code deploy)"
            echo "  --logs       Show PM2 logs after deploy"
            echo "  --status     Check remote PM2 status"
            echo "  --help       Show this help message"
            exit 0
            ;;
    esac
done

# Status check only
if [ "$STATUS_ONLY" = true ]; then
    echo -e "${CYAN}=== Remote PM2 Status ===${NC}"
    ssh "$REMOTE_ALIAS" "bash -lc 'pm2 list'"
    exit 0
fi

# Restart only
if [ "$RESTART_ONLY" = true ]; then
    echo -e "${CYAN}=== Restarting Remote Bot ===${NC}"
    echo -e "${YELLOW}[1/1]${NC} Restarting PM2 process..."
    ssh "$REMOTE_ALIAS" "bash -lc 'pm2 restart $PM2_NAME'"
    echo -e "${GREEN}✓ Bot restarted${NC}"

    if [ "$SHOW_LOGS" = true ]; then
        echo ""
        echo -e "${CYAN}=== PM2 Logs ===${NC}"
        ssh "$REMOTE_ALIAS" "bash -lc 'pm2 logs $PM2_NAME --lines 20 --nostream'"
    fi
    exit 0
fi

# Full deployment
echo -e "${CYAN}=== Pawtropolis Bot Deployment ===${NC}"
echo ""

# Step 1: Check prerequisites
echo -e "${YELLOW}[1/6]${NC} Checking prerequisites..."
command -v npm >/dev/null 2>&1 || { echo -e "${RED}Error: npm not found${NC}"; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo -e "${RED}Error: ssh not found${NC}"; exit 1; }
command -v scp >/dev/null 2>&1 || { echo -e "${RED}Error: scp not found${NC}"; exit 1; }
command -v tar >/dev/null 2>&1 || { echo -e "${RED}Error: tar not found${NC}"; exit 1; }
echo -e "${GREEN}✓ All tools available${NC}"

# Step 2: Run tests
echo -e "${YELLOW}[2/6]${NC} Running tests..."
if ! npm test; then
    echo -e "${RED}Error: Tests failed. Aborting deployment.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Tests passed${NC}"

# Step 3: Build project
echo -e "${YELLOW}[3/6]${NC} Building project..."
if ! npm run build; then
    echo -e "${RED}Error: Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Build complete${NC}"

# Step 4: Create deployment tarball
echo -e "${YELLOW}[4/6]${NC} Creating deployment package..."
rm -f deploy.tar.gz
tar -czf deploy.tar.gz dist package.json package-lock.json migrations scripts
TARBALL_SIZE=$(ls -lh deploy.tar.gz | awk '{print $5}')
echo -e "${GREEN}✓ Created deploy.tar.gz ($TARBALL_SIZE)${NC}"

# Step 5: Upload to remote
echo -e "${YELLOW}[5/6]${NC} Uploading to remote server..."
if ! scp deploy.tar.gz "$REMOTE_ALIAS:$REMOTE_PATH/"; then
    echo -e "${RED}Error: Failed to upload tarball${NC}"
    rm -f deploy.tar.gz
    exit 1
fi
echo -e "${GREEN}✓ Uploaded to $REMOTE_ALIAS:$REMOTE_PATH/${NC}"

# Step 6: Extract, install, and restart
echo -e "${YELLOW}[6/6]${NC} Deploying on remote server..."
ssh "$REMOTE_ALIAS" "bash -lc '
    cd $REMOTE_PATH && \
    echo \"  Extracting...\" && \
    tar -xzf deploy.tar.gz && \
    echo \"  Installing dependencies...\" && \
    npm ci --omit=dev && \
    echo \"  Restarting PM2...\" && \
    pm2 restart $PM2_NAME || pm2 start $REMOTE_PATH/dist/index.js --name $PM2_NAME && \
    echo \"  Cleaning up...\" && \
    rm -f deploy.tar.gz
'"
echo -e "${GREEN}✓ Deployment complete${NC}"

# Cleanup local tarball
rm -f deploy.tar.gz

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  DEPLOYMENT SUCCESSFUL!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Show logs if requested
if [ "$SHOW_LOGS" = true ]; then
    echo -e "${CYAN}=== PM2 Logs ===${NC}"
    ssh "$REMOTE_ALIAS" "bash -lc 'pm2 logs $PM2_NAME --lines 30 --nostream'"
else
    echo "Run './deploy.sh --status' to check bot status"
    echo "Run 'ssh $REMOTE_ALIAS \"pm2 logs $PM2_NAME\"' to view logs"
fi
