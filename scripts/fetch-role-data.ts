// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Fetch role data for role automation planning
 * Usage: npx tsx scripts/fetch-role-data.ts
 */
import "dotenv/config";
import { Client, GatewayIntentBits, Role } from "discord.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}
if (!GUILD_ID) {
  console.error("Missing GUILD_ID");
  process.exit(1);
}

// Role names we're looking for (partial matches)
const ROLE_SEARCHES = {
  // Level roles
  level: [
    "Newcomer Fur",
    "Beginner Fur",
    "Chatty Fur",
    "Engaged Fur",
    "Active Fur",
    "Known Fur",
    "Noble Fur",
    "Veteran Fur",
    "Elite Fur",
    "Legendary Fur",
    "Mythic Fur",
    "Eternal Fur",
  ],
  // Movie night tiers
  movie_night: [
    "Red Carpet Guest",
    "Popcorn Club",
    "Director's Cut",
    "Cinematic Royalty",
  ],
  // Byte tokens
  byte_token: [
    "Byte Token",
    "AllByte Token",
  ],
  // Activity rewards
  activity_reward: [
    "Fur of the Week",
    "Chatter Fox",
  ],
  // Reward items
  reward_items: [
    "OC Headshot Ticket",
  ],
};

function roleToJson(role: Role) {
  return {
    id: role.id,
    name: role.name,
    position: role.position,
    color: role.color,
    colorHex: role.hexColor,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    permissions: role.permissions.bitfield.toString(),
  };
}

async function main() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  console.log("Connecting to Discord...");

  await client.login(DISCORD_TOKEN);

  console.log(`Logged in as ${client.user?.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID!);
  console.log(`Fetched guild: ${guild.name}`);

  // Fetch all roles
  const roles = await guild.roles.fetch();
  console.log(`Found ${roles.size} total roles\n`);

  const results: Record<string, Record<string, any>> = {};
  const notFound: string[] = [];

  // Search for each category
  for (const [category, searchTerms] of Object.entries(ROLE_SEARCHES)) {
    results[category] = {};

    for (const search of searchTerms) {
      const found = roles.filter((r) =>
        r.name.toLowerCase().includes(search.toLowerCase())
      );

      if (found.size === 0) {
        notFound.push(search);
      } else {
        // Add all matches (there might be multiple Byte Token roles)
        found.forEach((role) => {
          results[category][role.name] = roleToJson(role);
        });
      }
    }
  }

  // Output results
  console.log("=".repeat(60));
  console.log("FOUND ROLES");
  console.log("=".repeat(60));
  console.log(JSON.stringify(results, null, 2));

  if (notFound.length > 0) {
    console.log("\n" + "=".repeat(60));
    console.log("NOT FOUND (may have different names)");
    console.log("=".repeat(60));
    notFound.forEach((name) => console.log(`  - ${name}`));
  }

  // Also output a flat list sorted by position for hierarchy reference
  console.log("\n" + "=".repeat(60));
  console.log("ALL ROLES BY POSITION (for hierarchy reference)");
  console.log("=".repeat(60));

  const sortedRoles = [...roles.values()].sort((a, b) => b.position - a.position);
  for (const role of sortedRoles) {
    console.log(`[${role.position.toString().padStart(3)}] ${role.name} (${role.id})`);
  }

  await client.destroy();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
