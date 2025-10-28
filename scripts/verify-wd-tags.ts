/**
 * Verify WD v3 tags for avatarRisk.ts evidence lists
 * Usage: npx tsx scripts/verify-wd-tags.ts
 */

import fs from "node:fs";
import { parse } from "csv-parse/sync";

type TagMetadata = {
  tag_id: number;
  name: string;
  category: number;
  count: number;
};

const csvPath = "./models/wd-v3-tags.csv";
const content = fs.readFileSync(csvPath, "utf-8");
const rows = parse(content, { columns: true, skip_empty_lines: true }) as TagMetadata[];

const tagSet = new Set(rows.map((r) => r.name.toLowerCase()));

// Current evidence lists from avatarRisk.ts
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

console.log("=== HARD EVIDENCE TAGS ===\n");
for (const tag of EVIDENCE_HARD) {
  const exists = tagSet.has(tag);
  console.log(`${exists ? "✓" : "✗"} ${tag}`);
}

console.log("\n=== SOFT EVIDENCE TAGS ===\n");
for (const tag of EVIDENCE_SOFT) {
  const exists = tagSet.has(tag);
  console.log(`${exists ? "✓" : "✗"} ${tag}`);
}

console.log("\n=== FURRY SAFE TAGS ===\n");
for (const tag of FURRY_SAFE) {
  const exists = tagSet.has(tag);
  console.log(`${exists ? "✓" : "✗"} ${tag}`);
}

// Suggest WD v3 alternatives
console.log("\n=== SUGGESTED WD V3 ALTERNATIVES ===\n");

const suggestions = [
  "completely_nude",
  "topless",
  "bottomless",
  "breasts_out",
  "see-through",
  "underboob",
  "large_breasts",
  "spread_pussy",
  "cum_in_pussy",
  "furry_female",
  "furry_male",
  "dragon",
  "scalie",
  "explicit",
  "nude",
];

console.log("Additional high-value tags found in WD v3:");
for (const tag of suggestions) {
  if (tagSet.has(tag)) {
    console.log(`✓ ${tag}`);
  }
}
