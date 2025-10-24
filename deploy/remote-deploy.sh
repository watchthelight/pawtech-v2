#!/bin/bash
# Pawtropolis Tech - Remote Deployment Script
# Builds, (re)starts, and verifies the app on remote server

set -Eeuo pipefail

REPO_DIR="/home/ubuntu/pawtropolis-tech"
PM2_APP="pawtropolis"
NODE_PORT=3000
PUBLIC_URL="https://pawtropolis.tech"

echo "[remote] cwd -> $REPO_DIR"
cd "$REPO_DIR"

echo "[remote] git pull (safe fast-forward)"
git pull --ff-only || true

echo "[remote] install dev deps (tsup etc.)"
npm ci

echo "[remote] build"
npm run build

echo "[remote] ensure pm2"
if ! command -v pm2 >/dev/null 2>&1; then
  npm i -g pm2
  pm2 install pm2-logrotate || true
fi

echo "[remote] restart or start app with pm2"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP" --update-env
else
  # Use the "start" script from package.json to run the server
  pm2 start npm --name "$PM2_APP" -- start
fi
pm2 save || true

echo "[remote] pm2 status"
pm2 status "$PM2_APP" || true

echo "[remote] port check (:${NODE_PORT})"
(ss -tlnp | grep ":${NODE_PORT}") || echo "WARNING: not listening on :${NODE_PORT}"

echo "[remote] Apache -> /auth/login (expect 302 Location: discord)"
curl -skI "${PUBLIC_URL}/auth/login" | sed -n "1,8p"

echo "[remote] /auth/me (expect 401 when not logged in)"
curl -skI "${PUBLIC_URL}/auth/me" | sed -n "1,8p"

echo "[remote] tail app logs (pm2)"
pm2 logs "$PM2_APP" --lines 20 --nostream || true

echo "[remote] done"
