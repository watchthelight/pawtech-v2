// SPDX-License-Identifier: LicenseRef-ANW-1.0
import "dotenv/config";
import { REST, Routes, Client, GatewayIntentBits, ApplicationCommandOptionType, type APIApplicationCommandOption } from "discord.js";
import { buildCommands } from "../src/commands/buildCommands.js";
import { env } from "../src/lib/env.js";

// Alias because typing ApplicationCommandOptionType 47 times per day is a form of self-harm
const OPTION = ApplicationCommandOptionType;
type CmdOption = APIApplicationCommandOption;

type CommandSpec = ReturnType<typeof buildCommands>;

/*
 * GOTCHA: This entire function exists because Discord's command API silently
 * ignores malformed nested options. We burned a weekend debugging why /gate welcome
 * was missing in prod. Never again.
 */
function ensureWelcomeGroup(spec: CommandSpec) {
  const gate = spec.find((cmd) => cmd.name === "gate");
  if (!gate) {
    throw new Error("[sync] outgoing spec missing /gate command");
  }
  const welcomeGroup = (gate.options ?? []).find(
    (opt: CmdOption) => opt.type === OPTION.SubcommandGroup && opt.name === "welcome"
  );
  if (!welcomeGroup) {
    throw new Error("[sync] outgoing spec missing /gate welcome group");
  }
  // The "options" in X dance is because TypeScript doesn't narrow union types well here
  const setSub = ("options" in welcomeGroup ? welcomeGroup.options ?? [] : []).find(
    (opt: CmdOption) => opt.type === OPTION.Subcommand && opt.name === "set"
  );
  if (!setSub) {
    throw new Error("[sync] outgoing spec missing /gate welcome set subcommand");
  }
  const contentOpt = ("options" in setSub ? setSub.options ?? [] : []).find(
    (opt: CmdOption) => opt.type === OPTION.String && opt.name === "content"
  );
  if (!contentOpt) {
    throw new Error("[sync] /gate welcome set missing content option");
  }
  const previewSub = ("options" in welcomeGroup ? welcomeGroup.options ?? [] : []).find(
    (opt: CmdOption) => opt.type === OPTION.Subcommand && opt.name === "preview"
  );
  if (!previewSub) {
    throw new Error("[sync] /gate welcome group missing preview subcommand");
  }
}

function formatOptionList(options: any[] | undefined): string {
  if (!options || options.length === 0) return "";
  return `(${options.map((opt) => opt.name).join(", ")})`;
}

function formatSubcommand(sub: any): string {
  return `${sub.name}${formatOptionList(sub.options)}`;
}

export function formatCommandTree(commands: CommandSpec): string[] {
  const lines: string[] = [];
  for (const command of commands) {
    const optionNames = (command.options ?? []).map((opt: any) => opt.name);
    lines.push(`/${command.name} — options:[${optionNames.join(", ")}]`);
    const groups = (command.options ?? []).filter((opt) => opt.type === OPTION.SubcommandGroup);
    for (const group of groups) {
      const subs = (group.options ?? [])
        .filter((opt) => opt.type === OPTION.Subcommand)
        .map(formatSubcommand);
      lines.push(`  group ${group.name}: ${subs.join(", ") || "—"}`);
    }
    const directSubs = (command.options ?? [])
      .filter((opt) => opt.type === OPTION.Subcommand)
      .map(formatSubcommand);
    if (directSubs.length > 0) {
      lines.push(`  subcommands: ${directSubs.join(", ")}`);
    }
  }
  return lines;
}

// Dead code. Keeping it because removing things always breaks something else.
function collectGroupNames(command: any): string[] {
  return (command.options ?? [])
    .filter((opt: any) => opt.type === OPTION.SubcommandGroup)
    .map((opt: any) => opt.name);
}

