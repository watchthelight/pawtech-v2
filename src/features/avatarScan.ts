/**
 * Pawtropolis Tech — src/features/avatarScan.ts
 * WHAT: Heuristic avatar scan utilities (NSFW via nsfwjs when available + simple skin/edge heuristic) and helpers to store/read results.
 * WHY: Reviewers want a quick heads‑up on potentially NSFW avatars; this is a best‑effort hint, not a classifier.
 * FLOWS:
 *  - scanAvatar(): resolve URL → fetch → classify (optional) → edge/skin heuristic → combine → return scores
 *  - combineScanScores(): weight model vs heuristic into finalPct (0–100)
 *  - getScan(): read stored scores for a given application_id from SQLite
 *  - buildReverseImageUrl(): build review‑time link to image search (e.g., Google Lens)
 * DOCS:
 *  - discord.js v14 (User): https://discord.js.org/#/docs/discord.js/main/class/User
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *  - Vitest (tests for this module): https://vitest.dev/guide/
 *  - Google Lens by URL: https://lens.google.com/uploadbyurl
 *
 * NOTE: This is a heuristic. False positives happen. We never block the card purely on scan errors; UX over fragility.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import type { User } from "discord.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/db.js";
import type { GuildConfig } from "../lib/config.js";
import type { RiskReason, RiskSummary } from "./avatarRisk.js";

const FETCH_TIMEOUT_MS = 5000;

type ScanReason = "nsfw" | "edge" | "both" | "none";

type InternalScanOptions = {
  nsfwThreshold: number;
  edgeThreshold: number;
  wModel: number;
  wEdge: number;
};

export type ScanOptions = Partial<InternalScanOptions> & {
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

let tfModulePromise: Promise<any | null> | null = null;
let nsfwModelPromise: Promise<any | null> | null = null;
let sharpModulePromise: Promise<any | null> | null = null;

async function loadTfModule() {
  if (!tfModulePromise) {
    tfModulePromise = (async () => {
      try {
        return await import("@tensorflow/tfjs-node" as any);
      } catch (err) {
        logger.debug({ err }, "[avatarScan] tfjs-node unavailable");
        return null;
      }
    })();
  }
  return tfModulePromise;
}

async function loadNsfwModel() {
  if (!nsfwModelPromise) {
    nsfwModelPromise = (async () => {
      try {
        const tf = await loadTfModule();
        if (!tf) return null;
        const nsfw = await import("nsfwjs" as any);
        return await nsfw.load();
      } catch (err) {
        logger.debug({ err }, "[avatarScan] nsfwjs unavailable");
        return null;
      }
    })();
  }
  return nsfwModelPromise;
}

async function loadSharpModule() {
  if (!sharpModulePromise) {
    sharpModulePromise = (async () => {
      try {
        return await import("sharp" as any);
      } catch (err) {
        logger.debug({ err }, "[avatarScan] sharp unavailable");
        return null;
      }
    })();
  }
  return sharpModulePromise;
}

function clamp01(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isSkinTone(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    diff > 15 &&
    Math.abs(r - g) > 15 &&
    r > g &&
    r > b &&
    !(r > 250 && g > 250 && b > 250)
  );
}

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

async function fetchAvatarBuffer(avatarUrl: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(avatarUrl, { signal: controller.signal });
    if (!response.ok) {
      logger.warn({ status: response.status, avatarUrl }, "[avatarScan] avatar fetch failed");
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    logger.warn({ err, avatarUrl }, "[avatarScan] avatar fetch error");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function classifyNsfw(buffer: Buffer): Promise<number | null> {
  try {
    const model = await loadNsfwModel();
    const tf = await loadTfModule();
    if (!model || !tf) return null;
    const tensor = tf.node.decodeImage(buffer, 3);
    try {
      const predictions = await model.classify(tensor, 5);
      const porn =
        predictions.find((p: any) => p.className.toLowerCase() === "porn")?.probability ?? 0;
      const hentai =
        predictions.find((p: any) => p.className.toLowerCase() === "hentai")?.probability ?? 0;
      return Math.max(porn, hentai);
    } finally {
      if (tensor && typeof tensor.dispose === "function") {
        tensor.dispose();
      }
    }
  } catch (err) {
    logger.debug({ err }, "[avatarScan] nsfw classification failed");
    return null;
  }
}

async function detectEdgeSkin(buffer: Buffer): Promise<number> {
  try {
    const sharpModule = await loadSharpModule();
    if (!sharpModule) return 0;
    const sharpFactory = sharpModule.default ?? sharpModule;
    const { data, info } = await sharpFactory(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    if (!width || !height || !channels) return 0;
    const stride = channels;
    const edgeThickness = Math.max(1, Math.round(Math.min(width, height) * 0.08));

    let totalEdgePixels = 0;
    let skinEdgePixels = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const edge =
          x < edgeThickness ||
          x >= width - edgeThickness ||
          y < edgeThickness ||
          y >= height - edgeThickness;
        if (!edge) continue;
        const idx = (y * width + x) * stride;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        totalEdgePixels++;
        if (isSkinTone(r, g, b)) {
          skinEdgePixels++;
        }
      }
    }

    if (totalEdgePixels === 0) return 0;
    return clamp01(skinEdgePixels / totalEdgePixels);
  } catch (err) {
    logger.warn({ err }, "[avatarScan] edge detection failed");
    return 0;
  }
}

function buildReason(
  nsfwScore: number | null,
  edgeScore: number,
  nsfwThreshold: number,
  edgeThreshold: number
): ScanReason {
  const nsfwTriggered = typeof nsfwScore === "number" && nsfwScore >= nsfwThreshold;
  const edgeTriggered = edgeScore >= edgeThreshold;
  if (nsfwTriggered && edgeTriggered) return "both";
  if (nsfwTriggered) return "nsfw";
  if (edgeTriggered) return "edge";
  return "none";
}

const DEFAULT_SCAN_OPTIONS: InternalScanOptions = {
  nsfwThreshold: 0.6,
  edgeThreshold: 0.18,
  wModel: 0.7,
  wEdge: 0.3,
};

// cute, fast, and somehow correct
export function combineScanScores(
  nsfwScore: number | null,
  edgeScore: number,
  options: ScanOptions = {}
) {
  /**
   * combineScanScores
   * WHAT: Computes a finalPct (0–100) weighted blend between ML model score and edge/skin heuristic.
   * WHY: nsfwjs can be absent or inconclusive; blending stabilizes signal for reviewers.
   * PARAMS:
   *  - nsfwScore: Nullable 0–1.
   *  - edgeScore: 0–1 proportion from our heuristic.
   *  - options: Optional weights and thresholds; safe defaults applied.
   * RETURNS: { reason, finalPct } where reason is nsfw/edge/both/none.
   * THROWS: Never throws.
   * LINKS:
   *  - nsfwjs: https://github.com/infinitered/nsfwjs
   * PITFALLS:
   *  - finalPct is an aid, not a verdict; treat it as a hint.
   */
  const merged: InternalScanOptions = {
    ...DEFAULT_SCAN_OPTIONS,
    ...options,
  };
  const reason = buildReason(nsfwScore, edgeScore, merged.nsfwThreshold, merged.edgeThreshold);
  const combined = clamp01(merged.wModel * (nsfwScore ?? 0) + merged.wEdge * edgeScore);
  return {
    reason,
    finalPct: Math.round(combined * 100),
  };
}

