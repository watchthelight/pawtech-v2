import "dotenv/config";
import { REST, Routes } from "discord.js";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
const appId = process.env.CLIENT_ID || process.env.APP_ID;
const guildId = process.env.GUILD_ID || process.env.TEST_GUILD_ID;

if (!appId || !guildId) {
  console.error("CLIENT_ID and GUILD_ID required");
  process.exit(1);
}

const cmds = await rest.get(Routes.applicationGuildCommands(appId, guildId));
const gate = cmds.find((c) => c.name === "gate");
const setup = gate?.options?.find((o) => o.name === "setup");

console.log("\n=== /gate setup options ===");
console.log(setup?.options?.map((o) => o.name) || []);
console.log("\nHas unverified_channel?", setup?.options?.some((o) => o.name === "unverified_channel"));
console.log("\nExpected: review_channel, gate_channel, general_channel, accepted_role, reviewer_role");
