---
title: "Security, Secrets, and Access Control"
slug: "16_Security_Secrets_and_Access_Control"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Security"
audience: "Engineers • SRE • Security Team"
source_of_truth: ["src/lib/env.ts", ".env.example", "Zod validation schema"]
related:
  - "08_Deployment_Config_and_Env"
  - "14_Slash_Commands_Registry_and_Permissions"
  - "17_Incident_Response_and_Postmortems"
summary: "Environment variable handling, secret management, least privilege principles, audit trails, log redaction, and remote SSH access patterns."
---

## Purpose & Outcomes

Establish secure practices for:
- Secret storage and rotation
- Environment variable validation
- Access control mechanisms
- Audit trail maintenance
- Log redaction procedures
- SSH key management

## Scope & Boundaries

### In Scope
- `.env` file structure and validation
- Discord bot token security
- OAuth2 client secrets
- Database encryption at rest
- SSH key-based authentication
- Password hashing (timing-safe comparison)
- Sentry DSN exposure
- Least privilege role assignments

### Out of Scope
- Network security (firewalls, VPNs)
- DDoS protection
- Rate limiting (covered in other docs)
- Certificate management (handled by Let's Encrypt auto-renewal)

## Current State

**Secret Storage**: `.env` file (gitignored)
**Validation**: Zod schema in [src/lib/env.ts](../src/lib/env.ts)
**Encryption**: None (SQLite database unencrypted)
**Access Control**: SSH keys + Discord OAuth2
**Audit Logging**: `action_log` table

## Key Flows

### Environment Loading Flow
```
1. Read .env file (dotenvx)
2. Parse variables
3. Validate with Zod schema
4. Fail-fast if invalid
5. Export typed env object
```

### Password Validation Flow
```
1. User provides password
2. Hash input with SHA-256
3. Hash expected password
4. Compare with crypto.timingSafeEqual
5. Return boolean (no timing leak)
```

## Commands & Snippets

### Required Environment Variables

```bash
# File: .env
# Core Discord Bot Credentials
DISCORD_TOKEN=<bot-token>          # Required: Discord bot token
CLIENT_ID=<application-id>         # Required: Application ID

# Database
DB_PATH=./data/data.db             # Optional: Default shown

# Web Dashboard (OAuth2)
DISCORD_CLIENT_SECRET=<secret>     # Required for OAuth2
DASHBOARD_REDIRECT_URI=<url>       # Required: Callback URL
FASTIFY_SESSION_SECRET=<32chars+>  # Required: Cookie signing
ADMIN_ROLE_ID=<role-ids>           # Optional: Comma-separated

# Security
RESET_PASSWORD=<strong-password>   # Required for /resetdata, /gate reset

# Monitoring
SENTRY_DSN=<sentry-url>            # Optional: Error tracking
LOG_LEVEL=info                     # Optional: debug|info|warn|error

# Avatar Scanning
GATE_SHOW_AVATAR_RISK=1            # Optional: 1=show, 0=hide
GOOGLE_APPLICATION_CREDENTIALS=<path> # Optional: GCP service account JSON
```

### Zod Validation Schema

```typescript
// File: src/lib/env.ts
import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "Missing DISCORD_TOKEN"),
  CLIENT_ID: z.string().min(1, "Missing CLIENT_ID"),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DASHBOARD_REDIRECT_URI: z.string().url().optional(),
  FASTIFY_SESSION_SECRET: z.string().min(32).optional(),
  RESET_PASSWORD: z.string().min(8).optional(),
  ADMIN_ROLE_ID: z.string().optional(),
  DB_PATH: z.string().default("./data/data.db"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  SENTRY_DSN: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Environment validation failed:");
  parsed.error.issues.forEach(issue => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);  // Fail-fast
}

export const env = parsed.data;
```

### Timing-Safe Password Comparison

```typescript
// File: src/commands/resetdata.ts
import crypto from "node:crypto";

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  return crypto.timingSafeEqual(bufA, bufB);
}

// Usage:
const isValid = constantTimeCompare(userInput, process.env.RESET_PASSWORD);
```

### Log Redaction

```typescript
// File: src/lib/logger.ts
import pino from "pino";

const redact = [
  "password",
  "token",
  "secret",
  "authorization",
  "*.password",
  "*.token",
  "env.DISCORD_TOKEN",
  "env.DISCORD_CLIENT_SECRET",
];

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: redact,
    remove: true  // Remove entirely, don't replace with [Redacted]
  }
});
```

## Interfaces & Data

### Environment Variable Types

```typescript
export interface Env {
  DISCORD_TOKEN: string;
  CLIENT_ID: string;
  DISCORD_CLIENT_SECRET?: string;
  DASHBOARD_REDIRECT_URI?: string;
  FASTIFY_SESSION_SECRET?: string;
  RESET_PASSWORD?: string;
  ADMIN_ROLE_ID?: string;
  DB_PATH: string;
  LOG_LEVEL: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  SENTRY_DSN?: string;
}
```

### Access Control Matrix

| Resource | Admin | Moderator | User |
|----------|-------|-----------|------|
| `/gate reset` | ✅ (password) | ❌ | ❌ |
| `/resetdata` | ✅ (password) | ❌ | ❌ |
| `/accept` | ✅ | ✅ | ❌ |
| `/modstats` (self) | ✅ | ✅ | ❌ |
| `/modstats` (others) | ✅ | ❌ | ❌ |
| Dashboard OAuth2 | ✅ (`ADMIN_ROLE_ID`) | ❌ | ❌ |
| Database SSH access | ✅ (SSH key) | ❌ | ❌ |
| PM2 control | ✅ (SSH key) | ❌ | ❌ |

## Ops & Recovery

### Rotating Secrets

#### Bot Token Rotation
```bash
# 1. Generate new token at Discord Developer Portal
# 2. Update .env file
echo "DISCORD_TOKEN=<new-token>" >> .env

# 3. Restart bot
pm2 restart pawtropolis --update-env

# 4. Verify connection
pm2 logs pawtropolis | grep "Bot ready"
```

#### OAuth2 Secret Rotation
```bash
# 1. Generate new secret at Discord Developer Portal
# 2. Update .env
echo "DISCORD_CLIENT_SECRET=<new-secret>" >> .env

# 3. Restart web server (bot restart also restarts Fastify)
pm2 restart pawtropolis --update-env
```

#### Session Secret Rotation
```bash
# 1. Generate new random secret (32+ characters)
openssl rand -hex 32

# 2. Update .env
echo "FASTIFY_SESSION_SECRET=<new-secret>" >> .env

# 3. Restart (invalidates all existing sessions)
pm2 restart pawtropolis --update-env

# WARNING: All users logged out, must re-authenticate
```

### SSH Key Management

#### Adding New SSH Key
```bash
# On local machine:
ssh-keygen -t ed25519 -C "admin@pawtropolis.tech"

# Add public key to server:
ssh-copy-id -i ~/.ssh/id_ed25519.pub ubuntu@pawtropolis.tech

# Test connection:
ssh ubuntu@pawtropolis.tech "whoami"
```

#### Revoking SSH Key
```bash
# On server:
ssh ubuntu@pawtropolis.tech
nano ~/.ssh/authorized_keys
# Remove the line corresponding to revoked key

# Verify:
cat ~/.ssh/authorized_keys | wc -l
```

## Security & Privacy

### Best Practices

1. **Never commit `.env` to git**
   ```bash
   # Verify gitignore
   cat .gitignore | grep "\.env"
   # Output: .env
   ```

2. **Use strong passwords (12+ characters)**
   ```bash
   # Generate random password
   openssl rand -base64 16
   ```

3. **Rotate secrets quarterly**
   - Bot token: Every 6 months
   - OAuth2 secret: Every 6 months
   - Session secret: Every 3 months
   - SSH keys: Annually

4. **Audit access logs**
   ```sql
   SELECT action, moderator_id, created_at
   FROM action_log
   WHERE action IN ('modmail_close', 'gate_reset')
   ORDER BY created_at DESC
   LIMIT 50;
   ```

5. **Use SSH keys, never passwords**
   ```bash
   # Disable password authentication
   sudo nano /etc/ssh/sshd_config
   # Set: PasswordAuthentication no
   sudo systemctl restart sshd
   ```

## FAQ / Gotchas

**Q: Can I use the same `RESET_PASSWORD` for multiple bots?**
A: Not recommended. Use unique passwords per instance.

**Q: What happens if `DISCORD_TOKEN` is leaked?**
A: Immediately regenerate token at Discord Developer Portal. Old token is instantly invalidated.

**Q: How do I know if my `.env` is valid?**
A: Run bot in dev mode: `npm run dev`. If env invalid, bot exits with error.

**Q: Can I store secrets in database instead of `.env`?**
A: Not recommended. Database is unencrypted. Use `.env` for secrets.

**Q: What's the minimum `FASTIFY_SESSION_SECRET` length?**
A: 32 characters (enforced by Zod validation).

## Changelog

- 2025-10-30: Initial creation with secret management best practices
