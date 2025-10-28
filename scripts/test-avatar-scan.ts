/**
 * Test script for avatar NSFW detection
 * Usage: npx tsx scripts/test-avatar-scan.ts <image-url>
 */

import { tagImage, TAG_LABELS, loadTagLabels } from "../src/features/avatarTagger.js";
import { computeRisk } from "../src/features/avatarRisk.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npx tsx scripts/test-avatar-scan.ts <image-url>");
  console.error("\nExample:");
  console.error("  npx tsx scripts/test-avatar-scan.ts https://cdn.discordapp.com/avatars/...");
  process.exit(1);
}

console.log(`\n=== Testing Avatar NSFW Detection ===`);
console.log(`Image URL: ${url}\n`);

try {
  // Ensure tags are loaded
  await loadTagLabels();

  console.log(`✓ Loaded ${TAG_LABELS.length} WD v3 tags\n`);
  console.log("Running inference (this may take 10-30 seconds)...\n");

  const startTime = Date.now();
  const result = await tagImage(url, { traceId: "test-script" });
  const elapsed = Date.now() - startTime;

  if (!result) {
    console.error("✗ Inference failed - check logs above");
    console.error("\nPossible causes:");
    console.error("  - NSFW_TAGGER_ENABLE=0 (tagger disabled)");
    console.error("  - Model file not found");
    console.error("  - Image URL invalid or inaccessible");
    process.exit(1);
  }

  console.log(`✓ Inference completed in ${elapsed}ms\n`);

  // Show top tags
  console.log("=== Top 15 Tags ===\n");
  result.tags.slice(0, 15).forEach((tag, i) => {
    const prob = (tag.prob * 100).toFixed(1);
    const bar = "█".repeat(Math.floor(tag.prob * 20));
    console.log(`${String(i + 1).padStart(2)}. ${tag.name.padEnd(30)} ${prob.padStart(5)}% ${bar}`);
  });

  // Compute risk
  console.log("\n=== Risk Assessment ===\n");
  const risk = computeRisk(result, TAG_LABELS, { traceId: "test-script" });

  const scoreColor = risk.finalPct >= 70 ? "🔴" : risk.finalPct >= 40 ? "🟡" : "🟢";
  console.log(`${scoreColor} Final Score: ${risk.finalPct}%`);
  console.log(`   Reason: ${risk.reason}`);
  console.log(`   NSFW Score: ${(risk.nsfwScore * 100).toFixed(1)}%`);
  console.log(`   Furry Score: ${(risk.furryScore * 100).toFixed(1)}%`);
  console.log(`   Scalie Score: ${(risk.scalieScore * 100).toFixed(1)}%`);

  // Show evidence
  console.log("\n=== Evidence ===\n");

  if (risk.evidence.hard.length > 0) {
    console.log("Hard Evidence (explicit NSFW):");
    risk.evidence.hard.forEach((e) => {
      console.log(`  • ${e.tag}: ${(e.p * 100).toFixed(0)}%`);
    });
  } else {
    console.log("Hard Evidence: none");
  }

  if (risk.evidence.soft.length > 0) {
    console.log("\nSoft Evidence (suggestive):");
    risk.evidence.soft.forEach((e) => {
      console.log(`  • ${e.tag}: ${(e.p * 100).toFixed(0)}%`);
    });
  } else {
    console.log("\nSoft Evidence: none");
  }

  if (risk.evidence.safe.length > 0) {
    console.log("\nSafe Indicators (furry/scalie context):");
    risk.evidence.safe.forEach((e) => {
      console.log(`  • ${e.tag}: ${(e.p * 100).toFixed(0)}%`);
    });
  } else {
    console.log("\nSafe Indicators: none");
  }

  // Show metadata
  console.log("\n=== Performance ===\n");
  console.log(`Crops Used: ${result.meta?.cropsUsed ?? "unknown"}`);
  console.log(`Early Exit: ${result.meta?.earlyExit ? "yes (high confidence)" : "no"}`);
  console.log(`Timed Out: ${result.meta?.timedOut ? "yes (per-crop budget exceeded)" : "no"}`);
  console.log(`Input Layout: ${result.meta?.layout ?? "unknown"}`);
  console.log(`Total Time: ${elapsed}ms`);

  // Recommendation
  console.log("\n=== Recommendation ===\n");
  if (risk.finalPct >= 70) {
    console.log("🔴 HIGH RISK - Likely NSFW content, manual review recommended");
  } else if (risk.finalPct >= 40) {
    console.log("🟡 MODERATE RISK - Suggestive content, manual review suggested");
  } else {
    console.log("🟢 LOW RISK - Appears safe for general audience");
  }

  console.log("\n");
  process.exit(0);
} catch (err) {
  console.error("\n✗ Error:", err);
  console.error("\nStack trace:");
  console.error((err as Error).stack);
  process.exit(1);
}
