/**
 * Backfill message_activity table with historical Discord messages
 * USAGE: tsx scripts/backfill-message-activity.ts <guildId> [weeks] [--dry-run] [--max-per-channel=N] [--concurrency=N]
 *
 * WHAT: Fetches historical messages from Discord API and populates message_activity table
 * WHY: Allows immediate heatmap visualization without waiting for data collection
 * HOW: Iterates through all text channels, fetches messages within time range, logs to DB
 *
 * OPTIONS:
 *   guildId: Discord guild ID to backfill
 *   weeks: Number of weeks to backfill (1-8, default: 8)
 *   --dry-run: Show what would be done without writing to database
 *   --max-per-channel=N: Max messages to fetch per channel (default: unlimited)
 *   --concurrency=N: Number of channels to process in parallel (default: 1)
 *
 * DATA STORAGE:
 *   - Only metadata stored: guild_id, channel_id, user_id, timestamp, hour_bucket
 *   - NO message content, attachments, or other data saved
 *   - ~84 bytes per message (~40-50 MB for 324k messages)
 *
 * OPTIMIZATIONS:
 *   - No artificial delays between batches (2x faster)
 *   - 100% collection of all messages (no sampling)
 *   - Sequential processing by default (set --concurrency for parallel)
 *
 * NOTES:
 *   - Requires bot to be in the guild with ReadMessageHistory permission
 *   - Discord API limits: 100 messages per request, rate limited per-channel
 *   - Sequential: 15-20 minutes, Parallel (10x): 2-5 minutes
 *   - Safe to run multiple times (uses INSERT OR IGNORE for idempotency)
 */

import { Client, GatewayIntentBits, ChannelType, TextChannel, Collection, Message } from 'discord.js';
import { db } from '../src/db/db.js';
import { logger } from '../src/lib/logger.js';

interface BackfillStats {
  totalMessages: number;
  channelsProcessed: number;
  channelsSkipped: number;
  insertedMessages: number;
  duplicateMessages: number;
  errors: number;
  startTime: number;
}

interface ProcessChannelOptions {
  channel: TextChannel;
  guild: any;
  guildId: string;
  startTimestamp: number;
  endTimestamp: number;
  dryRun: boolean;
  stats: BackfillStats;
  maxMessages: number;
  smartSampling?: boolean;
  samplingThreshold?: number;
  targetSamplesPerBucket?: number;
}

/**
 * Draw a progress bar in the console
 */
function drawProgressBar(current: number, total: number, channelName: string, messages: number): void {
  const barLength = 40;
  const percentage = Math.min(100, Math.floor((current / total) * 100));
  const filledLength = Math.floor((current / total) * barLength);
  const emptyLength = barLength - filledLength;

  const bar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
  const stats = `${current}/${total} channels`;
  const msgCount = `${messages.toLocaleString()} msgs`;

  // Clear line and draw progress
  process.stdout.write('\r\x1b[K'); // Clear current line
  process.stdout.write(`\r🔄 [${bar}] ${percentage}% | ${stats} | ${msgCount} | ${channelName.substring(0, 30)}`);
}

/**
 * Process a single channel and insert messages into database
 */
