## Permission System Overhaul Complete

Hey! Just finished a major update to how command permissions work. Here's what changed:

---

### What's New

**Named roles instead of generic "staff"** — Every command now requires a specific role instead of just checking if you're "staff". This gives you granular control over who can do what.

---

### Role Hierarchy

```
Server Owner > Community Manager > CDL > Senior Admin > Administrator > Senior Mod > Moderator > Junior Mod > Gatekeeper > Moderation Team
```

Server Dev and Bot Owner always bypass all checks.

---

### Command Permission Levels

**Gatekeeper only**
`/accept`, `/reject`, `/kick`, `/unclaim`, `/listopen`, `/unblock`, `/search`, all review card buttons

**Gatekeeper+**
`/modstats leaderboard`, `/modstats user`

**Junior Mod+**
`/flag`, `/isitreal`

**Moderator+**
`/movie`

**Senior Mod+**
`/activity`, `/skullmode`, `/update activity/status`, `/art all`, `/art assign`

**Administrator+**
`/config` (all subcommands), `/art leaderboard`

**Senior Admin+**
`/panic`, `/modstats export/reset`, `/config isitreal`, `/config toggleapis`, `/review-set-notify-config`, `/review-get-notify-config`

**Community Manager+**
`/audit`, `/backfill`, `/update banner/avatar`, `/gate setup/reset/status/config/welcome/set-questions`

**Bot Owner only**
`/database`, `/poke`, `/sync`

**Discord Permission Based**
- ManageMessages: `/send`, `/purge`
- ManageRoles: `/roles`, `/artistqueue`, `/redeemreward`
- ManageGuild: `/resetdata`, `/review-set-listopen-output`
- Administrator: `/modhistory`

---

### Better Error Messages

When someone tries to use a command they can't access, they now see exactly which roles are needed:

> **Permission Denied**
> Command: `/activity`
>
> You need one of:
> **Senior Moderator or above**
> • @Senior Moderator
> • @Administrator
> • @Senior Administrator
> • etc.

---

### Important Note on Gatekeeper

Gatekeeper is now its own thing — higher roles don't automatically get application commands. This means a Senior Mod can't accidentally process applications unless they also have the Gatekeeper role. This was intentional based on your requirements.

---

### Documentation

Full permission matrix is now in `PERMS-MATRIX.md` with all role IDs and command mappings.

Let me know if any of these permission levels need adjusting!
