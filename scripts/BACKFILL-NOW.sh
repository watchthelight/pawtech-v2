#!/bin/bash
# Quick script to backfill activity data for Pawtropolis server

GUILD_ID="${GUILD_ID:-896070888594759740}"
WEEKS=8

echo "🚀 Starting Activity Backfill for Pawtropolis"
echo "   Guild ID: $GUILD_ID"
echo "   Weeks: $WEEKS"
echo ""
echo "Configuration:"
echo "  📊 100% collection of all messages (no sampling)"
echo "  🔄 Sequential processing (one channel at a time)"
echo "  💾 Storage: ~40-50 MB for 324k messages"
echo "  ⚡ No artificial delays (Discord rate limits naturally)"
echo ""
echo "This will:"
echo "  ✅ Scan ALL 322 text channels (regular, announcements, threads, forums)"
echo "  ✅ Collect 100% of messages from all channels (including main-chat)"
echo "  ✅ Store only metadata (guild/channel/user/timestamp, NO message content)"
echo "  ✅ Insert to database (safe - uses INSERT OR IGNORE)"
echo ""
echo "Expected time: 15-20 minutes (sequential, full collection)"
echo ""
read -p "Press ENTER to start, or Ctrl+C to cancel..."

cd /home/ubuntu/pawtropolis-tech
npx tsx scripts/backfill-message-activity.ts "$GUILD_ID" "$WEEKS"

echo ""
echo "✅ Backfill complete!"
echo ""
echo "📊 Run diagnostic to verify:"
echo "   npx tsx scripts/diagnostic-activity.ts $GUILD_ID $WEEKS"
echo ""
echo "🎨 Test the heatmap in Discord:"
echo "   /activity weeks:$WEEKS"
echo ""
