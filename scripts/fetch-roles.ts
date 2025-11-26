/**
 * Fetch all roles from a guild and save to a file
 * Usage: npx dotenvx run -- tsx scripts/fetch-roles.ts <guild_id> [output_file]
 */

import { Client, GatewayIntentBits } from "discord.js";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const guildId = process.argv[2];
const outputFile = process.argv[3] || `docs/ROLES.md`;

if (!guildId) {
  console.error("Usage: npx dotenvx run -- tsx scripts/fetch-roles.ts <guild_id> [output_file]");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  try {
    const guild = await client.guilds.fetch(guildId);
    console.log(`Fetching roles from ${guild.name}...`);

    const roles = await guild.roles.fetch();
    console.log(`Found ${roles.size} roles`);

    // Sort roles by position (highest first)
    const sortedRoles = [...roles.values()].sort((a, b) => b.position - a.position);

    // Build role mapping
    const roleLines: string[] = [];
    const roleMap: Record<string, string> = {};

    for (const role of sortedRoles) {
      roleMap[role.id] = role.name;
      const colorHex = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'default';
      roleLines.push(`| ${role.id} | ${role.name} | ${colorHex} | ${role.position} |`);
    }

    // Also extract role IDs from SERVER_STRUCTURE.md and map them
    let extractedRoles: string[] = [];
    try {
      const serverStructure = readFileSync(join(process.cwd(), "docs/SERVER_STRUCTURE.md"), "utf-8");
      const roleIdMatches = serverStructure.match(/<@&(\d+)>/g) || [];
      const uniqueIds = [...new Set(roleIdMatches.map(m => m.match(/\d+/)?.[0]).filter(Boolean))];

      console.log(`\nFound ${uniqueIds.length} unique role IDs in SERVER_STRUCTURE.md`);

      extractedRoles = uniqueIds.map(id => {
        const role = roles.get(id!);
        return `| ${id} | ${role?.name || '❌ NOT FOUND'} |`;
      });
    } catch {
      console.log("Could not read SERVER_STRUCTURE.md");
    }

    const output = `# Roles for ${guild.name}

Guild ID: ${guildId}
Fetched: ${new Date().toISOString()}
Total roles: ${roles.size}

---

## Role IDs Referenced in Server Structure

These are the roles mentioned in the server-info forum:

| Role ID | Role Name |
|---------|-----------|
${extractedRoles.join("\n")}

---

## All Server Roles

| Role ID | Role Name | Color | Position |
|---------|-----------|-------|----------|
${roleLines.join("\n")}
`;

    const outputPath = join(process.cwd(), outputFile);
    writeFileSync(outputPath, output);
    console.log(`\nSaved to ${outputFile}`);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.DISCORD_TOKEN);
