# /send Command

## What It Does

Post messages as the bot. Useful for announcements where you don't want to show who sent it.

**Features:**
- Anonymous (your name stays hidden)
- Supports text and embeds
- Can reply to messages
- Can attach files
- Blocks @everyone/@here by default
- All uses are logged

## How to Use

```
/send message:<text> [embed:<true|false>] [reply_to:<messageId>] [attachment:<file>] [silent:<true|false>]
```

**Options:**
- `message` - What to say (required)
- `embed` - Send as blue embed box (optional)
- `reply_to` - Reply to a message by ID (optional)
- `attachment` - Add a file or image (optional)
- `silent` - Block all mentions, default is true (optional)

## Examples

**Simple message:**
```
/send message:"Welcome to the server!"
```

**Blue embed box:**
```
/send message:"Check out our new rules!" embed:true
```

**Reply to a message:**
```
/send message:"We're looking into this" reply_to:1234567890
```

**With attachment:**
```
/send message:"Here's the poster" attachment:[upload file]
```

**Allow mentions:**
```
/send message:"Thanks @ModName!" silent:false
```
Note: @everyone and @here are always blocked.

## Who Can Use It

You need "Manage Messages" permission. Server admins can add extra role restrictions using `SEND_ALLOWED_ROLE_IDS` in the bot config.

## Safety Features

- @everyone and @here are always blocked (even with silent:false)
- Default blocks all mentions (use silent:false to allow user/role mentions)
- Max 2000 chars for normal text, 4096 for embeds
- All uses are logged to the audit channel

## Common Errors

**"Can only be used in a server"**
- You're in DMs. Use this in a server channel.

**"You do not have the required role"**
- Ask an admin for the right role.

**"Failed to send message"**
- Bot needs Send Messages and Embed Links permissions.

## Audit Logging

If `LOGGING_CHANNEL` is set, the bot logs who used the command (but keeps it hidden from regular members). The log shows:
- Who sent it
- What channel
- Message preview (first 512 chars)

## Troubleshooting

**Command not showing up?**
Run `npm run deploy:cmds`

**Audit logs not appearing?**
1. Check channel ID is correct
2. Bot needs Send Messages + Embed Links in that channel
3. Make sure it's a text channel
