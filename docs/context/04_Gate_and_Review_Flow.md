# 04 — Gate and Review Flow

**Last Updated:** 2025-10-22
**Status:** Production-ready with full audit trail

## Summary

- **Purpose:** Verification system requiring applicants to answer questions before accessing server
- **Flow:** Join → Gate Message → Modal → Review → Decision → DM + Role Assignment
- **Audit:** Every step logged with timestamps, moderator IDs, and optional reasons
- **Join→Submit Ratio:** Key metric tracked for conversion funnel analysis

---

## Table of Contents

- [End-to-End Flow](#end-to-end-flow)
- [Gate Message](#gate-message)
- [Verification Questions](#verification-questions)
- [Review Queue](#review-queue)
- [Moderator Decision Flow](#moderator-decision-flow)
- [Welcome Message](#welcome-message)
- [Rejection Handling](#rejection-handling)
- [Join→Submit Ratio](#joinsubmit-ratio)
- [Database Schema](#database-schema)

---

## End-to-End Flow

```
┌──────────────────────────────────────────────────────────────┐
│ 1. User Joins Server                                         │
│    └─> Discord member add event fires                        │
│    └─> User sees only #gate channel (role permissions)       │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. Gate Message Displayed                                    │
│    └─> Embed with server welcome text                        │
│    └─> "Verify" button to start application                  │
│    └─> Explanation of verification process                   │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. User Clicks "Verify" Button                               │
│    └─> Discord modal opens with 5 questions                  │
│    └─> User must answer all questions (required fields)      │
│    └─> Submission validates input length and format          │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. Application Submitted                                     │
│    └─> Saved to `applications` table (status: pending)       │
│    └─> Action logged: app_submitted (timestamp recorded)     │
│    └─> Review card posted to #review channel                 │
│    └─> Avatar risk scan performed (optional flagging)        │
│    └─> User receives "Application received" DM               │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 5. Moderator Claims Application                              │
│    └─> Clicks "Decide" button on review card                 │
│    └─> Application status: pending → claimed                 │
│    └─> Action logged: claim (moderator_id + timestamp)       │
│    └─> Button changes to "Claimed by @Moderator"             │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 6. Moderator Reviews Answers                                 │
│    └─> Reads all 5 question responses                        │
│    └─> Checks avatar risk score (if available)               │
│    └─> Reviews user profile (account age, activity)          │
│    └─> Decides: approve / reject / kick                      │
└──────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        │                                       │
        ▼                                       ▼
┌─────────────────────┐              ┌─────────────────────┐
│ 7a. APPROVED        │              │ 7b. REJECTED/KICKED │
├─────────────────────┤              ├─────────────────────┤
│ • Verified role +   │              │ • Action logged     │
│ • DM sent (welcome) │              │ • DM sent (reason)  │
│ • Welcome msg posted│              │ • If kick: removed  │
│ • Action logged     │              │ • Can reapply later │
└─────────────────────┘              └─────────────────────┘
```

---

## Gate Message

**Location:** `#gate` channel (pinned message)
**Visibility:** All new members see only this channel until verified
**Components:**

- Welcome embed with server description
- Explanation of verification purpose
- "Verify" button (green, primary style)
- Rules reminder (optional)

**Example Embed:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🐾 Welcome to Pawtropolis!

Before you enjoy your stay, you must go through our
verification system which you can start by clicking
**Verify** and answering 5 simple questions.

This helps us keep the community safe and welcoming
for all members.

[Verify Button]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Customization:**

- Message text editable via admin panel config page
- Supports markdown formatting
- Template variables: `{guild.name}`, `{guild.memberCount}`

**Preview Available:**

- Admin panel Config page shows rendered preview
- Live updates when editing message template

---

## Verification Questions

**Count:** Up to 5 questions (configurable per guild)
**Format:** Modal with text input fields
**Validation:**

- All fields required (modal won't submit if empty)
- Maximum 1024 characters per answer (Discord limit)
- Minimum 10 characters per answer (prevents spam)

**Configuration:**

Questions can be customized per guild using the `/gate set-questions` command:

```
/gate set-questions q1:"What is your age?" q2:"How did you find this server?"
```

**Features:**
- Supports up to 5 questions (q1 through q5)
- Only provided questions are updated (omitted ones remain unchanged)
- Questions are required by default
- Maximum 500 characters per question prompt

**Viewing Current Questions:**

Run `/gate set-questions` without any parameters to view all current questions:

```
/gate set-questions
```

This will display an ephemeral message showing all configured questions.

**Default Questions (seeded on `/gate setup`):**

1. **What is your age?**
   - Purpose: Age verification for community safety
   - Expected: Numeric age or age range

2. **How did you find this server?**
   - Purpose: Track discovery channels (Reddit, friend invite, search)
   - Expected: Short answer (e.g., "Reddit post", "Friend recommendation")

3. **What tend to be your goals here?**
   - Purpose: Gauge genuine interest and community fit
   - Expected: 2-3 sentences about interests/goals

4. **What does a furry mean to you?**
   - Purpose: Community-specific context and understanding
   - Expected: Personal perspective on furry culture

5. **What is the password stated in our rules?**
   - Purpose: Verify rules were read completely
   - Expected: Exact password from rules channel

**Storage:**
Answers saved per question index in `application_response` table:

```sql
-- Each answer stored as a separate row
app_id | q_index | question              | answer
-------|---------|----------------------|--------
abc123 | 0       | What is your age?    | 24
abc123 | 1       | How did you find us? | Reddit
abc123 | 2       | What are your goals? | Looking for art community
...
```

---

## Review Queue

**Location:** `#review` channel (moderator-only)
**Card Format:** Rich embed with applicant info

**Review Card Components:**

```
┌─────────────────────────────────────────────────────┐
│ 🆕 New Application                                  │
│ User: Alice#1234 (ID: 123456789012345678)          │
│ Account Created: 2023-05-15 (2 years ago)          │
│ Joined Server: 2025-10-22 03:15:42 UTC             │
│ Avatar Risk: 🟢 Low (score: 0.12)                  │
├─────────────────────────────────────────────────────┤
│ Q1: What brings you to our community?              │
│ A1: I'm interested in furry art and looking for... │
│                                                     │
│ Q2: How did you find us?                           │
│ A2: Found through Reddit r/furry                   │
│                                                     │
│ [... remaining Q&A ...]                            │
├─────────────────────────────────────────────────────┤
│ [Decide] [Copy UID] [View Avatar]                 │
└─────────────────────────────────────────────────────┘
```

**Avatar Risk Scoring:**

- 🟢 Low (< 0.3): Safe, typical profile picture
- 🟡 Medium (0.3-0.7): Potential concern, manual review
- 🔴 High (> 0.7): Likely NSFW/inappropriate, flag for review

**Claim Flow:**

1. Moderator clicks "Decide" button
2. Application locked to that moderator (prevents double-claiming)
3. Button updates to "Claimed by @ModeratorName"
4. Other moderators see disabled button
5. Slash commands `/accept`, `/reject`, `/kick` now available

---

## Moderator Decision Flow

### Approve (`/accept @user [reason]`)

**Flow:**

```
1. Moderator: /accept @Alice reason: Great answers, account looks good
   ↓
2. Verify moderator owns claim (user === claimed_by_moderator)
   ↓
3. Update applications.status = 'approved'
   ↓
4. Log action: approve (moderator_id, timestamp, optional reason)
   ↓
5. Calculate response time (submission → decision)
   ↓
6. Assign verified role to user
   ↓
7. Send DM to user with welcome message
   ↓
8. Post welcome message in #general (optional)
   ↓
9. Update mod_metrics (total_accepts++, response time)
   ↓
10. Reply to moderator: ✓ Alice approved
```

**DM Content (Approval):**

```
✅ Application Approved!

Welcome to Pawtropolis! Your application has been approved.

You now have access to all channels. Please remember to:
• Follow our community rules
• Be respectful to all members
• Have fun and engage positively

If you have questions, feel free to open a modmail ticket by DMing me.
```

### Reject (`/reject @user reason: <text>`)

**Flow:**

```
1. Moderator: /reject @Bob reason: Account too new (< 7 days)
   ↓
2. Verify moderator owns claim
   ↓
3. Update applications.status = 'rejected'
   ↓
4. Log action: reject (moderator_id, timestamp, REQUIRED reason)
   ↓
5. Send DM to user with rejection reason
   ↓
6. User remains in server (can reapply)
   ↓
7. Update mod_metrics (total_rejects++, response time)
   ↓
8. Reply to moderator: ✓ Bob rejected
```

**DM Content (Rejection):**

```
❌ Application Rejected

Your application to Pawtropolis has been rejected.

Reason: Account too new (< 7 days). Please reapply after your account ages.

You may reapply in the future by returning to the #gate channel and clicking "Verify" again.
```

### Kick (`/kick @user reason: <text>`)

**Flow:**

```
1. Moderator: /kick @Charlie reason: Troll answers, likely spam
   ↓
2. Verify moderator owns claim
   ↓
3. Update applications.status = 'perm_rejected'
   ↓
4. Log action: kick (moderator_id, timestamp, REQUIRED reason)
   ↓
5. Send DM to user with kick reason
   ↓
6. Remove user from server (guild.members.kick)
   ↓
7. Update mod_metrics (total_kicks++, response time)
   ↓
8. Reply to moderator: ✓ Charlie kicked
```

**DM Content (Kick):**

```
🚫 Application Rejected & Removed

Your application to Pawtropolis has been rejected and you have been removed from the server.

Reason: Troll answers, likely spam

If you believe this was a mistake, please contact the moderation team through our support server [link].
```

---

## Welcome Message

**Trigger:** Sent after application approval
**Delivery:** DM to user + optional public post in welcome channel
**Format:** Markdown-formatted text with template variables

**Template Variables:**

- `{applicant.mention}` → `<@123456789012345678>`
- `{applicant.username}` → `Alice`
- `{applicant.tag}` → `Alice#1234`
- `{guild.name}` → `Pawtropolis`
- `{guild.memberCount}` → `1,247`
- `{timestamp}` → `2025-10-22 03:30:15 UTC`

**Example Template:**

```markdown
Welcome {applicant.mention} to **{guild.name}**! 🎉

We're thrilled to have you as member #{guild.memberCount}.

Feel free to:
• Introduce yourself in <#intro-channel>
• Pick roles in <#roles-channel>
• Check out <#rules-channel> if you haven't already

Enjoy your stay! If you need help, just DM the bot to open a modmail ticket.
```

**Customization:**

- Editable via admin panel config page
- Live preview shows rendered output
- Supports Discord markdown (bold, italic, channels, roles, users)

**Public Welcome Post:**
Optionally posts to designated welcome channel:

```
🎉 Welcome @Alice!

Please give them a warm welcome to the community!
```

---

## Rejection Handling

### Soft Rejection (Status: `rejected`)

- User remains in server
- Can reapply by clicking "Verify" again
- Previous application marked as rejected in database
- No cooldown period (reapply immediately)

### Hard Rejection (Status: `perm_rejected` / Kicked)

- User removed from server
- Must rejoin server to reapply
- Previous application flagged as permanent rejection
- Rejoining triggers automatic flag for moderators

**Reapplication Flow:**

```
1. Previously rejected user clicks "Verify" again
   ↓
2. Bot checks for existing rejected application
   ↓
3. If found: add "⚠️ Reapplication (previously rejected on YYYY-MM-DD)" to review card
   ↓
4. Moderator reviews with prior rejection context
   ↓
5. Can approve if circumstances improved
```

---

## Join→Submit Ratio

**Definition:** Percentage of server joins that complete verification application

**Formula:**

```
Join→Submit Ratio = (Applications Submitted / Server Joins) × 100
```

**Tracked Windows:**

- Last 24 hours
- Last 7 days
- Last 30 days (default)
- Last year
- All time

**Purpose:**

- Identify drop-off points in verification funnel
- Measure effectiveness of gate message clarity
- Detect bot/spam join waves (low submit ratio)
- Assess friction in verification process

**Visualization:**

- Admin dashboard shows line graph over time
- Color-coded: Green (> 60%), Yellow (40-60%), Red (< 40%)
- Tooltip shows exact counts (e.g., "147 submits / 245 joins = 60%")

**Interpretation:**

- **High ratio (> 70%):** Gate message clear, low friction
- **Medium ratio (50-70%):** Normal, some drop-off expected
- **Low ratio (< 50%):** Investigate: unclear instructions, too many questions, intimidating language

**Database Tracking:**

- `action_log.action = 'app_submitted'` → application submissions
- Guild member add events logged separately (future: track in `action_log` for consistency)

---

## Database Schema

### `applications` Table

```sql
CREATE TABLE applications (
  application_id TEXT PRIMARY KEY,
  applicant_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  status TEXT NOT NULL, -- pending, claimed, approved, rejected, perm_rejected
  claimed_by_moderator TEXT,
  claimed_at INTEGER,
  answer_data TEXT, -- JSON blob with Q&A
  submitted_at INTEGER NOT NULL,
  decided_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_guild_status ON applications(guild_id, status);
CREATE INDEX idx_applications_claimed_by ON applications(claimed_by_moderator);
```

**Status Transitions:**

```
pending → claimed → approved / rejected / perm_rejected
   ↓         ↓
   └─────────┴──> can unclaim → back to pending
```

### `action_log` Table

```sql
CREATE TABLE action_log (
  action_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  action TEXT NOT NULL, -- app_submitted, claim, approve, reject, kick, modmail_open, modmail_close
  moderator_id TEXT,
  target_user_id TEXT,
  reason TEXT,
  timestamp INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_action_log_guild_action ON action_log(guild_id, action);
CREATE INDEX idx_action_log_moderator ON action_log(moderator_id);
CREATE INDEX idx_action_log_timestamp ON action_log(timestamp);
```

**Action Types:**

- `app_submitted` — User submitted application (no moderator_id)
- `claim` — Moderator claimed application
- `approve` — Moderator approved application
- `reject` — Moderator rejected application (reason required)
- `kick` — Moderator rejected + kicked (reason required)

**Response Time Calculation:**

```sql
SELECT
  (approve.timestamp - submit.timestamp) AS response_time_ms
FROM action_log submit
JOIN action_log approve
  ON submit.target_user_id = approve.target_user_id
  AND approve.action = 'approve'
WHERE submit.action = 'app_submitted';
```

---

## Changelog

**Since last revision:**

- Added Join→Submit ratio section with formula, tracked windows, and interpretation guidelines
- Documented gate message and welcome message customization via admin panel
- Added template variable support for welcome messages
- Clarified soft rejection (rejected) vs. hard rejection (perm_rejected/kicked)
- Added reapplication flow for previously rejected users
- Documented avatar risk scoring thresholds and display
- Added database schema section with status transitions
- Included response time calculation SQL example
- Expanded DM content examples for approve/reject/kick outcomes
