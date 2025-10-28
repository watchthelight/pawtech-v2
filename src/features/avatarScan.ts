/**
 * Pawtropolis Tech — src/features/avatarScan.ts
 * WHAT: Avatar NSFW detection using Google Cloud Vision API
 * WHY: Provides accurate NSFW detection for cartoon/anime/furry avatars
 * FLOWS:
 *  - scanAvatar(): resolve URL → Google Vision API → return scores
 *  - getScan(): read stored scores for a given application_id from SQLite
 *  - buildReverseImageUrl(): build review‑time link to image search (e.g., Google Lens)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import type { User } from "discord.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/db.js";
import type { GuildConfig } from "../lib/config.js";
import type { RiskReason, RiskSummary } from "./avatarRisk.js";

export type ScanOptions = {
  traceId?: string | null;
};

type ScanSubject = string | Pick<User, "displayAvatarURL" | "id">;

export type ScanResult = {
  avatarUrl: string | null;
  finalPct: number;
  reason: RiskReason;
  nsfwScore: number | null;
  edgeScore: number;
  furryScore: number;
  scalieScore: number;
  evidence: RiskSummary["evidence"];
};

export type AvatarScanRow = {
  application_id: string;
  avatar_url: string;
  nsfw_score: number | null;
  edge_score: number | null;
  final_pct: number;
  furry_score: number;
  scalie_score: number;
  reason: string;
  evidence_hard: string | null;
  evidence_soft: string | null;
  evidence_safe: string | null;
  scanned_at: string;
};

function resolveAvatarUrl(subject: ScanSubject): string | null {
  if (typeof subject === "string") {
    return subject;
  }
  try {
    const url = subject.displayAvatarURL({
      extension: "png",
      forceStatic: true,
      size: 1024,
    } as any);
    return typeof url === "string" && url.length > 0 ? url : null;
  } catch (err) {
    logger.warn({ err, userId: subject.id }, "[avatarScan] failed to resolve avatar URL");
    return null;
  }
}

export async function scanAvatar(
  subject: ScanSubject,
  options: ScanOptions = {}
): Promise<ScanResult> {
  /**
   * scanAvatar
   * WHAT: Scans avatar for NSFW content using Google Cloud Vision API
   * WHY: Provides accurate NSFW detection for furry/cartoon/anime avatars
   * PARAMS:
   *  - subject: Either a URL string or a discord.js User with displayAvatarURL
   *  - options: Optional traceId for logging
   * RETURNS: ScanResult with avatarUrl, finalPct, reason, and evidence
   * THROWS: Never throws; errors are logged and surfaced via default values
   */
  const { traceId = null } = options;
  const avatarUrl = resolveAvatarUrl(subject);
  const baseResult: ScanResult = {
    avatarUrl: null,
    finalPct: 0,
    reason: "none",
    nsfwScore: null,
    edgeScore: 0,
    furryScore: 0,
    scalieScore: 0,
    evidence: { hard: [], soft: [], safe: [] },
  };

  if (!avatarUrl) {
    return baseResult;
  }

  // Use high-res avatar for Google Vision
  const highResUrl = avatarUrl.replace(/\?size=\d+/, "?size=1024");
  baseResult.avatarUrl = highResUrl;

  try {
    // Use Google Cloud Vision API for NSFW detection
    const { detectNsfwVision, calculateVisionScore } = await import("./googleVision.js");
    const visionResult = await detectNsfwVision(highResUrl);

    if (!visionResult) {
      logger.warn({ traceId, avatarUrl: highResUrl }, "[avatarScan] Google Vision detection failed");
      return baseResult;
    }

    // Calculate combined score from Google Vision results
    const visionScore = calculateVisionScore(visionResult);
    const finalPct = Math.round(visionScore * 100);

    // Determine reason based on Google Vision scores
    let reason: RiskReason = "none";
    if (visionResult.adultScore >= 0.8) {
      reason = "hard_evidence";
    } else if (visionResult.adultScore >= 0.5 || visionResult.racyScore >= 0.8) {
      reason = "soft_evidence";
    } else if (visionResult.racyScore >= 0.5) {
      reason = "suggestive";
    }

    const result: ScanResult = {
      avatarUrl: highResUrl,
      finalPct,
      reason,
      nsfwScore: visionScore,
      edgeScore: 0,
      furryScore: 0,
      scalieScore: 0,
      evidence: {
        hard: visionResult.adultScore >= 0.5 ? [{ tag: `adult:${visionResult.raw.adult}`, p: visionResult.adultScore }] : [],
        soft: visionResult.racyScore >= 0.5 ? [{ tag: `racy:${visionResult.raw.racy}`, p: visionResult.racyScore }] : [],
        safe: []
      },
    };

    logger.info(
      {
        traceId,
        userId: typeof subject === "object" ? subject.id : undefined,
        finalPct: result.finalPct,
        reason: result.reason,
        nsfwScore: result.nsfwScore,
        visionAdult: visionResult.raw.adult,
        visionRacy: visionResult.raw.racy,
      },
      "[avatarScan] scan complete"
    );

    return result;
  } catch (err) {
    logger.error({ err, avatarUrl, traceId }, "[avatarScan] scan error");
    return baseResult;
  }
}

