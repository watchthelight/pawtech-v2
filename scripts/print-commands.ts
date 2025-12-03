// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Debug script to dump all registered slash commands per guild.
 * Useful when Discord's command sync is being weird (read: always).
 * Run this when commands mysteriously vanish or duplicate themselves.
 */
import "dotenv/config";
import { REST, Routes, Client, GatewayIntentBits } from "discord.js";
import { formatCommandTree, summarizeGate } from "./commands.js";

async function main() {
  // WHY both? Because I renamed the var once and broke prod. Never again.
  const appId = process.env.APP_ID || process.env.CLIENT_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!appId || !token) {
    console.error("Missing credentials:");
    console.error("  APP_ID/CLIENT_ID:", appId ? "SET" : "NOT SET");
    console.error("  DISCORD_TOKEN:", token ? "SET" : "NOT SET");
    throw new Error("APP_ID and DISCORD_TOKEN required");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  /*
   * GOTCHA: We need a full client login just to list guilds.
   * The REST API alone can't enumerate guilds the bot is in.
   * Yes, this is annoying. No, there's no better way.
   */
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  const guilds = await client.guilds.fetch();
  console.info(`[sync] found ${guilds.size} guilds`);

  for (const [gid] of guilds) {
    // The `as any[]` is shameful but Discord's types are a moving target
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

  // Clean up or the process hangs forever. Ask me how I know.
  await client.destroy();
}

/*
 * ESM "am I the main module?" check. This replaces the old require.main === module.
 * The backslash replacement handles Windows paths. We support Windows in theory.
 * In practice, nobody runs this on Windows and if they do, that's their problem.
 */
const isMainModule =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMainModule) {
  main().catch((err) => {
    console.error("[sync] print failed", err);
    process.exit(1);
  });
}
