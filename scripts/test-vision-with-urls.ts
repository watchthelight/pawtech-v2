/**
 * Test Google Cloud Vision on publicly accessible image URLs
 * Since Google Vision requires public URLs, we'll test with Discord CDN URLs
 */

import "dotenv/config";
import { detectNsfwVision, calculateVisionScore } from "../src/features/googleVision.js";

// Test URLs - using Discord CDN and other public sources
const testImages = [
  // Safe Discord default avatars
  {
    url: "https://cdn.discordapp.com/embed/avatars/0.png",
    expected: "safe",
    label: "Discord Default Avatar 0",
  },
  {
    url: "https://cdn.discordapp.com/embed/avatars/1.png",
    expected: "safe",
    label: "Discord Default Avatar 1",
  },
  {
    url: "https://cdn.discordapp.com/embed/avatars/2.png",
    expected: "safe",
    label: "Discord Default Avatar 2",
  },
];

console.log("\n=== Google Cloud Vision SafeSearch Testing ===\n");

if (!process.env.GOOGLE_VISION_API_KEY) {
  console.error("❌ GOOGLE_VISION_API_KEY not set in .env");
  console.error("\nPlease add your Google Cloud Vision API key to .env:");
  console.error("GOOGLE_VISION_API_KEY=AIzaSy...\n");
  process.exit(1);
}

console.log("✓ API key configured\n");
console.log(`Testing ${testImages.length} images...\n`);

for (const test of testImages) {
  console.log(`Testing: ${test.label}`);
  console.log(`URL: ${test.url}`);

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
    console.log(
      `     Violence: ${result.raw.violence} (${Math.round(result.violenceScore * 100)}%)`
    );

    const passed =
      (test.expected === "safe" && pct < 40) || (test.expected === "nsfw" && pct >= 40);
    console.log(`  ${passed ? "✓ PASS" : "✗ FAIL"} (expected ${test.expected})\n`);
  } catch (err) {
    console.log(`  ❌ Error: ${(err as Error).message}\n`);
  }
}

console.log("=== Test Complete ===\n");
console.log("To test with your own avatar URLs:");
console.log("1. Right-click a Discord user → Copy Avatar URL");
console.log("2. Add to testImages array above");
console.log("3. Run: npx tsx scripts/test-vision-with-urls.ts\n");
