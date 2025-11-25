/**
 * Pawtropolis Tech — src/lib/pm2.ts
 * WHAT: PM2 process manager helper wrapper
 * WHY: Safe, mockable access to PM2 status for health checks
 * FLOWS:
 *  - getPM2Status(processNames) → shell pm2 jlist → parse JSON → return status array
 * DOCS:
 *  - PM2: https://pm2.keymetrics.io/docs/usage/process-management/
 *  - PM2 programmatic: https://pm2.keymetrics.io/docs/usage/pm2-api/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger.js";

const execAsync = promisify(exec);

/**
 * PM2 process status shape
 */
export interface PM2ProcessStatus {
  name: string;
  pm2Id?: number;
  status: "online" | "stopped" | "errored" | "unknown";
  uptimeSeconds?: number;
  memoryBytes?: number;
  cpuPercent?: number;
}

/**
 * Raw PM2 jlist output shape (subset)
 */
interface PM2Process {
  name: string;
  pm_id: number;
  pm2_env: {
    status: string;
    pm_uptime?: number;
  };
  monit?: {
    memory?: number;
    cpu?: number;
  };
}

/**
 * WHAT: Fetch PM2 process status for given process names.
 * WHY: Health dashboard needs to show PM2 process health (online/stopped/errored).
 *
 * @param processNames - Array of PM2 process names to query
 * @returns Array of process statuses
 *
 * @example
 * const statuses = await getPM2Status(['pawtropolis', 'other-service']);
 * // => [{ name: 'pawtropolis', status: 'online', uptimeSeconds: 123456, ... }]
 */
export async function getPM2Status(processNames: string[]): Promise<PM2ProcessStatus[]> {
  if (processNames.length === 0) {
    logger.debug("[pm2] no process names provided, returning empty array");
    return [];
  }

  try {
    // Use pm2 jlist to get JSON output of all processes
    const { stdout, stderr } = await execAsync("pm2 jlist", {
      timeout: 5000, // 5s timeout
      maxBuffer: 1024 * 1024, // 1MB buffer
    });

    if (stderr) {
      logger.warn({ stderr }, "[pm2] pm2 jlist stderr output");
    }

    // Parse JSON output
    const processes: PM2Process[] = JSON.parse(stdout.trim() || "[]");

    // Map requested process names to statuses
    const statuses: PM2ProcessStatus[] = processNames.map((name) => {
      const proc = processes.find((p) => p.name === name);

      if (!proc) {
        logger.debug({ processName: name }, "[pm2] process not found in pm2 list");
        return {
          name,
          status: "unknown",
        };
      }

      // Map PM2 status to our simplified status
      let status: PM2ProcessStatus["status"] = "unknown";
      const pm2Status = proc.pm2_env.status?.toLowerCase();
      if (pm2Status === "online") status = "online";
      else if (pm2Status === "stopped") status = "stopped";
      else if (pm2Status === "errored" || pm2Status === "error") status = "errored";

      // Calculate uptime in seconds
      const uptimeSeconds =
        proc.pm2_env.pm_uptime && status === "online"
          ? Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000)
          : undefined;

      return {
        name: proc.name,
        pm2Id: proc.pm_id,
        status,
        uptimeSeconds,
        memoryBytes: proc.monit?.memory,
        cpuPercent: proc.monit?.cpu,
      };
    });

    logger.debug({ statuses }, "[pm2] fetched process statuses");
    return statuses;
  } catch (err: any) {
    // PM2 not installed or not running
    if (err.code === "ENOENT" || err.message?.includes("command not found")) {
      logger.warn("[pm2] pm2 command not found - PM2 may not be installed");
      return processNames.map((name) => ({
        name,
        status: "unknown",
      }));
    }

    // Timeout or other error
    logger.error({ err: err.message, code: err.code }, "[pm2] failed to fetch process status");
    return processNames.map((name) => ({
      name,
      status: "unknown",
    }));
  }
}

/**
 * WHAT: Check if PM2 is available on the system.
 * WHY: Determine if PM2 health checks can be performed.
 *
 * @returns True if PM2 is installed and accessible
 */
export async function isPM2Available(): Promise<boolean> {
  try {
    await execAsync("pm2 --version", { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}
