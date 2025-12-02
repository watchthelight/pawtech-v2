// SPDX-License-Identifier: LicenseRef-ANW-1.0

// This file aggregates all slash command definitions for bulk registration with Discord.
// The buildCommands() function returns JSON payloads that get PUT to Discord's API.
//
// GOTCHA: Discord caches slash commands aggressively. After adding/removing commands here,
// you need to re-register them. Global commands can take up to 1 hour to propagate.
// Guild commands update instantly - prefer guild-scoped commands during development.
//
// Each import pulls in a SlashCommandBuilder instance. We call .toJSON() to serialize
// them into the format Discord's REST API expects.

import { data as gateData, acceptData, rejectData, kickData, unclaimData } from "./gate.js";
import { data as healthData } from "./health.js";
import { data as updateData } from "./update.js";
import { data as configData } from "./config.js";
import { data as databaseData } from "./database.js";
import { modmailCommand, modmailContextMenu } from "../features/modmail.js";
import { analyticsData, analyticsExportData } from "./analytics.js";
import { data as modstatsData } from "./modstats.js";
import { data as sendData } from "./send.js";
import { data as resetdataData } from "./resetdata.js";
import { data as purgeData } from "./purge.js";
import { data as flagData } from "./flag.js";
import { data as sampleData } from "./sample.js";
import { data as listopenData } from "./listopen.js";
import { data as modhistoryData } from "./modhistory.js";
import { data as setNotifyConfigData } from "./review/setNotifyConfig.js";
import { data as getNotifyConfigData } from "./review/getNotifyConfig.js";
import { data as pokeData } from "./poke.js";
import { data as unblockData } from "./unblock.js";
import { data as activityData } from "./activity.js";
import { data as backfillData } from "./backfill.js";
import { data as reviewSetListopenOutputData } from "./review-set-listopen-output.js";
import { data as movieData } from "./movie.js";
import { data as rolesData } from "./roles.js";
import { data as panicData } from "./panic.js";
import { data as searchData } from "./search.js";
import { data as approvalRateData } from "./approvalRate.js";
import { data as artistqueueData } from "./artistqueue.js";
import { data as redeemrewardData } from "./redeemreward.js";
import { data as artData } from "./art.js";

// Returns an array of command JSON objects for Discord's bulk command registration.
// Discord has a limit of 100 slash commands per bot per guild, so we're fine here.
// If you hit that limit, consider using subcommands to consolidate related commands.
export function buildCommands() {
  return [
    // Gate workflow commands - these are the core moderation actions
    gateData.toJSON(),
    acceptData.toJSON(),
    rejectData.toJSON(),
    kickData.toJSON(),
    unclaimData.toJSON(),

    // System/admin commands
    healthData.toJSON(),
    updateData.toJSON(),
    configData.toJSON(),
    databaseData.toJSON(),

    // Feature commands
    modmailCommand.toJSON(),
    analyticsData.toJSON(),
    analyticsExportData.toJSON(),
    modstatsData.toJSON(),
    sendData.toJSON(),
    resetdataData.toJSON(),
    purgeData.toJSON(),
    flagData.toJSON(),
    sampleData.toJSON(),
    listopenData.toJSON(),
    modhistoryData.toJSON(),
    setNotifyConfigData.toJSON(),
    getNotifyConfigData.toJSON(),
    pokeData.toJSON(),
    unblockData.toJSON(),
    activityData.toJSON(),
    backfillData.toJSON(),
    reviewSetListopenOutputData.toJSON(),
    movieData.toJSON(),
    rolesData.toJSON(),
    panicData.toJSON(),
    searchData.toJSON(),
    approvalRateData.toJSON(),

    // Artist rotation commands
    artistqueueData.toJSON(),
    redeemrewardData.toJSON(),
    artData.toJSON(),

    // Context menu commands are registered alongside slash commands in Discord.js v14
    modmailContextMenu.toJSON(),
  ];
}
