/**
 * Test Google Cloud Vision on E621 furry images (safe and explicit)
 */

import "dotenv/config";
import { detectNsfwVision, calculateVisionScore } from "../src/features/googleVision.js";

// Test images from E621 CDN
const testImages = [
  // SAFE furry images (rating:s)
  {
    url: "https://static1.e621.net/data/54/85/5485b95e8eb1cb7702caf01794f1c99e.png",
    expected: "safe",
    label: "E621 Safe - FNAF Comic",
    id: 763439,
  },
  {
    url: "https://static1.e621.net/data/ae/bb/aebbdd542e18159060b4694ca357e78a.png",
    expected: "safe",
    label: "E621 Safe - Bear eating burger",
    id: 2318066,
  },
  {
    url: "https://static1.e621.net/data/8b/ba/8bba52e564aca14f529ebbcd4c462ea9.jpg",
    expected: "safe",
    label: "E621 Safe - Orca portrait",
    id: 4293526,
  },
  {
    url: "https://static1.e621.net/data/2c/36/2c36798d3018469807133b7e295a9379.jpg",
    expected: "safe",
    label: "E621 Safe - Donald Duck superhero",
    id: 5762978,
  },
  {
    url: "https://static1.e621.net/data/3a/93/3a9322efb590489c0cf90b1af70dea05.jpg",
    expected: "safe",
    label: "E621 Safe - Wolf eating pizza (topless)",
    id: 4827968,
  },

  // EXPLICIT furry images (rating:e) - from e621-nsfw-sample.json
  {
    url: "https://static1.e621.net/data/a7/36/a736fee1690c3f359d567638e29740ef.jpg",
    expected: "nsfw",
    label: "E621 Explicit - Mouse masturbation",
    id: 1945980,
  },
  {
    url: "https://static1.e621.net/data/2e/ca/2eca2d4c765b5a16c274ec4f3787aa2b.jpg",
    expected: "nsfw",
    label: "E621 Explicit - Nicole Watterson",
    id: 1306133,
  },
  {
    url: "https://static1.e621.net/data/bc/5b/bc5b10e29c89a9c69dbcce3def3aeb94.png",
    expected: "nsfw",
    label: "E621 Explicit - Frog bondage (nude)",
    id: 5672696,
  },
  {
    url: "https://static1.e621.net/data/39/6c/396c9cfa1941b2c3277515757738a4d1.jpg",
    expected: "nsfw",
    label: "E621 Explicit - Wolf sex",
    id: 3158161,
  },
];

console.log("\n=== Google Cloud Vision - E621 Furry Content Test ===\n");

if (!process.env.GOOGLE_VISION_API_KEY) {
  console.error("❌ GOOGLE_VISION_API_KEY not set");
  process.exit(1);
}

type TestStats = {
  total: number;
  safeTests: number;
  nsfwTests: number;
  safeCorrect: number;
  nsfwCorrect: number;
  falsePositives: number;
  falseNegatives: number;
};

const stats: TestStats = {
  total: 0,
  safeTests: 0,
  nsfwTests: 0,
  safeCorrect: 0,
  nsfwCorrect: 0,
  falsePositives: 0,
  falseNegatives: 0,
};

for (const test of testImages) {
  console.log(`\n[${stats.total + 1}/${testImages.length}] ${test.label}`);
  console.log(`E621 ID: ${test.id}`);
  console.log(`Expected: ${test.expected.toUpperCase()}`);

  stats.total++;
  if (test.expected === "safe") stats.safeTests++;
  else stats.nsfwTests++;

  try {
    const result = await detectNsfwVision(test.url);

    if (!result) {
      console.log("  ❌ Detection failed (API error)\n");
      continue;
    }

    const score = calculateVisionScore(result);
    const pct = Math.round(score * 100);
    const icon = pct >= 70 ? "🔴" : pct >= 40 ? "🟡" : "🟢";

    console.log(`  ${icon} Score: ${pct}%`);
    console.log(`     Adult: ${result.raw.adult} (${Math.round(result.adultScore * 100)}%)`);
    console.log(`     Racy: ${result.raw.racy} (${Math.round(result.racyScore * 100)}%)`);

    const detected = pct >= 40;
    const correct =
      (test.expected === "safe" && !detected) || (test.expected === "nsfw" && detected);

    if (correct) {
      console.log(`  ✓ PASS`);
      if (test.expected === "safe") stats.safeCorrect++;
      else stats.nsfwCorrect++;
    } else {
      console.log(`  ✗ FAIL`);
      if (test.expected === "safe") {
        stats.falsePositives++;
        console.log(`     False Positive: Safe image flagged as NSFW`);
      } else {
        stats.falseNegatives++;
        console.log(`     False Negative: NSFW image not detected`);
      }
    }
  } catch (err) {
    console.log(`  ❌ Error: ${(err as Error).message}`);
  }
}

console.log("\n\n" + "=".repeat(80));
console.log("  FINAL RESULTS");
console.log("=".repeat(80));

console.log(`\nTotal Tests: ${stats.total}`);
console.log(`  Safe Images: ${stats.safeTests}`);
console.log(`  NSFW Images: ${stats.nsfwTests}`);

console.log(`\n✓ Correct Detections:`);
console.log(
  `  Safe correctly identified: ${stats.safeCorrect}/${stats.safeTests} (${Math.round((stats.safeCorrect / stats.safeTests) * 100)}%)`
);
console.log(
  `  NSFW correctly detected: ${stats.nsfwCorrect}/${stats.nsfwTests} (${Math.round((stats.nsfwCorrect / stats.nsfwTests) * 100)}%)`
);

console.log(`\n✗ Errors:`);
console.log(`  False Positives: ${stats.falsePositives} (safe flagged as NSFW)`);
console.log(`  False Negatives: ${stats.falseNegatives} (NSFW not detected)`);

const accuracy = ((stats.safeCorrect + stats.nsfwCorrect) / stats.total) * 100;
console.log(`\n🎯 Overall Accuracy: ${Math.round(accuracy)}%`);

if (accuracy >= 80) {
  console.log(`\n✅ EXCELLENT - Google Vision works well for furry content!`);
} else if (accuracy >= 60) {
  console.log(`\n🟡 GOOD - Acceptable detection rate`);
} else {
  console.log(`\n❌ POOR - Detection rate too low`);
}

console.log("\n" + "=".repeat(80) + "\n");
