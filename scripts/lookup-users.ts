/**
 * Look up Discord user IDs by username in a guild
 * Usage: npx dotenvx run -- tsx scripts/lookup-users.ts <guild_id> <username1> [username2] ...
 */

import { Client, GatewayIntentBits } from "discord.js";

const guildId = process.argv[2];
const usernames = process.argv.slice(3);

if (!guildId || usernames.length === 0) {
  console.error("Usage: npx dotenvx run -- tsx scripts/lookup-users.ts <guild_id> <username1> [username2] ...");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}\n`);

  try {
    const guild = await client.guilds.fetch(guildId);
    console.log(`Searching in ${guild.name}...\n`);

    // Fetch all members (required for username search)
    console.log("Fetching members...");
    const members = await guild.members.fetch();
    console.log(`Loaded ${members.size} members\n`);

    console.log("Results:");
    console.log("=".repeat(60));

    for (const username of usernames) {
      const member = members.find(
        (m) => m.user.username.toLowerCase() === username.toLowerCase()
      );

      if (member) {
        console.log(`✅ ${username}`);
        console.log(`   User ID: ${member.id}`);
        console.log(`   Display: ${member.displayName}`);
        console.log(`   Tag: ${member.user.tag}`);
      } else {
        console.log(`❌ ${username} - NOT FOUND`);
      }
      console.log("");
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.DISCORD_TOKEN);
