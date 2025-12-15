# Gate and Review Flow

## Application Modal Lifecycle

### Step 1: Submission via `/gate`

**User Experience**:

1. User types `/gate` in any channel.
2. Bot displays modal popup with form fields.
3. User fills fields and clicks "Submit".
4. Bot validates input, inserts into DB, posts review card.

**Field Configuration**:

| Field        | Type      | Validation         | Required | Notes                    |
| ------------ | --------- | ------------------ | -------- | ------------------------ |
| Display Name | Short     | Length 2–32 chars  | Yes      | Displayed in review card |
| Age          | Short     | Integer >= 18      | Yes      | Gatekeeping question     |
| Reason       | Paragraph | Length >= 50 chars | Yes      | Why join community       |
| Referral     | Short     | Any string         | No       | How did you find us?     |

**Validation Logic**:

```typescript
async function validateApplication(fields: ModalFields): Promise<string | null> {
  const age = parseInt(fields.age);
  const reason = fields.reason.trim();

  if (isNaN(age) || age < 18) {
    return "You must be 18 or older to join.";
  }

  if (reason.length < 50) {
    return `Reason too short (${reason.length}/50 characters minimum).`;
  }

  // Check for duplicate submission
  const existing = db.prepare("SELECT id FROM review_action WHERE user_id = ?").get(fields.userId);
  if (existing) {
    return "You already have a pending application.";
  }

  return null; // Valid
}
```

### Step 2: Database Insert

```typescript
const appId = db
  .prepare(
    `
  INSERT INTO review_action (
    user_id, display_name, age, reason, referral,
    status, submitted_at
  ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
`
  )
  .run(
    interaction.user.id,
    fields.displayName,
    age,
    fields.reason,
    fields.referral || null,
    new Date().toISOString()
  ).lastInsertRowid;

// [Known Issue] History not visible until first action (claim)
// Recommendation: Insert initial action_log row
db.prepare(
  `
  INSERT INTO action_log (app_id, moderator_id, action, timestamp)
  VALUES (?, '0', 'submit', ?)
`
).run(appId, new Date().toISOString());
```

### Step 3: Review Card Rendering

```typescript
async function postReviewCard(appId: number) {
  const app = db.prepare("SELECT * FROM review_action WHERE id = ?").get(appId);
  const user = await client.users.fetch(app.user_id);

  const embed = new EmbedBuilder()
    .setTitle(`Application #${appId}`)
    .setColor(0x3498db) // Blue for pending
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: "User", value: `<@${app.user_id}>`, inline: true },
      { name: "Display Name", value: app.display_name, inline: true },
      { name: "Age", value: app.age.toString(), inline: true },
      { name: "Reason", value: app.reason.substring(0, 1024) }, // Max 1024 chars
      { name: "Referral", value: app.referral || "*None*", inline: true },
      {
        name: "Submitted",
        value: `<t:${Math.floor(new Date(app.submitted_at).getTime() / 1000)}:R>`,
        inline: true,
      }
    )
    .setFooter({ text: `App ID: ${appId}` })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_${appId}`)
      .setLabel("Claim")
      .setStyle(ButtonStyle.Primary)
  );

  const config = db
    .prepare("SELECT review_channel_id FROM configs WHERE guild_id = ?")
    .get(interaction.guildId);
  const channel = client.channels.cache.get(config.review_channel_id) as TextChannel;

  const message = await channel.send({ embeds: [embed], components: [row] });

  // Store message ID for later updates
  db.prepare("UPDATE review_action SET review_message_id = ? WHERE id = ?").run(message.id, appId);
}
```

## Claiming Workflow

### Atomic Claim Logic

**Goal**: Prevent race conditions where two moderators claim the same application.

