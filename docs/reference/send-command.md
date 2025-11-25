# /send Command Documentation

## Overview

The `/send` command allows authorized staff members to post anonymous messages as the bot. This is useful for moderation announcements, community updates, or any situation where a message should come from the bot rather than an individual moderator.

**Key Features:**
- ✅ Complete anonymity - invoker identity never revealed in public
- ✅ Supports plain text and embeds
- ✅ Reply to existing messages
- ✅ Attach files/images
- ✅ Configurable mention blocking
- ✅ Audit logging for accountability
- ✅ Role-based access control

---

## Command Syntax

```
/send message:<text> [embed:<true|false>] [reply_to:<messageId>] [attachment:<file>] [silent:<true|false>]
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message` | String | ✅ Yes | - | The content to post |
| `embed` | Boolean | ❌ No | `false` | Send as an embed (description field) |
| `reply_to` | String | ❌ No | - | Message ID to reply to in current channel |
| `attachment` | Attachment | ❌ No | - | Include one file or image |
| `silent` | Boolean | ❌ No | `true` | Block all mentions when true |

---

## Usage Examples

### Basic Message
```
/send message:"Welcome to the server!"
```
**Result:** Bot posts "Welcome to the server!" in the current channel

### Embed Message
```
/send message:"Check out our new rules!" embed:true
```
**Result:** Bot posts a blue embed with the message as description

### Reply to Message
```
/send message:"We're looking into this issue" reply_to:1234567890
```
**Result:** Bot replies to message ID 1234567890 with the text

### With Attachment
```
/send message:"Here's the event poster" attachment:[upload file]
```
**Result:** Bot posts message with the attached image/file

### Allow User Mentions
```
/send message:"Thanks @ModeratorName for helping!" silent:false
```
**Result:** Bot posts with user/role mentions enabled (but still blocks @everyone/@here)

---

## Permissions & Access Control

### Default Permission
**ManageMessages** - Only members with "Manage Messages" permission can see/use the command.

### Optional Role Restriction
Set `SEND_ALLOWED_ROLE_IDS` in `.env` to restrict access further:

```env
# Only allow specific roles (comma-separated)
SEND_ALLOWED_ROLE_IDS=123456789,987654321
```

**Behavior:**
- If **not set**: Anyone with ManageMessages can use `/send`
- If **set**: User must have ManageMessages AND at least one of the specified roles

**Denial Message:**
> ❌ You do not have the required role to use this command. Contact an administrator if you believe this is an error.

---

## Safety Features

