# Start Pawtropolis (remote) — PowerShell
# Uses SSH alias "pawtech" and your PEM key.

$ErrorActionPreference = "Stop"

$KEY = "D:\pawtropolis-tech\authentication\pawtropolis-tech.pem"
$REMOTE_HOST = "pawtech"

# Candidate repo paths on the remote (first that exists wins)
$remoteScript = @'
set -Eeuo pipefail

# 1) cd into repo
if [ -d "/srv/pawtropolis" ]; then
  cd /srv/pawtropolis
elif [ -d "$HOME/pawtropolis-tech" ]; then
  cd "$HOME/pawtropolis-tech"
else
  echo "[fatal] repo dir not found (/srv/pawtropolis or ~/pawtropolis-tech)"; exit 1
fi
echo "[remote] cwd: $(pwd)"

# 2) update + install + build
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git pull --ff-only || true
fi

npm ci --omit=dev
npm run build:web --if-present
npm run build --if-present

# 3) start via PM2 if available, else nohup
if command -v pm2 >/dev/null 2>&1; then
  pm2 describe pawtropolis >/dev/null 2>&1 \
    && pm2 restart pawtropolis --update-env \
    || pm2 start dist/index.js --name pawtropolis --update-env
  pm2 save || true
else
  pkill -f "node .*dist/index.js" || true
  mkdir -p logs
  nohup node dist/index.js >> logs/out.log 2>> logs/err.log < /dev/null &
fi

# 4) quick health
echo "[remote] listening on :3000 ?"
(ss -tlnp | grep ":3000") || echo "WARNING: not listening on :3000"

echo "[remote] /auth/login (expect 302 → discord)"
curl -skI https://pawtropolis.tech/auth/login -o /dev/null -D - | egrep -i '^(HTTP/|Location:)'
'@

# Send and run the script on remote
Write-Host "[local] Connecting to $REMOTE_HOST via SSH (this may take a minute)..."
ssh -o IdentitiesOnly=yes -o ConnectTimeout=60 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=no -i $KEY $REMOTE_HOST "bash -lc $([System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($remoteScript))"

if ($LASTEXITCODE -ne 0) {
    Write-Host "[local] ERROR: SSH command failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

Write-Host "[local] Remote deployment completed successfully!" -ForegroundColor Green
