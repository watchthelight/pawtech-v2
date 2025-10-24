/**
 * Avatar Risk v2 — evidence-driven NSFW scoring
 * Combines WD tagger probabilities with explicit anatomy evidence and furry dampening.
 */

import { logger } from "../lib/logger.js";
import type { TagResult } from "./avatarTagger.js";

const RISK_DEBUG = process.env.RISK_DEBUG === "1";

const SOFT_DAMPEN = clamp01(Number.parseFloat(process.env.AVATAR_RISK_SOFT_DAMPEN ?? "0.45"));
const MIN_HARD_FLOOR = clamp01(Number.parseFloat(process.env.AVATAR_RISK_MIN_HARD ?? "0.90"));
const { trigger: GENERAL_CLAMP_TRIGGER, clamp: GENERAL_CLAMP_VALUE } = parseClampPair(
  process.env.AVATAR_RISK_GENERAL_CLAMP,
  { trigger: 0.45, clamp: 0.15 }
);

const EVIDENCE_HARD = [
  "areola",
  "nipples",
  "nipple",
  "areolae",
  "breasts",
  "genitals",
  "vulva",
  "pussy",
  "labia",
  "clitoris",
  "penis",
  "erection",
  "testicles",
  "scrotum",
  "semen",
  "cum",
  "anal",
  "anus",
  "fellatio",
  "cunnilingus",
  "sex",
  "intercourse",
  "penetration",
  "fingering",
  "handjob",
  "footjob",
  "boobjob",
];

const EVIDENCE_SOFT = [
  "underwear",
  "lingerie",
  "bikini",
  "cleavage",
  "sideboob",
  "cameltoe",
  "ass",
  "butt",
  "thong",
  "pasties",
  "nip_slip",
  "topless",
  "spread_legs",
  "open_clothes",
  "nsfw",
  "rating:sensitive",
];

const FURRY_SAFE = [
  "kemono",
  "furry",
  "anthro",
  "anthropomorphic",
  "mascot",
  "animal_ears",
  "portrait",
  "headshot",
  "profile",
  "shoulders",
  "icon",
  "avatar",
];

const ROUND_DECIMALS = 1000;

type EvidenceEntry = { tag: string; p: number };
export type RiskReason = "hard_evidence" | "soft_evidence" | "suggestive" | "none";

export type RiskSummary = {
  finalPct: number;
  reason: RiskReason;
  nsfwScore: number;
  furryScore: number;
  scalieScore: number;
  evidence: {
    hard: EvidenceEntry[];
    soft: EvidenceEntry[];
    safe: EvidenceEntry[];
  };
  detail: {
    pExplicit: number;
    pNSFW: number;
    softEv: number;
    hardEv: number;
    furrySafe: number;
    softSupport: number;
    pFurry: number;
    pScalie: number;
  };
};

type ComputeOptions = {
  traceId?: string | null;
};