```typescript
async function claimApplication(appId: number, moderatorId: string): Promise<void> {
  try {
    db.transaction(() => {
      const app = db.prepare("SELECT claimed_by FROM review_action WHERE id = ?").get(appId);

      if (app.claimed_by !== null) {
        throw new Error("ALREADY_CLAIMED");
      }

      db.prepare(
        `
        UPDATE review_action
        SET claimed_by = ?, claimed_at = ?
        WHERE id = ? AND claimed_by IS NULL
      `
      ).run(moderatorId, new Date().toISOString(), appId);

      db.prepare(
        `
        INSERT INTO action_log (app_id, moderator_id, action, timestamp)
        VALUES (?, ?, 'claim', ?)
      `
      ).run(appId, moderatorId, new Date().toISOString());
    })();

    // [Known Issue] Pretty card sometimes not posted
    await logAction("claim", appId, moderatorId);

    // Update review card
    await updateReviewCardStatus(appId, "claimed");
  } catch (error) {
    if (error.message === "ALREADY_CLAIMED") {
      throw new Error("This application is already claimed by another moderator.");
    }
    throw error;
  }
}
```

### Unclaim Operation

```typescript
async function unclaimApplication(appId: number, moderatorId: string): Promise<void> {
  const app = db.prepare("SELECT claimed_by FROM review_action WHERE id = ?").get(appId);

  if (app.claimed_by !== moderatorId) {
    throw new Error("You can only unclaim applications you claimed.");
  }

  db.prepare(
    `
    UPDATE review_action
    SET claimed_by = NULL, claimed_at = NULL
    WHERE id = ?
  `
  ).run(appId);

  db.prepare(
    `
    INSERT INTO action_log (app_id, moderator_id, action, timestamp)
    VALUES (?, ?, 'unclaim', ?)
  `
  ).run(appId, moderatorId, new Date().toISOString());

  await logAction("unclaim", appId, moderatorId);
  await updateReviewCardStatus(appId, "pending");
}
```

## Approve and Reject Workflows

### Accept Application (`/accept`)

```typescript
async function acceptApplication(
  appId: number,
  moderatorId: string,
  reason?: string
): Promise<void> {
  const app = db.prepare("SELECT * FROM review_action WHERE id = ?").get(appId);

  // Validate claim ownership
  if (app.claimed_by !== moderatorId) {
    throw new Error("You must claim this application before accepting it.");
  }

  // Update status
  db.prepare(
    `
    UPDATE review_action
    SET status = 'accepted', decided_at = ?
    WHERE id = ?
  `
  ).run(new Date().toISOString(), appId);

  // Insert action log with free-text reason
  db.prepare(
    `
    INSERT INTO action_log (app_id, moderator_id, action, reason, timestamp)
    VALUES (?, ?, 'accept', ?, ?)
  `
  ).run(appId, moderatorId, reason || null, new Date().toISOString());

  // Send DM to applicant
  await sendApprovalDM(app.user_id, reason);

  // Grant member role (if configured)
  await grantMemberRole(app.user_id);

  // [Known Issue] Pretty card sometimes not emitted
  await logAction("accept", appId, moderatorId, reason);

  // Update review card to "Accepted"
  await updateReviewCardStatus(appId, "accepted");
}
```

### Reject Application (`/reject`)

```typescript
async function rejectApplication(
  appId: number,
  moderatorId: string,
  reason?: string
): Promise<void> {
  const app = db.prepare("SELECT * FROM review_action WHERE id = ?").get(appId);

  if (app.claimed_by !== moderatorId) {
    throw new Error("You must claim this application before rejecting it.");
  }

  db.prepare(
    `
    UPDATE review_action
    SET status = 'rejected', decided_at = ?
    WHERE id = ?
  `
  ).run(new Date().toISOString(), appId);

  db.prepare(
    `
    INSERT INTO action_log (app_id, moderator_id, action, reason, timestamp)
    VALUES (?, ?, 'reject', ?, ?)
  `
  ).run(appId, moderatorId, reason || null, new Date().toISOString());

  // Send DM to applicant
  await sendRejectionDM(app.user_id, reason);

  // Optionally kick from guild
  const config = db
    .prepare("SELECT auto_kick_rejected FROM configs WHERE guild_id = ?")
    .get(interaction.guildId);
  if (config.auto_kick_rejected === 1) {
    await kickUser(app.user_id, reason);
  }

  await logAction("reject", appId, moderatorId, reason);
  await updateReviewCardStatus(appId, "rejected");
}
```

## DM Templates

### Approval Template

