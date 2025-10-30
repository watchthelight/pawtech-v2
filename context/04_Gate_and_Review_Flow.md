---
title: "Gate and Review Flow"
slug: "04_Gate_and_Review_Flow"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Platform"
audience: "Moderators • Engineers"
source_of_truth: ["code", "src/features/gate.ts", "src/features/review.ts"]
related:
  - "03_Slash_Commands_and_UX"
  - "05_Modmail_System"
  - "07_Database_Schema_and_Migrations"
summary: "Complete technical specification of the application submission and review workflow, including gate channel setup, draft persistence, avatar scanning, claim system, and decision execution. Essential for understanding the core verification flow."
---

## Purpose & Outcomes

- **Gate channel setup**: Understand how to create and configure the entry point for new members
- **Application workflow**: Trace the complete lifecycle from button click to approval/rejection
- **Draft system**: Learn how partial submissions are saved and recovered
- **Avatar scanning**: Understand ONNX + Google Vision API integration for risk analysis
- **Review card design**: Master the embed structure and button interactions
- **Claim mechanism**: Prevent review collisions with exclusive locks
- **Decision execution**: Understand approval, rejection, kick, and permanent ban flows
- **Audit trail**: Track every action for accountability and debugging

## Scope & Boundaries

### In Scope
- Gate channel message creation and button interactions
- Multi-page modal flow with question pagination
- Draft creation, persistence, and recovery
- Application submission and validation
- Avatar scanning (ONNX local + Google Vision API remote)
- Review card posting and embed formatting
- Claim system and reviewer assignment
- Approve/Reject/Kick/Permanent Reject decision flows
- Role assignment and DM notifications
- Action logging for audit trail

### Out of Scope
- Guild configuration commands (see [03_Slash_Commands_and_UX](./03_Slash_Commands_and_UX.md))
- Modmail system (see [05_Modmail_System](./05_Modmail_System.md))
- Database schema design (see [07_Database_Schema_and_Migrations](./07_Database_Schema_and_Migrations.md))

## Current State

### File Structure

| File | Purpose | Lines |
|------|---------|-------|
| [src/features/gate.ts](../src/features/gate.ts) | Gate channel management, application submission | ~800 |
| [src/features/review.ts](../src/features/review.ts) | Review card display, claim system, decisions | ~3100 |
| [src/features/avatarScan.ts](../src/features/avatarScan.ts) | ONNX + Google Vision API integration | ~350 |
| [src/ui/reviewCard.ts](../src/ui/reviewCard.ts) | Embed builder and button generation | ~550 |
| [src/db/operations.ts](../src/db/operations.ts) | Database CRUD for applications and drafts | ~600 |

### Database Tables Involved

```sql
-- Applications (primary table)
CREATE TABLE applications (
  id TEXT PRIMARY KEY, -- ULID
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL, -- pending|submitted|approved|rejected|kicked
  created_at_s INTEGER NOT NULL,
  submitted_at_s INTEGER,
  updated_at_s INTEGER,
  resolved_at_s INTEGER,
  resolver_id TEXT,
  resolution_reason TEXT
);

-- Q&A answers
CREATE TABLE application_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  q_index INTEGER NOT NULL,
  answer TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id)
);

-- Draft persistence
CREATE TABLE application_drafts (
  id TEXT PRIMARY KEY, -- ULID
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at_s INTEGER NOT NULL,
  last_saved_at_s INTEGER NOT NULL,
  current_page INTEGER DEFAULT 0,
  data_json TEXT -- JSON array of answers
);

-- Avatar scans
CREATE TABLE avatar_scan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  avatar_url TEXT,
  final_pct REAL DEFAULT 0,
  reason TEXT,
  evidence_json TEXT, -- Hard/soft/safe tags
  created_at_s INTEGER NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id)
);

-- Review claims
CREATE TABLE review_claims (
  application_id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  claimed_at_s INTEGER NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id)
);

-- Review actions (audit log)
CREATE TABLE review_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  action TEXT NOT NULL, -- claimed|approved|rejected|kicked|modmail_opened
  reason TEXT,
  created_at_s INTEGER NOT NULL
);

-- Permanent bans
CREATE TABLE perm_rejected_users (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  rejected_by TEXT NOT NULL,
  rejected_at_s INTEGER NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (user_id, guild_id)
);
```

## Key Flows

### 1. Gate Channel Setup and Message Creation

**Initial Setup**:
```
/config set gate_channel #verify
    ↓
Bot checks:
  - Channel exists
  - Bot has SendMessages permission
  - Bot has ManageMessages permission (for updating)
    ↓
Save channel ID to config table
    ↓
Post or update gate message
```