export async function scanAvatar(
  subject: ScanSubject,
  options: ScanOptions = {}
): Promise<ScanResult> {
  /**
   * scanAvatar
   * WHAT: Fetches an avatar, runs WD tagger (multi-crop NSFW/furry/scalie detection), returns risk scores.
   * WHY: Gives reviewers accurate NSFW risk context for furry/scalie avatars.
   * PARAMS:
   *  - subject: Either a URL string or a discord.js User with displayAvatarURL.
   *  - options: Optional tuning of thresholds/weights.
   * RETURNS: ScanResult with avatarUrl, per‑method scores, reason, and finalPct.
   * THROWS: Never throws; errors are logged and surfaced via default values.
   * LINKS:
   *  - discord.js User.displayAvatarURL: https://discord.js.org/#/docs/discord.js/main/class/User?scrollTo=displayAvatarURL
   */
  const { traceId = null, ..._tuning } = options;
  const avatarUrl = resolveAvatarUrl(subject);
  if (!avatarUrl) {
    return {
      avatarUrl: null,
      finalPct: 0,
      reason: "none",
      nsfwScore: null,
      edgeScore: 0,
      furryScore: 0,
      scalieScore: 0,
      evidence: { hard: [], soft: [], safe: [] },
    };
  }

  // Use high-res avatar for WD tagger
  const highResUrl = avatarUrl.replace(/\?size=\d+/, "?size=1024");
  const baseResult: ScanResult = {
    avatarUrl: highResUrl,
    finalPct: 0,
    reason: "none",
    nsfwScore: null,
    edgeScore: 0,
    furryScore: 0,
    scalieScore: 0,
    evidence: { hard: [], soft: [], safe: [] },
  };

  try {
    const { tagImage, TAG_LABELS } = await import("./avatarTagger.js");
    const { computeRisk } = await import("./avatarRisk.js");

    const tagResult = await tagImage(highResUrl, { traceId });
    const risk = computeRisk(tagResult, TAG_LABELS, { traceId });

    const result: ScanResult = {
      avatarUrl: highResUrl,
      finalPct: risk.finalPct,
      reason: risk.reason,
      nsfwScore: risk.nsfwScore,
      edgeScore: baseResult.edgeScore,
      furryScore: risk.furryScore,
      scalieScore: risk.scalieScore,
      evidence: risk.evidence,
    };

    logger.info(
      {
        traceId,
        userId: typeof subject === "object" ? subject.id : undefined,
        finalPct: result.finalPct,
        reason: result.reason,
        nsfwScore: result.nsfwScore,
        furryScore: result.furryScore,
        scalieScore: result.scalieScore,
        avatarUrl: highResUrl,
      },
      "[avatarScan] result"
    );

    return result;
  } catch (err) {
    logger.warn(
      { err, avatarUrl, traceId },
      "[avatarScan] WD tagger failed, falling back to defaults"
    );
    return baseResult;
  }
}

