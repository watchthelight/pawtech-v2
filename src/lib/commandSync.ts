/**
 * Pawtropolis Tech — src/lib/commandSync.ts
 * WHAT: In-process guild command sync using REST, performed after client ready.
 * WHY: Guild-scoped commands update fast (<1m) and are safer during iteration than global commands.
 * FLOWS:
 *  - Build outgoing spec → assert structure → PUT bulk overwrite per guild → log summary
 * DOCS:
 *  - REST client / Routes: https://discord.js.org/#/docs/rest/main/class/REST
 *  - Bulk overwrite guild commands: https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-guild-application-commands
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  REST,
  Routes,
  Client,
  ApplicationCommandOptionType,
  type APIApplicationCommandOption,
} from "discord.js";
import { buildCommands } from "../commands/buildCommands.js";
import { logger } from "./logger.js";

const OPTION = ApplicationCommandOptionType;
type CmdOption = APIApplicationCommandOption;

type CommandSpec = ReturnType<typeof buildCommands>;

/**
 * Build-time assertion that the command spec hasn't drifted from expected structure.
 * This catches refactoring mistakes before they hit production - e.g., someone
 * renames "welcome" to "greeting" but forgets to update dependent code.
 *
 * Throws hard errors because a malformed spec means the bot is fundamentally broken.
 */
function ensureWelcomeGroup(spec: CommandSpec) {
  const gate = spec.find((cmd) => cmd.name === "gate");
  if (!gate) throw new Error("[sync] outgoing spec missing /gate command");
  const welcome = (gate.options ?? []).find(
    (opt: CmdOption) => opt.type === OPTION.SubcommandGroup && opt.name === "welcome"
  );
  if (!welcome) throw new Error("[sync] outgoing spec missing /gate welcome group");
  const set = ("options" in welcome ? welcome.options ?? [] : []).find(
    (opt: CmdOption) => opt.type === OPTION.Subcommand && opt.name === "set"
  );
  if (!set) throw new Error("[sync] /gate welcome.group missing set subcommand");
  const content = ("options" in set ? set.options ?? [] : []).find(
    (opt: CmdOption) => opt.type === OPTION.String && opt.name === "content"
  );
  if (!content) throw new Error("[sync] /gate welcome set missing content option");
  const preview = ("options" in welcome ? welcome.options ?? [] : []).find(
    (opt: CmdOption) => opt.type === OPTION.Subcommand && opt.name === "preview"
  );
  if (!preview) throw new Error("[sync] /gate welcome group missing preview subcommand");
}

function formatSubcommand(sub: any): string {
  const opts = (sub.options ?? []).map((opt: any) => opt.name);
  return opts.length > 0 ? `${sub.name}(${opts.join(", ")})` : sub.name;
}

function summarizeGate(commands: any[]) {
  const gate = commands.find((cmd) => cmd.name === "gate");
  if (!gate) {
    return { options: [] as string[], welcomeSubs: [] as string[] };
  }
  const options = (gate.options ?? []).map((opt: any) => opt.name);
  const welcome = (gate.options ?? []).find(
    (opt: any) => opt.type === OPTION.SubcommandGroup && opt.name === "welcome"
  );
  const welcomeSubs =
    (welcome?.options ?? [])
      .filter((opt: any) => opt.type === OPTION.Subcommand)
      .map(formatSubcommand) ?? [];
  return { options, welcomeSubs };
}

/**
 * Check if error is the classic "bot was invited without slash command scope" problem.
 * Discord returns 50001 (Missing Access) or 403 when the bot can't register commands.
 * This is recoverable by reinviting - not worth crashing over.
 */
function handleMissingScope(err: any, guildId: string) {
  if (err?.code === 50001 || err?.status === 403) {
    logger.warn(
      `[sync] guild ${guildId} missing applications.commands scope — reinvite the bot with the \"applications.commands\" permission`
    );
    return true;
  }
  return false;
}

export async function syncGuildCommandsInProcess(client: Client) {
  /**
   * syncGuildCommandsInProcess
   * WHAT: Bulk overwrites application commands for every guild the bot is in.
   * WHY: Avoids global propagation delays; keeps dev/prod in sync without restarting.
   * RETURNS: Promise<void>; logs per-guild outcomes.
   * PITFALLS: Requires applications.commands scope; otherwise 403/50001.
   */
  const appId = client.application?.id;
  const token = process.env.DISCORD_TOKEN;

  if (!appId || !token) {
    logger.warn("[sync] missing appId or token, skipping command sync");
    return;
  }

  const spec = buildCommands();
  ensureWelcomeGroup(spec);

  // Using REST directly rather than client.application.commands because
  // we need fine-grained control over per-guild registration and error handling.
  const rest = new REST({ version: "10" }).setToken(token);
  const guilds = await client.guilds.fetch();
  logger.info(`[sync] found ${guilds.size} guilds`);

  for (const [gid] of guilds) {
    try {
      // PUT bulk overwrite replaces ALL commands for this guild atomically.
      // This is safer than incremental add/remove which can leave stale commands.
      // Downside: if spec is malformed, all commands vanish. ensureWelcomeGroup guards this.
      const updated = (await rest.put(Routes.applicationGuildCommands(appId, gid), {
        body: spec,
      })) as any[];
      const { options, welcomeSubs } = summarizeGate(updated);
      const optionList = options.length > 0 ? options.join(",") : "—";
      const welcomeList = welcomeSubs.length > 0 ? welcomeSubs.join(", ") : "—";
      logger.info(
        `[sync] guild ${gid} ok – commands=${updated.length} /gate groups: ${optionList} … welcome subcommands: ${welcomeList}`
      );
    } catch (err: any) {
      if (handleMissingScope(err, gid)) {
        continue;
      }
      logger.error(
        {
          guildId: gid,
          status: err?.status,
          code: err?.code,
        },
        "[sync] guild command sync failed"
      );
    }
    // Rate limit buffer. Discord's rate limit for bulk command updates is
    // relatively generous, but hammering 50 guilds in rapid succession will
    // hit it. 650ms is conservative; could probably go lower with proper
    // rate limit header parsing, but this is startup-only code so who cares.
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
}
