/**
 * Pawtropolis Tech — scripts/deploy-commands.ts
 * WHAT: CLI helper to bulk overwrite guild commands and verify presence of expected options.
 * WHY: Faster iteration on guild-scoped commands without waiting on global propagation.
 * FLOWS: build commands → login lightweight client to list guilds → REST PUT per guild → verify
 * DOCS:
 *  - REST client / Routes: https://discord.js.org/#/docs/rest/main/class/REST
 *  - Bulk overwrite guild commands: https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-guild-application-commands
 *  - Node ESM: https://nodejs.org/api/esm.html
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import "dotenv/config";
import { REST, Routes, Client, GatewayIntentBits } from "discord.js";
import { buildSpec } from "./commands.js";

// please work. please work.
export function buildCommands() {
  /**
   * buildCommands
   * WHAT: Returns the outgoing JSON spec from local builders.
   * THROWS: Never.
   */
  return buildSpec();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SyncResult = {
  guildId: string;
  ok: boolean;
  opts?: string[];
  error?: string;
  status?: number;
};

// early return; future me says thanks
async function verifyGuildCommands(
  rest: REST,
  appId: string,
  guildId: string
): Promise<{ ok: boolean; opts?: string[]; error?: string; status?: number }> {
  try {
    const existing = (await rest.get(Routes.applicationGuildCommands(appId, guildId))) as any[];

    const gateCmd = existing.find((cmd: any) => cmd.name === "gate");
    if (!gateCmd) {
      return { ok: false, error: "gate command not found" };
    }

    const setupSub = gateCmd.options?.find((o: any) => o.name === "setup");
    if (!setupSub) {
      return { ok: false, error: "setup subcommand not found" };
    }

    const opts = setupSub.options?.map((o: any) => o.name) || [];
    const expected = [
      "review_channel",
      "gate_channel",
      "general_channel",
      "unverified_channel",
      "accepted_role",
      "reviewer_role",
    ];

    const hasAll = expected.every((e) => opts.includes(e));
    if (!hasAll) {
      return { ok: false, opts, error: "missing expected options" };
    }

    return { ok: true, opts };
  } catch (err: any) {
    return { ok: false, error: err.message, status: err.status };
  }
}

async function syncGuild(
  rest: REST,
  appId: string,
  guildId: string,
  commands: any[]
): Promise<SyncResult> {
  try {
    // zero or once. never twice.
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });

    const verify = await verifyGuildCommands(rest, appId, guildId);
    if (!verify.ok) {
      // one more try: delete + re-PUT
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
      await wait(500);
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });

      const verify2 = await verifyGuildCommands(rest, appId, guildId);
      return {
        guildId,
        ok: verify2.ok,
        opts: verify2.opts,
        error: verify2.error,
        status: verify2.status,
      };
    }

    return { guildId, ok: true, opts: verify.opts };
  } catch (err: any) {
    return {
      guildId,
      ok: false,
      error: err.message || "unknown error",
      status: err.status,
    };
  }
}

export async function syncAllGuilds(appId: string, token: string): Promise<void> {
  /**
   * syncAllGuilds
   * WHAT: Bulk overwrites commands for every guild the app is in.
   * PITFALLS: Requires applications.commands scope; otherwise expect 403/50001.
   */
  const rest = new REST({ version: "10" }).setToken(token);
  const commands = buildCommands();

  console.log("[sync] fetching guilds...");

  // tiny helper, big juicey
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);

  const guilds = await client.guilds.fetch();
  const guildIds = Array.from(guilds.keys());

  console.log(`[sync] found ${guildIds.length} guilds`);

  await client.destroy();

  const results: SyncResult[] = [];

  for (const guildId of guildIds) {
    const result = await syncGuild(rest, appId, guildId, commands);
    results.push(result);

    if (result.ok) {
      console.log(JSON.stringify({ guildId, ok: true, opts: result.opts }));
    } else {
      console.error(
        JSON.stringify({
          guildId,
          ok: false,
          error: result.error,
          status: result.status,
        })
      );
    }

    await wait(750);
  }

  const synced = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(`[sync] summary: total=${guildIds.length}, synced=${synced}, failed=${failed}`);

  if (failed > 0) {
    console.error("[sync] some guilds failed to sync");
    process.exit(1);
  }

  console.log("[sync] all guilds synced successfully");
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const appId = process.env.APP_ID || process.env.CLIENT_ID;
  const token = process.env.DISCORD_TOKEN;

  if (!appId || !token) {
    console.error("APP_ID (or CLIENT_ID) and DISCORD_TOKEN required");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.includes("--all")) {
    await syncAllGuilds(appId, token);
  } else {
    console.error("Usage: node scripts/deploy-commands.js --all");
    process.exit(1);
  }
}