type StoredEvidence = RiskSummary["evidence"];

function serializeEvidence(evidence: StoredEvidence): {
  hard: string | null;
  soft: string | null;
  safe: string | null;
} {
  return {
    hard: evidence.hard.length > 0 ? JSON.stringify(evidence.hard) : null,
    soft: evidence.soft.length > 0 ? JSON.stringify(evidence.soft) : null,
    safe: evidence.safe.length > 0 ? JSON.stringify(evidence.safe) : null,
  };
}

function deserializeEvidence(hard: string | null, soft: string | null, safe: string | null): StoredEvidence {
  return {
    hard: hard ? JSON.parse(hard) : [],
    soft: soft ? JSON.parse(soft) : [],
    safe: safe ? JSON.parse(safe) : [],
  };
}

export async function storeScan(
  applicationId: string,
  scanResult: ScanResult,
  config: GuildConfig
): Promise<void> {
  /**
   * storeScan
   * WHAT: Persists an avatar scan result into the SQLite database
   * WHY: Review cards need to retrieve the saved scores later
   * PARAMS:
   *  - applicationId: The application.id (primary key in applications table)
   *  - scanResult: The result from scanAvatar()
   *  - config: Guild config (not currently used but kept for consistency)
   * THROWS: Never throws; logs errors
   */
  if (!db) {
    logger.warn({ applicationId }, "[avatarScan] db not available, cannot store scan");
    return;
  }

  try {
    const { avatarUrl, nsfwScore, edgeScore, finalPct, furryScore, scalieScore, reason, evidence } = scanResult;
    const evidenceSerialized = serializeEvidence(evidence);

    db.prepare(
      `INSERT INTO avatar_scans (
        application_id, avatar_url, nsfw_score, edge_score, final_pct,
        furry_score, scalie_score, reason,
        evidence_hard, evidence_soft, evidence_safe, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(application_id) DO UPDATE SET
        avatar_url=excluded.avatar_url,
        nsfw_score=excluded.nsfw_score,
        edge_score=excluded.edge_score,
        final_pct=excluded.final_pct,
        furry_score=excluded.furry_score,
        scalie_score=excluded.scalie_score,
        reason=excluded.reason,
        evidence_hard=excluded.evidence_hard,
        evidence_soft=excluded.evidence_soft,
        evidence_safe=excluded.evidence_safe,
        scanned_at=excluded.scanned_at`
    ).run(
      applicationId,
      avatarUrl,
      nsfwScore,
      edgeScore,
      finalPct,
      furryScore,
      scalieScore,
      reason,
      evidenceSerialized.hard,
      evidenceSerialized.soft,
      evidenceSerialized.safe
    );
    logger.debug({ applicationId, finalPct }, "[avatarScan] scan stored");
  } catch (err) {
    logger.warn({ err, applicationId }, "[avatarScan] failed to store scan");
  }
}

export function getScan(applicationId: string): ScanResult | null {
  /**
   * getScan
   * WHAT: Retrieves a previously stored avatar scan from SQLite
   * WHY: Review cards show the scan results without re‑running
   * PARAMS:
   *  - applicationId: The application.id
   * RETURNS: ScanResult or null if not found
   * THROWS: Never throws; logs errors and returns null
   */
  if (!db) {
    logger.warn({ applicationId }, "[avatarScan] db not available, cannot get scan");
    return null;
  }

  try {
    const row = db
      .prepare(
        `SELECT avatar_url, nsfw_score, edge_score, final_pct, furry_score, scalie_score, reason,
                evidence_hard, evidence_soft, evidence_safe
         FROM avatar_scans
         WHERE application_id = ?`
      )
      .get(applicationId) as Partial<AvatarScanRow> | undefined;

    if (!row) {
      return null;
    }

    const evidence = deserializeEvidence(
      row.evidence_hard ?? null,
      row.evidence_soft ?? null,
      row.evidence_safe ?? null
    );

    return {
      avatarUrl: row.avatar_url ?? null,
      nsfwScore: row.nsfw_score ?? null,
      edgeScore: row.edge_score ?? 0,
      finalPct: row.final_pct ?? 0,
      furryScore: row.furry_score ?? 0,
      scalieScore: row.scalie_score ?? 0,
      reason: (row.reason as RiskReason) ?? "none",
      evidence,
    };
  } catch (err) {
    logger.warn({ err, applicationId }, "[avatarScan] failed to get scan");
    return null;
  }
}

export function googleReverseImageUrl(imageUrl: string): string {
  /**
   * googleReverseImageUrl
   * WHAT: Returns a Google Lens URL for reverse image search
   * WHY: Reviewers want a quick "where else does this image appear?" link
   * PARAMS:
   *  - imageUrl: A publicly accessible image URL
   * RETURNS: A Google Lens uploadbyurl link
   * THROWS: Never throws
   */
  const encoded = encodeURIComponent(imageUrl);
  return `https://lens.google.com/uploadbyurl?url=${encoded}`;
}