**Gate Message Format**:
```
╔══════════════════════════════════════╗
║     Welcome to Pawtropolis Tech      ║
╚══════════════════════════════════════╝

To join our community, please submit an application by clicking the button below.

Your responses will be reviewed by our moderation team, and you'll receive a decision within 24-48 hours.

[Image: Banner from assets/banner.webp]

[Button: 🎟️ Apply for Membership]
```

**Code Path**: [src/features/gate.ts:ensureGateEntry](../src/features/gate.ts) L50-150

```typescript
export async function ensureGateEntry(
  ctx: CommandContext,
  guildId: string
): Promise<{ action: 'created' | 'updated' | 'reused', messageId: string | null }> {
  const cfg = getConfig(guildId);
  const gateChannelId = cfg.gate_channel_id;

  if (!gateChannelId) {
    throw new Error('Gate channel not configured');
  }

  const channel = await guild.channels.fetch(gateChannelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Gate channel not found or not text-based');
  }

  // Check for existing gate message in database
  const existingMessageId = db.prepare(`
    SELECT gate_message_id FROM config WHERE guild_id = ?
  `).get(guildId)?.gate_message_id;

  if (existingMessageId) {
    try {
      const message = await channel.messages.fetch(existingMessageId);
      // Update existing message
      await message.edit({
        content: buildGateMessageContent(),
        embeds: [buildGateEmbed()],
        components: [buildGateButtons()]
      });
      return { action: 'updated', messageId: existingMessageId };
    } catch {
      // Message deleted, create new one
    }
  }

  // Create new message
  const message = await channel.send({
    content: buildGateMessageContent(),
    embeds: [buildGateEmbed()],
    components: [buildGateButtons()]
  });

  // Save message ID to database
  db.prepare(`
    UPDATE config SET gate_message_id = ? WHERE guild_id = ?
  `).run(message.id, guildId);

  return { action: 'created', messageId: message.id };
}
```

### 2. Application Submission Flow (Multi-Page Modals)

**Trigger**: User clicks "Apply" button in gate channel

**Sequence**:
```
1. Button Click: v1:gate-apply:{guildId}
    ↓
2. Validate User State:
   - Has unverified role? ✓
   - Not already in review channel? ✓
   - No active application? ✓
   - Not permanently banned? ✓
    ↓
3. Load Questions:
   - Query gate_questions table
   - Order by q_index ASC
   - Check minimum questions exist (at least 1)
    ↓
4. Check for Draft:
   - Query application_drafts by user_id + guild_id
   - If exists, load saved answers
   - Determine current page
    ↓
5. Build Modal (Page 1):
   - Questions 0-4 (Discord limit: 5 per modal)
   - Pre-fill from draft if exists
   - Custom ID: v1:gate-submit:page1:draft{ULID}
    ↓
6. User Fills Modal → Submit
    ↓
7. Save Draft:
   - Upsert to application_drafts
   - Save answers as JSON array
   - Update last_saved_at_s timestamp
    ↓
8. Check Pagination:
   - More questions? Show next page modal
   - All done? Proceed to final submission
    ↓
9. Final Submission:
   - Create application record (status: submitted)
   - Insert answers to application_answers table
   - Delete draft
   - Trigger avatar scan (async)
   - Post review card to review channel
   - Send DM confirmation to user
```

**Code Path**: [src/features/gate.ts](../src/features/gate.ts)
- Button handler: `handleGateApplyButton` L150-280
- Modal handler: `handleGateSubmitModal` L350-650
- Draft operations: `saveDraftAnswers` L700-750

