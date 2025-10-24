/**
 * Avatar Risk v2 tests
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { computeRisk } from "../../src/features/avatarRisk.js";
import type { TagResult } from "../../src/features/avatarTagger.js";

const TAG_NAMES = [
  "rating:general",
  "rating:sensitive",
  "rating:questionable",
  "rating:explicit",
  "nsfw",
  "explicit",
  "porn",
  "nude",
  "naked",
  "nipples",
  "areola",
  "breasts",
  "genitals",
  "penis",
  "vulva",
  "vagina",
  "pussy",
  "crotch",
  "anus",
  "spread_legs",
  "fellatio",
  "cunnilingus",
  "sex",
  "cum",
  "erection",
  "genital_focused",
  "crotch_shot",
  "furry",
  "anthro",
  "feral",
  "kemono",
  "dragon",
  "scalie",
  "reptile",
  "lizard",
  "kobold",
  "werewolf",
  "taur",
  "mammal",
  "muzzle",
  "snout",
  "presenting",
  "crotch_grab",
  "exhibitionism",
  "portrait",
  "headshot",
  "profile",
  "underwear",
  "lingerie",
  "bikini",
  "cleavage",
  "cameltoe",
  "animal_ears",
];

function makeResult(probMap: Record<string, number>): TagResult {
  const maxProbs = new Float32Array(TAG_NAMES.length);
  for (let i = 0; i < TAG_NAMES.length; i++) {
    const tag = TAG_NAMES[i];
    maxProbs[i] = probMap[tag] ?? 0;
  }
  const tags = Object.entries(probMap)
    .filter(([, prob]) => prob > 0)
    .map(([name, prob]) => ({ name, prob }))
    .sort((a, b) => b.prob - a.prob);
  return {
    tags,
    meanProbs: maxProbs,
    maxProbs,
  };
}

describe("computeRisk v2", () => {
  it("returns zero for empty tags", () => {
    const result = computeRisk(null, TAG_NAMES);
    expect(result.finalPct).toBe(0);
    expect(result.reason).toBe("none");
  });

  it("dampens kemono headshot without anatomy", () => {
    const tagResult = makeResult({
      kemono: 0.6,
      portrait: 0.55,
      headshot: 0.5,
      furry: 0.45,
      explicit: 0.58,
      nsfw: 0.35,
    });

    const risk = computeRisk(tagResult, TAG_NAMES);

    expect(risk.finalPct).toBeLessThanOrEqual(35);
    expect(["none", "suggestive"]).toContain(risk.reason);
  });

  it("scores suggestive content with soft evidence", () => {
    const tagResult = makeResult({
      explicit: 0.47,
      nsfw: 0.38,
      "rating:sensitive": 0.32,
      spread_legs: 0.34,
      underwear: 0.3,
    });

    const risk = computeRisk(tagResult, TAG_NAMES);

    expect(risk.finalPct).toBeGreaterThanOrEqual(40);
    expect(risk.finalPct).toBeLessThanOrEqual(80);
    expect(risk.reason).toBe("soft_evidence");
  });

  it("flags hard evidence at high confidence", () => {
    const tagResult = makeResult({
      explicit: 0.7,
      nipples: 0.22,
      breasts: 0.3,
      nsfw: 0.4,
    });

    const risk = computeRisk(tagResult, TAG_NAMES);

    expect(risk.reason).toBe("hard_evidence");
    expect(risk.finalPct).toBeGreaterThanOrEqual(90);
  });

  it("boosts scalie soft evidence without going hard red", () => {
    const tagResult = makeResult({
      explicit: 0.52,
      nsfw: 0.35,
      scalie: 0.5,
      dragon: 0.4,
      underwear: 0.32,
      "rating:sensitive": 0.28,
    });

    const risk = computeRisk(tagResult, TAG_NAMES);

    expect(risk.reason).not.toBe("hard_evidence");
    expect(risk.finalPct).toBeLessThan(90);
    expect(risk.finalPct).toBeGreaterThan(35);
  });
});