### 1. Mass Ping Neutralization
@everyone and @here are **always** neutralized by inserting a zero-width space:
- `@everyone` → `@​everyone` (won't ping)
- `@here` → `@​here` (won't ping)

This applies even when `silent:false` is used.

### 2. Mention Control

#### Silent Mode (Default: `silent:true`)
```json
{
  "allowedMentions": {
    "parse": [],
    "repliedUser": false
  }
}
```
**Blocks ALL mentions** - no user, role, or everyone pings.

#### Non-Silent Mode (`silent:false`)
```json
{
  "allowedMentions": {
    "parse": ["users", "roles"],
    "repliedUser": false
  }
}
```
**Allows user/role mentions** but still blocks @everyone/@here.

### 3. Content Length Limits

| Mode | Limit | Error Message |
|------|-------|---------------|
| Plain Text | 2000 chars | "Messages have a 2000 character limit. Try using `embed:true` (4096 char limit) or shorten your message." |
| Embed | 4096 chars | "Embed descriptions have a 4096 character limit. Please shorten your message." |

**Example Error:**
```
❌ Message too long (2543/2000 characters).

Messages have a 2000 character limit. Try using `embed:true` (4096 char limit) or shorten your message.
```

---

## Audit Logging

### Configuration
Set **either** environment variable to enable audit logging:

```env
# Option 1: Use existing logging channel from analytics
LOGGING_CHANNEL=1234567890

# Option 2: Separate audit channel for /send only
LOGGING_CHANNEL_ID=0987654321
```

### Audit Embed Format
When enabled, an audit embed is posted to the configured channel:

```
🔇 Anonymous /send used

<message preview (first 512 chars)>

Channel: #general
Invoker: @Username (123456789)
Embed Mode: ✅ Yes
Silent: ❌ No

[Timestamp]
```

**Notes:**
- Audit logging is **best-effort** - failures won't prevent the message from sending
- Mentions are suppressed in audit logs (`allowedMentions: { parse: [] }`)
- Long messages are truncated to 512 chars with " …" suffix

---

## Error Handling

### Guild-Only Command
```
❌ This command can only be used in a server.
```
**Cause:** Command used in DMs
**Solution:** Use in a guild channel

### Permission Denied
```
❌ You do not have the required role to use this command. Contact an administrator if you believe this is an error.
```
**Cause:** User lacks required role (when `SEND_ALLOWED_ROLE_IDS` is set)
**Solution:** Contact server admin to request role assignment

### Send Failure
```
❌ Failed to send message. Check bot permissions in this channel.
```
**Cause:** Bot lacks Send Messages permission in target channel
**Solution:** Grant bot Send Messages + Embed Links permissions

### Reply Fetch Failure
**Behavior:** Gracefully falls back to normal send (no error shown to user)
**Logged:** `[send] Failed to fetch reply_to message <id>: <error>`

---

## Common Use Cases

### 1. Server Announcements
```
/send message:"🎉 We've reached 1000 members! Thank you all for being part of our community." embed:true
```

### 2. Rule Reminders
```
/send message:"Reminder: Please keep all discussions in their respective channels. Check <#rules-channel> for details." silent:false
```

### 3. Event Notifications
```
/send message:"Movie night starts in 30 minutes! Join us in <#voice-channel>" attachment:[event-poster.png] silent:false
```

### 4. Replying to Questions
```
/send message:"This is now fixed. Thanks for reporting!" reply_to:9876543210
```

### 5. Emergency Announcements
```
/send message:"⚠️ Server maintenance in progress. Expect brief downtime." embed:true
```

---

## Privacy & Accountability

### What's Anonymous?
- ✅ **Public messages** - Invoker identity is never revealed
- ✅ **Bot attribution** - Message appears to come from the bot
- ✅ **Ephemeral confirmations** - "Sent ✅" only visible to invoker

### What's Logged?
- ✅ **Audit trail** - Invoker ID logged to LOGGING_CHANNEL (if configured)
- ✅ **Message content** - First 512 chars logged for review
- ✅ **Metadata** - Channel, embed mode, silent mode tracked

**Privacy Balance:** Anonymous to community, accountable to administrators.

---

## Deployment

### 1. Register Command
```bash
npm run deploy:cmds
```

### 2. Configure Environment (Optional)
```env
# Additional role restriction
SEND_ALLOWED_ROLE_IDS=mod-role-id,admin-role-id

# Audit logging (uses existing analytics channel)
LOGGING_CHANNEL=your-logging-channel-id
```

### 3. Test in Guild
```
/send message:"Test message" embed:true
```

Verify:
- ✅ Message posted by bot
- ✅ "Sent ✅" reply is ephemeral
- ✅ Audit log appears (if configured)
- ✅ @everyone is neutralized

---

## Troubleshooting

### Command Not Appearing
**Issue:** `/send` not in autocomplete
**Fix:** Run `npm run deploy:cmds` to sync commands

### Permission Denied (Despite ManageMessages)
**Issue:** `SEND_ALLOWED_ROLE_IDS` is set but user lacks role
**Fix:** Add user to one of the configured roles or remove restriction

### Audit Logs Not Posting
**Issue:** `LOGGING_CHANNEL` set but no audit embeds
**Checks:**
1. Is the channel ID correct?
2. Does bot have Send Messages + Embed Links in that channel?
3. Is the channel a text channel (not voice/category)?

### Reply Not Working
**Issue:** `reply_to` parameter doesn't create a reply
**Checks:**
1. Is the message ID correct?
2. Is the message in the **same channel** where /send is run?
3. Check console for `[say] Failed to fetch reply_to message` warnings

---

## API Reference

### Exported Functions

#### `data`
Type: `SlashCommandBuilder`
Discord command definition with all options and permissions.

#### `execute(interaction: ChatInputCommandInteraction): Promise<void>`
Main command handler. Performs:
1. Guild + permission validation
2. Role access check (if `SEND_ALLOWED_ROLE_IDS` set)
3. Message sanitization (@everyone/@here neutralization)
4. Length validation
5. Message sending with configured options
6. Ephemeral confirmation
7. Audit logging (best-effort)

### Internal Functions

#### `checkRoleAccess(interaction): boolean`
Validates user has required role when `SEND_ALLOWED_ROLE_IDS` is configured.

#### `neutralizeMassPings(content: string): string`
Inserts zero-width space in @everyone and @here mentions.

#### `sendAuditLog(interaction, content, useEmbed, silent): Promise<void>`
Posts audit embed to configured logging channel (non-blocking).

---

## Security Considerations

### Authorized Use Only
- ✅ Default ManageMessages permission restricts access to trusted staff
- ✅ Optional role-based restriction adds second layer
- ✅ All usage tracked in audit logs (if configured)

### Abuse Prevention
- ✅ Mass pings (@everyone/@here) always neutralized
- ✅ Mention control via `silent` parameter
- ✅ Content length limits prevent spam
- ✅ Audit trail enables accountability

### Privacy Protection
- ✅ Ephemeral confirmations prevent accidental identity reveals
- ✅ No invoker mention in public messages
- ✅ Audit logs restricted to logging channel (admin-only access recommended)

---

## Changelog

### v1.0.0 (2025-10-20)
- ✨ Initial implementation
- ✅ Basic message sending
- ✅ Embed mode support
- ✅ Reply-to functionality
- ✅ Attachment support
- ✅ Configurable mention blocking
- ✅ Mass ping neutralization
- ✅ Role-based access control
- ✅ Audit logging to LOGGING_CHANNEL
- ✅ Comprehensive error handling
- ✅ Full test coverage (11 tests passing)

---

## Support

**Issues:** Report bugs or feature requests in the project issue tracker
**Questions:** Contact bot administrators or check Discord.js documentation
**Contributing:** Follow project coding standards and include tests for new features
