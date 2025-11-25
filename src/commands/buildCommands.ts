// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { data as gateData, acceptData, rejectData, kickData, unclaimData } from "./gate.js";
import { data as healthData } from "./health.js";
import { data as updateData } from "./update.js";
import { data as configData } from "./config.js";
import { data as databaseData } from "./database.js";
import { modmailCommand } from "../features/modmail.js";
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
import { data as statusupdateData } from "./statusupdate.js";
import { data as reviewSetListopenOutputData } from "./review-set-listopen-output.js";

export function buildCommands() {
  return [
    gateData.toJSON(),
    acceptData.toJSON(),
    rejectData.toJSON(),
    kickData.toJSON(),
    unclaimData.toJSON(),
    healthData.toJSON(),
    updateData.toJSON(),
    configData.toJSON(),
    databaseData.toJSON(),
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
    statusupdateData.toJSON(),
    reviewSetListopenOutputData.toJSON(),
    // Note: Context menu commands would be registered separately via a different API endpoint
    // modmailContextMenu.toJSON(),
  ];
}
