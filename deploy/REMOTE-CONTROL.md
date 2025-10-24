# Service Control Scripts (Local & Remote)

Simple scripts to start/stop the Pawtropolis Node.js service locally or on the remote server.

## Local Development (Default)

### Start locally

```cmd
.\start.cmd
# OR
.\start-local.ps1
```

This will:

1. Build the project if needed (`npm run build`)
2. Open a new terminal window
3. Start the bot using `npm run start`
4. Load environment from `.env` file

The bot runs in a **separate window**, so your terminal stays free.

### Stop locally

```cmd
.\stop.cmd
# OR just close the bot window
```

This will find and kill any local Node.js processes running Pawtropolis.

---

## Remote Deployment

### Prerequisites

- **SSH alias configured:** `pawtech` should resolve to your server
- **SSH key:** `D:\pawtropolis-tech\authentication\pawtropolis-tech.pem` must exist
- **SSH key auth working:** Test with `ssh -i D:\pawtropolis-tech\authentication\pawtropolis-tech.pem pawtech "echo connected"`

### Start remote service

```cmd
.\start.cmd --remote
# OR
.\start.ps1
```

**What it does:**

1. SSHs to remote server using the PEM key
2. Finds the repo directory (`/srv/pawtropolis` or `~/pawtropolis-tech`)
3. Pulls latest code (`git pull --ff-only`)
4. Installs dependencies (`npm ci --omit=dev`)
5. Builds the project (`npm run build`)
6. Starts via PM2 (or nohup if PM2 not installed)
7. Verifies port 3000 is listening
8. Tests `/auth/login` endpoint (expects 302 redirect to Discord)

**Expected output:**

```
[remote] cwd: /home/ubuntu/pawtropolis-tech
[remote] pulling latest...
[remote] installing deps...
[remote] building...
[remote] listening on :3000 ?
tcp LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=12345,fd=18))
[remote] /auth/login (expect 302 → discord)
HTTP/2 302
Location: https://discord.com/api/oauth2/authorize?client_id=...
```

### Stop remote service

```cmd
.\stop.cmd --remote
```

**What it does:**

1. SSHs to remote server
2. Stops PM2 process (or kills nohup node process)
3. Verifies port 3000 is free

**Expected output:**

```
[stop.cmd] Stopping remote service...
[stop.cmd] Connecting to pawtech via SSH...
[remote] stopped
[remote] port 3000 is free
[stop.cmd] Remote stop command completed!
```

## Troubleshooting

### SSH Connection Issues

**Error:** `Permission denied (publickey)`

**Fix:**

1. Check SSH key exists: `Test-Path D:\pawtropolis-tech\authentication\pawtropolis-tech.pem`
2. Verify SSH config has pawtech alias:
   ```bash
   # Check ~/.ssh/config
   Host pawtech
     HostName pawtropolis.tech
     User ubuntu
     IdentityFile D:\pawtropolis-tech\authentication\pawtropolis-tech.pem
   ```
3. Test direct connection: `ssh -i D:\pawtropolis-tech\authentication\pawtropolis-tech.pem ubuntu@pawtropolis.tech`

### Repo Not Found

**Error:** `[fatal] repo dir not found`

**Fix:** Update `start.ps1` with the actual repo path on your server:

```powershell
# Change these lines if your repo is elsewhere:
if [ -d "/srv/pawtropolis" ]; then
  cd /srv/pawtropolis
elif [ -d "$HOME/pawtropolis-tech" ]; then
  cd "$HOME/pawtropolis-tech"
```

### Port 3000 Already in Use

**Error:** Port 3000 is occupied by another process

**Fix:**

1. Run stop script: `.\stop.cmd`
2. Manually check/kill: `ssh pawtech "ss -tlnp | grep :3000"`
3. Kill specific process: `ssh pawtech "pkill -f 'node .*dist/index.js'"`

### Build Fails

**Error:** `npm run build` fails on remote

**Fix:**

1. SSH into server: `ssh pawtech`
2. Check logs: `cd ~/pawtropolis-tech && cat logs/err.log`
3. Verify dependencies: `npm ci`
4. Build manually: `npm run build`
5. Check for missing env vars: `cat .env`

### PM2 Not Saving

**Error:** PM2 process list not persisting

**Fix:**

```bash
# SSH into server
ssh pawtech

# Setup PM2 startup script
pm2 startup
# Copy/paste the command it outputs and run it

# Save current processes
pm2 save
```

### Health Check Fails