```typescript
async function sendApprovalDM(userId: string, reason?: string): Promise<void> {
  const config = db
    .prepare("SELECT acceptance_message FROM configs WHERE guild_id = ?")
    .get(guildId);

  const embed = new EmbedBuilder()
    .setTitle("🎉 Application Approved!")
    .setDescription(
      config.acceptance_message ||
        "Congratulations! Your application has been approved. Welcome to Pawtropolis!"
    )
    .setColor(0x2ecc71) // Green
    .addFields({ name: "Moderator Note", value: reason || "*No additional notes.*" })
    .setFooter({ text: "Questions? Reply to this DM to open a support ticket." })
    .setTimestamp();

  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
  } catch (error) {
    if (error.code === 50007) {
      console.warn(`Cannot DM user ${userId}: DMs disabled or blocked bot.`);
      // Don't block accept flow; log warning only
    } else {
      throw error;
    }
  }
}
```

### Rejection Template

```typescript
async function sendRejectionDM(userId: string, reason?: string): Promise<void> {
  const config = db
    .prepare("SELECT rejection_message FROM configs WHERE guild_id = ?")
    .get(guildId);

  const embed = new EmbedBuilder()
    .setTitle("Application Decision")
    .setDescription(
      config.rejection_message ||
        "Thank you for applying to Pawtropolis. Unfortunately, we cannot accept your application at this time."
    )
    .setColor(0xe74c3c) // Red
    .addFields(
      { name: "Reason", value: reason || "*No specific reason provided.*" },
      { name: "Reapply", value: "You may reapply after 30 days." }
    )
    .setFooter({ text: "Questions? Reply to this DM to open a support ticket." })
    .setTimestamp();

  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
  } catch (error) {
    if (error.code === 50007) {
      console.warn(`Cannot DM user ${userId}: DMs disabled.`);
    } else {
      throw error;
    }
  }
}
```

## Review Card Status Updates

### Dynamic Embed Updates

```typescript
async function updateReviewCardStatus(
  appId: number,
  status: "pending" | "claimed" | "accepted" | "rejected"
): Promise<void> {
  const app = db.prepare("SELECT * FROM review_action WHERE id = ?").get(appId);
  const config = db
    .prepare("SELECT review_channel_id FROM configs WHERE guild_id = ?")
    .get(guildId);
  const channel = client.channels.cache.get(config.review_channel_id) as TextChannel;
  const message = await channel.messages.fetch(app.review_message_id);

  const embed = EmbedBuilder.from(message.embeds[0]);

  // Update color and add status field
  if (status === "accepted") {
    embed.setColor(0x2ecc71); // Green
    embed.addFields({ name: "Status", value: "✅ Accepted", inline: true });
  } else if (status === "rejected") {
    embed.setColor(0xe74c3c); // Red
    embed.addFields({ name: "Status", value: "❌ Rejected", inline: true });
  } else if (status === "claimed") {
    embed.setColor(0xf1c40f); // Yellow
    const moderator = await client.users.fetch(app.claimed_by);
    embed.addFields({ name: "Claimed By", value: `<@${moderator.id}>`, inline: true });
  }

  // Update buttons
  const components =
    status === "pending"
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`claim_${appId}`)
              .setLabel("Claim")
              .setStyle(ButtonStyle.Primary)
          ),
        ]
      : status === "claimed"
        ? [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`unclaim_${appId}`)
                .setLabel("Unclaim")
                .setStyle(ButtonStyle.Secondary)
            ),
          ]
        : []; // Disable all buttons for decided applications

  await message.edit({ embeds: [embed], components });
}
```

## History Persistence Logic

### Known Issue: History Not Visible Until Claim

**Problem**: Applications submitted via `/gate` don't appear in `/modstats` until a moderator claims them.

**Root Cause**: No `action_log` row exists on submission; queries using `INNER JOIN action_log` exclude pending apps.

**Fix 1: Insert Submit Action**:

```typescript
// In /gate modal submit handler
db.prepare(
  `
  INSERT INTO action_log (app_id, moderator_id, action, timestamp)
  VALUES (?, '0', 'submit', ?)
`
).run(appId, new Date().toISOString());
// moderator_id = '0' indicates system action
```

