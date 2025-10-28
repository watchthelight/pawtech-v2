/**
 * Batch test avatar scanning on local images
 * Usage: npx tsx scripts/test-batch-scan.ts <directory>
 */

import { tagImage, TAG_LABELS, loadTagLabels } from "../src/features/avatarTagger.js";
import { computeRisk } from "../src/features/avatarRisk.js";
import fs from "node:fs";
import path from "node:path";

const testDir = process.argv[2] || "./assets/testing";

if (!fs.existsSync(testDir)) {
  console.error(`Error: Directory not found: ${testDir}`);
  process.exit(1);
}

console.log(`\n=== Batch Avatar NSFW Testing ===`);
console.log(`Directory: ${testDir}\n`);

// Load tags
await loadTagLabels();
console.log(`✓ Loaded ${TAG_LABELS.length} WD v3 tags\n`);

// Get all image files
const files = fs.readdirSync(testDir)
  .filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f))
  .sort();

console.log(`Found ${files.length} images to test\n`);

type TestResult = {
  filename: string;
  finalPct: number;
  reason: string;
  nsfwScore: number;
  furryScore: number;
  scalieScore: number;
  hardEvidence: string[];
  softEvidence: string[];
  inferenceTime: number;
  error?: string;
};

const results: TestResult[] = [];

for (let i = 0; i < files.length; i++) {
  const filename = files[i];
  const filePath = path.join(testDir, filename);

  console.log(`[${i + 1}/${files.length}] Testing ${filename}...`);

  try {
    // Convert local file to file:// URL
    const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;

    const startTime = Date.now();
    const tagResult = await tagImage(fileUrl, { traceId: `batch-${i}` });
    const inferenceTime = Date.now() - startTime;

    if (!tagResult) {
      console.log(`  ✗ Failed to scan\n`);
      results.push({
        filename,
        finalPct: 0,
        reason: "error",
        nsfwScore: 0,
        furryScore: 0,
        scalieScore: 0,
        hardEvidence: [],
        softEvidence: [],
        inferenceTime: 0,
        error: "Inference failed"
      });
      continue;
    }

    const risk = computeRisk(tagResult, TAG_LABELS, { traceId: `batch-${i}` });

    const hardEvidence = risk.evidence.hard.map(e => `${e.tag}(${Math.round(e.p * 100)}%)`);
    const softEvidence = risk.evidence.soft.map(e => `${e.tag}(${Math.round(e.p * 100)}%)`);

    const icon = risk.finalPct >= 70 ? "🔴" : risk.finalPct >= 40 ? "🟡" : "🟢";
    console.log(`  ${icon} Score: ${risk.finalPct}% (${risk.reason}) - ${inferenceTime}ms`);
    if (hardEvidence.length > 0) {
      console.log(`     Hard: ${hardEvidence.slice(0, 3).join(", ")}`);
    }
    if (softEvidence.length > 0) {
      console.log(`     Soft: ${softEvidence.slice(0, 3).join(", ")}`);
    }
    console.log();

    results.push({
      filename,
      finalPct: risk.finalPct,
      reason: risk.reason,
      nsfwScore: risk.nsfwScore,
      furryScore: risk.furryScore,
      scalieScore: risk.scalieScore,
      hardEvidence,
      softEvidence,
      inferenceTime
    });

  } catch (err) {
    console.log(`  ✗ Error: ${(err as Error).message}\n`);
    results.push({
      filename,
      finalPct: 0,
      reason: "error",
      nsfwScore: 0,
      furryScore: 0,
      scalieScore: 0,
      hardEvidence: [],
      softEvidence: [],
      inferenceTime: 0,
      error: (err as Error).message
    });
  }
}

// Statistics
console.log("=== Summary Statistics ===\n");

const totalImages = results.length;
const successfulScans = results.filter(r => !r.error).length;
const failedScans = results.filter(r => r.error).length;

const highRisk = results.filter(r => r.finalPct >= 70).length;
const mediumRisk = results.filter(r => r.finalPct >= 40 && r.finalPct < 70).length;
const lowRisk = results.filter(r => r.finalPct < 40).length;

