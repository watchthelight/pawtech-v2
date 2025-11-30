# Issue #47: Consolidate Password Comparison Implementations

**Status:** Pending
**Priority:** Medium
**Category:** Code Quality, Security Consistency

## Summary

Two different secure password comparison implementations exist in the codebase:
- `safeEq()` in `src/commands/gate.ts` (lines 211-216)
- `secureCompare()` in `src/lib/secureCompare.ts` (lines 37-57)

Both serve the same purpose (constant-time string comparison to prevent timing attacks), but having two implementations violates DRY principles and creates maintenance burden.

## Current State

### Implementation #1: `safeEq()` in gate.ts
```typescript
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```
- **Location:** `src/commands/gate.ts:211-216`
- **Usage:** `/gate reset` password validation (line 370)
- **Approach:** Direct string-to-buffer conversion, then `timingSafeEqual()`
- **Limitation:** Leaks length information (fails fast on length mismatch)

### Implementation #2: `secureCompare()` in secureCompare.ts
```typescript
export function secureCompare(a: string, b: string): boolean {
  const ah = Buffer.from(createHash("sha256").update(a, "utf8").digest("hex"), "utf8");
  const bh = Buffer.from(createHash("sha256").update(b, "utf8").digest("hex"), "utf8");
  if (ah.length !== bh.length) return false;
  return timingSafeEqual(ah, bh);
}
```
- **Location:** `src/lib/secureCompare.ts:37-57`
- **Usage:**
  - `/modstats reset` password validation (`src/commands/modstats.ts:597-598`)
  - `/database` operations (`src/commands/database.ts:34, 492`)
- **Approach:** Hash both inputs with SHA-256, then `timingSafeEqual()`
- **Advantage:** Normalizes length (always 64 chars after hashing), better security

### Why This Matters

1. **Inconsistent security posture:** `safeEq()` leaks length info; `secureCompare()` doesn't
2. **Maintenance burden:** Bug fixes or improvements must be applied in two places
3. **Developer confusion:** New code might use the wrong one or create a third variant
4. **Documentation debt:** The existence of two functions implies they serve different purposes (they don't)

## Proposed Changes

### Step 1: Audit Current Usage
- [x] Identify all usages of `safeEq()`: `src/commands/gate.ts:370`
- [x] Identify all usages of `secureCompare()`: `src/commands/modstats.ts:598`, `src/commands/database.ts:492`
- [x] Confirm both are used for password comparison only

### Step 2: Standardize on `secureCompare()`
**Rationale:**
- Already exported from a dedicated utility module
- Superior security (hash-based length normalization)
- More extensively documented
- Already used in 2 of 3 locations

### Step 3: Replace `safeEq()` with `secureCompare()`
**File:** `src/commands/gate.ts`

1. Add import at top of file:
   ```typescript
   import { secureCompare } from "../lib/secureCompare.js";
   ```

2. Replace line 370:
   ```typescript
   // BEFORE:
   if (!safeEq(password, env.RESET_PASSWORD)) {

   // AFTER:
   if (!secureCompare(password, env.RESET_PASSWORD)) {
   ```

3. Delete the `safeEq()` function (lines 201-216, including docstring)

### Step 4: Verify No Other References
- Search codebase for `safeEq` (should only find this roadmap doc)
- Search for `timingSafeEqual` usage outside `secureCompare.ts` (should only find imports)

## Files Affected

1. **`src/commands/gate.ts`** (Modified)
   - Remove: `safeEq()` function definition (lines 201-216)
   - Add: Import for `secureCompare` from `../lib/secureCompare.js`
   - Change: Line 370 to use `secureCompare()` instead of `safeEq()`

2. **`src/lib/secureCompare.ts`** (No changes)
   - Remains as the single source of truth for secure comparison

## Testing Strategy

### Pre-deployment Testing

1. **Unit test** (create if missing):
   ```typescript
   // src/lib/secureCompare.test.ts
   describe('secureCompare', () => {
     it('returns true for identical strings', () => {
       expect(secureCompare('password123', 'password123')).toBe(true);
     });

     it('returns false for different strings', () => {
       expect(secureCompare('password123', 'password456')).toBe(false);
     });

     it('returns false for different lengths', () => {
       expect(secureCompare('short', 'very long password')).toBe(false);
     });
   });
   ```

2. **Integration test** for `/gate reset`:
   - Set `RESET_PASSWORD` in test environment
   - Invoke `/gate reset` modal with correct password → should succeed
   - Invoke `/gate reset` modal with incorrect password → should fail
   - Verify audit logs for both cases

3. **Regression test**:
   - Verify `/modstats reset` still works (uses `secureCompare` before and after)
   - Verify `/database` commands still work (uses `secureCompare` before and after)

### Manual Verification

1. Start bot in dev environment
2. Run `/gate reset` with:
   - Correct password → verify success
   - Wrong password → verify rejection + rate limiting
   - Edge cases: empty string, very long string, Unicode characters

## Rollback Plan

### If Issues Detected

1. **Immediate rollback:**
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. **Alternative (manual):**
   - Restore `safeEq()` function in `gate.ts`
   - Revert line 370 to use `safeEq()`
   - Remove `secureCompare` import

### Post-Rollback Actions

1. Investigate failure cause (check logs for errors)
2. Verify `RESET_PASSWORD` env var is accessible in both old/new code paths
3. Re-test in staging environment before re-attempting

### Risk Assessment

**Risk Level:** Low
- Change is purely internal (no API/behavior changes)
- Both functions use same underlying primitive (`timingSafeEqual`)
- Only difference is hash-based length normalization (strictly more secure)
- Worst case: password comparison fails closed (denies access) rather than open

## Success Criteria

- [ ] `safeEq()` function removed from codebase
- [ ] All password comparisons use `secureCompare()` from `src/lib/secureCompare.ts`
- [ ] No grep matches for `safeEq` outside this roadmap doc
- [ ] All `/gate reset`, `/modstats reset`, and `/database` commands pass integration tests
- [ ] No new timing attack vectors introduced (security parity or improvement only)

## References

- **Related Audit Issue:** Codebase Audit 2025-11-30, Issue #47
- **Security Context:** [OWASP: Timing Attacks](https://owasp.org/www-community/attacks/Timing_attack)
- **Node.js Docs:** [crypto.timingSafeEqual](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
