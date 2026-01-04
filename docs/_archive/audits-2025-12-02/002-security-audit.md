# Security Audit Plan

**Audit Date:** 2025-12-02
**Priority:** Critical
**Estimated Scope:** ~10 files modified

---

## Executive Summary

The codebase has strong security foundations (parameterized queries, constant-time comparison, permission layering) but has critical issues around SQL injection in dynamic column building, API key exposure, and missing authorization checks.

---

## Critical Issues

### 1. SQL Injection - Dynamic Column Names

**Severity:** CRITICAL
**CWE:** CWE-89 (SQL Injection)

**Location:** `src/features/artJobs/store.ts:205`

**Current Code:**
```typescript
export function updateJobStatus(jobId: number, options: UpdateJobOptions): boolean {
  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (options.status !== undefined) {
    updates.push("status = ?");
    params.push(options.status);
  }
  // ... more fields added to updates array

  // VULNERABLE: updates array built from options without allowlist
  const result = db.prepare(`UPDATE art_job SET ${updates.join(", ")} WHERE id = ?`).run(...params);
}
```

**Actions:**
1. Add strict allowlist validation at top of function:
   ```typescript
   const ALLOWED_UPDATE_FIELDS = new Set(['status', 'notes', 'completed_at', 'updated_at']);

   // Validate all keys in options
   for (const key of Object.keys(options)) {
     if (!ALLOWED_UPDATE_FIELDS.has(key)) {
       throw new Error(`Invalid update field: ${key}`);
     }
   }
   ```

2. Add unit test verifying injection attempt throws

**Files to modify:**
- `src/features/artJobs/store.ts`
- Add test in `src/features/artJobs/store.test.ts` (if exists)

---

### 2. API Key Exposure in URL

**Severity:** HIGH
**CWE:** CWE-598 (Sensitive Query Strings)

**Location:** `src/features/googleVision.ts:118`

**Current Code:**
```typescript
const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
```

**Actions:**
1. Change to header-based authentication:
   ```typescript
   const endpoint = 'https://vision.googleapis.com/v1/images:annotate';

   const response = await fetch(endpoint, {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'X-Goog-Api-Key': apiKey,
     },
     body: JSON.stringify(requestBody),
     signal: AbortSignal.timeout(15000),
   });
   ```

2. Rotate the current API key in Google Cloud Console (in case it was logged)

3. Review logs for any URL containing the old key pattern

**Files to modify:**
- `src/features/googleVision.ts`

---

### 3. Missing Authorization for Database Recovery

**Severity:** HIGH
**CWE:** CWE-862 (Missing Authorization)

**Location:** `src/commands/database.ts:572`

**Current Code:**
```typescript
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;  // Too permissive for recovery!

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "recover") {
    await executeRecover(ctx);  // Destructive operation with staff-level perms
  }
}
```

**Actions:**
1. Add admin-only check for recovery subcommand:
   ```typescript
   if (subcommand === "recover") {
     // Database recovery requires admin permissions
     if (!requireAdminOrLeadership(interaction)) {
       await interaction.reply({
         content: "Database recovery requires admin permissions.",
         ephemeral: true,
       });
       return;
     }
     await executeRecover(ctx);
   }
   ```

2. Consider requiring bot owner for this operation (highest privilege)

**Files to modify:**
- `src/commands/database.ts`

---

### 4. Command Execution - Unsafe Environment Variables

**Severity:** HIGH
**CWE:** CWE-78 (OS Command Injection)

**Locations:**
- `src/commands/database.ts:227, 243`
- `src/features/dbRecovery.ts:415, 516`

**Current Code:**
```typescript
await execAsync(`pm2 stop ${env.PM2_PROCESS_NAME}`);
await execAsync(`ssh ... ${remoteAlias} "cd ${remotePath} && ..."`);
```

**Actions:**
1. Add environment variable validation on startup in `src/lib/env.ts`:
   ```typescript
   const SAFE_NAME_REGEX = /^[a-zA-Z0-9_\-]+$/;
   const SAFE_PATH_REGEX = /^[a-zA-Z0-9_\-\/\.]+$/;

   export const env = z.object({
     PM2_PROCESS_NAME: z.string().regex(SAFE_NAME_REGEX, 'Invalid PM2 process name'),
     REMOTE_ALIAS: z.string().regex(SAFE_NAME_REGEX, 'Invalid remote alias'),
     REMOTE_PATH: z.string().regex(SAFE_PATH_REGEX, 'Invalid remote path'),
     // ... existing validations
   }).parse(process.env);
   ```

2. Use `child_process.spawn()` with array arguments where possible:
   ```typescript
   import { spawn } from 'child_process';

   const pm2 = spawn('pm2', ['stop', env.PM2_PROCESS_NAME]);
   ```

**Files to modify:**
- `src/lib/env.ts`
- `src/commands/database.ts`
- `src/features/dbRecovery.ts`