const avgScore = results.reduce((sum, r) => sum + r.finalPct, 0) / successfulScans;
const avgTime = results.filter(r => !r.error).reduce((sum, r) => sum + r.inferenceTime, 0) / successfulScans;

console.log(`Total Images: ${totalImages}`);
console.log(`Successful Scans: ${successfulScans}`);
console.log(`Failed Scans: ${failedScans}`);
console.log();

console.log(`Risk Distribution:`);
console.log(`  🔴 High Risk (70-100%): ${highRisk} (${Math.round(highRisk / successfulScans * 100)}%)`);
console.log(`  🟡 Medium Risk (40-69%): ${mediumRisk} (${Math.round(mediumRisk / successfulScans * 100)}%)`);
console.log(`  🟢 Low Risk (0-39%): ${lowRisk} (${Math.round(lowRisk / successfulScans * 100)}%)`);
console.log();

console.log(`Average Score: ${avgScore.toFixed(1)}%`);
console.log(`Average Inference Time: ${avgTime.toFixed(0)}ms`);
console.log();

// Detection rate analysis
console.log(`Detection Rate (assuming all test images are NSFW):`);
console.log(`  Detected (>=40%): ${highRisk + mediumRisk}/${successfulScans} (${Math.round((highRisk + mediumRisk) / successfulScans * 100)}%)`);
console.log(`  Missed (<40%): ${lowRisk}/${successfulScans} (${Math.round(lowRisk / successfulScans * 100)}%)`);
console.log();

// Top scores
console.log("=== Top 10 Highest Scores ===\n");
const topScores = [...results]
  .filter(r => !r.error)
  .sort((a, b) => b.finalPct - a.finalPct)
  .slice(0, 10);

topScores.forEach((r, i) => {
  const icon = r.finalPct >= 70 ? "🔴" : r.finalPct >= 40 ? "🟡" : "🟢";
  console.log(`${i + 1}. ${icon} ${r.filename.padEnd(25)} ${r.finalPct}% (${r.reason})`);
  if (r.hardEvidence.length > 0) {
    console.log(`   Hard: ${r.hardEvidence.slice(0, 3).join(", ")}`);
  }
});
console.log();

// Bottom scores (potential false negatives)
console.log("=== Bottom 10 Lowest Scores (Potential False Negatives) ===\n");
const bottomScores = [...results]
  .filter(r => !r.error)
  .sort((a, b) => a.finalPct - b.finalPct)
  .slice(0, 10);

bottomScores.forEach((r, i) => {
  const icon = r.finalPct >= 70 ? "🔴" : r.finalPct >= 40 ? "🟡" : "🟢";
  console.log(`${i + 1}. ${icon} ${r.filename.padEnd(25)} ${r.finalPct}% (${r.reason})`);
  if (r.softEvidence.length > 0) {
    console.log(`   Soft: ${r.softEvidence.slice(0, 3).join(", ")}`);
  }
});
console.log();

// Save results to CSV
const csvPath = "./tests/batch-scan-results.csv";
const csvHeader = "filename,score,reason,nsfw_score,furry_score,scalie_score,hard_evidence,soft_evidence,inference_time,error\n";
const csvRows = results.map(r => {
  return [
    r.filename,
    r.finalPct,
    r.reason,
    (r.nsfwScore * 100).toFixed(1),
    (r.furryScore * 100).toFixed(1),
    (r.scalieScore * 100).toFixed(1),
    `"${r.hardEvidence.join("; ")}"`,
    `"${r.softEvidence.join("; ")}"`,
    r.inferenceTime,
    r.error || ""
  ].join(",");
}).join("\n");

fs.writeFileSync(csvPath, csvHeader + csvRows);
console.log(`Results saved to: ${csvPath}\n`);

// Exit with status
if (lowRisk > successfulScans * 0.5) {
  console.log("⚠️  WARNING: More than 50% of images scored below 40%");
  console.log("   Consider adjusting thresholds or checking test data.\n");
  process.exit(1);
} else {
  console.log("✅ Detection rate acceptable\n");
  process.exit(0);
}