export function computeRisk(
  result: TagResult | null,
  tagNames: string[],
  options: ComputeOptions = {}
): RiskSummary {
  if (!result || (!result.tags.length && (!result.maxProbs || result.maxProbs.length === 0))) {
    return {
      finalPct: 0,
      reason: "none",
      nsfwScore: 0,
      furryScore: 0,
      scalieScore: 0,
      evidence: { hard: [], soft: [], safe: [] },
      detail: {
        pExplicit: 0,
        pNSFW: 0,
        softEv: 0,
        hardEv: 0,
        furrySafe: 0,
        softSupport: 0,
        pFurry: 0,
        pScalie: 0,
      },
    };
  }

  const tagProb = buildProbabilityLookup(result, tagNames);
  const p = (name: string) => tagProb.get(name.toLowerCase()) ?? 0;
  const pExplicit = Math.max(p("explicit"), p("nudity"), p("nude"));
  const pNSFW = Math.max(p("nsfw"), p("rating:sensitive"));
  const pFurry = Math.max(p("kemono"), p("furry"), p("anthro"));
  const pScalie = Math.max(p("dragon"), p("lizard"), p("reptile"), p("scalie"));
  const pGeneral = p("rating:general");

  const hardScores = EVIDENCE_HARD.map(p);
  const softScores = EVIDENCE_SOFT.map(p);
  const safeScores = FURRY_SAFE.map(p);

  const hardEv = sumTop(hardScores, 3);
  const softEv = sumTop(softScores, 5);
  const furrySafe = sumTop(safeScores, 4);
  const hasHard = maxValue(hardScores) >= 0.2;

  let reason: RiskReason = "none";
  let pctScore = 0;

  if (hasHard) {
    const score = clamp01(0.7 * pExplicit + 0.5 * softEv + 0.2 * pNSFW);
    pctScore = clamp01(Math.max(score, MIN_HARD_FLOOR));
    reason = "hard_evidence";
  } else {
    const softSupport = Math.max(softEv, p("spread_legs"), p("cleavage"), p("underwear"));
    let raw = 0.65 * pExplicit + 0.4 * pNSFW + 0.25 * softSupport;
    const dampen = Math.max(0, furrySafe - softSupport);
    if (dampen > 0) {
      raw -= SOFT_DAMPEN * dampen;
    }
    if (pScalie > 0.35 && softSupport > 0.25) {
      raw += 0.1;
    }

    pctScore = clamp01(raw);
    if (pctScore >= 0.7) {
      reason = "soft_evidence";
    } else if (pctScore >= 0.4) {
      reason = "suggestive";
    } else {
      reason = "none";
    }

    if (reason === "none" && pGeneral >= GENERAL_CLAMP_TRIGGER) {
      pctScore = Math.min(pctScore, GENERAL_CLAMP_VALUE);
    }
  }

  const finalPct = Math.round(pctScore * 100);
  const evidence = {
    hard: collectTopEntries(EVIDENCE_HARD, p, 3),
    soft: collectTopEntries(EVIDENCE_SOFT, p, 3),
    safe: collectTopEntries(FURRY_SAFE, p, 3),
  };

  const detail = {
    pExplicit,
    pNSFW,
    softEv,
    hardEv,
    furrySafe,
    softSupport: Math.max(softEv, p("spread_legs"), p("cleavage"), p("underwear")),
    pFurry,
    pScalie,
  };

  const topTags = pickTopTags(tagProb, 5);
  const logPayload = {
    traceId: options.traceId ?? null,
    finalPct,
    reason,
    nsfwScore: roundProb(Math.max(pExplicit, pNSFW)),
    pExplicit: roundProb(pExplicit),
    pNSFW: roundProb(pNSFW),
    hardEv: roundProb(hardEv),
    softEv: roundProb(softEv),
    furrySafe: roundProb(furrySafe),
    furryScore: roundProb(pFurry),
    scalieScore: roundProb(pScalie),
    top_tags: topTags,
  };

  logger.info(logPayload, "[avatarRisk] breakdown");
  if (RISK_DEBUG) {
    logger.info({ traceId: options.traceId ?? null, evidence }, "[avatarRisk] evidence");
  }

  return {
    finalPct,
    reason,
    nsfwScore: Math.max(pExplicit, pNSFW),
    furryScore: pFurry,
    scalieScore: pScalie,
    evidence,
    detail,
  };
}

function buildProbabilityLookup(result: TagResult, tagNames: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (result.maxProbs && result.maxProbs.length === tagNames.length) {
    for (let i = 0; i < tagNames.length; i++) {
      const name = tagNames[i]?.toLowerCase() ?? "";
      if (!name) continue;
      map.set(name, result.maxProbs[i]);
    }
  }
  for (const tag of result.tags) {
    const norm = tag.name.toLowerCase();
    const existing = map.get(norm) ?? 0;
    if (tag.prob > existing) {
      map.set(norm, tag.prob);
    }
  }
  return map;
}

function sumTop(values: number[], limit: number): number {
  const sum = [...values]
    .sort((a, b) => b - a)
    .slice(0, limit)
    .reduce((acc, value) => acc + value, 0);
  return sum > 1 ? 1 : sum;
}

function maxValue(values: number[]): number {
  let max = 0;
  for (const value of values) {
    if (value > max) {
      max = value;
    }
  }
  return max;
}

function collectTopEntries(
  tags: string[],
  p: (tag: string) => number,
  limit: number
): EvidenceEntry[] {
  return tags
    .map((tag) => ({ tag, p: roundProb(p(tag)) }))
    .filter((entry) => entry.p > 0)
    .sort((a, b) => b.p - a.p)
    .slice(0, limit);
}

function pickTopTags(prob: Map<string, number>, limit: number): EvidenceEntry[] {
  return Array.from(prob.entries())
    .map(([tag, value]) => ({ tag, p: roundProb(value) }))
    .filter((entry) => entry.p > 0.01)
    .sort((a, b) => b.p - a.p)
    .slice(0, limit);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function roundProb(prob: number): number {
  return Math.round(prob * ROUND_DECIMALS) / ROUND_DECIMALS;
}

function parseClampPair(raw: string | undefined, fallback: { trigger: number; clamp: number }) {
  if (!raw) {
    return fallback;
  }

  const arrowParts = raw.split("->").map((part) => part.trim());
  if (arrowParts.length === 2) {
    const trigger = clamp01(Number.parseFloat(arrowParts[0]));
    const clamp = clamp01(Number.parseFloat(arrowParts[1]));
    if (Number.isFinite(trigger) && Number.isFinite(clamp)) {
      return { trigger, clamp };
    }
  }

  const colonParts = raw.split(":").map((part) => part.trim());
  if (colonParts.length === 2) {
    const trigger = clamp01(Number.parseFloat(colonParts[0]));
    const clamp = clamp01(Number.parseFloat(colonParts[1]));
    if (Number.isFinite(trigger) && Number.isFinite(clamp)) {
      return { trigger, clamp };
    }
  }

  const single = clamp01(Number.parseFloat(raw));
  if (Number.isFinite(single)) {
    return { trigger: single, clamp: fallback.clamp };
  }

  return fallback;
}