---

## High Priority Issues

### 5. Rate Limiting for Expensive Operations

**Severity:** MEDIUM
**CWE:** CWE-770 (Resource Allocation)

**Problem:** Only `/flag` has rate limiting. Expensive commands lack protection.

**Actions:**
1. Create `src/lib/rateLimiter.ts`:
   ```typescript
   const cooldowns = new Map<string, Map<string, number>>();

   export function checkCooldown(
     commandName: string,
     userId: string,
     cooldownMs: number
   ): { allowed: boolean; remainingMs?: number } {
     const now = Date.now();
     const userCooldowns = cooldowns.get(commandName) ?? new Map();
     const lastUsed = userCooldowns.get(userId) ?? 0;

     if (now - lastUsed < cooldownMs) {
       return { allowed: false, remainingMs: cooldownMs - (now - lastUsed) };
     }

     userCooldowns.set(userId, now);
     cooldowns.set(commandName, userCooldowns);
     return { allowed: true };
   }
   ```

2. Add rate limits to expensive commands:
   - `/audit nsfw` - 1 hour per guild
   - `/database check` - 5 minutes per user
   - `/sync` - 10 minutes per guild

**Files to modify:**
- Create `src/lib/rateLimiter.ts`
- `src/commands/audit.ts`
- `src/commands/database.ts`
- `src/commands/sync.ts` (if exists)

---

### 6. Input Validation - Reason Field Length

**Severity:** MEDIUM
**CWE:** CWE-20 (Improper Input Validation)

**Locations:**
- `src/commands/gate/kick.ts:65`
- `src/commands/gate/reject.ts:74`

**Current Code:**
```typescript
const reason = interaction.options.getString("reason", true).trim();
// No length validation before database insertion
```

**Actions:**
1. Create shared validation constant:
   ```typescript
   // src/lib/constants.ts
   export const MAX_REASON_LENGTH = 512;
   ```

2. Add validation in commands:
   ```typescript
   const reason = interaction.options.getString("reason", true).trim();
   if (reason.length > MAX_REASON_LENGTH) {
     await interaction.reply({
       content: `Reason too long (max ${MAX_REASON_LENGTH} characters)`,
       ephemeral: true,
     });
     return;
   }
   ```

3. Apply same pattern used in `/flag` command (already correct)

**Files to modify:**
- `src/lib/constants.ts`
- `src/commands/gate/kick.ts`
- `src/commands/gate/reject.ts`
- Any other commands with reason fields

---

### 7. Path Traversal Protection

**Severity:** MEDIUM
**CWE:** CWE-22 (Path Traversal)

**Location:** `src/features/dbRecovery.ts:100, 453`

**Current Code:**
```typescript
const filePath = path.join(backupsDir, filename);
// No check that resolved path is within backupsDir
```

**Actions:**
1. Add path traversal protection:
   ```typescript
   import path from 'node:path';

   function safeJoinPath(baseDir: string, filename: string): string {
     const filePath = path.join(baseDir, filename);
     const resolvedPath = path.resolve(filePath);
     const resolvedBase = path.resolve(baseDir);

     if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
       throw new Error('Path traversal attempt detected');
     }

     return resolvedPath;
   }
   ```

2. Add filename validation:
   ```typescript
   const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9_\-\.]+\.db$/;

   if (!SAFE_FILENAME_REGEX.test(filename)) {
     throw new Error('Invalid backup filename');
   }
   ```

**Files to modify:**
- `src/features/dbRecovery.ts`
- Consider creating `src/lib/pathSecurity.ts` for reuse

---

### 8. Sensitive Data in Logs

**Severity:** LOW
**CWE:** CWE-532 (Sensitive Info in Logs)

**Problem:** Avatar URLs and extensive user data logged throughout.

**Actions:**
1. Review and sanitize sensitive fields in log calls
2. Ensure passwords are never logged (already good)
3. Consider adding log scrubbing for patterns like tokens

**Files to modify:**
- Review all `logger.*` calls for sensitive data
- Focus on `src/features/googleVision.ts` (logs imageUrl)

---

## Verification Steps

After each fix:

1. Run `npm run test` to verify no regressions
2. Test the specific security scenario:
   - SQL injection: Try malformed input
   - API key: Check network tab for URL params
   - Auth: Test with staff vs admin accounts
   - Rate limit: Rapid-fire command execution
3. Review Sentry for any new error patterns

---

## Post-Remediation Tasks

1. **Rotate Google Vision API key** after moving to headers
2. **Run `npm audit`** to check for vulnerable dependencies
3. **Document security practices** in `SECURITY.md`
4. **Schedule quarterly security audits**

---

## Estimated Impact

- **Files modified:** ~10
- **Lines changed:** ~300
- **Risk level:** Low (fixes are targeted, well-scoped)
- **Testing required:** Manual security testing for each fix
