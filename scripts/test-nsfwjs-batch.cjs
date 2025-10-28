/**
 * Test nsfwjs model on batch of local images
 * Usage: node scripts/test-nsfwjs-batch.js <directory>
 */

const fs = require("fs");
const path = require("path");
const nsfwjs = require("nsfwjs");
const tf = require("@tensorflow/tfjs-node");

const testDir = process.argv[2] || "./assets/testing";

if (!fs.existsSync(testDir)) {
  console.error(`Error: Directory not found: ${testDir}`);
  process.exit(1);
}

async function main() {
  console.log(`\n=== NSFWJS Batch Testing ===`);
  console.log(`Directory: ${testDir}\n`);

  // Get all image files
  const files = fs.readdirSync(testDir)
    .filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f))
    .sort();

  console.log(`Found ${files.length} images to test\n`);

  const results = [];

  // Load model
  console.log("Loading nsfwjs model...");
  const startLoad = Date.now();
  const model = await nsfwjs.load();
  const loadTime = Date.now() - startLoad;
  console.log(`✓ Model loaded in ${loadTime}ms\n`);

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filePath = path.join(testDir, filename);

    console.log(`[${i + 1}/${files.length}] Testing ${filename}...`);

    try {
      const buffer = fs.readFileSync(filePath);

      const startTime = Date.now();
      const tensor = tf.node.decodeImage(buffer, 3);

      let predictions;
      try {
        predictions = await model.classify(tensor, 5);
      } finally {
        tensor.dispose();
      }

      const inferenceTime = Date.now() - startTime;

      const porn = predictions.find((p) => p.className.toLowerCase() === "porn")?.probability ?? 0;
      const hentai = predictions.find((p) => p.className.toLowerCase() === "hentai")?.probability ?? 0;
      const sexy = predictions.find((p) => p.className.toLowerCase() === "sexy")?.probability ?? 0;
      const maxScore = Math.max(porn, hentai, sexy);

      const pct = Math.round(maxScore * 100);
      const icon = pct >= 70 ? "🔴" : pct >= 40 ? "🟡" : "🟢";

      console.log(`  ${icon} Score: ${pct}% (porn: ${Math.round(porn * 100)}%, hentai: ${Math.round(hentai * 100)}%, sexy: ${Math.round(sexy * 100)}%) - ${inferenceTime}ms`);
      console.log();

      results.push({
        filename,
        pornScore: porn,
        hentaiScore: hentai,
        sexyScore: sexy,
        maxScore,
        predictions,
        inferenceTime
      });

    } catch (err) {
      console.log(`  ✗ Error: ${err.message}\n`);
      results.push({
        filename,
        pornScore: 0,
        hentaiScore: 0,
        sexyScore: 0,
        maxScore: 0,
        predictions: [],
        inferenceTime: 0,
        error: err.message
      });
    }
  }

  // Statistics
  console.log("=== Summary Statistics ===\n");

  const totalImages = results.length;
  const successfulScans = results.filter(r => !r.error).length;
  const failedScans = results.filter(r => r.error).length;

  const highRisk = results.filter(r => r.maxScore >= 0.70).length;
  const mediumRisk = results.filter(r => r.maxScore >= 0.40 && r.maxScore < 0.70).length;
  const lowRisk = results.filter(r => r.maxScore < 0.40).length;

  const avgScore = results.reduce((sum, r) => sum + r.maxScore, 0) / successfulScans;
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

  console.log(`Average Score: ${(avgScore * 100).toFixed(1)}%`);
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
    .sort((a, b) => b.maxScore - a.maxScore)
    .slice(0, 10);

  topScores.forEach((r, i) => {
    const pct = Math.round(r.maxScore * 100);
    const icon = pct >= 70 ? "🔴" : pct >= 40 ? "🟡" : "🟢";
    const porn = Math.round(r.pornScore * 100);
    const hentai = Math.round(r.hentaiScore * 100);
    const sexy = Math.round(r.sexyScore * 100);
    console.log(`${i + 1}. ${icon} ${r.filename.padEnd(30)} ${pct}% (p:${porn}% h:${hentai}% s:${sexy}%)`);
  });
  console.log();

  // Bottom scores (potential false negatives)
  console.log("=== Bottom 10 Lowest Scores (Potential False Negatives) ===\n");
  const bottomScores = [...results]
    .filter(r => !r.error)
    .sort((a, b) => a.maxScore - b.maxScore)
    .slice(0, 10);

  bottomScores.forEach((r, i) => {
    const pct = Math.round(r.maxScore * 100);
    const icon = pct >= 70 ? "🔴" : pct >= 40 ? "🟡" : "🟢";
    const porn = Math.round(r.pornScore * 100);
    const hentai = Math.round(r.hentaiScore * 100);
    const sexy = Math.round(r.sexyScore * 100);
    console.log(`${i + 1}. ${icon} ${r.filename.padEnd(30)} ${pct}% (p:${porn}% h:${hentai}% s:${sexy}%)`);
  });
  console.log();

  // Save results to CSV
  const csvPath = "./tests/nsfwjs-batch-results.csv";
  const csvHeader = "filename,max_score,porn_score,hentai_score,sexy_score,inference_time,error\n";
  const csvRows = results.map(r => {
    return [
      r.filename,
      (r.maxScore * 100).toFixed(1),
      (r.pornScore * 100).toFixed(1),
      (r.hentaiScore * 100).toFixed(1),
      (r.sexyScore * 100).toFixed(1),
      r.inferenceTime,
      r.error || ""
    ].join(",");
  }).join("\n");

  fs.writeFileSync(csvPath, csvHeader + csvRows);
  console.log(`Results saved to: ${csvPath}\n`);

  // Exit with status
  if (lowRisk > successfulScans * 0.5) {
    console.log("⚠️  WARNING: More than 50% of images scored below 40%");
    console.log("   NSFWJS detection rate insufficient for production use.\n");
    process.exit(1);
  } else {
    console.log("✅ Detection rate acceptable (>50% detected at 40% threshold)\n");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