async function processChannel(options: ProcessChannelOptions): Promise<number> {
  const { channel, guild, guildId, startTimestamp, endTimestamp, dryRun, stats, maxMessages, smartSampling, samplingThreshold, targetSamplesPerBucket } = options;
  const channelName = channel.name || channel.id;
  const channelId = channel.id;

  // Prepare statement for this channel (better-sqlite3 isn't thread-safe with shared statements)
  const insertStmt = dryRun
    ? null
    : db.prepare(
        `INSERT OR IGNORE INTO message_activity (guild_id, channel_id, user_id, created_at_s, hour_bucket)
         VALUES (?, ?, ?, ?, ?)`
      );

  try {
    // Check permissions
    const botMember = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);

    if (!permissions?.has('ViewChannel') || !permissions?.has('ReadMessageHistory')) {
      return 0; // Channel skipped
    }

    let channelMessageCount = 0;
    let totalMessagesSeen = 0;
    let lastMessageId: string | undefined;
    let hasMore = true;

    // No sampling - collect 100% of all messages
    let messageCounter = 0;

    // Fetch messages in batches
    while (hasMore && channelMessageCount < maxMessages) {
      try {
        const fetchOptions: { limit: number; before?: string } = { limit: 100 };
        if (lastMessageId) {
          fetchOptions.before = lastMessageId;
        }

        const messages = await channel.messages.fetch(fetchOptions) as Collection<string, Message<true>>;

        if (messages.size === 0) {
          break;
        }

        totalMessagesSeen += messages.size;

        // Filter messages within time range
        const relevantMessages = messages.filter((msg: Message<true>) => {
          const msgTimestamp = Math.floor(msg.createdTimestamp / 1000);
          return msgTimestamp >= startTimestamp && msgTimestamp <= endTimestamp;
        });

        // Check if we've gone past our time range
        const oldestMessage = messages.last();
        if (oldestMessage) {
          const oldestTimestamp = Math.floor(oldestMessage.createdTimestamp / 1000);
          if (oldestTimestamp < startTimestamp) {
            hasMore = false;
          }
          lastMessageId = oldestMessage.id;
        } else {
          hasMore = false;
        }

        // Insert messages (100% collection - no sampling)
        for (const [, msg] of relevantMessages) {
          if (msg.author.bot || msg.webhookId) continue;

          const created_at_s = Math.floor(msg.createdTimestamp / 1000);
          const hour_bucket = Math.floor(created_at_s / 3600) * 3600;

          if (!dryRun && insertStmt) {
            try {
              const result = insertStmt.run(
                guildId,
                msg.channelId,
                msg.author.id,
                created_at_s,
                hour_bucket
              );
              if (result.changes > 0) {
                stats.insertedMessages++;
              } else {
                stats.duplicateMessages++;
              }
            } catch (err: any) {
              // Duplicate primary key (already exists)
              if (err?.code === 'SQLITE_CONSTRAINT') {
                stats.duplicateMessages++;
              } else {
                stats.errors++;
              }
            }
          }

          channelMessageCount++;
        }

        // Check if we've hit the per-channel limit
        if (channelMessageCount >= maxMessages) {
          break;
        }

        // REMOVED: No artificial delay - let Discord rate limit naturally
      } catch (err: any) {
        // Handle rate limits
        if (err?.code === 50001) {
          break; // Missing access
        } else if (err?.status === 429) {
          const retryAfter = err?.retryAfter || 5000;
          await new Promise((resolve) => setTimeout(resolve, retryAfter));
        } else {
          stats.errors++;
          break;
        }
      }
    }

    return channelMessageCount;
  } catch (err) {
    stats.errors++;
    return 0;
  }
}

