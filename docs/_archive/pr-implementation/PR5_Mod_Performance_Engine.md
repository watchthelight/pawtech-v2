# PR5 — Persistent Mod Performance Engine

## 🧭 Overview

Upgrades `/modstats` into a full analytics system tracking moderator performance over time, with persistence and leaderboard export options.

## 🧩 Changes

- New `mod_metrics` table for tracking counts and response times.
- Automatic updates triggered on every `review_action`.
- Added `/modstats leaderboard`, `/modstats user`, and `/modstats export`.
- Added daily recalculation and caching layer.
- Integrated with analytics endpoints and dashboard feed.

## ✅ Acceptance Criteria

- [ ] Metrics persist correctly across restarts.
- [ ] `/modstats leaderboard` and `/modstats user` show correct data.
- [ ] Export works as `.csv` and `.json`.
- [ ] Median/percentile response times accurate.
- [ ] Achievements render (Fastest Reviewer, Most Active, etc.).

## 🧪 Testing Plan

1. Create several fake apps with timestamps.
2. Claim/Reject/Accept as different moderators.
3. Run `/modstats leaderboard` → verify order.
4. Export results and check format.
5. Cross-check with DB totals.

## ⚙️ Files Touched

- `src/features/modstats.ts`
- `src/db/schema.ts`
- `src/features/review.ts`
- `src/analytics/modPerformance.ts`
- `src/server/routes/metrics.ts`
