# Pawtech Handbook

## Application Review

**`/accept`** — Approve an application
- `app:A1B2C3` — By short code
- `user:@Username` — By mention/picker
- `uid:123456789` — By user ID (if they left the server)

**`/reject`** — Reject an application
- Same options as accept, plus:
- `reason:` — Required rejection reason (max 500 chars)
- `perm:true` — Permanently block re-application

**`/kick`** — Kick an applicant from the server
- Same options as accept/reject
- `reason:` — Required kick reason

**`/unclaim`** — Release your claim on an app so others can review it
- Same identifier options (app/user/uid)

**`/listopen`** — View pending applications
- `scope:mine` — Your claimed apps (default)
- `scope:all` — All open applications (claimed + unclaimed)
- `scope:drafts` — Incomplete/in-progress applications

**`/search user:@Username`** — Find a user's full application history including past decisions and notes

**`/unblock target:@Username`** — Remove permanent rejection so user can re-apply
- Also accepts `user_id:` for users who left

---

## Mod Stats & Leaderboards

**`/modstats leaderboard`** — Rankings by review count
- `days:7` — Time period (default: 30)
- Shows approvals, rejections, and total decisions

**`/modstats user moderator:@You`** — Your detailed personal stats
- Response times, approval rate, activity breakdown
- `days:30` — Customize time range

**`/approval-rate`** — Server-wide approval vs rejection rates
- `days:7` — See trends over time

**`/analytics`** — Visual activity charts
- `bucket:hourly` / `daily` / `weekly` — Change grouping
- Great for spotting peak review times

---

## Server Activity

**`/activity`** — Server message activity heatmap
- `weeks:4` — Show up to 8 weeks of history
- Visual breakdown by day and hour
- Identifies when the server is most active

**`/health`** — Bot uptime, latency, and system status

---

## Movie Night

**`/movie start channel:#movie-vc`** — Begin tracking voice attendance

**`/movie end`** — Finalize and assign tier roles to qualified attendees

**`/movie attendance`** — View all attendees from the latest event
- `user:@Username` — Check someone's movie history and tier progress

**Tier Progression** (must stay 30+ min to qualify):
- **Red Carpet Guest** — 1+ movies
- **Popcorn Club** — 5+ movies
- **Director's Cut** — 10+ movies
- **Cinematic Royalty** — 20+ movies

---

## Suggestions

**`/suggestions`** — Browse community suggestions
- `status:open` — Filter: open, approved, denied, implemented, all

**`/suggestion approve id:42`** — Approve with optional response
**`/suggestion deny id:42 reason:Out of scope`** — Deny with reason
**`/suggestion implement id:42`** — Mark as shipped

---

## Utility

**`/send message:Your text`** — Post as the bot
- `embed:true` — Rich embed format
- `reply_to:123456789` — Reply to specific message
- `attachment:` — Include image or file

**`/flag user:@Suspicious`** — Flag a user for staff attention
- `reason:` — Add context for other mods

---

## Quick Tips

- **One identifier only**: For accept/reject/kick/unclaim, use exactly ONE of `app`, `user`, or `uid`
- **Short codes**: The 6-character code on app embeds (e.g., `A1B2C3`)
- **Claim first**: Always click Claim before reviewing to avoid duplicate work
- **User left?**: Use `uid:` with their Discord ID — works even after they leave
- **Perm reject**: Use sparingly — permanently blocks someone from ever re-applying
- **Check your stats**: Run `/modstats user moderator:@YourName` to see your activity

---

*Full docs: BOT-HANDBOOK.md • Questions? Ask leadership*
