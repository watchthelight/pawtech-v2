# Pawtech Handbook

## Reviewing Applications

When a new application comes in, click the **Claim** button first so other mods know you're handling it.

To approve someone, use `/accept` with one of these options:
- `app:A1B2C3` — the short code shown on the application
- `user:@Username` — mention or pick them from the list
- `uid:123456789` — their Discord ID if they already left

To reject, use `/reject` with the same options plus a required `reason:`. If someone should never be allowed back, add `perm:true` to permanently block them from re-applying.

If you need to kick an applicant, `/kick` works the same way with a required `reason:`.

Changed your mind or need to step away? Use `/unclaim` to release the application so someone else can pick it up.

To see what's waiting for review, run `/listopen`. By default it shows your claimed apps, but you can use `scope:all` to see everything or `scope:drafts` for incomplete applications.

If you need to look up someone's history, `/search user:@Username` pulls up all their past applications and decisions.

Made a mistake with a permanent rejection? `/unblock target:@Username` lets them apply again.

---

## Checking Your Stats

Curious how you're doing? Run `/modstats user moderator:@YourName` to see your approval rate, response times, and activity breakdown. You can adjust the time range with `days:30` or whatever period you want.

To see how everyone's doing, `/modstats leaderboard` shows rankings by review count. Great for friendly competition or seeing who's been most active.

For server-wide trends, `/approval-rate` shows the overall approve vs reject breakdown, and `/analytics` gives you visual charts of activity patterns — helpful for spotting when reviews tend to pile up.

---

## Server Activity

Want to know when the server is busiest? `/activity` shows a heatmap of message activity by day and hour. You can look back up to 8 weeks with `weeks:8`.

To check if the bot is running smoothly, `/health` shows uptime and response latency.

---

## Movie Night

When a movie event starts, use `/movie start channel:#movie-vc` to begin tracking who's in the voice channel.

When the movie is over, make sure you end attendance tracking with `/movie end`. This finalizes everyone's time and automatically assigns tier roles to anyone who stayed 30+ minutes.

To see who attended or check someone's movie history, use `/movie attendance`. Add `user:@Username` to look up a specific person's progress toward the next tier.

**Tier roles** (you need 30+ minutes per movie to count):
- **Red Carpet Guest** — attended 1+ movie
- **Popcorn Club** — attended 5+ movies
- **Director's Cut** — attended 10+ movies
- **Cinematic Royalty** — attended 20+ movies

---

## Managing Suggestions

Community members can submit feature ideas, and you can browse them with `/suggestions`. Filter by status using `status:open`, `status:approved`, etc.

When reviewing suggestions:
- `/suggestion approve id:42` — marks it approved (add `response:` to send feedback)
- `/suggestion deny id:42 reason:Outside scope` — denies with an explanation
- `/suggestion implement id:42` — marks it as shipped

---

## Utility Commands

Need to post something as the bot? `/send message:Your text here` does the trick. Add `embed:true` for a nicer format, or `reply_to:` with a message ID to reply to something specific.

If someone seems suspicious, `/flag user:@Username reason:Alt account` flags them for other staff to see.

---

## Tips

- Only use ONE identifier per command (app code, user mention, OR user ID — not multiple)
- Always claim before reviewing to avoid stepping on someone else's work
- The `perm:true` option is permanent — use it sparingly
- User left the server? Their Discord ID still works with the `uid:` option
