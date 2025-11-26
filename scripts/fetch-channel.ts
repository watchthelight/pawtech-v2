/**
 * Fetch messages from a Discord channel and save to a file
 * Usage: npx dotenvx run -- tsx scripts/fetch-channel.ts <channel_id> [output_file]
 */

import { Client, GatewayIntentBits, TextChannel, ChannelType, ForumChannel, ThreadChannel } from "discord.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const channelId = process.argv[2];
const outputFile = process.argv[3] || `docs/channel-${channelId}.md`;

if (!channelId) {
  console.error("Usage: npx dotenvx run -- tsx scripts/fetch-channel.ts <channel_id> [output_file]");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function fetchMessagesFromChannel(channel: TextChannel | ThreadChannel): Promise<string[]> {
  const messages: string[] = [];
  let lastId: string | undefined;
  let fetchedCount = 0;

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });

    if (fetched.size === 0) break;

    fetchedCount += fetched.size;

    const sorted = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const msg of sorted) {
      const timestamp = msg.createdAt.toISOString();
      const author = msg.author.tag;
      const content = msg.content || "(no text content)";

      let entry = `### ${author} - ${timestamp}\n\n${content}`;

      if (msg.embeds.length > 0) {
        for (const embed of msg.embeds) {
          entry += "\n\n**[Embed]**";
          if (embed.title) entry += `\n**Title:** ${embed.title}`;
          if (embed.description) entry += `\n${embed.description}`;
          if (embed.fields.length > 0) {
            for (const field of embed.fields) {
              entry += `\n**${field.name}:** ${field.value}`;
            }
          }
        }
      }

      if (msg.attachments.size > 0) {
        entry += "\n\n**Attachments:**";
        for (const [, att] of msg.attachments) {
          entry += `\n- ${att.name}: ${att.url}`;
        }
      }

      messages.unshift(entry);
    }

    lastId = fetched.last()?.id;

    if (fetchedCount >= 200) break;
  }

  messages.reverse();
  return messages;
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  try {
    const channel = await client.channels.fetch(channelId);

    if (!channel) {
      console.error(`Channel ${channelId} not found`);
      process.exit(1);
    }

    // Handle forum channels
    if (channel.type === ChannelType.GuildForum) {
      const forum = channel as ForumChannel;
      console.log(`Fetching threads from forum #${forum.name}...`);

      // Fetch all threads (active and archived)
      const activeThreads = await forum.threads.fetchActive();
      const archivedThreads = await forum.threads.fetchArchived();

      const allThreads = [
        ...activeThreads.threads.values(),
        ...archivedThreads.threads.values(),
      ];

      console.log(`Found ${allThreads.length} threads`);

      const threadContents: string[] = [];

      for (const thread of allThreads) {
        console.log(`  Reading thread: ${thread.name}`);
        const threadMessages = await fetchMessagesFromChannel(thread);
        threadContents.push(`# Thread: ${thread.name}\n\nCreated: ${thread.createdAt?.toISOString()}\n\n${threadMessages.join("\n\n---\n\n")}`);
      }

      const output = `# Forum: #${forum.name}

Channel ID: ${channelId}
Guild: ${forum.guild.name}
Fetched: ${new Date().toISOString()}
Total threads: ${allThreads.length}

---

${threadContents.join("\n\n===\n\n")}
`;

      const outputPath = join(process.cwd(), outputFile);
      writeFileSync(outputPath, output);
      console.log(`\nSaved forum content to ${outputFile}`);
      client.destroy();
      process.exit(0);
    }

    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      console.error(`Channel is not a text channel (type: ${channel.type})`);
      process.exit(1);
    }

    const textChannel = channel as TextChannel;
    console.log(`Fetching messages from #${textChannel.name}...`);

    // Fetch messages (up to 100 at a time, we'll get more if needed)
    const messages: string[] = [];
    let lastId: string | undefined;
    let fetchedCount = 0;

    while (true) {
      const fetched = await textChannel.messages.fetch({
        limit: 100,
        ...(lastId ? { before: lastId } : {}),
      });

      if (fetched.size === 0) break;

      fetchedCount += fetched.size;
      console.log(`  Fetched ${fetchedCount} messages...`);

      // Sort by timestamp (oldest first for this batch, we'll reverse at the end)
      const sorted = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      for (const msg of sorted) {
        const timestamp = msg.createdAt.toISOString();
        const author = msg.author.tag;
        const content = msg.content || "(no text content)";

        let entry = `## ${author} - ${timestamp}\n\n${content}`;

        // Include embeds if any
        if (msg.embeds.length > 0) {
          for (const embed of msg.embeds) {
            entry += "\n\n**[Embed]**";
            if (embed.title) entry += `\n**Title:** ${embed.title}`;
            if (embed.description) entry += `\n${embed.description}`;
            if (embed.fields.length > 0) {
              for (const field of embed.fields) {
                entry += `\n**${field.name}:** ${field.value}`;
              }
            }
          }
        }

        // Note attachments
        if (msg.attachments.size > 0) {
          entry += "\n\n**Attachments:**";
          for (const [, att] of msg.attachments) {
            entry += `\n- ${att.name}: ${att.url}`;
          }
        }

        messages.unshift(entry); // Add to beginning (we're going backwards)
      }

      lastId = fetched.last()?.id;

      // Safety limit
      if (fetchedCount >= 500) {
        console.log("  Reached 500 message limit");
        break;
      }
    }

    // Reverse to get chronological order
    messages.reverse();

    // Build output
    const output = `# Channel: #${textChannel.name}

Channel ID: ${channelId}
Guild: ${textChannel.guild.name}
Fetched: ${new Date().toISOString()}
Total messages: ${messages.length}

---

${messages.join("\n\n---\n\n")}
`;

    const outputPath = join(process.cwd(), outputFile);
    writeFileSync(outputPath, output);
    console.log(`\nSaved ${messages.length} messages to ${outputFile}`);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.DISCORD_TOKEN);
