#!/bin/bash
set -e

# Pawtropolis Deployment Script
# Deploys to pawtech server (Ubuntu, user: ubuntu)
# Remote path: /home/ubuntu/pawtropolis-tech/
# PM2 process: pawtropolis

REMOTE_USER="ubuntu"
REMOTE_HOST="pawtech"
REMOTE_PATH="/home/ubuntu/pawtropolis-tech"
PM2_PROCESS="pawtropolis"
TARBALL="deploy.tar.gz"

# Parse arguments
SHOW_LOGS=false
RESTART_ONLY=false
STATUS_ONLY=false

for arg in "$@"; do
  case $arg in
    --logs)
      SHOW_LOGS=true
      shift
      ;;
    --restart)
      RESTART_ONLY=true
      shift
      ;;
    --status)
      STATUS_ONLY=true
      shift
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--logs] [--restart] [--status]"
      exit 1
      ;;
  esac
done

# Status only
if [ "$STATUS_ONLY" = true ]; then
  echo "Checking PM2 status on remote server..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 status"
  exit 0
fi

# Restart only
if [ "$RESTART_ONLY" = true ]; then
  echo "Restarting PM2 process..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 restart ${PM2_PROCESS}"
  echo "Process restarted successfully!"
  exit 0
fi

# Full deployment
echo "Starting deployment to ${REMOTE_HOST}..."

# Step 1: Run tests
echo "Step 1/7: Running tests..."
npm test

# Step 2: Build
echo "Step 2/7: Building project..."
npm run build

# Step 3: Inject build metadata
# ─────────────────────────────────────────────────────────────────────────────
# This generates .env.build with:
#   BUILD_GIT_SHA     - Git commit hash for exact code identification
#   BUILD_TIMESTAMP   - ISO 8601 timestamp of when this build was created
#   BUILD_DEPLOY_ID   - Unique deployment identifier (date+sha)
#
# These values are read by src/lib/buildInfo.ts at runtime, enabling:
#   - Error correlation to exact commits in Sentry
#   - Wide event logs with build identity
#   - Error cards showing version+SHA
#   - /health command with deployment info
# ─────────────────────────────────────────────────────────────────────────────
echo "Step 3/7: Injecting build metadata..."
npx tsx scripts/inject-build-info.ts

# Step 4: Create tarball
# Include .env.build so the build metadata is available on the server
echo "Step 4/7: Creating deployment tarball..."
tar -czf ${TARBALL} dist migrations package.json package-lock.json .env.build

# Step 5: Upload to remote
echo "Step 5/7: Uploading to remote server..."
scp ${TARBALL} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/

# Step 6: Extract and install on remote
echo "Step 6/7: Extracting and installing on remote..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && tar -xzf ${TARBALL} && npm ci --omit=dev"

# Step 7: Restart PM2
echo "Step 7/7: Restarting PM2 process..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 restart ${PM2_PROCESS}"

# Cleanup
echo "Cleaning up local tarball..."
rm ${TARBALL}

echo ""
echo "Deployment completed successfully!"
echo ""

# Show logs if requested
if [ "$SHOW_LOGS" = true ]; then
  echo "Showing recent logs..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 logs ${PM2_PROCESS} --lines 50"
fi
