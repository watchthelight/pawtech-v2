/**
 * Pawtropolis Tech — src/features/avatarScan.ts
 * WHAT: Avatar NSFW detection using Google Cloud Vision API
 * WHY: Provides accurate NSFW detection for cartoon/anime/furry avatars
 * FLOWS:
 *  - scanAvatar(): resolve URL → Google Vision API → return scores
 *  - getScan(): read stored scores for a given application_id from SQLite
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import type { User } from "discord.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/db.js";

// Types for NSFW risk assessment
export type RiskReason = "hard_evidence" | "soft_evidence" | "suggestive" | "none";
type EvidenceEntry = { tag: string; p: number };
type RiskSummary = {
  evidence: {
    hard: EvidenceEntry[];
    soft: EvidenceEntry[];
    safe: EvidenceEntry[];
  };
};

export type ScanOptions = {
  traceId?: string | null;
  nsfwThreshold?: number;
  edgeThreshold?: number;
  wModel?: number;
  wEdge?: number;
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

/**
 * Database row representation of avatar scan (snake_case, matches SQLite schema).
 * For UI representation, see AvatarScanRow in src/features/review/types.ts
 */
export type AvatarScanDbRow = {
  application_id: string;
  avatar_url: string;
  nsfw_score: number | null;
  edge_score: number;
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
  // Handle both direct URL strings and Discord User objects.
  // The User object path is the common case from application processing.
  if (typeof subject === "string") {
    return subject;
  }
  try {
    // forceStatic: true because we don't want animated GIFs - Vision API handles
    // static images better, and animated avatars are rare for new applicants anyway.
    // size: 1024 gives us good detail without being excessive for the API.
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
  // Force size=1024 even if a different size was in the URL. Vision API accuracy
  // improves with larger images, and 1024 is a good balance of quality vs. bandwidth.
  //
  // GOTCHA: This regex is fragile. If Discord changes their CDN query params format,
  // this will silently stop working. We've been burned before. Check the Discord docs
  // if avatars suddenly look low-res in the review UI.
  const highResUrl = avatarUrl.replace(/\?size=\d+/, "?size=1024");
  baseResult.avatarUrl = highResUrl;

  try {
    // Use Google Cloud Vision API for NSFW detection
    const { detectNsfwVision, calculateVisionScore } = await import("./googleVision.js");
    const { withRetry } = await import("../lib/retry.js");

    const visionResult = await withRetry(
      () => detectNsfwVision(highResUrl),
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        label: "google_vision_api"
      }
    );

    if (!visionResult) {
      logger.warn(
        { traceId, avatarUrl: highResUrl },
        "[avatarScan] Google Vision detection failed"
      );
      return baseResult;
    }

    // Calculate combined score from Google Vision results
    const visionScore = calculateVisionScore(visionResult);
    const finalPct = Math.round(visionScore * 100);

    // Determine reason based on Google Vision scores
    // These thresholds were tuned empirically against a sample of furry/anime avatars.
    // The Vision API tends to flag artistic nudity differently than photographic,
    // so we use higher thresholds than you might for general content moderation.
    // hard_evidence (0.8+): Almost certainly NSFW, auto-flag
    // soft_evidence (0.5+ adult OR 0.8+ racy): Likely problematic, needs review
    // suggestive (0.5+ racy): Borderline, include in report but lower priority
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
        hard:
          visionResult.adultScore >= 0.5
            ? [{ tag: `adult:${visionResult.raw.adult}`, p: visionResult.adultScore }]
            : [],
        soft:
          visionResult.racyScore >= 0.5
            ? [{ tag: `racy:${visionResult.raw.racy}`, p: visionResult.racyScore }]
            : [],
        safe: [],
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

// Evidence is stored as JSON strings in SQLite because SQLite doesn't have real arrays.
// If you're tempted to normalize this into a separate table: don't.
// The query overhead isn't worth it for data we always fetch together.
function deserializeEvidence(
  hard: string | null,
  soft: string | null,
  safe: string | null
): StoredEvidence {
  return {
    hard: hard ? JSON.parse(hard) : [],
    soft: soft ? JSON.parse(soft) : [],
    safe: safe ? JSON.parse(safe) : [],
  };
}

export function getScan(applicationId: string): ScanResult {
  /**
   * getScan
   * WHAT: Retrieves a previously stored avatar scan from SQLite
   * WHY: Review cards show the scan results without re‑running
   * PARAMS:
   *  - applicationId: The application.id
   * RETURNS: ScanResult with safe defaults if not found or error occurs
   * THROWS: Never throws; logs errors and returns safe defaults
   */
  const safeDefault: ScanResult = {
    avatarUrl: null,
    finalPct: 0,
    reason: "none",
    nsfwScore: null,
    edgeScore: 0,
    furryScore: 0,
    scalieScore: 0,
    evidence: { hard: [], soft: [], safe: [] },
  };

  if (!db) {
    logger.warn({ applicationId }, "[avatarScan] db not available, cannot get scan");
    return safeDefault;
  }

  try {
    const row = db
      .prepare(
        `SELECT avatar_url, nsfw_score, edge_score, final_pct, furry_score, scalie_score, reason,
                evidence_hard, evidence_soft, evidence_safe
         FROM avatar_scan
         WHERE application_id = ?`
      )
      .get(applicationId) as Partial<AvatarScanDbRow> | undefined;

    if (!row) {
      return safeDefault;
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
    return safeDefault;
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
   *
   * Note: Google Lens is better than the old images.google.com/searchbyimage
   * for furry art. It actually finds similar art styles, not just exact matches.
   */
  const encoded = encodeURIComponent(imageUrl);
  return `https://lens.google.com/uploadbyurl?url=${encoded}`;
}
