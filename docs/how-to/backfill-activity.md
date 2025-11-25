# Activity Heatmap Backfill Guide

## Quick Start

### 1. Test Run (Recommended First Step)
See what the backfill will do without writing to the database:

```bash
ssh pawtech "cd /home/ubuntu/pawtropolis-tech && npx tsx scripts/backfill-message-activity.ts 896070888594759740 8 --dry-run"
```

### 2. Live Backfill
Once you verify the dry run looks good, run the actual backfill:

```bash
ssh pawtech "cd /home/ubuntu/pawtropolis-tech && npx tsx scripts/backfill-message-activity.ts 896070888594759740 8"
```

Replace `896070888594759740` with your guild ID if different.

## What It Does

The backfill script:
- ✅ Fetches **ALL** text channels (regular, announcement, threads)
- ✅ Fetches **ALL** forum channels and their threads (active + archived)
- ✅ Fetches **ALL** active threads across the server
- ✅ Respects Discord rate limits (auto-waits when rate limited)
- ✅ Shows real-time progress with channel-by-channel updates
- ✅ Safe to run multiple times (uses `INSERT OR IGNORE`)
- ✅ Filters to only non-bot, non-webhook messages

## Expected Output

```
=== Message Activity Backfill ===
Guild ID: 896070888594759740
Weeks: 8
Mode: LIVE (writing to database)

Time Range:
  Start: 2025-09-28T18:00:00.000Z
  End:   2025-11-24T18:00:00.000Z

🔌 Connecting to Discord...

✅ Bot connected as Pawtropolis Tech#2205

📋 Guild: Pawtropolis (5400 members)

📁 Found 42 text channels/threads
📁 Found 3 forum channels

🔍 Fetching active threads...
📁 Total channels after thread scan: 68

🔍 Fetching forum threads from Community Discussions...
📁 Final channel count: 124

📥 [1/124] Fetching from #general (text)...
  ✅ 4,287 messages fetched

📥 [2/124] Fetching from #announcements (announcement)...
  ✅ 156 messages fetched

📥 [3/124] Fetching from #introductions (text)...
  ✅ 2,043 messages fetched

...

=== Backfill Complete ===
Time elapsed: 18.5 minutes
Channels processed: 124
Channels skipped: 0
Total messages found: 52,387
Messages inserted: 52,387
Duplicates skipped: 0

✅ Backfill process completed successfully!
💡 You can now run /activity command to see the heatmap!
```

## Troubleshooting

### Bot Missing Permissions
If you see many "Skipping (missing X permission)" warnings:

1. Check bot has these permissions:
   - ✅ View Channels
   - ✅ Read Message History
   - ✅ Read Messages/View Channels

2. Grant permissions server-wide or per-channel

### Very Low Message Count
If you only see a few hundred messages for an active server:

1. **Bot might not have forum access** - Check forum channel permissions
2. **Threads not being scanned** - Improved script now fetches archived threads too
3. **Rate limited heavily** - Script will wait, but may take longer

### Script Hangs
If the script appears stuck:
- It may be waiting for a rate limit (check last output)
- Press Ctrl+C to cancel and run with `--dry-run` to diagnose

## Verifying Results

After backfill completes, check the data:

```bash
ssh pawtech "cd /home/ubuntu/pawtropolis-tech && npx tsx scripts/diagnostic-activity.ts 896070888594759740 8"
```

You should see:
- Total messages in thousands (not hundreds)
- Activity spread across multiple days
- Reasonable busiest hours (likely afternoon/evening UTC)

## Running the Heatmap

Once backfill is complete:

```
/activity weeks:8
```

You should see a colorful heatmap with significant activity!