type StoredEvidence = RiskSummary["evidence"];

export function getScan(applicationId: string): {
  finalPct: number;
  nsfwScore: number | null;
  edgeScore: number;
  furry_score: number;
  scalie_score: number;
  reason: string;
  evidence: StoredEvidence;
} {
  /**
   * getScan
   * WHAT: Reads the stored scan for an application_id.
   * WHY: Used when rendering the review card or answering staff requests.
   * PARAMS:
   *  - applicationId: App business ID (not HEX6); UNIQUE via ux_avatar_scan_application.
   * RETURNS: Present scores or neutral defaults when absent/errors.
   * THROWS: Never; logs and returns neutral defaults on error.
   * LINKS:
   *  - SQLite UPSERT (related to writers elsewhere): https://sqlite.org/lang_UPSERT.html
   */
  try {
    // SELECT columns: nsfw_score (0–1 or null), edge_score (0–1), final_pct (0–100), furry_score, scalie_score, reason (string)
    // Table: avatar_scan — ensured in src/db/ensure.ts
    const row = db
      .prepare(
        `
        SELECT
          nsfw_score,
          edge_score,
          final_pct,
          furry_score,
          scalie_score,
          reason,
          evidence_hard,
          evidence_soft,
          evidence_safe
        FROM avatar_scan
        WHERE application_id = ?
      `
      )
      .get(applicationId) as
      | {
          nsfw_score: number | null;
          edge_score: number | null;
          final_pct: number | null;
          furry_score: number | null;
          scalie_score: number | null;
          reason: string | null;
          evidence_hard: string | null;
          evidence_soft: string | null;
          evidence_safe: string | null;
        }
      | undefined;

    if (!row) {
      return {
        finalPct: 0,
        nsfwScore: null,
        edgeScore: 0,
        furry_score: 0,
        scalie_score: 0,
        reason: "none",
        evidence: { hard: [], soft: [], safe: [] },
      };
    }

    return {
      finalPct: row.final_pct ?? 0,
      nsfwScore: row.nsfw_score,
      edgeScore: row.edge_score ?? 0,
      furry_score: row.furry_score ?? 0,
      scalie_score: row.scalie_score ?? 0,
      reason: row.reason ?? "none",
      evidence: {
        hard: parseEvidence(row.evidence_hard),
        soft: parseEvidence(row.evidence_soft),
        safe: parseEvidence(row.evidence_safe),
      },
    };
  } catch (err) {
    logger.warn({ err, applicationId }, "[avatarScan] getScan failed");
    return {
      finalPct: 0,
      nsfwScore: null,
      edgeScore: 0,
      furry_score: 0,
      scalie_score: 0,
      reason: "none",
      evidence: { hard: [], soft: [], safe: [] },
    };
  }
}

export function googleReverseImageUrl(avatarUrl: string): string {
  /**
   * googleReverseImageUrl
   * WHAT: Convenience to open the avatar in Google Lens (reverse image search).
   * WHY: When scan says "edge" or "nsfw", reviewers may want to quickly verify content.
   * PARAMS:
   *  - avatarUrl: Direct image URL; will be URL-encoded into query param.
   * RETURNS: Google Lens reverse image search URL.
   */
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(avatarUrl)}`;
}

// link button: let the browser flex
export function buildReverseImageUrl(
  cfg: Pick<GuildConfig, "image_search_url_template">,
  avatarUrl: string
) {
  /**
   * buildReverseImageUrl
   * WHAT: Builds a staff-facing link to reverse-image search using guild-configured template.
   * WHY: Some communities prefer custom endpoints; defaults to Google Lens.
   * PARAMS:
   *  - cfg.image_search_url_template: Either contains {avatarUrl} or we append ?avatar=...
   *  - avatarUrl: Direct image URL, URL-encoded when substituted.
   * RETURNS: A fully-formed link ready to drop into an interaction reply.
   * THROWS: Never.
   */
  const template =
    cfg.image_search_url_template || "https://www.google.com/searchbyimage?image_url={avatarUrl}";
  const encoded = encodeURIComponent(avatarUrl);
  if (template.includes("{avatarUrl}")) {
    return template.replaceAll("{avatarUrl}", encoded);
  }
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}avatar=${encoded}`;
}

function parseEvidence(raw: string | null): StoredEvidence["hard"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === "string") {
          return { tag: entry, p: 0 };
        }
        if (entry && typeof entry === "object") {
          const tag = typeof entry.tag === "string" ? entry.tag : String(entry[0] ?? "");
          const pValue = typeof entry.p === "number" ? entry.p : Number(entry[1] ?? 0);
          if (!tag) return null;
          return { tag, p: Number.isFinite(pValue) ? pValue : 0 };
        }
        return null;
      })
      .filter((entry): entry is { tag: string; p: number } => !!entry && entry.tag.length > 0);
  } catch (err) {
    logger.debug({ err }, "[avatarScan] failed to parse evidence JSON");
    return [];
  }
}
