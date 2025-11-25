// SPDX-License-Identifier: LicenseRef-ANW-1.0
import "dotenv/config";
import { REST, Routes, Client, GatewayIntentBits } from "discord.js";
import { formatCommandTree, summarizeGate } from "./commands.js";

async function main() {
  const appId = process.env.APP_ID || process.env.CLIENT_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!appId || !token) {
    console.error("Missing credentials:");
    console.error("  APP_ID/CLIENT_ID:", appId ? "SET" : "NOT SET");
    console.error("  DISCORD_TOKEN:", token ? "SET" : "NOT SET");
    throw new Error("APP_ID and DISCORD_TOKEN required");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  const guilds = await client.guilds.fetch();
  console.info(`[sync] found ${guilds.size} guilds`);

  for (const [gid] of guilds) {
    const commands = (await rest.get(Routes.applicationGuildCommands(appId, gid))) as any[];
    console.info(`[sync] guild ${gid} live commands:`);
    for (const line of formatCommandTree(commands)) {
      console.info(`  ${line}`);
    }
    const { options, welcomeSubs } = summarizeGate(commands);
    const optionList = options.length > 0 ? options.join(",") : "—";
    const welcomeList = welcomeSubs.length > 0 ? welcomeSubs.join(", ") : "—";
    console.info(
      `[sync] guild ${gid} live – /gate groups: ${optionList} … welcome subcommands: ${welcomeList}`
    );
  }

  await client.destroy();
}

const isMainModule =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMainModule) {
  main().catch((err) => {
    console.error("[sync] print failed", err);
    process.exit(1);
  });
}
