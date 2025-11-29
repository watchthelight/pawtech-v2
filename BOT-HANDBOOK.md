# Pawtropolis Tech Bot Handbook

Everything you need to know about the bot — what it does, who can use it, and how.

---

## Table of Contents

1. [Gate System (Application Review)](#gate-system-application-review)
2. [Moderator Tools](#moderator-tools)
3. [Suggestion System](#suggestion-system)
4. [Artist Rotation](#artist-rotation)
5. [Movie Night](#movie-night)
6. [Role Automation](#role-automation)
7. [Configuration](#configuration)
8. [Utility & Admin](#utility--admin)
9. [Permission Reference](#permission-reference)
10. [Troubleshooting](#troubleshooting)

---

## Gate System (Application Review)

The gate system is how new members join the server. When someone wants in, they fill out an application in the gate channel. The bot creates a review embed in the staff channel with all their answers, and staff can claim it, look it over, and decide whether to accept, reject, or kick them.

### How Applications Work

Here's the flow from start to finish:

1. **Someone applies** — They click the Apply button in the gate channel and answer the questions you've set up
2. **Bot creates a review** — An embed appears in the review channel showing their answers, how old their account is, when they joined, and a short code like `A1B2C3` for quick reference
3. **A mod claims it** — Click the Claim button so other mods know you're handling this one
4. **You make the call** — Use the Accept, Reject, or Kick buttons (or slash commands if the buttons aren't working)
5. **Bot handles the rest** — Accepted users get the member role and a welcome message. Rejected users get a DM explaining why. Kicked users are removed.

### `/gate`
**Who can use it:** Staff (Manage Messages)

This is how you set up and configure the whole application system.

| Subcommand | What it does |
|------------|--------------|
| `setup` | First-time setup — tells the bot which channels to use and what role to give accepted members |
| `status` | Shows you the numbers — how many apps total, how many pending, accepted, rejected, etc. |
| `config` | Displays all your current settings so you can double-check everything |
| `reset` | Wipes all application data and starts fresh. Be careful with this one! |
| `welcome set` | Change what the welcome message says when someone gets accepted |
| `welcome preview` | See what the welcome message will look like before going live |
| `welcome channels` | Pick which channels get welcome messages |
| `welcome role` | Choose a role to ping when welcoming new members |
| `set-questions` | Set the questions applicants have to answer (q1 through q5) |

**Placeholders you can use in welcome messages:**
- `{applicant.mention}` — @mentions the new member
- `{applicant.username}` — just their name
- `{applicant.id}` — their Discord ID
- `{channel.rules}` — links to #rules
- `{channel.roles}` — links to #roles
- `{server.name}` — the server name
- `{server.memberCount}` — current member count

**Examples:**
```
/gate setup review_channel:#staff-review gate_channel:#apply general_channel:#general accepted_role:@Member
/gate welcome set content:Welcome {applicant.mention}! 🎉 Check out {channel.rules} and grab some roles in {channel.roles}!
/gate set-questions q1:What is the password? q2:How did you find us? q3:Tell us about yourself
```

---

### `/accept`
**Who can use it:** Staff (Reviewer role or Manage Guild)

Use this to approve someone's application. They'll get the member role and a welcome message will be posted.

You need to tell the bot which application you mean. Pick ONE of these:
- `app:A1B2C3` — the short code shown on the review embed
- `user:@Username` — mention them or pick from the list
- `uid:123456789012345678` — their Discord ID (handy if they already left)

**What happens when you accept someone:**
1. They get the member role (like <@&896070888594759743>)
2. A welcome message goes out in the configured channel(s)
3. The review embed updates to show you accepted them
4. Everything gets logged for mod stats

**Examples:**
```
/accept app:A1B2C3
/accept user:@CoolPerson
/accept uid:123456789012345678
```

---

### `/reject`
**Who can use it:** Staff (Reviewer role or Manage Guild)

Use this when you need to turn someone down. You have to give a reason, and they'll get a DM explaining why (if their DMs are open).

| Option | Required? | What it does |
|--------|-----------|--------------|
| `reason` | **Yes** | Why you're rejecting them — this gets sent to the user and logged (max 500 characters) |
| `app` | No | The short code from the review embed |
| `user` | No | Mention them or pick from the list |
| `uid` | No | Their Discord ID |
| `perm` | No | Set this to `true` if they should never be allowed to apply again |

Pick ONE of app/user/uid — not multiple.

**What happens when you reject someone:**
1. They get a DM with your reason (if their DMs are open)
2. The review embed updates to show the rejection and reason
3. If you used `perm:true`, they're blocked from ever applying again
4. They get kicked from the server
5. It all gets logged for mod stats

**When to use permanent rejection:**
- Obvious spam or bot accounts
- People who break rules during the application
- Repeat offenders who keep getting rejected
- Underage users

**Examples:**
```
/reject app:A1B2C3 reason:Incorrect password - please re-read the rules and try again
/reject user:@SpamBot reason:Bot account perm:true
/reject uid:123456789012345678 reason:Underage perm:true
```

---

### `/kick`
**Who can use it:** Staff (Reviewer role or Manage Guild)

This removes someone from the server but doesn't count as a formal rejection. Good for situations where they just need to try again.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `reason` | **Yes** | Why you're kicking them |
| `app` | No | Short code |
| `user` | No | Mention or picker |
| `uid` | No | Discord ID |

**When to kick vs when to reject:**
- **Kick:** They made a mistake, didn't finish their app, need another shot
- **Reject:** You're formally denying them and want it on record

**Examples:**
```
/kick app:A1B2C3 reason:Incomplete application - please try again
/kick user:@Username reason:Application timed out
```

---

### `/unclaim`
**Who can use it:** Staff

If you claimed an application but can't finish reviewing it, use this to release it so someone else can take over.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `app` | No | Short code |
| `user` | No | Mention or picker |
| `uid` | No | Discord ID |

**Examples:**
```
/unclaim app:A1B2C3
/unclaim user:@Username
```

---

### `/listopen`
**Who can use it:** Staff (Reviewer role or Manage Guild)

See what applications are waiting for review.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `scope` | No | What to show (default: `mine`) |

**Scope options:**
| Scope | What you'll see |
|-------|-----------------|
| `mine` | Just the apps you've claimed (default) |
| `all` | Everything that's open — claimed and unclaimed |
| `drafts` | Applications people started but haven't finished yet |

The list shows you the applicant's name, the short code, who claimed it (if anyone), and how long it's been waiting.

**Examples:**
```
/listopen
/listopen scope:all
/listopen scope:drafts
```

---

### `/search`
**Who can use it:** Staff (Reviewer role or Manage Guild)

Look up someone's entire application history — every app they've submitted, what happened, and which mod handled it.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `user` | **Yes** | Who to look up |

You'll see their total number of applications, each one with the date, outcome, and handling mod. If they were rejected, you'll see the reasons. It also shows if they're currently blocked.

**Example:**
```
/search user:@Username
```

---

### `/unblock`
**Who can use it:** Staff

Made a mistake with a permanent rejection? Or did someone's appeal get approved? Use this to let them apply again.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `target` | No | Mention the user |
| `user_id` | No | Their Discord ID (if they left) |
| `username` | No | Their username as a fallback |
| `reason` | No | Why you're unblocking them — gets logged |

**Examples:**
```
/unblock target:@Username reason:Appeal approved by leadership
/unblock user_id:123456789012345678 reason:Mistaken identity - wrong person
```

---

## Moderator Tools

These commands help you track how mods are doing, spot patterns, and keep an eye on things.

### `/modstats`
**Who can use it:** Staff

See how active moderators are and how they're performing.

| Subcommand | What it does |
|------------|--------------|
| `leaderboard` | Ranks mods by how many apps they've handled |
| `user` | Deep dive into a specific mod's stats |
| `export` | Download everything as a CSV file |
| `reset` | Wipe and rebuild the stats (needs admin password) |

**Options:**
| Option | Works with | What it does |
|--------|------------|--------------|
| `days` | All | How far back to look (default: 30 days) |
| `moderator` | `user` | Which mod to analyze |

**The leaderboard shows:**
- Rankings by total decisions
- Accept and reject counts
- Approval rate percentage
- Average response time

**Individual mod stats show:**
- Total decisions they've made
- Accept vs reject breakdown with percentages
- Response time percentiles (p50 and p95)
- Day-by-day activity
- Anomaly detection (flags if something seems off)

**Examples:**
```
/modstats leaderboard days:7
/modstats user moderator:@ModName days:30
/modstats export days:90
```

---

### `/modhistory`
**Who can use it:** Leadership only (server owners or designated leaders)

This gives you a detailed look at everything a specific mod has done. It's for oversight and performance reviews, which is why it's restricted to leadership.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `moderator` | **Yes** | Who to look into |
| `days` | No | How far back (default: 30, max: 365) |
| `export` | No | Download as CSV |

**You'll see:**
- Every accept, reject, and kick they've made
- Timestamps for each action
- How long they took to respond
- The reasons they gave for rejections
- Anomaly scores (flags unusual patterns)

**Examples:**
```
/modhistory moderator:@ModName days:60
/modhistory moderator:@ModName days:90 export:true
```

---

### `/analytics`
**Who can use it:** Staff

Visual charts showing review activity over time. Helpful for spotting busy periods or figuring out when you need more coverage.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `from` | No | Start date (Unix timestamp) |
| `to` | No | End date (Unix timestamp) |
| `all-guilds` | No | Include all servers (bot owners only) |
| `bucket` | No | Group by `hourly`, `daily`, or `weekly` |

**The charts show:**
- How many apps came in over time
- Accept vs reject distribution
- Peak activity hours and days
- Trend lines

**Examples:**
```
/analytics
/analytics bucket:daily
/analytics bucket:weekly
```

---

### `/analytics-export`
**Who can use it:** Staff

Same data as `/analytics` but downloaded as a CSV so you can dig into it yourself.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `from` | No | Start date |
| `to` | No | End date |
| `all-guilds` | No | Include all servers (owners only) |

---

### `/flag`
**Who can use it:** Staff

Mark someone as suspicious. Flagged users show a warning badge on their applications so other mods know to look closer.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `user` | **Yes** | Who to flag |
| `reason` | No | Why — this shows to other staff |

**Good reasons to flag someone:**
- Suspicious account (brand new, no avatar, weird username)
- You think they're an alt of someone banned
- Other members reported them
- Bad history in other servers

**Examples:**
```
/flag user:@SuspiciousUser reason:Alt account of banned user
/flag user:@NewAccount reason:Suspicious join pattern - review carefully
```

---

### `/approval-rate`
**Who can use it:** Staff

See the big picture — what percentage of applications get approved vs rejected server-wide.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `days` | No | How far back to look (default: 30) |

**You'll see:**
- Total applications received
- Approval rate percentage
- Rejection rate percentage
- How it compares to the previous period
- Common rejection reasons (if there are patterns)

**Examples:**
```
/approval-rate
/approval-rate days:7
/approval-rate days:90
```

---

## Suggestion System

A way for community members to submit feature ideas for the bot, and for staff to manage them.

### How It Works

1. **Someone has an idea** — They use `/suggest` to submit it
2. **It gets posted** — The suggestion appears in the suggestions channel
3. **People react** — Members can upvote or downvote
4. **Staff reviews** — You can approve, deny, or mark it as implemented
5. **They get notified** — The person who suggested it gets a DM with your decision

### `/suggest`
**Who can use it:** Everyone

Submit an idea for a new bot feature. There's a cooldown between submissions to prevent spam.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `suggestion` | **Yes** | Your idea (max 1000 characters) |

**Tips for good suggestions:**
- Be specific about what you want
- Explain why it would be useful
- Check existing suggestions first so you don't duplicate

**Examples:**
```
/suggest suggestion:Add a command to view server statistics like member count over time
/suggest suggestion:Let users set their own timezone for event notifications
```

---

### `/suggestions`
**Who can use it:** Everyone

Browse through all the suggestions people have submitted.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `status` | No | Filter by status |

**Status options:**
| Status | What it shows |
|--------|---------------|
| `open` | New ones waiting for review (default) |
| `approved` | Approved and planned |
| `denied` | Turned down with a reason |
| `implemented` | Done and live! |
| `all` | Everything |

**Examples:**
```
/suggestions
/suggestions status:approved
/suggestions status:implemented
```

---

### `/suggestion`
**Who can use it:** Staff (Manage Messages)

Manage suggestions — approve them, deny them, or mark them done.

| Subcommand | What it does |
|------------|--------------|
| `approve` | Green light it — means you're planning to add it |
| `deny` | Turn it down with a reason |
| `implement` | Mark it as shipped |
| `delete` | Remove it entirely |

**Options:**
| Option | Works with | What it does |
|--------|------------|--------------|
| `id` | All | The suggestion's ID number (required) |
| `response` | `approve`, `implement` | Optional message to the suggester |
| `reason` | `deny` | Why you're denying it (required for deny) |

**Examples:**
```
/suggestion approve id:42 response:Great idea! Adding to the roadmap for next month.
/suggestion deny id:43 reason:This is outside the scope of what the bot does.
/suggestion implement id:42 response:This is now live! Thanks for the suggestion.
/suggestion delete id:99
```

---

## Artist Rotation

A queue system that fairly distributes art commissions among Server Artists. When someone redeems an art reward, the next artist in line gets assigned.

### How the Queue Works

1. **Artists join the queue** — Anyone with the <@&1201395606455562341> role is automatically in
2. **Order is set** — By default it's based on when they joined, but you can adjust it
3. **Someone redeems a reward** — When you use `/redeemreward`, the next available artist gets assigned
4. **Artist moves to back** — After an assignment, that artist goes to the end of the line
5. **Skip if needed** — Artists can be temporarily skipped if they're on vacation or too busy

### `/artistqueue`
**Who can use it:** Manage Roles permission

Manage who's in the queue and their order.

| Subcommand | What it does |
|------------|--------------|
| `list` | See the current queue order and who's skipped |
| `sync` | Update the queue to match who currently has the Server Artist role |
| `move` | Put an artist at a specific position in the queue |
| `skip` | Temporarily take an artist out of rotation |
| `unskip` | Put them back in rotation |
| `history` | See past art reward assignments |
| `setup` | First-time setup — syncs the queue and gets everything configured |

**Examples:**
```
/artistqueue list
/artistqueue sync
/artistqueue move user:@Artist position:1
/artistqueue skip user:@Artist reason:On vacation until Dec 15
/artistqueue unskip user:@Artist
/artistqueue history limit:20
/artistqueue history user:@Artist limit:10
```

---

### `/redeemreward`
**Who can use it:** Manage Roles permission

Use this in a ticket channel when someone is redeeming an art prize. It assigns the next artist and adds them to the ticket.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `user` | **Yes** | Who's redeeming the reward |
| `type` | **Yes** | What kind of art |
| `artist` | No | Override the queue and pick a specific artist |

**Art types:**
| Type | Description |
|------|-------------|
| `headshot` | Head/portrait |
| `halfbody` | Waist-up |
| `fullbody` | Full character |
| `emoji` | Discord emoji |

**What happens:**
1. Bot shows you a confirmation with the user's ticket roles and who's next in the queue
2. You click Confirm
3. Bot sends `$add <@artistId>` to add the artist to the ticket
4. That artist moves to the back of the queue
5. Assignment gets logged in history

**Examples:**
```
/redeemreward user:@Winner type:headshot
/redeemreward user:@Winner type:fullbody artist:@SpecificArtist
```

---

## Movie Night

Track who shows up to movie nights and automatically give out tier roles based on attendance.

### How It Works

1. **Start tracking** — When the movie begins, use `/movie start` to monitor the voice channel
2. **Bot watches** — Everyone's time in the VC gets recorded
3. **End the event** — When the movie's over, use `/movie end` to finalize everything
4. **Roles get assigned** — Anyone who stayed 30+ minutes gets credit, and tier roles update automatically

### Tier Roles

You need to stay **at least 30 minutes** during a movie night for it to count toward your tier.

| Tier | Role | How to earn it |
|------|------|----------------|
| T1 | <@&1388676461657063505> | Attend 1+ movie night |
| T2 | <@&1388676662337736804> | Attend 5+ movie nights |
| T3 | <@&1388675577778802748> | Attend 10+ movie nights |
| T4 | <@&1388677466993987677> | Attend 20+ movie nights |

**Important:** People only get promoted, never demoted. If someone has <@&1388675577778802748> and misses a few movies, they keep the role.

### `/movie`
**Who can use it:** Staff

| Subcommand | What it does |
|------------|--------------|
| `start` | Begin tracking attendance in a voice channel |
| `end` | Finish the event and hand out roles |
| `attendance` | See who attended or check a specific person's history |

**Start options:**
| Option | Required? | What it does |
|--------|-----------|--------------|
| `channel` | **Yes** | Which voice channel to track |

**Attendance options:**
| Option | Required? | What it does |
|--------|-----------|--------------|
| `user` | No | Check a specific person — leave blank to see everyone |

**Examples:**
```
/movie start channel:#movie-night-vc
/movie end
/movie attendance
/movie attendance user:@Username
```

**Edge cases the bot handles:**
- Someone joins, leaves, and rejoins — all their time gets added up
- Someone was already in the VC when you started tracking — counted from start time
- Bot restarts mid-movie — session data is preserved, nothing lost

---

## Role Automation

Set up automatic role assignments based on Amaribot levels and movie night attendance.

### `/roles`
**Who can use it:** Manage Roles permission

Configure which roles get assigned automatically.

| Subcommand | What it does |
|------------|--------------|
| `add-level-tier` | Connect an Amaribot level to a role |
| `add-level-reward` | Give a one-time token role when someone hits a level |
| `add-movie-tier` | Set up a movie attendance tier |
| `list` | See all your configured mappings |
| `remove-level-tier` | Delete a level tier mapping |
| `remove-level-reward` | Delete a level reward |
| `remove-movie-tier` | Delete a movie tier |

**How level automation works:**
When Amaribot announces someone leveled up, the bot checks if there's a role configured for that level. If there is, they get it automatically.

**Examples:**
```
/roles add-level-tier level:15 role:@Engaged Fur
/roles add-level-reward level:15 role:@Byte Token [Common]
/roles add-movie-tier tier_name:Popcorn Club role:@Popcorn Club movies_required:5
/roles list type:level_tier
/roles list type:level_reward
/roles list type:movie_tier
```

---

### `/panic`
**Who can use it:** Staff

Emergency stop button for role automation. If roles are getting assigned incorrectly, use this immediately.

| Subcommand | What it does |
|------------|--------------|
| `on` | **STOP** all automatic role grants right now |
| `off` | Resume normal operation |
| `status` | Check if panic mode is currently on |

**When to hit the panic button:**
- Roles going to the wrong people
- Duplicate roles being added
- Any weird role behavior you don't understand
- Before making configuration changes (just to be safe)

**Examples:**
```
/panic on
/panic status
/panic off
```

---

## Configuration

Set up how the bot behaves in your server.

### `/config`
**Who can use it:** Administrator

Server-wide bot settings.

| Subcommand | What it does |
|------------|--------------|
| `set logging_channel` | Where bot actions get logged |
| `set flags_channel` | Where Silent-Since-Join alerts go |
| `set flags_threshold` | How many days before flagging silent members (7-365) |
| `set dadmode` | Toggle the "Hi hungry, I'm Dad!" joke responses |
| `set pingdevonapp` | Toggle whether to ping Bot Dev when new apps come in |
| `set suggestion_channel` | Where suggestions get posted |
| `set suggestion_cooldown` | How long between suggestions (in seconds) |
| `get logging` | Check your logging settings |
| `get flags` | Check your flags settings |
| `view` | See all your current settings at once |

**What's Dad Mode?**
When someone says "I'm hungry" (or any "I'm [thing]"), the bot has a random chance to respond "Hi hungry, I'm Dad!" It's silly but people seem to like it.

**What's Silent-Since-Join?**
The bot can flag users who've been in the server for X days but have never sent a single message. Helps catch lurker bots or inactive accounts.

**Examples:**
```
/config set logging_channel channel:#mod-logs
/config set dadmode state:true chance:500
/config set flags_threshold days:14
/config set suggestion_channel channel:#suggestions
/config view
```

---

### `/review-set-notify-config`
**Who can use it:** Administrator

Set up notifications for new forum posts (for application review forums).

| Option | Required? | What it does |
|--------|-----------|--------------|
| `mode` | No | `post` (reply in the thread) or `channel` (send to a separate channel) |
| `role` | No | Which role to ping |
| `forum` | No | Which forum channel to watch |
| `channel` | No | Where to send notifications (for channel mode) |
| `cooldown` | No | Minimum seconds between notifications |
| `max_per_hour` | No | Cap on notifications per hour |

---

### `/review-get-notify-config`
**Who can use it:** Administrator

Check your current forum notification settings.

---

### `/review-set-listopen-output`
**Who can use it:** Manage Guild

Control whether `/listopen` results are visible to everyone or just you.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `mode` | **Yes** | `public` or `ephemeral` |

---

## Utility & Admin

General-purpose tools and admin commands.

### `/update`
**Who can use it:** Bot Owner only

Change the bot's Discord presence and profile.

| Subcommand | What it does |
|------------|--------------|
| `activity` | What the bot is "doing" (Playing, Watching, Listening, etc.) |
| `status` | Custom status text |
| `banner` | Update banners (profile, gate embed, welcome embed, website) |
| `avatar` | Change the bot's profile picture |

**Activity types:** Playing, Streaming, Listening, Watching, Competing

**Examples:**
```
/update activity type:watching text:over the gate
/update status text:Protecting the realm 🛡️
/update banner image:<attachment>
/update avatar image:<attachment>
```

---

### `/send`
**Who can use it:** Manage Messages

Post a message as the bot. Good for announcements where you don't want to show who wrote it.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `message` | **Yes** | What to say |
| `embed` | No | Make it a fancy embed (default: false) |
| `reply_to` | No | Reply to a specific message ID |
| `attachment` | No | Include a file or image |
| `silent` | No | Block all @mentions (default: true) |

**Examples:**
```
/send message:Welcome to the server!
/send message:Important announcement embed:true
/send message:As requested... reply_to:123456789012345678
/send message:Check out this image attachment:<file>
```

---

### `/purge`
**Who can use it:** Manage Messages + Password

Mass delete messages in a channel. Requires the admin password because this is destructive.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `password` | **Yes** | Admin password |
| `count` | No | How many messages (default: all in channel) |

**Heads up:**
- Discord only lets you delete messages less than 14 days old
- It's rate limited so you can't nuke everything instantly

**Example:**
```
/purge password:*** count:50
```

---

### `/poke`
**Who can use it:** Bot Owner only

Ping someone across multiple channels in a category. For when you really need to get someone's attention.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `user` | **Yes** | Who to poke |

---

### `/health`
**Who can use it:** Everyone

Quick check to see if the bot is working properly.

**Shows you:**
- Uptime (how long since last restart)
- WebSocket latency (connection to Discord)
- Database status
- Memory usage

**Example:**
```
/health
```

---

### `/activity`
**Who can use it:** Everyone

See a heatmap of when the server is most active. Shows message volume by day and hour.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `weeks` | No | How far back to look (1-8 weeks, default: 1) |

**The heatmap shows:**
- Activity broken down by day of week and hour
- Color intensity = message volume
- Trend analysis (busier or quieter than usual)

**Examples:**
```
/activity
/activity weeks:4
```

---

### `/backfill`
**Who can use it:** Staff

Rebuild the activity data by scanning message history. Use this after first enabling activity tracking, or if the data seems incomplete.

| Option | Required? | What it does |
|--------|-----------|--------------|
| `weeks` | No | How far back to scan (1-8 weeks, default: 8) |
| `dry-run` | No | Test without actually saving anything |

**Note:** This can take a while for busy servers.

---

### `/database`
**Who can use it:** Bot Owner + Password

Database maintenance and recovery tools.

| Subcommand | What it does |
|------------|--------------|
| `check` | Check database health, integrity, and table sizes |
| `recover` | Interactive assistant for database recovery |

---

## Permission Reference

| Level | Who has it | Example commands |
|-------|------------|------------------|
| **Everyone** | All server members | `/health`, `/activity`, `/suggest` |
| **Staff** | Reviewer role or Manage Guild | `/accept`, `/reject`, `/listopen`, `/modstats` |
| **Leadership** | Server owners + leadership role | `/modhistory` |
| **Administrator** | Administrator permission | `/config`, `/review-set-notify-config` |
| **Bot Owner** | Designated in config | `/update`, `/poke`, `/database` |

### What counts as "Staff"?

You're considered staff if you have ANY of these:
- The configured Reviewer role
- Manage Guild permission
- Administrator permission
- You're the server owner
- You're a bot owner

---

## Troubleshooting

### The buttons on applications aren't working

If Accept/Reject/Kick buttons stop responding:
1. Use the slash commands instead — `/accept app:SHORTCODE`
2. Run `/health` to see if the bot is responding at all
3. Find the short code on the application embed (like `A1B2C3`)

### Someone left before I could accept/reject them

You can still process their application using their Discord ID:
```
/accept uid:123456789012345678
/reject uid:123456789012345678 reason:Left during review
```

### I accidentally permanently rejected someone

Use `/unblock` to fix it:
```
/unblock user_id:123456789012345678 reason:Mistake - wrong person
```

### Role automation is doing something weird

1. Run `/panic on` immediately to stop everything
2. Check `/roles list` to see if something's misconfigured
3. Fix whatever's wrong
4. Run `/panic off` to start it back up

### The bot isn't responding at all

1. Check Discord's status page (status.discord.com) — might be a Discord issue
2. Ask a bot owner to check the server logs
3. The bot might need a restart

---

## Quick Reference

### Commands you'll use all the time

| Command | What it's for |
|---------|---------------|
| `/accept` | Approve an application |
| `/reject` | Reject an application |
| `/listopen` | See what's pending |
| `/search` | Look up someone's history |
| `/modstats leaderboard` | See mod activity |
| `/health` | Check if bot's working |

### Emergency commands

| Command | What it's for |
|---------|---------------|
| `/panic on` | Stop all role automation NOW |
| `/purge` | Emergency message cleanup |
| `/database check` | Make sure the database is okay |
| `/unblock` | Fix an accidental perm rejection |

---

*Last updated: November 2025*
