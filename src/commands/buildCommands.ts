// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { data as gateData, acceptData, rejectData, kickData, unclaimData } from "./gate.js";
import { data as healthData } from "./health.js";
import { data as statusupdateData } from "./statusupdate.js";
import { data as configData } from "./config.js";
import { data as databaseData } from "./database.js";
import { modmailCommand } from "../features/modmail.js";
import { analyticsData, analyticsExportData } from "./analytics.js";
import { data as modstatsData } from "./modstats.js";
import { data as sendData } from "./send.js";
import { data as resetdataData } from "./resetdata.js";
import { data as flagData } from "./flag.js";
import { data as sampleData } from "./sample.js";

export function buildCommands() {
  return [
    gateData.toJSON(),
    acceptData.toJSON(),
    rejectData.toJSON(),
    kickData.toJSON(),
    unclaimData.toJSON(),
    healthData.toJSON(),
    statusupdateData.toJSON(),
    configData.toJSON(),
    databaseData.toJSON(),
    modmailCommand.toJSON(),
    analyticsData.toJSON(),
    analyticsExportData.toJSON(),
    modstatsData.toJSON(),
    sendData.toJSON(),
    resetdataData.toJSON(),
    flagData.toJSON(),
    sampleData.toJSON(),
    // Note: Context menu commands would be registered separately via a different API endpoint
    // modmailContextMenu.toJSON(),
  ];
}
