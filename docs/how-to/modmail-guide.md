# Modmail Guide

Talk with applicants privately through Discord threads.

## What It Does

Modmail lets staff message applicants without using personal DMs. Messages go through a private thread that only staff can see.

Key features:
- Private threads in the review channel
- Messages auto-forward between thread and applicant DMs
- Open, close, and reopen threads
- Shows on review cards when an app is claimed

## How to Use

### Open Modmail

**From Review Card:**
1. Claim the application first
2. Click "Modmail" button
3. A private thread opens
4. You're auto-added to the thread
5. Applicant gets a DM notification

**From Context Menu:**
1. Right-click the review card
2. Select "Modmail: Open"

**What's in the thread:**
- Applicant info (tag, app code, join date, avatar)
- "Close" button
- "Copy Lens Link" button (for image search)

### Send Messages

**You write in thread → Applicant gets DM:**
- Any message you send in the thread goes to the applicant
- Shows as: "From Staff (YourName): message"
- Includes first attachment if you add one
- If DM fails, you'll see a warning in the thread

**Applicant writes DM → You see in thread:**
- Applicant's DM appears in the thread
- Shows as: "Applicant (@user): message"
- Includes first attachment if they add one

### Close Modmail

**Use the button:**
- Click "Close" in the thread
- Thread locks and archives
- Applicant gets a notification

**Use the command:**
```
/modmail close [thread]
```
- Leave `thread` blank to close the current thread
- Same result as the button

### Reopen Modmail

```
/modmail reopen [user] [thread]
```

**If closed less than 7 days ago:**
- Unlocks and unarchives the same thread
- Applicant gets a notification

**If closed more than 7 days ago:**
- Creates a new thread
- Keeps the same application code

## Permissions Needed

**Bot needs:**
- Manage Threads
- Send Messages in Threads
- View Channel
- Send Messages (for DMs)

**You need one of:**
- Manage Guild permission
- Reviewer Role

## Technical Details

**Database:** Each modmail thread is tracked in the database with:
- Guild ID and user ID
- Application code
- Thread ID
- Status (open or closed)
- Timestamps

**Important:** Only one open thread per user per server.

## Command Reference

### `/modmail close [thread]`
Close a thread. Leave `thread` blank to close the current one.

### `/modmail reopen [user] [thread]`
Reopen a closed thread. Specify the user or thread ID.

### Context Menu: "Modmail: Open"
Right-click a review card and select this to open modmail.

## Common Problems

### Applicant DMs are off
- You'll see a warning in the thread
- Thread still opens
- Messages won't deliver until they enable DMs

### Bot missing permissions
- Error: "Bot is missing ManageThreads or SendMessagesInThreads permission"
- No thread created
- Fix bot permissions and try again

### You don't have permission
- Error: "You do not have permission for this"
- Need Manage Guild or Reviewer Role

### Thread already open
- Error: "Modmail thread already exists"
- Only one open thread per user at a time
- Close the existing thread first

## Review Card Integration

The "Modmail" button shows on review cards when:
- Application is claimed
- Not yet approved/rejected/kicked

Review cards show modmail status:
- "Modmail: Open: #modmail-A1B2C3"
- "Modmail: Closed"

## Related Docs

- [Modmail System Reference](../reference/modmail-system.md) - Technical details
- [BOT-HANDBOOK.md](../../BOT-HANDBOOK.md) - All commands
- [Troubleshooting](../operations/troubleshooting.md) - Fix problems
