# Moderator Guide

You run server events and have more tools to keep things healthy.

**Prerequisite:** [Gatekeeper Guide](GATEKEEPER-GUIDE.md) | **Other docs:** [Quick Reference](../MOD-QUICKREF.md) &#8226; [Bot Handbook](../BOT-HANDBOOK.md)

---

## Everything You Had Before

You still have all Gatekeeper capabilities:
- Gate system (accept, reject, kick, claim, listopen, search)
- Flagging users
- AI detection (`/isitreal`)
- Viewing stats

📖 [Review Gatekeeper Guide →](GATEKEEPER-GUIDE.md)

---

## What's New at This Level

### Movie Night

You can run movie watching events and track who attends.

**Commands:**
- `/movie start channel:#movie-vc` — Begin tracking attendance in a voice channel
- `/movie end` — Stop tracking and finalize attendance
- `/movie attendance [user:@Name]` — See who attended or check someone's history

**How it works:**
1. Start tracking when the movie begins
2. Bot monitors who's in the voice channel and for how long
3. End tracking when movie is over
4. Anyone who stayed 30+ minutes earns credit toward tier roles

**Tier roles** (require 30+ min per movie):
- 1+ movie — First tier
- 5+ movies — Second tier
- 10+ movies — Third tier
- 20+ movies — Top tier

📖 [Full documentation →](../BOT-HANDBOOK.md#movie-night)

📋 *Introduced in [v1.1.0](../CHANGELOG.md#110---2025-11-25)*

---

### Server Activity Heatmap

See when the server is busiest.

**Command:**
- `/activity [weeks:N]` — Show activity heatmap (default: 4 weeks, max: 8)

The heatmap shows message activity by day and hour. Useful for:
- Planning events at peak times
- Understanding quiet periods
- Spotting unusual activity patterns

📖 [Full documentation →](../BOT-HANDBOOK.md#activity)

📋 *Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)*

---

### Bot Presence

Update what the bot is doing/playing.

**Commands:**
- `/update activity type:... text:...` — Set the bot's activity
- `/update status [text:...]` — Set custom status (or clear it with no text)

**Activity types:**
- `Playing` — "Playing [text]"
- `Watching` — "Watching [text]"
- `Listening` — "Listening to [text]"
- `Competing` — "Competing in [text]"

📖 [Full documentation →](../BOT-HANDBOOK.md#update)

📋 *Introduced in [v1.0.0](../CHANGELOG.md#100---2025-11-25)* | *Status clear added in [v4.8.0](../CHANGELOG.md#480---2025-12-08)*

---

### Skull Mode

Random skull reactions on messages. A fun server feature.

**Commands:**
- `/skullmode chance:N` — Set odds (1-1000) for skull reactions
- `/config set skullmode enabled:true/false` — Toggle on/off

Lower numbers = more skulls. Set to 1000 for rare skulls, 1 for constant skulls.

📖 [Full documentation →](../BOT-HANDBOOK.md#skull-mode)

📋 *Introduced in [v4.8.0](../CHANGELOG.md#480---2025-12-08)*

---

## Tips for This Level

1. **Movie night timing matters** — Start tracking right as the movie begins, end when it finishes
2. **Check activity before events** — Use `/activity` to pick good times
3. **Bot status is visible to everyone** — Keep it appropriate
4. **Skull mode is opt-in** — Make sure leadership wants it enabled before turning it on

---

## What's Coming Next

When you advance to **Administrator**, you'll unlock:

- **Server Configuration** — Change bot settings with `/config`
- **Role Automation** — Set up automatic role assignment
- **Emergency Controls** — `/panic` to stop all automation instantly
- **Advanced Stats** — Export and reset moderator statistics

📖 [ADMIN-GUIDE.md →](ADMIN-GUIDE.md)

---

## See Also

**Previous:** [Gatekeeper Guide](GATEKEEPER-GUIDE.md) | **Next:** [Admin Guide](ADMIN-GUIDE.md)

**Reference:** [Bot Handbook](../BOT-HANDBOOK.md) &#8226; [Staff Policies](MOD-HANDBOOK.md) &#8226; [Permissions](../PERMS-MATRIX.md)
