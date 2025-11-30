/**
 * Check if bot has access to a channel and fetch recent messages
 * USAGE: tsx scripts/check-channel-access.ts <channelId>
 */

import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

/**
 * Validate a Discord snowflake ID (17-19 digits)
 */
function validateDiscordId(id: string | undefined, name: string): string {
  if (!id) {
    console.error(`Error: ${name} is required`);
    console.error('Usage: tsx scripts/check-channel-access.ts <channelId>');
    process.exit(1);
  }
  if (!/^\d{17,19}$/.test(id)) {
    console.error(`Error: ${name} must be a valid Discord snowflake (17-19 digits)`);
    process.exit(1);
  }
  return id;
}

async function main() {
  const channelId = validateDiscordId(process.argv[2], 'channelId');

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ ERROR: DISCORD_TOKEN not found in environment');
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once('ready', async () => {
    console.log(`✅ Bot connected as ${client.user?.tag}\n`);

    try {
      // Try to fetch the channel
      console.log(`🔍 Checking access to channel ${channelId}...`);
      const channel = await client.channels.fetch(channelId);

      if (!channel) {
        console.log('❌ Channel not found or bot does not have access');
        process.exit(1);
      }

      console.log(`✅ Channel found: ${channel.isTextBased() ? '#' + ('name' in channel ? channel.name : channelId) : 'Non-text channel'}`);
      console.log(`   Type: ${ChannelType[channel.type]}`);

      if ('guild' in channel && channel.guild) {
        console.log(`   Guild: ${channel.guild.name}`);
      }

      // Check if it's a text-based channel
      if (!channel.isTextBased()) {
        console.log('\n⚠️  This is not a text-based channel');
        process.exit(0);
      }

      // Check permissions
      const guild = 'guild' in channel ? channel.guild : null;
      if (guild && 'permissionsFor' in channel) {
        const botMember = await guild.members.fetchMe();
        const permissions = channel.permissionsFor(botMember);

        console.log('\n📋 Permissions:');
        console.log(`   ViewChannel: ${permissions?.has('ViewChannel') ? '✅' : '❌'}`);
        console.log(`   ReadMessageHistory: ${permissions?.has('ReadMessageHistory') ? '✅' : '❌'}`);
        console.log(`   SendMessages: ${permissions?.has('SendMessages') ? '✅' : '❌'}`);

        if (!permissions?.has('ViewChannel') || !permissions?.has('ReadMessageHistory')) {
          console.log('\n❌ Bot does not have permission to read messages in this channel');
          process.exit(0);
        }
      }

      // Fetch last 5 messages
      console.log('\n📥 Fetching last 5 messages...\n');
      const messages = await channel.messages.fetch({ limit: 5 });

      if (messages.size === 0) {
        console.log('No messages found in this channel');
        process.exit(0);
      }

      console.log(`Found ${messages.size} message(s):\n`);
      console.log('━'.repeat(80));

      // Display messages (most recent first)
      const sortedMessages = Array.from(messages.values()).sort(
        (a, b) => b.createdTimestamp - a.createdTimestamp
      );

      for (const msg of sortedMessages) {
        const timestamp = new Date(msg.createdTimestamp).toISOString();
        const author = msg.author.bot ? `${msg.author.tag} [BOT]` : msg.author.tag;
        const content = msg.content || '[No text content]';

        console.log(`[${timestamp}]`);
        console.log(`Author: ${author}`);
        console.log(`Content: ${content}`);

        if (msg.attachments.size > 0) {
          console.log(`Attachments: ${msg.attachments.size}`);
          msg.attachments.forEach(att => {
            console.log(`  - ${att.name} (${att.url})`);
          });
        }

        if (msg.embeds.length > 0) {
          console.log(`Embeds: ${msg.embeds.length}`);
        }

        console.log('━'.repeat(80));
      }

      process.exit(0);
    } catch (err: any) {
      console.error('❌ Error:', err.message);
      if (err.code === 10003) {
        console.error('   Channel not found (unknown channel)');
      } else if (err.code === 50001) {
        console.error('   Missing access (bot cannot see this channel)');
      }
      process.exit(1);
    }
  });

  console.log('🔌 Connecting to Discord...\n');
  await client.login(token);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
