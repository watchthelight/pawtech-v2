# Deployment Audit

Generated: 2026-01-11

## Overview

Primary deployment method: `./deploy.sh` script deploying to pawtech server via SSH/SCP.

---

## 1. Current Deployment Flow

```
Local Machine                    Remote Server (pawtech)
     |                                  |
     | 1. npm test                      |
     | 2. npm run build                 |
     | 3. tar -czf deploy.tar.gz        |
     |                                  |
     | 4. scp deploy.tar.gz ---------> |
     |                                  | 5. tar -xzf
     |                                  | 6. npm ci --omit=dev
     |                                  | 7. pm2 restart
     |                                  |
     | 8. rm deploy.tar.gz (local)      |
```

---

## 2. Robustness Analysis

### Good Practices (Keep)

| Practice | Location | Notes |
|----------|----------|-------|
| `set -e` | Line 2 | Exits on any error |
| Tests before deploy | Step 1 | Catches issues early |
| Build before deploy | Step 2 | Ensures clean build |
| Production deps only | Step 5 | `npm ci --omit=dev` |
| Cleanup after deploy | Line 86 | Removes local tarball |

### Gaps Identified

| Issue | Severity | Description |
|-------|----------|-------------|
| No `set -u` | P2 | Unset variables won't error |
| No `set -o pipefail` | P2 | Piped command failures ignored |
| No remote cleanup | P1 | Old tarball stays on server |
| No validation | P1 | No health check after restart |
| No rollback | P1 | No way to revert bad deploy |
| No backup | P2 | DB not backed up before deploy |
| No lock | P2 | Concurrent deploys possible |
| No timeout | P2 | SSH can hang forever |
| Secrets in code | P1 | `REMOTE_HOST` hardcoded |

---

## 3. Speed Analysis

### Current Timing (Estimated)

| Step | Time | Notes |
|------|------|-------|
| Tests | ~10s | `vitest run` |
| Build | ~5s | `tsup` |
| Tarball | <1s | Small project |
| Upload | ~5s | Depends on connection |
| Extract + npm ci | ~30s | Network + install |
| PM2 restart | <2s | Fast |
| **Total** | ~55s | |

### Speed Improvements

| Improvement | Potential Savings | Complexity |
|-------------|------------------|------------|
| Skip tests with `--fast` flag | 10s | S |
| Use rsync instead of tar | Varies | M |
| Parallel test + build | 5s | S |
| Cache node_modules on remote | 20s | M |

---

## 4. Recommended Changes

### Immediate (P1)

```bash
#!/bin/bash
set -euo pipefail  # Add -u and -o pipefail

# Add validation after PM2 restart
echo "Step 7/7: Validating deployment..."
sleep 3
ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 show ${PM2_PROCESS} | grep -q 'online'" || {
  echo "ERROR: Process not online after restart!"
  exit 1
}
```

### Recommended (P2)

```bash
# Add remote cleanup
ssh ${REMOTE_USER}@${REMOTE_HOST} "rm -f ${REMOTE_PATH}/${TARBALL}"

# Add timeout to SSH commands
ssh -o ConnectTimeout=10 -o ServerAliveInterval=5 ${REMOTE_USER}@${REMOTE_HOST} "..."

# Add deploy lock
LOCKFILE="${REMOTE_PATH}/.deploy.lock"
ssh ${REMOTE_USER}@${REMOTE_HOST} "mkdir ${LOCKFILE}" 2>/dev/null || {
  echo "ERROR: Another deployment in progress"
  exit 1
}
trap "ssh ${REMOTE_USER}@${REMOTE_HOST} 'rmdir ${LOCKFILE}'" EXIT
```

### Future (P3)

1. **Database backup before deploy:**
```bash
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && cp data/data.db data/backups/pre-deploy-$(date +%Y%m%d_%H%M%S).db"
```

2. **Rollback capability:**
```bash
# Keep previous build
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && mv dist dist.backup"
```

3. **Health check endpoint:**
```bash
# Call /health endpoint after restart
curl -sf http://localhost:3000/health || exit 1
```

---

## 5. Alternative Deployment Strategies

### Option A: rsync (Recommended)

```bash
# Replace tar/scp with rsync
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'data' \
  dist migrations package*.json ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/
```

**Pros:** Incremental, faster for small changes
**Cons:** Requires rsync on both ends

### Option B: Git-based deploy

```bash
# Pull from Git on remote
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && git pull && npm ci --omit=dev && npm run build && pm2 restart ${PM2_PROCESS}"
```

**Pros:** Clean, auditable
**Cons:** Requires build on server, exposes .git

### Option C: Container-based (Future)

```bash
# Build and push Docker image
docker build -t pawtropolis-tech .
docker push registry/pawtropolis-tech
ssh ${REMOTE_USER}@${REMOTE_HOST} "docker pull registry/pawtropolis-tech && docker-compose up -d"
```

**Pros:** Immutable, rollback easy
**Cons:** Requires Docker setup, more complex

---

## 6. Recommended Patch

```bash
#!/bin/bash
# deploy.sh - Patched version
set -euo pipefail

REMOTE_USER="ubuntu"
REMOTE_HOST="pawtech"
REMOTE_PATH="/home/ubuntu/pawtropolis-tech"
PM2_PROCESS="pawtropolis"
TARBALL="deploy.tar.gz"
SSH_OPTS="-o ConnectTimeout=10 -o ServerAliveInterval=5"

# ... (rest of existing logic) ...

# After PM2 restart, add:
echo "Validating deployment..."
sleep 3
ssh ${SSH_OPTS} ${REMOTE_USER}@${REMOTE_HOST} "pm2 show ${PM2_PROCESS} | grep -q 'online'" || {
  echo "ERROR: Deployment validation failed!"
  exit 1
}

# Cleanup remote tarball
ssh ${SSH_OPTS} ${REMOTE_USER}@${REMOTE_HOST} "rm -f ${REMOTE_PATH}/${TARBALL}"

echo "Deployment completed and validated!"
```

---

## Summary

| Category | Status | Priority |
|----------|--------|----------|
| Basic structure | ✅ Good | - |
| Error handling | ⚠️ Partial | P2 |
| Validation | ❌ Missing | P1 |
| Rollback | ❌ Missing | P1 |
| Speed | ⚠️ Acceptable | P3 |
| Security | ⚠️ Hardcoded hosts | P2 |

**Recommended Commits:**

1. `fix(deploy): add set -uo pipefail for stricter error handling`
2. `feat(deploy): add post-deploy validation`
3. `feat(deploy): add remote tarball cleanup`
4. `feat(deploy): add SSH timeout options`
