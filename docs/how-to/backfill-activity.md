# Activity Backfill Guide

Load past message data to see activity heatmaps.

## How to Run

### Step 1: Test First (Recommended)
See what will happen without making changes:

```bash
ssh pawtech "cd /home/ubuntu/pawtropolis-tech && npx tsx scripts/backfill-message-activity.ts 896070888594759740 8 --dry-run"
```

### Step 2: Run for Real
If the test looks good, run it:

```bash
ssh pawtech "cd /home/ubuntu/pawtropolis-tech && npx tsx scripts/backfill-message-activity.ts 896070888594759740 8"
```

Change `896070888594759740` to your server ID if needed.

## What It Does

The script:
- Gets all text channels, threads, and forums
- Respects Discord rate limits (waits when needed)
- Shows progress as it runs
- Safe to run multiple times
- Only counts real user messages (not bots)

## What You'll See

The script will show:
- Which channels it's reading
- How many messages it finds
- A final summary with total messages

Example summary:
```
=== Backfill Complete ===
Time elapsed: 18.5 minutes
Channels processed: 124
Total messages found: 52,387
Messages inserted: 52,387

You can now run /activity to see the heatmap!
```

## Problems?

### "Skipping (missing permission)" warnings
Make sure the bot has these permissions:
- View Channels
- Read Message History
- Read Messages/View Channels

### Very few messages found
- Check forum channel permissions
- Script might be rate limited (it will wait)

### Script seems stuck
- It might be waiting for Discord rate limits
- Press Ctrl+C to stop, then try with `--dry-run`

## Check Results

After the backfill finishes:

```bash
ssh pawtech "cd /home/ubuntu/pawtropolis-tech && npx tsx scripts/diagnostic-activity.ts 896070888594759740 8"
```

You should see thousands of messages spread across multiple days.

## Use the Heatmap

Run this command in Discord:

```
/activity weeks:8
```

You'll see a colorful activity heatmap!