**Draft Persistence Pattern**:
```typescript
// Save after each page completion
const draft = {
  id: draftId || ulid(),
  guild_id: guildId,
  user_id: userId,
  created_at_s: nowSec,
  last_saved_at_s: nowSec,
  current_page: pageNumber,
  data_json: JSON.stringify(answersArray)
};

db.prepare(`
  INSERT INTO application_drafts (id, guild_id, user_id, created_at_s, last_saved_at_s, current_page, data_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    last_saved_at_s = excluded.last_saved_at_s,
    current_page = excluded.current_page,
    data_json = excluded.data_json
`).run(draft.id, draft.guild_id, draft.user_id, draft.created_at_s, draft.last_saved_at_s, draft.current_page, draft.data_json);
```

**Multi-Page Modal Logic**:
```typescript
const QUESTIONS_PER_PAGE = 5;
const totalPages = Math.ceil(questions.length / QUESTIONS_PER_PAGE);
const currentPage = parseInt(match[1]); // from custom ID

if (currentPage < totalPages) {
  // Show next page
  const nextPageQuestions = questions.slice(
    currentPage * QUESTIONS_PER_PAGE,
    (currentPage + 1) * QUESTIONS_PER_PAGE
  );

  const nextModal = buildGateModal(nextPageQuestions, currentPage + 1, draftId);
  await interaction.showModal(nextModal);
} else {
  // Final page - submit application
  await submitApplication(interaction, allAnswers);
}
```

### 3. Avatar Scanning Flow (Async)

**Trigger**: Application submitted → Avatar scan starts automatically

**Sequence**:
```
1. Get User Avatar URL:
   - Prefer guild avatar (member.displayAvatarURL())
   - Fallback to user avatar
   - Fallback to default Discord avatar
    ↓
2. Check Cache:
   - Query avatar_scan table by application_id
   - If recent scan exists (< 1 hour), reuse result
    ↓
3. Download Image:
   - Fetch avatar URL
   - Convert to buffer
   - Validate size (< 10MB)
    ↓
4. ONNX Local Scan:
   - Load model from models/nsfw-model.onnx
   - Preprocess image (resize to 224x224, normalize)
   - Run inference
   - Get scores: neutral, drawings, hentai, porn, sexy
    ↓
5. Google Vision API (if GOOGLE_APPLICATION_CREDENTIALS set):
   - Send image to Cloud Vision API
   - SafeSearch detection
   - Get likelihood: adult, violence, medical
    ↓
6. Combine Scores:
   - ONNX weight: 60%
   - Google Vision weight: 40%
   - Calculate final risk percentage
    ↓
7. Classify Content:
   - Furry/scalie heuristics (tag-based)
   - Edge detection for skin tone boundaries
   - Flag suspicious patterns
    ↓
8. Save Results:
   - Insert to avatar_scan table
   - Store evidence JSON (hard/soft/safe tags)
   - Log scan completion
    ↓
9. Update Review Card (if already posted):
   - Edit embed with avatar risk percentage
   - Add "Reverse Search" link (Google Lens)
```

**Code Path**: [src/features/avatarScan.ts](../src/features/avatarScan.ts)
- Main function: `scanApplicationAvatar` L50-250
- ONNX inference: `runONNXModel` L280-320
- Google Vision: `callGoogleVisionAPI` L150-200

**Risk Calculation Formula**:
```typescript
// ONNX scores (0-1 range)
const onnxScore = Math.max(
  scores.hentai * 1.0,
  scores.porn * 1.0,
  scores.sexy * 0.5,
  scores.drawings * 0.3
);

// Google Vision scores (likelihood: UNKNOWN, VERY_UNLIKELY, UNLIKELY, POSSIBLE, LIKELY, VERY_LIKELY)
const visionScore = convertLikelihoodToScore(safeSearch.adult);

// Combined score
const finalScore = (onnxScore * 0.6) + (visionScore * 0.4);
const finalPct = Math.round(finalScore * 100);

// Evidence classification
const evidence = {
  hard: tags.filter(t => hardTags.includes(t.tag)), // 100% NSFW
  soft: tags.filter(t => softTags.includes(t.tag)), // Suggestive
  safe: tags.filter(t => !hardTags.includes(t.tag) && !softTags.includes(t.tag))
};
```

### 4. Review Card Creation and Posting

**Trigger**: Application submitted successfully

**Sequence**:
```
1. Build Review Embed:
   - Title: "New Application • {username} • App #{code}"
   - Color: Slate (pending), Green (approved), Red (rejected)
   - Thumbnail: User avatar
   - Sections: Application Info, Q&A, Status, History
    ↓
2. Application Info Section:
   - Submitted: Full timestamp + relative
   - Claimed by: Unclaimed (or moderator name)
   - Account created: Full timestamp + relative
    ↓
3. Q&A Section:
   - Each question as field name
   - Answer in code block (markdown \`\`\`text)
   - No truncation (full answers shown)
    ↓
4. Status Section:
   - Modmail: None/Open/Closed
   - Member status: In server / Left server
   - Avatar risk: X% • [Reverse Search link]
    ↓
5. History Section (last 3 actions):
   - Action: claimed/approved/rejected/modmail_opened
   - Moderator: @mention
   - Timestamp: Full date + time (user's timezone)
    ↓
6. Action Buttons (if not terminal status):
   Row 1: [Claim Application]

   Row 1 (after claim): [Accept] [Reject] [Permanently Reject] [Kick]
   Row 2 (after claim): [Modmail] [Copy UID] [Ping in Unverified]
    ↓
7. Post to Review Channel:
   - Get review_channel_id from config
   - Send embed + components
   - Save message_id to applications table
    ↓
8. Log Action:
   - Insert to review_action table
   - Action: "submitted"
   - Moderator: Application author (self)
   - Timestamp: Current time
```

**Code Path**: [src/ui/reviewCard.ts:buildReviewEmbed](../src/ui/reviewCard.ts) L237-450

**Embed Structure**:
```typescript
const embed = new EmbedBuilder()
  .setTitle(`New Application • ${username} • App #${code}`)
  .setColor(getStatusColor(app.status))
  .setThumbnail(avatarUrl);

// Decision section (only for rejected)
if (app.status === 'rejected' && app.resolution_reason) {
  embed.setDescription(
    `**Decision:** Rejected\n\n**Reason:**\n\`\`\`text\n${reason}\n\`\`\``
  );
}

// Application info
embed.addFields({
  name: '──────────── Application ────────────',
  value: [
    `**Submitted:** <t:${submittedEpoch}:F> (<t:${submittedEpoch}:R>)`,
    `**Claimed by:** ${claim ? `<@${claim.reviewer_id}>` : 'Unclaimed'}`,
    `**Account created:** <t:${accountEpoch}:F> (<t:${accountEpoch}:R>)`
  ].join('\n'),
  inline: false
});

// Q&A separator
embed.addFields({
  name: '────────────── Q&A ──────────────',
  value: '\u200b',
  inline: false
});

// Questions and answers
for (const qa of answers) {
  embed.addFields({
    name: `Q${qa.q_index + 1}: ${qa.question}`,
    value: `\`\`\`text\n${qa.answer}\n\`\`\``,
    inline: false
  });
}

// Status section
embed.addFields({
  name: '─────────────── Status ───────────────',
  value: [
    `**Modmail:** ${modmailStatus}`,
    `**Member status:** ${member ? 'In server' : 'Left server'}`,
    `**Avatar risk:** ${avatarScan.finalPct}% • [Reverse Search](${reverseUrl})`
  ].join('\n'),
  inline: false
});

// History section
if (recentActions.length > 0) {
  embed.addFields({
    name: '───────────── History (Last 3) ─────────────',
    value: recentActions.slice(0, 3).map(action =>
      `• **${action.action}** by <@${action.moderator_id}>\n  <t:${action.created_at}:F>`
    ).join('\n\n'),
    inline: false
  });
}
```

### 5. Claim System Flow

**Purpose**: Prevent multiple moderators from reviewing the same application simultaneously

**Sequence**:
```
1. Moderator clicks "Claim Application"
    ↓
2. Check Application State:
   - Status still pending/submitted? ✓
   - Not already claimed by someone else? ✓
    ↓
3. Insert Claim Record:
   INSERT INTO review_claims (application_id, reviewer_id, claimed_at_s)
   VALUES (?, ?, ?)
   ON CONFLICT (application_id) DO NOTHING
    ↓
4. Verify Claim Success:
   - Query review_claims by application_id
   - Check reviewer_id matches current user
   - If mismatch, another mod claimed first (race condition)
    ↓
5. Update Review Card:
   - Edit embed: "Claimed by: @Moderator"
   - Replace button: [Claim] → [Accept] [Reject] [Kick] [Modmail]
   - Add timestamp: "Claimed at: <t:epoch:R>"
    ↓
6. Log Claim Action:
   - Insert to review_action table
   - Action: "claimed"
   - Moderator: Current user
    ↓
7. Reply to Interaction:
   - Ephemeral message: "✅ Application claimed. You can now review."
```

**Code Path**: [src/features/review.ts:handleClaimButton](../src/features/review.ts) L500-650

**Race Condition Handling**:
```typescript
// Atomic claim using database constraint
db.prepare(`
  INSERT INTO review_claims (application_id, reviewer_id, claimed_at_s)
  VALUES (?, ?, ?)
`).run(applicationId, userId, nowSec);

// Verify claim succeeded
const claim = db.prepare(`
  SELECT reviewer_id FROM review_claims WHERE application_id = ?
`).get(applicationId);

if (claim.reviewer_id !== userId) {
  await interaction.reply({
    content: '❌ Another moderator claimed this application first.',
    flags: MessageFlags.Ephemeral
  });
  return;
}

// Success - proceed with review
```

### 6. Approval Flow

**Trigger**: Moderator clicks "Accept" button on claimed application

**Sequence**:
```
1. Validate State:
   - Application still pending/submitted? ✓
   - Claimed by current user? ✓
   - User still has unverified role? ✓
   - User still in server? ✓
    ↓
2. Fetch Member Object:
   - guild.members.fetch(userId)
   - If not found → User left server (fail gracefully)
    ↓
3. Assign Verified Role:
   - Get verified_role_id from config
   - member.roles.add(verifiedRoleId)
   - Log: "Added verified role"
    ↓
4. Remove Unverified Role:
   - Get unverified_role_id from config
   - member.roles.remove(unverifiedRoleId)
   - Log: "Removed unverified role"
    ↓
5. Send Welcome DM:
   - Get general_channel_id from config
   - Format message: "Welcome to {guild}! Check out #{channel}."
   - Try DM, fail silently if blocked
    ↓
6. Update Database:
   - UPDATE applications SET
       status = 'approved',
       resolved_at_s = ?,
       resolver_id = ?
     WHERE id = ?
    ↓
7. Log Action:
   - INSERT INTO review_action (action: "approved")
   - INSERT INTO action_log (action: "member_approved")
    ↓
8. Delete Review Card:
   - message.delete()
   - Keeps channel clean
    ↓
9. Delete Claim Record:
   - DELETE FROM review_claims WHERE application_id = ?
    ↓
10. Send Welcome Message (General Channel):
    - Post: "Welcome <@userId> to the community!"
    - Include banner image if configured
    ↓
11. Reply to Moderator:
    - Ephemeral: "✅ Application approved. Welcome message sent."
```

**Code Path**: [src/features/review.ts:handleApproveButton](../src/features/review.ts) L800-950

**Error Handling**:
```typescript
try {
  // Assign role
  await member.roles.add(verifiedRoleId);
} catch (err) {
  logger.error({ err, userId, roleId: verifiedRoleId }, 'Failed to assign role');

  // Rollback if needed
  await interaction.reply({
    content: '❌ Failed to assign role. Check bot permissions.',
    flags: MessageFlags.Ephemeral
  });
  return;
}

// Continue with DM (non-blocking)
try {
  await user.send({
    content: `Welcome to **${guild.name}**! Check out <#${generalChannelId}>.`
  });
} catch {
  // DMs blocked - not critical, continue
  logger.info({ userId }, 'Could not DM user (blocked or privacy settings)');
}
```

### 7. Rejection Flow

**Trigger**: Moderator clicks "Reject" button on claimed application

**Sequence**:
```
1. Show Rejection Modal:
   - Custom ID: v1:reject:code{appCode}
   - Title: "Reject Application"
   - Input: Reason (10-1000 chars, required)
    ↓
2. Moderator Submits Reason
    ↓
3. Validate State:
   - Application still pending/submitted? ✓
   - Claimed by current user? ✓
    ↓
4. Send DM to Applicant:
   - Format: "Your application to {guild} was rejected.\n\n**Reason:**\n{reason}"
   - Try DM, log if blocked
    ↓
5. Update Database:
   - UPDATE applications SET
       status = 'rejected',
       resolved_at_s = ?,
       resolver_id = ?,
       resolution_reason = ?
     WHERE id = ?
    ↓
6. Log Action:
   - INSERT INTO review_action (action: "rejected", reason: reason)
   - INSERT INTO action_log (action: "application_rejected")
    ↓
7. Update Review Card (Don't Delete):
   - Edit embed color: Red
   - Add Decision section at top:
     **Decision:** Rejected
     **Reason:** {reason in code block}
   - Remove action buttons
   - Update timestamp
    ↓
8. Close Modmail (if open):
   - Archive modmail thread
   - Send transcript to log channel
    ↓
9. Delete Claim Record:
   - DELETE FROM review_claims WHERE application_id = ?
    ↓
10. Reply to Moderator:
    - Ephemeral: "✅ Application rejected. User notified via DM."
```

**Code Path**: [src/features/review.ts](../src/features/review.ts)
- Button handler: `handleRejectButton` L1100-1150
- Modal handler: `handleRejectModal` L1200-1400

**Rejection Reason Display**:
```typescript
// Short reasons: Show inline
if (reason.length <= 3800) {
  embed.setDescription(
    `**Decision:** Rejected\n\n**Reason:**\n\`\`\`text\n${reason}\n\`\`\``
  );
} else {
  // Long reasons: Attach as file
  const attachment = new AttachmentBuilder(
    Buffer.from(reason, 'utf-8'),
    { name: 'rejection-reason.txt' }
  );

  embed.setDescription(
    `**Decision:** Rejected\n\n**Reason:** Attached as rejection-reason.txt (too long to display)`
  );

  await message.edit({ embeds: [embed], files: [attachment], components: [] });
}
```

### 8. Permanent Rejection Flow

**Trigger**: Moderator clicks "Permanently Reject" button on claimed application

**Sequence**:
```
1. Show Permanent Rejection Modal:
   - Custom ID: v1:permreject:code{appCode}
   - Title: "Permanent Rejection - WARNING"
   - Description: "This user will be BANNED from reapplying. This action is logged."
   - Input: Reason (20-1000 chars, required)
    ↓
2. Moderator Confirms with Reason
    ↓
3. Validate State:
   - Application still pending/submitted? ✓
   - Claimed by current user? ✓
    ↓
4. Insert Permanent Ban Record:
   - INSERT INTO perm_rejected_users
     (user_id, guild_id, rejected_by, rejected_at_s, reason)
     VALUES (?, ?, ?, ?, ?)
    ↓
5. Send DM to Applicant:
   - Format: "Your application to {guild} was permanently rejected.\n\n**Reason:**\n{reason}\n\n**Note:** You will not be able to reapply."
    ↓
6. Update Database:
   - UPDATE applications SET
       status = 'rejected',
       resolved_at_s = ?,
       resolver_id = ?,
       resolution_reason = ?
     WHERE id = ?
    ↓
7. Log Action:
   - INSERT INTO review_action (action: "permanently_rejected", reason: reason)
   - INSERT INTO action_log (action: "permanent_ban")
    ↓
8. Update Review Card:
   - Edit embed color: Red
   - Add Decision section:
     **Decision:** PERMANENTLY REJECTED
     **Reason:** {reason in code block}
   - Add warning: "⚠️ User banned from reapplying"
   - Remove action buttons
    ↓
9. Close Modmail (if open)
    ↓
10. Delete Claim Record
    ↓
11. Reply to Moderator:
    - Ephemeral: "✅ Application permanently rejected. User banned from reapplying."
```

**Code Path**: [src/features/review.ts](../src/features/review.ts)
- Button handler: `handlePermRejectButton` L1450-1500
- Modal handler: `handlePermRejectModal` L1550-1700

**Permanent Ban Check** (on future applications):
```typescript
// Check before allowing application submission
const permanentBan = db.prepare(`
  SELECT * FROM perm_rejected_users
  WHERE user_id = ? AND guild_id = ?
`).get(userId, guildId);

if (permanentBan) {
  await interaction.reply({
    content: `❌ You have been permanently banned from applying to this server.\n\n**Reason:** ${permanentBan.reason}`,
    flags: MessageFlags.Ephemeral
  });
  return;
}
```

### 9. Kick Flow

**Trigger**: Moderator clicks "Kick" button on claimed application

**Sequence**:
```
1. Validate State:
   - Application still pending/submitted? ✓
   - Claimed by current user? ✓
    ↓
2. Fetch Member:
   - guild.members.fetch(userId)
   - If not found → Already left
    ↓
3. Send DM (before kick):
   - Format: "You have been kicked from {guild} for incomplete/invalid application."
   - Try DM, log if blocked
    ↓
4. Kick Member:
   - member.kick('Application rejected - incomplete/invalid')
   - Requires bot has Kick Members permission
    ↓
5. Update Database:
   - UPDATE applications SET
       status = 'kicked',
       resolved_at_s = ?,
       resolver_id = ?
     WHERE id = ?
    ↓
6. Log Action:
   - INSERT INTO review_action (action: "kicked")
   - INSERT INTO action_log (action: "member_kicked")
    ↓
7. Update Review Card:
   - Edit embed color: Red
   - Add Decision: "Kicked from server"
   - Remove action buttons
    ↓
8. Delete Claim Record
    ↓
9. Reply to Moderator:
   - Ephemeral: "✅ User kicked from server. Application marked as kicked."
```

**Code Path**: [src/features/review.ts:handleKickButton](../src/features/review.ts) L1750-1850

## Commands & Snippets

### Testing Gate Flow Locally

```bash
# 1. Start dev server
npm run dev

# 2. In Discord:
# - Set gate channel: /config set gate_channel #verify
# - Set review channel: /config set review_channel #review
# - Set roles: /config set unverified_role @Unverified verified_role @Verified

# 3. Test application:
# - Click "Apply" button in gate channel
# - Fill out modal pages
# - Check review channel for review card

# 4. Test claim:
# - Click "Claim Application" (as moderator)
# - Verify buttons change

# 5. Test decisions:
# - Click "Accept" → Check role assignment
# - Click "Reject" → Check DM and embed update
```

### Manual Database Operations

```sql
-- Check application status
SELECT id, user_id, status, created_at_s, submitted_at_s
FROM applications
WHERE guild_id = '{guildId}'
ORDER BY created_at_s DESC
LIMIT 10;

-- View application answers
SELECT a.id, a.status, aa.q_index, aa.answer
FROM applications a
JOIN application_answers aa ON a.id = aa.application_id
WHERE a.id = '{applicationId}'
ORDER BY aa.q_index;

-- Check active drafts
SELECT id, user_id, current_page, last_saved_at_s
FROM application_drafts
WHERE guild_id = '{guildId}'
ORDER BY last_saved_at_s DESC;

-- View avatar scan results
SELECT a.id, a.user_id, avs.final_pct, avs.reason, avs.evidence_json
FROM applications a
LEFT JOIN avatar_scan avs ON a.id = avs.application_id
WHERE a.guild_id = '{guildId}'
ORDER BY a.created_at_s DESC;

-- Check permanent bans
SELECT user_id, rejected_by, rejected_at_s, reason
FROM perm_rejected_users
WHERE guild_id = '{guildId}';

-- Audit review actions
SELECT ra.created_at_s, ra.action, ra.moderator_id, a.user_id as applicant_id
FROM review_action ra
JOIN applications a ON ra.application_id = a.id
WHERE ra.guild_id = '{guildId}'
ORDER BY ra.created_at_s DESC
LIMIT 20;
```

### Generating Sample Review Card

```bash
# Test embed formatting
/sample reviewcard status:pending

# Test with rejected status
/sample reviewcard status:rejected

# Test with long answers
/sample reviewcard status:pending --long

# Test with custom user
/sample reviewcard status:pending applicant:@User
```

## Interfaces & Data

### Application State Machine

```
     [User Clicks Apply]
              ↓
         pending (draft)
              ↓
     [User Submits Final Page]
              ↓
          submitted
              ↓
         ┌────┴────┐
         ↓         ↓
     approved   rejected/kicked
                   ↓
              (terminal)
```

**Valid State Transitions**:
- `pending` → `submitted` (user completes application)
- `submitted` → `approved` (moderator accepts)
- `submitted` → `rejected` (moderator rejects)
- `submitted` → `kicked` (moderator kicks)

**Invalid Transitions** (prevented by code):
- `approved` → `rejected` (final states are immutable)
- `rejected` → `approved` (cannot un-reject)

### Event Payloads

**Application Submitted Event**:
```typescript
{
  type: 'application_submitted',
  application_id: 'ULID',
  guild_id: '123456789',
  user_id: '987654321',
  submitted_at: 1698765432,
  question_count: 5,
  answer_lengths: [150, 200, 175, 180, 160]
}
```

**Review Action Event**:
```typescript
{
  type: 'review_action',
  action: 'approved' | 'rejected' | 'kicked' | 'claimed',
  application_id: 'ULID',
  guild_id: '123456789',
  user_id: '987654321',
  moderator_id: '111222333',
  reason?: string,
  timestamp: 1698765432
}
```

### Avatar Scan Result Format

```typescript
{
  final_pct: 0-100, // Combined risk score
  furry_score: 0.0-1.0,
  scalie_score: 0.0-1.0,
  reason: 'none' | 'suspicious' | 'flagged',
  evidence: {
    hard: [{ tag: 'explicit_content', p: 0.95 }],
    soft: [{ tag: 'suggestive', p: 0.60 }],
    safe: [{ tag: 'sfw', p: 0.10 }]
  }
}
```

## Ops & Recovery

### Stuck Draft Recovery

**Symptoms**: User can't submit, says "draft already exists"

**Resolution**:
```sql
-- Find draft
SELECT * FROM application_drafts
WHERE user_id = '{userId}' AND guild_id = '{guildId}';

-- Delete stuck draft
DELETE FROM application_drafts
WHERE user_id = '{userId}' AND guild_id = '{guildId}';

-- User can now retry
```

### Orphaned Review Cards

**Symptoms**: Review card in channel but no database record

**Resolution**:
```sql
-- Find applications with no review card
SELECT id, user_id, status, submitted_at_s
FROM applications
WHERE guild_id = '{guildId}'
  AND status = 'submitted'
  AND id NOT IN (
    SELECT application_id FROM review_claims
  )
ORDER BY submitted_at_s DESC;

-- Option 1: Manually post review card via /review command
-- Option 2: Mark as stale and notify user to reapply
UPDATE applications
SET status = 'rejected',
    resolution_reason = 'Technical issue - please reapply'
WHERE id = '{applicationId}';
```

### Avatar Scan Failures

**Symptoms**: Avatar scan never completes, risk shows 0%

**Diagnostics**:
```bash
# Check ONNX model exists
ls -l models/nsfw-model.onnx

# Check Google Vision API credentials
echo $GOOGLE_APPLICATION_CREDENTIALS
test -f "$GOOGLE_APPLICATION_CREDENTIALS"

# Check logs for scan errors
pm2 logs pawtropolis | grep avatarScan
```

**Resolution**:
```sql
-- Re-trigger avatar scan
DELETE FROM avatar_scan WHERE application_id = '{applicationId}';

-- Then edit/update the review card to trigger rescan
-- Or manually update scan results:
INSERT INTO avatar_scan (
  application_id, user_id, avatar_url, final_pct, reason, evidence_json, created_at_s
) VALUES (
  '{applicationId}', '{userId}', '{avatarUrl}', 0, 'manual_override', '{}', strftime('%s', 'now')
);
```

## Security & Privacy

### Application Data Retention

**Policy**:
- Approved applications: Kept indefinitely for audit trail
- Rejected applications: Kept for 90 days, then soft-deleted
- Drafts: Deleted after 30 days of inactivity
- Permanent bans: Never deleted (compliance requirement)

**Implementation**:
```sql
-- Cleanup old drafts (run monthly)
DELETE FROM application_drafts
WHERE last_saved_at_s < strftime('%s', 'now') - (30 * 86400);

-- Archive old rejections (run quarterly)
UPDATE applications
SET status = 'archived'
WHERE status = 'rejected'
  AND resolved_at_s < strftime('%s', 'now') - (90 * 86400);
```

### PII Protection

**Sensitive Fields**:
- `application_answers.answer` - May contain age, location, personal info
- `avatar_scan.avatar_url` - Contains Discord CDN URLs with user IDs
- `perm_rejected_users.reason` - May contain sensitive details

**Access Controls**:
- Only moderators with staff role can view applications
- Only bot owner can export database
- Review cards deleted after approval (no PII in channel history)
- DMs sent for decisions (private communication)

### Avatar Scanning Privacy

**Data Flow**:
1. Avatar URL fetched from Discord (public data)
2. Image sent to Google Vision API (optional, configurable)
3. Results stored in local database
4. Original image NOT stored (only URL reference)

**Opt-Out**: Users can disable Google Vision API scans by not setting `GOOGLE_APPLICATION_CREDENTIALS`

## FAQ / Gotchas

**Q: What happens if user leaves server during review?**
A: Review card shows "Left server" status. Moderators can still reject (no DM sent). Application stays in database for audit.

**Q: Can I edit application questions after submissions exist?**
A: Yes, but existing applications show old questions. Use versioning or migration script if needed.

**Q: Why do modals sometimes say "Interaction failed"?**
A: Discord has 15-minute modal timeout. If user takes too long, they must click "Apply" again.

**Q: How do I recover from a failed role assignment?**
A: Check bot role hierarchy. Bot's role must be ABOVE the verified role in server settings.

**Q: Can I customize the welcome message?**
A: Not via UI currently. Edit [src/features/review.ts:handleApproveButton](../src/features/review.ts) or add config option.

**Q: What if two moderators claim at the exact same time?**
A: Database constraint prevents double-claim. Second moderator gets "already claimed" error.

**Q: Why don't review cards update after avatar scan completes?**
A: Performance optimization. Scan happens async. Moderators refresh by editing review card.

**Q: How do I unban a permanently rejected user?**
A: Delete record from `perm_rejected_users` table. No UI option currently.

**Q: Can I approve application without assigning roles?**
A: No. Approval always assigns verified role. Use "Reject" if manual role assignment preferred.

**Q: What happens to application if review channel is deleted?**
A: Application stays in database but review card is lost. Recreate channel and manually post cards.

## Changelog

### 2025-10-30
- **Created**: Comprehensive gate and review flow documentation
- **Documented**: Complete lifecycle from application to decision
- **Added**: Multi-page modal flow with draft persistence
- **Detailed**: Avatar scanning with ONNX + Google Vision API
- **Explained**: Claim system race condition handling
- **Specified**: All decision flows (approve/reject/kick/permanent)
- **Included**: SQL queries, code paths, and recovery procedures
- **Verified**: All file references and code snippets against repository
- **Cross-linked**: Related docs for commands, modmail, and database