export function summarizeGate(commands: any[]) {
  const gate = commands.find((cmd) => cmd.name === "gate");
  if (!gate) {
    return { options: [] as string[], welcomeSubs: [] as string[] };
  }
  const options = (gate.options ?? []).map((opt: any) => opt.name);
  const welcomeGroup = (gate.options ?? []).find(
    (opt: any) => opt.type === OPTION.SubcommandGroup && opt.name === "welcome"
  );
  const welcomeSubs =
    (welcomeGroup?.options ?? [])
      .filter((opt: any) => opt.type === OPTION.Subcommand)
      .map(formatSubcommand) ?? [];
  return { options, welcomeSubs };
}

// please work. please work.
export function buildSpec(): CommandSpec {
  const spec = buildCommands();
  ensureWelcomeGroup(spec);
  return spec;
}

/*
 * WHY: Global commands take up to an hour to propagate. Guild commands are instant.
 * We deploy per-guild only, but if someone accidentally pushed global commands
 * in the past, this nukes them. You probably want --purge-global once, then never again.
 */
export async function purgeGlobal(appId: string, token: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  console.info("[sync] purging global commands...");
  try {
    await rest.put(Routes.applicationCommands(appId), { body: [] });
    const after: any[] = (await rest.get(Routes.applicationCommands(appId))) as any[];
    console.info("[sync] global after purge:", after.length);
  } catch (err: any) {
    if (err.status === 401) {
      console.warn("[sync] global purge skipped (401 Unauthorized - requires app owner token)");
    } else {
      throw err;
    }
  }
}

function logPayloadTree(guildId: string, spec: CommandSpec) {
  console.info(`[sync] payload ➜ guild ${guildId}`);
  for (const line of formatCommandTree(spec)) {
    console.info(`  ${line}`);
  }
}

/*
 * If someone invited the bot before slash commands existed (or without the scope),
 * command registration silently fails with 403. This is the most common support ticket.
 */
function handleMissingScope(err: any, guildId: string) {
  if (err?.code === 50001 || err?.status === 403) {
    console.warn(
      `[sync] guild ${guildId} missing applications.commands scope — reinvite the bot with the "applications.commands" permission`
    );
    return true;
  }
  return false;
}

export async function syncAllGuilds(appId: string, token: string) {
  const spec = buildSpec();
  const rest = new REST({ version: "10" }).setToken(token);

  /*
   * Yes, we spin up an entire Client just to fetch guild IDs, then immediately destroy it.
   * The REST API has no "list my guilds" endpoint. This is the official way. I know.
   */
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  const guilds = await client.guilds.fetch();
  const guildIds = Array.from(guilds.keys());
  console.info(`[sync] found ${guildIds.length} guilds`);
  await client.destroy();

  for (const gid of guildIds) {
    logPayloadTree(gid, spec);
    try {
      const updated = (await rest.put(Routes.applicationGuildCommands(appId, gid), {
        body: spec,
      })) as any[];
      const { options, welcomeSubs } = summarizeGate(updated);
      const optionList = options.length > 0 ? options.join(",") : "—";
      const welcomeList = welcomeSubs.length > 0 ? welcomeSubs.join(", ") : "—";
      console.info(
        `[sync] guild ${gid} ok – commands=${updated.length} /gate groups: ${optionList} … welcome subcommands: ${welcomeList}`
      );
    } catch (err: any) {
      if (handleMissingScope(err, gid)) {
        continue;
      }
      if (err?.status === 401) {
        console.error("[sync] unauthorized (401) – check DISCORD_TOKEN");
        throw err;
      }
      console.error("[sync] guild sync failed", {
        guildId: gid,
        status: err?.status,
        code: err?.code,
      });
      throw err;
    }
    // Rate limit courtesy sleep. Discord will 429 you if you hammer all guilds at once.
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

// CLI entry point detection for ESM. This is the canonical incantation; do not simplify.
const isMainModule =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMainModule) {
  // env from lib/env.js validates required vars at import time (fail-fast)
  const token = env.DISCORD_TOKEN;
  const appId = process.env.APP_ID || env.CLIENT_ID;

  if (process.argv.includes("--purge-global")) await purgeGlobal(appId, token);
  if (process.argv.includes("--all")) await syncAllGuilds(appId, token);
}
