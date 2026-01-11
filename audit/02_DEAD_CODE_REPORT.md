# Dead Code Report

Generated: 2026-01-11

## Executive Summary

Found **42 potentially unused exports** and **10 TODO/deprecated markers**. Most are type exports or intentionally public APIs. A few are genuine dead code that can be safely removed.

---

## 1. Unused Exports (ts-prune analysis)

### High Confidence - Safe to Remove

| File | Export | Notes |
|------|--------|-------|
| `src/commands/listopen.ts:285` | `invalidateDraftsCache` | Not imported anywhere |
| `src/features/metricsEpoch.ts:158` | `clearMetricsEpoch` | Not imported anywhere |
| `src/features/modPerformance.ts:441` | `getModeratorMetrics` | Not imported (has similar `getCachedMetrics`) |
| `src/features/modPerformance.ts:458` | `getTopModerators` | Not imported anywhere |
| `src/features/modPerformance.ts:38` | `APPLICANT_ACTIONS` | Constant not used |
| `src/features/notifyConfig.ts:186` | `getConfiguredGuilds` | Not imported anywhere |
| `src/features/roleAutomation.ts:472` | `getAssignmentHistory` | Not imported anywhere |
| `src/features/roleAutomation.ts:489` | `getRecentAssignments` | Not imported anywhere |
| `src/lib/buildInfo.ts:394` | `getShortBuildId` | Not imported anywhere |
| `src/lib/buildInfo.ts:416` | `getBuildAge` | Not imported anywhere |
| `src/lib/constants.ts:61` | `OAUTH_RATE_LIMIT_MAX_REQUESTS` | Not imported anywhere |

### Type Exports - Keep (Public API)

These are type definitions that may be used by external consumers or for documentation:

| File | Export | Notes |
|------|--------|-------|
| `src/features/avatarScan.ts:15` | `RiskReason` | Type export |
| `src/features/avatarScan.ts:25` | `ScanOptions` | Type export |
| `src/features/avatarScan.ts:50` | `AvatarScanDbRow` | Type export |
| `src/features/botDetection.ts:*` | Multiple types | Type exports |
| `src/lib/errors.ts:*` | Error classes | Public API |
| `src/lib/cmdWrap.ts:47` | `InstrumentedInteraction` | Type export |

### Module-Internal Exports - Keep

These are marked "used in module" by ts-prune:

| File | Export | Notes |
|------|--------|-------|
| `src/index.ts:134` | `client` | Entry point |
| `scripts/commands.ts:*` | Script exports | CLI usage |

---

## 2. TODO/FIXME/Deprecated Markers

### Active TODOs

| File | Line | Content |
|------|------|---------|
| `src/commands/art.ts:869` | TODO | "Might be worth refactoring this out, but it works for now" |
| `src/features/activityTracker.ts:288` | TODO | "Implement JSON fallback logging (future enhancement)" |

### Deprecated Code

| File | Description | Migration Path |
|------|-------------|----------------|
| `src/commands/movie.ts` | Entire command deprecated | Use `/event movie` instead |
| `src/lib/wideEvent.ts:319` | `wasDeferred` property | Use `responseState.deferredAt !== null` |
| `src/lib/wideEvent.ts:325` | `wasReplied` property | Use `responseState.repliedAt !== null` |

### Workarounds/Hacks

| File | Line | Description |
|------|------|-------------|
| `src/commands/resetdata.ts:146` | Hack | Uses "modmail_close" action type instead of proper "metrics_reset" |
| `src/commands/send.ts:150` | Note | Dual env var names for backwards compatibility |

---

## 3. Orphan Config Keys

### Potentially Unused Config Keys

Need to verify these are actually read somewhere:

| Key | Set In | Read In |
|-----|--------|---------|
| `OAUTH_RATE_LIMIT_MAX_REQUESTS` | constants.ts | Not found |
| `backfill_notification_channel_id` | backfill.ts | backfill.ts |

---

## 4. Safe Deletion Plan

### Phase 1: Low Risk (Safe to delete now)

```bash
# Remove unused exports
# These functions are never imported anywhere

# 1. invalidateDraftsCache in listopen.ts - line 285
# 2. clearMetricsEpoch in metricsEpoch.ts - line 158
# 3. APPLICANT_ACTIONS in modPerformance.ts - line 38
# 4. getModeratorMetrics in modPerformance.ts - line 441
# 5. getTopModerators in modPerformance.ts - line 458
# 6. getConfiguredGuilds in notifyConfig.ts - line 186
# 7. getAssignmentHistory in roleAutomation.ts - line 472
# 8. getRecentAssignments in roleAutomation.ts - line 489
# 9. getShortBuildId in buildInfo.ts - line 394
# 10. getBuildAge in buildInfo.ts - line 416
# 11. OAUTH_RATE_LIMIT_MAX_REQUESTS in constants.ts - line 61
```

### Phase 2: Verify Before Deleting

```bash
# Run these searches before removing:
rg "invalidateDraftsCache" --type ts
rg "clearMetricsEpoch" --type ts
rg "getModeratorMetrics" --type ts
rg "getTopModerators" --type ts
```

### Phase 3: Deprecation Cleanup (After Migration)

Wait until `/movie` command users migrate to `/event movie`, then:
1. Remove `src/commands/movie.ts`
2. Update command registration

---

## Verification Commands

```bash
# Check for unused exports
npx ts-prune | grep -v "used in module"

# Check for TODO markers
rg "TODO|FIXME|HACK|XXX" src/ --type ts

# Check for deprecated markers
rg "deprecated" src/ --type ts
```

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| Safe to remove | 11 | Remove in next cleanup commit |
| Type exports | ~15 | Keep (public API) |
| TODOs | 2 | Address or document |
| Deprecated | 3 | Migrate and remove |
| Hacks | 2 | Add proper action types |

**Recommended Commits:**

1. `chore: remove 11 unused exports`
2. `feat(logging): add metrics_reset action type`
3. `fix(resetdata): use proper action type instead of modmail_close`
4. `docs: document remaining TODOs with issue references`
