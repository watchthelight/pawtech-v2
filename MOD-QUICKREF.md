# Pawtech Quick Reference

> For full documentation, see [BOT-HANDBOOK.md](BOT-HANDBOOK.md) and [MOD-HANDBOOK.md](docs/MOD-HANDBOOK.md)

---

## Reviewing Applications

When a new application comes in, click the **Claim** button first so other mods know you're handling it. Then use the **Accept**, **Reject**, or **Kick** buttons to take action.

If an application is bugged and you can't use the buttons, use these commands instead:

- `/accept` — approve the application
- `/reject reason:Your reason here` — reject with explanation
- `/kick reason:Your reason here` — kick from server
- `/unclaim` — release so someone else can review it

Each command accepts one of these to identify the application:
- `app:A1B2C3` — the short code shown on the embed
- `user:@Username` — mention or pick from the list
- `uid:123456789` — their Discord ID if they already left

For rejections, add `perm:true` if they should never be allowed to re-apply.

To see what's waiting for review, run `/listopen`. Use `scope:all` to see everything or `scope:drafts` for incomplete applications.

Need to look up someone's history? `/search user:@Username` pulls up all their past applications and decisions.

Made a mistake with a permanent rejection? `/unblock target:@Username` lets them apply again.

## Checking Your Stats

Curious how you're doing? Run `/modstats user moderator:@YourName` to see your approval rate, response times, and activity breakdown. You can adjust the time range with `days:30` or whatever period you want.

To see how everyone's doing, `/modstats leaderboard` shows rankings by review count. Great for friendly competition or seeing who's been most active.

For server-wide trends, `/approval-rate` shows the overall approve vs reject breakdown, and `/analytics` gives you visual charts of activity patterns — helpful for spotting when reviews tend to pile up.

## Server Activity

Want to know when the server is busiest? `/activity` shows a heatmap of message activity by day and hour. You can look back up to 8 weeks with `weeks:8`.

To check if the bot is running smoothly, `/health` shows uptime and response latency.

## Movie Night

When a movie event starts, use `/movie start channel:#movie-vc` to begin tracking who's in the voice channel.

When the movie is over, make sure you end attendance tracking with `/movie end`. This finalizes everyone's time and automatically assigns tier roles to anyone who stayed 30+ minutes.

To see who attended or check someone's movie history, use `/movie attendance`. Add `user:@Username` to look up a specific person's progress toward the next tier.

**Tier roles** (you need 30+ minutes per movie to count):
- <@&1388676461657063505> — attended 1+ movie
- <@&1388676662337736804> — attended 5+ movies
- <@&1388675577778802748> — attended 10+ movies
- <@&1388677466993987677> — attended 20+ movies

## Utility Commands

Need to post something as the bot? `/send message:Your text here` does the trick. Add `embed:true` for a nicer format, or `reply_to:` with a message ID to reply to something specific.

If someone seems suspicious, `/flag user:@Username reason:Alt account` flags them for other staff to see.

## Audit & Detection Tools

Check if an image is AI-generated:
- `/isitreal message:<message_id_or_link>` — scans all images in a message

Flag suspicious users:
- `/flag user:@Username reason:Alt account` — marks user for extra review

Server audits (leadership only):
- `/audit members` — scan for bot accounts
- `/audit nsfw` — scan avatars for NSFW content

## Tips

- Only use ONE identifier per command (app code, user mention, OR user ID — not multiple)
- Always claim before reviewing to avoid stepping on someone else's work
- The `perm:true` option is permanent — use it sparingly
- User left the server? Their Discord ID still works with the `uid:` option

---

## Related Documentation

- **[BOT-HANDBOOK.md](BOT-HANDBOOK.md)** — Full technical documentation for all bot commands
- **[MOD-HANDBOOK.md](docs/MOD-HANDBOOK.md)** — Staff policies, escalation, and moderation protocols
- **[PERMS-MATRIX.md](PERMS-MATRIX.md)** — Complete permission reference
- **[CHANGELOG.md](CHANGELOG.md)** — Version history and recent changes
- **[Staff Documentation Index](docs/INDEX.md)** — Find any document quickly

### Tier-Specific Guides

- **[GATEKEEPER-GUIDE.md](docs/GATEKEEPER-GUIDE.md)** — For Gatekeeper and Junior Mod
- **[MODERATOR-GUIDE.md](docs/MODERATOR-GUIDE.md)** — For Moderator and Senior Mod
- **[ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md)** — For Administrator and Senior Admin
- **[LEADERSHIP-GUIDE.md](docs/LEADERSHIP-GUIDE.md)** — For CM, CDL, and Server Owner