**Error:** `/auth/login` returns 404 or 500

**Possible causes:**

1. **Apache not configured:** See [APACHE-PROXY-SETUP.md](APACHE-PROXY-SETUP.md)
2. **Node app crashed:** Check logs: `ssh pawtech "pm2 logs pawtropolis"`
3. **Wrong port:** Check if app is on different port: `ssh pawtech "ss -tlnp | grep node"`
4. **Environment vars missing:** `ssh pawtech "cd ~/pawtropolis-tech && grep DISCORD_TOKEN .env"`

## Manual Control (SSH)

If you prefer manual control:

### Start manually

```bash
ssh pawtech
cd ~/pawtropolis-tech
pm2 start dist/index.js --name pawtropolis --update-env
pm2 save
```

### Stop manually

```bash
ssh pawtech
pm2 stop pawtropolis
pm2 delete pawtropolis
pm2 save
```

### Restart manually

```bash
ssh pawtech
pm2 restart pawtropolis --update-env
```

### View logs

```bash
ssh pawtech
pm2 logs pawtropolis
# Or
pm2 logs pawtropolis --lines 100
```

### Check status

```bash
ssh pawtech
pm2 status
pm2 info pawtropolis
```

## Integration with Apache

These scripts manage the Node.js app only. Apache configuration is separate.

**To update Apache config:**

1. Follow [APACHE-PROXY-SETUP.md](APACHE-PROXY-SETUP.md)
2. Apache runs independently and proxies to Node on port 3000

**Full deployment workflow:**

1. Update code locally
2. Commit and push to GitHub
3. Run `.\start.ps1` (pulls latest code and restarts)
4. Verify: `https://pawtropolis.tech/auth/login`

## Environment Variables

The service uses environment variables from `.env` on the remote server.

**Required variables:**

```bash
NODE_ENV=production
DISCORD_TOKEN=your-token
CLIENT_ID=your-client-id
DASHBOARD_PORT=3000
TRUST_PROXY=1
CORS_ORIGIN=https://pawtropolis.tech
DISCORD_CLIENT_ID=your-oauth-client-id
DISCORD_CLIENT_SECRET=your-oauth-secret
ADMIN_ROLE_ID=your-admin-role-id
FASTIFY_SESSION_SECRET=your-session-secret
```

**Update remote .env:**

```bash
ssh pawtech
cd ~/pawtropolis-tech
nano .env
# Make changes
# Save and exit
# Restart: pm2 restart pawtropolis --update-env
```

## Advanced Options

### Custom Repo Path

Edit `start.ps1` and change the path detection:

```powershell
if [ -d "/custom/path/to/repo" ]; then
  cd /custom/path/to/repo
```

### Different SSH Key

Edit both files and change the `KEY` variable:

```powershell
$KEY = "C:\path\to\different-key.pem"
```

### Different Host

Edit both files and change the `REMOTE_HOST` variable:

```powershell
# In start.ps1:
$REMOTE_HOST = "different-server"

# In stop.cmd:
set "REMOTE_HOST=different-server"
```

Or update your SSH config (`~/.ssh/config`):

```
Host pawtech
  HostName different-server.com
  User ubuntu
  IdentityFile D:\pawtropolis-tech\authentication\pawtropolis-tech.pem
```

## Security Notes

1. **PEM key protection:** Ensure `pawtropolis-tech.pem` has restricted permissions

   ```powershell
   # Windows: Right-click → Properties → Security → Advanced
   # Only your user should have Read access
   ```

2. **SSH config:** Keep `~/.ssh/config` secure with proper permissions

3. **Environment secrets:** Never commit `.env` files with real credentials

4. **PM2 security:** Use `pm2 startup` to ensure processes restart on server reboot

## Quick Reference Commands

| Action        | Command                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Start service | `.\start.ps1`                                                                                           |
| Stop service  | `.\stop.cmd`                                                                                            |
| View logs     | `ssh pawtech "pm2 logs pawtropolis"`                                                                    |
| Check status  | `ssh pawtech "pm2 status"`                                                                              |
| Restart       | `.\start.ps1` (smart restart)                                                                           |
| Update .env   | `ssh pawtech "nano ~/pawtropolis-tech/.env"`                                                            |
| Manual deploy | `ssh pawtech "cd ~/pawtropolis-tech && git pull && npm ci && npm run build && pm2 restart pawtropolis"` |
| Check health  | `curl -I https://pawtropolis.tech/auth/login`                                                           |
