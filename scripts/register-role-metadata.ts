/**
 * Pawtropolis Tech — scripts/register-role-metadata.ts
 * WHAT: Registers Role Connection metadata schema with Discord.
 * WHY: Required one-time setup for Linked Roles feature.
 * USAGE: npm run linked-roles:register
 *
 * This defines what metadata fields your app tracks for users.
 * Discord uses these to determine if a user qualifies for a Linked Role.
 *
 * DOCS: https://discord.com/developers/docs/tutorials/configuring-app-metadata-for-linked-roles
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { REST } from "discord.js";
import dotenv from "dotenv";
import path from "node:path";

// Load environment
dotenv.config({ path: path.join(process.cwd(), ".env") });

const CLIENT_ID = process.env.CLIENT_ID?.trim();
const DISCORD_TOKEN = process.env.DISCORD_TOKEN?.trim();

if (!CLIENT_ID || !DISCORD_TOKEN) {
  console.error("Missing CLIENT_ID or DISCORD_TOKEN in .env");
  process.exit(1);
}

/**
 * Role Connection Metadata Types:
 * 1 = INTEGER_LESS_THAN_OR_EQUAL
 * 2 = INTEGER_GREATER_THAN_OR_EQUAL
 * 3 = INTEGER_EQUAL
 * 4 = INTEGER_NOT_EQUAL
 * 5 = DATETIME_LESS_THAN_OR_EQUAL
 * 6 = DATETIME_GREATER_THAN_OR_EQUAL
 * 7 = BOOLEAN_EQUAL
 * 8 = BOOLEAN_NOT_EQUAL
 */
const metadata = [
  {
    type: 7, // BOOLEAN_EQUAL
    key: "is_developer",
    name: "Server Developer",
    description: "Verified developer of this server",
  },
];

async function registerMetadata() {
  console.log("Registering Role Connection metadata...");
  console.log("Application ID:", CLIENT_ID);
  console.log("Metadata schema:", JSON.stringify(metadata, null, 2));

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    // PUT /applications/{app.id}/role-connections/metadata
    const result = await rest.put(`/applications/${CLIENT_ID}/role-connections/metadata`, {
      body: metadata,
    });

    console.log("\nSuccess! Registered metadata:");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n=== NEXT STEPS ===");
    console.log("1. Go to Discord Developer Portal → Your App → Linked Roles");
    console.log("2. You should see 'Server Developer' metadata listed");
    console.log("3. In your Discord server:");
    console.log("   - Go to Server Settings → Roles → Safety Third");
    console.log("   - Click 'Links' tab");
    console.log("   - Click 'Add requirement' → Select your app");
    console.log("   - Set condition: 'Server Developer' = true");
    console.log("4. Run the OAuth2 server: npm run linked-roles:server");
    console.log("5. Visit http://localhost:3001/linked-roles to authorize");
  } catch (err) {
    console.error("Failed to register metadata:", err);
    process.exit(1);
  }
}

registerMetadata();