**Fix 2: Use LEFT JOIN in Queries**:

```sql
-- Before (excludes pending apps)
SELECT ra.*, al.action, al.timestamp
FROM review_action ra
INNER JOIN action_log al ON ra.id = al.app_id
WHERE ra.status = 'pending';

-- After (includes pending apps)
SELECT ra.*, al.action, al.timestamp
FROM review_action ra
LEFT JOIN action_log al ON ra.id = al.app_id
WHERE ra.status = 'pending';
```

### Review History Display

```typescript
async function getApplicationHistory(appId: number): Promise<ActionLog[]> {
  return db
    .prepare(
      `
    SELECT
      al.*,
      u.username as moderator_name
    FROM action_log al
    LEFT JOIN users u ON al.moderator_id = u.id
    WHERE al.app_id = ?
    ORDER BY al.timestamp ASC
  `
    )
    .all(appId);
}

// Render in embed
function buildHistoryField(history: ActionLog[]): string {
  return (
    history
      .map((log) => {
        const timestamp = `<t:${Math.floor(new Date(log.timestamp).getTime() / 1000)}:R>`;
        const moderator = log.moderator_id === "0" ? "System" : `<@${log.moderator_id}>`;
        return `${timestamp} - **${log.action}** by ${moderator}`;
      })
      .join("\n") || "*No history yet*"
  );
}
```

## Performance Considerations

### Rate Limiting

```typescript
const submissionCache = new Map<string, number>(); // userId -> timestamp

async function checkSubmissionRateLimit(userId: string): Promise<boolean> {
  const lastSubmission = submissionCache.get(userId);
  if (lastSubmission && Date.now() - lastSubmission < 24 * 60 * 60 * 1000) {
    return false; // Rate limited
  }
  submissionCache.set(userId, Date.now());
  return true;
}
```

### Database Indexing

```sql
-- Essential indexes for review flow queries
CREATE INDEX idx_review_action_status ON review_action(status);
CREATE INDEX idx_review_action_claimed_by ON review_action(claimed_by);
CREATE INDEX idx_review_action_submitted_at ON review_action(submitted_at);
CREATE INDEX idx_action_log_app_id ON action_log(app_id);
CREATE INDEX idx_action_log_timestamp ON action_log(timestamp);
```

## Actionable Recommendations

### Immediate Fixes

1. **Insert submit action**: Add `action_log` row on `/gate` submission (moderator_id = '0').
2. **Fix pretty card emission**: Ensure `logAction()` called for all accept/reject operations.
3. **Add retry logic**: If DM send fails (50007), log warning but continue flow.

### UX Improvements

1. **Show pending queue**: `/queue` command listing all unclaimed applications.
2. **Auto-expire applications**: After 7 days pending, auto-reject with DM notification.
3. **Application edits**: Allow users to update their reason via `/gate edit` before claim.

### Monitoring

1. **Track claim→decision time**: Alert if any application exceeds 48h SLA.
2. **Audit duplicate claims**: Log warnings if claim transaction fails with ALREADY_CLAIMED.
3. **Monitor DM failures**: Count users who block bot (50007 errors) for reporting.

### Data Integrity

1. **Cascade deletes**: Ensure `action_log` rows deleted when application deleted.
2. **Validate foreign keys**: Check all `user_id` references exist in Discord before operations.
3. **Backup before decisions**: Daily snapshots of `review_action` table for rollback.

---

## See Also

### Related Guides
- [GATEKEEPER-GUIDE.md](../GATEKEEPER-GUIDE.md) — Staff guide for gate system usage
- [Modmail System](modmail-system.md) — DM routing for applicant communication
- [Logging and ModStats](logging-and-modstats.md) — Audit trail and moderator analytics

### Reference Documentation
- [BOT-HANDBOOK.md](../../BOT-HANDBOOK.md) — Complete command reference
- [Database Schema](database-schema.md) — Full schema documentation
- [PERMS-MATRIX.md](../../PERMS-MATRIX.md) — Permission reference

### Navigation
- [Staff Documentation Index](../INDEX.md) — Find any document quickly
- [Troubleshooting](../operations/troubleshooting.md) — Common issues and fixes
