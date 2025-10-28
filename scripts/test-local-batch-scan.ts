/**
 * Batch test avatar scanning on local image files
 * Reads files directly from disk instead of using URLs
 * Usage: npx tsx scripts/test-local-batch-scan.ts <directory>
 */

import { TAG_LABELS, loadTagLabels } from "../src/features/avatarTagger.js";
import { computeRisk } from "../src/features/avatarRisk.js";
import { logger } from "../src/lib/logger.js";
import fs from "node:fs";
import path from "node:path";

const testDir = process.argv[2] || "./assets/testing";

if (!fs.existsSync(testDir)) {
  console.error(`Error: Directory not found: ${testDir}`);
  process.exit(1);
}

console.log(`\n=== Batch Avatar NSFW Testing (Local Files) ===`);
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

// Import necessary modules for direct inference
const sharp = await import("sharp" as any);
const ort = await import("onnxruntime-node" as any);

// Load model once
const MODEL_PATH = process.env.NSFW_TAGGER_MODEL || "./models/wd-v3-tagger.onnx";
console.log(`Loading model from: ${MODEL_PATH}...`);
const modelSession = await ort.InferenceSession.create(MODEL_PATH, {
  executionProviders: ["cpu"],
  graphOptimizationLevel: "all",
});
console.log(`✓ Model loaded\n`);

const INPUT_SIZE = 448;

for (let i = 0; i < files.length; i++) {
  const filename = files[i];
  const filePath = path.join(testDir, filename);

  console.log(`[${i + 1}/${files.length}] Testing ${filename}...`);

  try {
    const startTime = Date.now();

    // Read file buffer
    const buffer = fs.readFileSync(filePath);

    // Process with sharp
    const sharpFactory = sharp.default ?? sharp;
    const { data, info } = await sharpFactory(buffer)
      .removeAlpha()
      .toColourspace("srgb")
      .resize(INPUT_SIZE, INPUT_SIZE, { fit: "cover" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 3) {
      throw new Error(`Unexpected channel count: ${info.channels}`);
    }

    // Normalize to [-1, 1] in HWC format (what the model expects)
    const H = INPUT_SIZE;
    const W = INPUT_SIZE;
    const C = 3;
    const hwc = new Float32Array(H * W * C);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let c = 0; c < C; c++) {
          const i = (y * W + x) * C + c;
          const v = data[i] / 255;
          const normalized = (v - 0.5) / 0.5;
          hwc[i] = normalized;
        }
      }
    }

    // Run inference
    const inputName = modelSession.inputNames[0];
    const inputTensor = new ort.Tensor("float32", hwc, [1, INPUT_SIZE, INPUT_SIZE, 3]);
    const feeds = { [inputName]: inputTensor };
    const inferenceResult = await modelSession.run(feeds);
    const outputName = modelSession.outputNames[0];
    const outputData = inferenceResult[outputName].data as Float32Array;

    // Build tag result
    const tags = [];
    for (let i = 0; i < Math.min(outputData.length, TAG_LABELS.length); i++) {
      if (outputData[i] > 0.1) {
        tags.push({
          name: TAG_LABELS[i],
          prob: outputData[i]
        });
      }
    }
    tags.sort((a, b) => b.prob - a.prob);

    const tagResult = {
      tags,
      meanProbs: outputData,
      maxProbs: outputData,
      meta: { cropsUsed: 1, earlyExit: false, timedOut: false, layout: "NCHW" }
    };

    // Compute risk
    const risk = computeRisk(tagResult, TAG_LABELS, { traceId: `batch-${i}` });

    const inferenceTime = Date.now() - startTime;

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
const detected = highRisk + mediumRisk;
const missed = lowRisk;
const detectionRate = (detected / successfulScans * 100).toFixed(1);
const missRate = (missed / successfulScans * 100).toFixed(1);

console.log(`Detection Rate (assuming all test images are NSFW):`);
console.log(`  🔴 Detected (>=40%): ${detected}/${successfulScans} (${detectionRate}%)`);
console.log(`  🟢 Missed (<40%): ${missed}/${successfulScans} (${missRate}%)`);
console.log();

// Save detailed results
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
console.log(`✓ Results saved to: ${csvPath}\n`);

// Show lowest scoring images (potential false negatives)
if (missed > 0) {
  console.log("=== Lowest Scores (Potential False Negatives) ===\n");
  const lowScores = [...results]
    .filter(r => !r.error && r.finalPct < 40)
    .sort((a, b) => a.finalPct - b.finalPct)
    .slice(0, Math.min(15, missed));

  lowScores.forEach((r, i) => {
    console.log(`${i + 1}. ${r.filename.padEnd(25)} ${r.finalPct}% (${r.reason})`);
    if (r.hardEvidence.length > 0) {
      console.log(`   Hard: ${r.hardEvidence.slice(0, 3).join(", ")}`);
    }
    if (r.softEvidence.length > 0) {
      console.log(`   Soft: ${r.softEvidence.slice(0, 3).join(", ")}`);
    }
  });
  console.log();
}

// Exit status
if (detected / successfulScans >= 0.7) {
  console.log(`✅ Detection rate: ${detectionRate}% (>=70% threshold met)\n`);
  process.exit(0);
} else {
  console.log(`⚠️  WARNING: Detection rate ${detectionRate}% is below 70% threshold`);
  console.log(`   Consider tuning thresholds in src/features/avatarRisk.ts\n`);
  process.exit(1);
}
