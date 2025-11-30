/**
 * Diagnostic script for activity heatmap data collection
 * USAGE: tsx scripts/diagnostic-activity.ts <guildId> [weeks]
 */

import { db } from '../src/db/db.js';
import { fetchActivityData } from '../src/lib/activityHeatmap.js';

/**
 * Validate a Discord snowflake ID (17-19 digits)
 */
function validateDiscordId(id: string | undefined, name: string): string {
  if (!id) {
    console.error(`Error: ${name} is required`);
    console.error('Usage: tsx scripts/diagnostic-activity.ts <guildId> [weeks]');
    process.exit(1);
  }
  if (!/^\d{17,19}$/.test(id)) {
    console.error(`Error: ${name} must be a valid Discord snowflake (17-19 digits)`);
    process.exit(1);
  }
  return id;
}

/**
 * Validate a positive integer within a range
 */
function validatePositiveInt(value: string | undefined, name: string, min: number, max: number, defaultValue: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (isNaN(num) || num < min || num > max) {
    console.error(`Error: ${name} must be between ${min} and ${max}`);
    process.exit(1);
  }
  return num;
}

async function main() {
  const guildId = validateDiscordId(process.argv[2], 'guildId');
  const weeks = validatePositiveInt(process.argv[3], 'weeks', 1, 8, 1);

  console.log(`\n=== Activity Data Diagnostic for Guild ${guildId} ===\n`);

  // Check if message_activity table exists
  try {
    const tableCheck = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='message_activity'`)
      .get() as { name: string } | undefined;

    if (!tableCheck) {
      console.error('❌ ERROR: message_activity table does not exist!');
      console.error('   Run migration 020 to create the table.');
      process.exit(1);
    }
    console.log('✅ message_activity table exists');
  } catch (err) {
    console.error('❌ ERROR checking for message_activity table:', err);
    process.exit(1);
  }

  // Calculate time range
  const now = new Date();
  const weeksAgo = new Date(now);
  weeksAgo.setDate(now.getDate() - (weeks * 7));

  const startTimestamp = Math.floor(weeksAgo.getTime() / 1000);
  const endTimestamp = Math.floor(now.getTime() / 1000);

  console.log(`\nTime Range:`);
  console.log(`  Start: ${new Date(startTimestamp * 1000).toISOString()} (${startTimestamp})`);
  console.log(`  End:   ${new Date(endTimestamp * 1000).toISOString()} (${endTimestamp})`);

  // Query total messages
  try {
    const totalMessages = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM message_activity
         WHERE guild_id = ? AND created_at_s >= ? AND created_at_s <= ?`
      )
      .get(guildId, startTimestamp, endTimestamp) as { count: number } | undefined;

    console.log(`\nTotal Messages:`);
    console.log(`  ${totalMessages?.count || 0} messages found in the last ${weeks} week(s)`);

    if (!totalMessages || totalMessages.count === 0) {
      console.warn('\n⚠️  WARNING: No messages found! Possible issues:');
      console.warn('   1. Bot was just deployed and needs time to collect data');
      console.warn('   2. Bot is not receiving messageCreate events');
      console.warn('   3. No messages have been sent in this guild during the time period');
      console.warn('   4. Guild ID is incorrect');
    }
  } catch (err) {
    console.error('❌ ERROR querying total messages:', err);
  }

  // Query messages by day
  console.log(`\nMessages by Day:`);
  try {
    const dayBreakdown = db
      .prepare(
        `SELECT
           DATE(created_at_s, 'unixepoch') as day,
           COUNT(*) as count
         FROM message_activity
         WHERE guild_id = ? AND created_at_s >= ? AND created_at_s <= ?
         GROUP BY day
         ORDER BY day DESC
         LIMIT 14`
      )
      .all(guildId, startTimestamp, endTimestamp) as Array<{ day: string; count: number }>;

    if (dayBreakdown.length === 0) {
      console.log('  No data available');
    } else {
      for (const row of dayBreakdown) {
        console.log(`  ${row.day}: ${row.count.toLocaleString()} messages`);
      }
    }
  } catch (err) {
    console.error('❌ ERROR querying day breakdown:', err);
  }

  // Query top message hours
  console.log(`\nTop Message Hours (UTC):`);
  try {
    const hourBreakdown = db
      .prepare(
        `SELECT
           CAST(strftime('%H', datetime(created_at_s, 'unixepoch')) AS INTEGER) as hour,
           COUNT(*) as count
         FROM message_activity
         WHERE guild_id = ? AND created_at_s >= ? AND created_at_s <= ?
         GROUP BY hour
         ORDER BY count DESC
         LIMIT 5`
      )
      .all(guildId, startTimestamp, endTimestamp) as Array<{ hour: number; count: number }>;

    if (hourBreakdown.length === 0) {
      console.log('  No data available');
    } else {
      for (const row of hourBreakdown) {
        const hourLabel = row.hour === 0 ? '12am' : row.hour < 12 ? `${row.hour}am` : row.hour === 12 ? '12pm' : `${row.hour - 12}pm`;
        console.log(`  ${hourLabel}: ${row.count.toLocaleString()} messages`);
      }
    }
  } catch (err) {
    console.error('❌ ERROR querying hour breakdown:', err);
  }

  // Detect gaps
  console.log(`\nGap Detection:`);
  try {
    const gapQuery = db
      .prepare(
        `SELECT
           DATE(created_at_s, 'unixepoch') as day,
           COUNT(*) as count
         FROM message_activity
         WHERE guild_id = ? AND created_at_s >= ? AND created_at_s <= ?
         GROUP BY day
         HAVING count < 10
         ORDER BY day DESC`
      )
      .all(guildId, startTimestamp, endTimestamp) as Array<{ day: string; count: number }>;

    if (gapQuery.length === 0) {
      console.log('  ✅ No low-activity days detected (all days have 10+ messages)');
    } else {
      console.log('  ⚠️  Low-activity days detected:');
      for (const row of gapQuery) {
        console.log(`    ${row.day}: only ${row.count} messages`);
      }
    }
  } catch (err) {
    console.error('❌ ERROR detecting gaps:', err);
  }

  // Fetch activity data using the heatmap function
  console.log(`\nFetching activity data using fetchActivityData()...`);
  try {
    const data = fetchActivityData(guildId, weeks);
    console.log(`  Weeks loaded: ${data.weeks.length}`);
    console.log(`  Max value: ${data.maxValue}`);
    console.log(`  Total messages: ${data.trends.totalMessages.toLocaleString()}`);
    console.log(`  Avg messages/hour: ${data.trends.avgMessagesPerHour.toFixed(1)}`);
    console.log(`  Busiest hours: ${data.trends.busiestHours}`);
    console.log(`  Least active hours: ${data.trends.leastActiveHours}`);
    console.log(`  Peak days: ${data.trends.peakDays.join(', ')}`);
    console.log(`  Quietest days: ${data.trends.quietestDays.join(', ')}`);
    if (data.trends.weekOverWeekGrowth !== undefined) {
      const emoji = data.trends.weekOverWeekGrowth > 0 ? '📈' : data.trends.weekOverWeekGrowth < 0 ? '📉' : '━';
      console.log(`  Week-over-week: ${emoji} ${data.trends.weekOverWeekGrowth > 0 ? '+' : ''}${data.trends.weekOverWeekGrowth.toFixed(1)}%`);
    }
  } catch (err) {
    console.error('❌ ERROR fetching activity data:', err);
  }

  console.log('\n=== Diagnostic Complete ===\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