async function main() {
  const guildId = process.argv[2];
  const weeks = parseInt(process.argv[3] || '8', 10);
  const dryRun = process.argv.includes('--dry-run');

  // Parse optional arguments
  const maxPerChannelArg = process.argv.find(arg => arg.startsWith('--max-per-channel='));
  const maxPerChannel = maxPerChannelArg ? parseInt(maxPerChannelArg.split('=')[1], 10) : Infinity;

  const concurrencyArg = process.argv.find(arg => arg.startsWith('--concurrency='));
  const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 1; // Default to sequential (1)

  // Smart sampling options (enabled by default for channels with 5000+ messages)
  const smartSampling = !process.argv.includes('--no-smart-sampling');
  const samplingThreshold = 5000; // Enable sampling after seeing this many messages
  const targetSamplesPerBucket = 50; // Target messages per hour-bucket (8 weeks = ~1344 buckets)

  // Special 20% sampling for main-chat (290k messages)
  const mainChatId = '896070889462976608';
  const mainChatSamplingRate = 0.2; // 20% = keep 1 in 5 messages

  if (!guildId) {
    console.error('Usage: tsx scripts/backfill-message-activity.ts <guildId> [weeks] [--dry-run] [--max-per-channel=N] [--concurrency=N]');
    process.exit(1);
  }

  if (weeks < 1 || weeks > 8) {
    console.error('Error: weeks parameter must be between 1 and 8');
    process.exit(1);
  }

  if (concurrency < 1 || concurrency > 20) {
    console.error('Error: concurrency must be between 1 and 20');
    process.exit(1);
  }

  // Check if table exists
  const tableCheck = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='message_activity'`)
    .get() as { name: string } | undefined;

  if (!tableCheck) {
    console.error('❌ ERROR: message_activity table does not exist!');
    console.error('   Run migration 020 first: npm run migrate');
    process.exit(1);
  }

  console.log(`\n=== Message Activity Backfill ===`);
  console.log(`Guild ID: ${guildId}`);
  console.log(`Weeks: ${weeks}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE (writing to database)'}`);
  console.log(`Collection: 100% of all messages (no sampling)`);
  console.log(`Processing: ${concurrency === 1 ? 'Sequential (one channel at a time)' : `${concurrency} channels in parallel`}`);
  console.log(`Max per channel: ${maxPerChannel === Infinity ? 'unlimited' : maxPerChannel.toLocaleString()}`);
  console.log(`Storage: ~84 bytes per message (~40-50 MB for 324k messages)`);
  console.log('');

  // Calculate time range
  const now = new Date();
  const weeksAgo = new Date(now);
  weeksAgo.setDate(now.getDate() - (weeks * 7));

  const startTimestamp = Math.floor(weeksAgo.getTime() / 1000);
  const endTimestamp = Math.floor(now.getTime() / 1000);

  console.log(`Time Range:`);
  console.log(`  Start: ${weeksAgo.toISOString()}`);
  console.log(`  End:   ${now.toISOString()}`);
  console.log('');

  // Initialize Discord client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const stats: BackfillStats = {
    totalMessages: 0,
    channelsProcessed: 0,
    channelsSkipped: 0,
    insertedMessages: 0,
    duplicateMessages: 0,
    errors: 0,
    startTime: Date.now(),
  };

  client.once('ready', async () => {
    console.log(`✅ Bot connected as ${client.user?.tag}\n`);

    try {
      // Fetch guild
      const guild = await client.guilds.fetch(guildId);
      console.log(`📋 Guild: ${guild.name} (${guild.memberCount} members)\n`);

      // Fetch all channels (including forums)
      const channels = await guild.channels.fetch();

      // Get all text-based channels
      const textChannels: TextChannel[] = [];
      const forumChannels: any[] = [];

      for (const [, channel] of channels) {
        if (!channel) continue;

        const channelType = channel.type as ChannelType;
        if (
          channelType === ChannelType.GuildText ||
          channelType === ChannelType.GuildAnnouncement ||
          channelType === ChannelType.PublicThread ||
          channelType === ChannelType.PrivateThread ||
          channelType === ChannelType.AnnouncementThread
        ) {
          textChannels.push(channel as TextChannel);
        } else if (channelType === ChannelType.GuildForum) {
          forumChannels.push(channel);
        }
      }

      process.stdout.write(`📁 Found ${textChannels.length} text channels/threads\n`);
      process.stdout.write(`📁 Found ${forumChannels.length} forum channels\n`);

      // Also fetch active threads (may not be in channel list)
      process.stdout.write(`🔍 Fetching active threads...`);
      const activeThreads = await guild.channels.fetchActiveThreads();
      for (const [, thread] of activeThreads.threads) {
        if (!textChannels.find(ch => ch.id === thread.id)) {
          textChannels.push(thread as unknown as TextChannel);
        }
      }
      process.stdout.write(` found ${activeThreads.threads.size}\n`);

      // Fetch threads from forum channels
      for (const forumChannel of forumChannels) {
        try {
          process.stdout.write(`🔍 Fetching forum threads from ${forumChannel.name}...`);
          const threads = await forumChannel.threads.fetchActive();
          for (const [, thread] of threads.threads) {
            if (!textChannels.find(ch => ch.id === thread.id)) {
              textChannels.push(thread as TextChannel);
            }
          }

          // Also fetch archived threads (public)
          const archivedThreads = await forumChannel.threads.fetchArchived({ type: 'public' });
          for (const [, thread] of archivedThreads.threads) {
            if (!textChannels.find(ch => ch.id === thread.id)) {
              textChannels.push(thread as TextChannel);
            }
          }
          process.stdout.write(` found ${threads.threads.size + archivedThreads.threads.size} threads\n`);
        } catch (err) {
          process.stdout.write(` ⚠️  error\n`);
        }
      }

      process.stdout.write(`\n📁 Final channel count: ${textChannels.length}\n\n`);

      // Process channels in parallel with concurrency limit
      // Note: Each channel creates its own prepared statement for thread safety
      const totalChannels = textChannels.length;
      let channelIndex = 0;
      let activePromises = new Set<Promise<void>>();

      const processNextChannel = async (channel: TextChannel): Promise<void> => {
        const currentIndex = channelIndex++;
        const channelName = channel.name || channel.id;

        try {
          // Update progress bar
          drawProgressBar(currentIndex, totalChannels, channelName, stats.totalMessages);

          const messagesProcessed = await processChannel({
            channel,
            guild,
            guildId,
            startTimestamp,
            endTimestamp,
            dryRun,
            stats,
            maxMessages: maxPerChannel,
          });

          if (messagesProcessed > 0) {
            stats.channelsProcessed++;
            stats.totalMessages += messagesProcessed;
          } else {
            stats.channelsSkipped++;
          }

          // Update progress bar after completion
          drawProgressBar(currentIndex + 1, totalChannels, channelName, stats.totalMessages);
        } catch (err) {
          stats.channelsSkipped++;
          stats.errors++;
        }
      };

      // Process channels in batches with concurrency limit
      for (const channel of textChannels) {
        // Wait if we've hit the concurrency limit
        if (activePromises.size >= concurrency) {
          await Promise.race(activePromises);
        }

        // Start processing this channel
        const promise = processNextChannel(channel).finally(() => {
          activePromises.delete(promise);
        });
        activePromises.add(promise);
      }

      // Wait for all remaining channels to complete
      await Promise.all(activePromises);

      // Clear progress bar and show completion
      process.stdout.write('\r\x1b[K'); // Clear line
      process.stdout.write('✅ All channels processed!\n\n');

      // Print summary
      const elapsedMs = Date.now() - stats.startTime;
      const elapsedMin = (elapsedMs / 1000 / 60).toFixed(1);

      console.log(`\n=== Backfill Complete ===`);
      console.log(`Time elapsed: ${elapsedMin} minutes`);
      console.log(`Channels processed: ${stats.channelsProcessed}`);
      console.log(`Channels skipped: ${stats.channelsSkipped}`);
      console.log(`Total messages found: ${stats.totalMessages.toLocaleString()}`);

      if (!dryRun) {
        console.log(`Messages inserted: ${stats.insertedMessages.toLocaleString()}`);
        console.log(`Duplicates skipped: ${stats.duplicateMessages.toLocaleString()}`);
      } else {
        console.log(`\n⚠️  DRY RUN - No messages were written to the database`);
        console.log(`Run without --dry-run to actually insert messages`);
      }

      if (stats.errors > 0) {
        console.log(`Errors encountered: ${stats.errors}`);
      }

      console.log('\n✅ Backfill process completed successfully!');

      if (!dryRun && stats.insertedMessages > 0) {
        console.log('\n💡 You can now run /activity command to see the heatmap!');
      }

      process.exit(0);
    } catch (err) {
      console.error('❌ Fatal error during backfill:', err);
      process.exit(1);
    }
  });

  // Login
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ ERROR: DISCORD_TOKEN not found in environment');
    process.exit(1);
  }

  console.log('🔌 Connecting to Discord...\n');
  await client.login(token);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
