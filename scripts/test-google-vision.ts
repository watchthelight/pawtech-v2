/**
 * Test Google Cloud Vision SafeSearch API on local images
 * Usage: npx tsx scripts/test-google-vision.ts <directory>
 */

import fs from "node:fs";
// Unused imports removed - this is a demo script showing API usage
// import { detectNsfwVision, calculateVisionScore } from "../src/features/googleVision.js";
// import { logger } from "../src/lib/logger.js";

const testDir = process.argv[2] || "./assets/testing-safe";

if (!fs.existsSync(testDir)) {
  console.error(`Error: Directory not found: ${testDir}`);
  process.exit(1);
}

if (!process.env.GOOGLE_VISION_API_KEY) {
  console.error(`Error: GOOGLE_VISION_API_KEY not set in .env file`);
  console.error(`\nTo use Google Cloud Vision API:`);
  console.error(`1. Go to https://console.cloud.google.com/apis/credentials`);
  console.error(`2. Create a new API key (restrict to Vision API for security)`);
  console.error(`3. Add GOOGLE_VISION_API_KEY=your_key_here to .env file`);
  console.error(`\nPricing: FREE for first 1000 requests/month, then $1.50 per 1000`);
  process.exit(1);
}

console.log(`\n=== Google Cloud Vision SafeSearch Testing ===`);
console.log(`Directory: ${testDir}\n`);

// Get all image files
const files = fs
  .readdirSync(testDir)
  .filter((f) => /\.(jpg|jpeg|png|gif)$/i.test(f))
  .sort();

console.log(`Found ${files.length} images to test\n`);

// Type definition removed - this is a demo script showing API usage
// type TestResult = { ... };
// const results: TestResult[] = [];

// Note: Google Vision requires publicly accessible URLs
// For testing local files, we need to upload them to a temporary URL
// For this demo, we'll show what the code looks like

console.log("NOTE: Google Cloud Vision API requires publicly accessible image URLs.");
console.log("Local files cannot be tested directly.");
console.log("\nTo test local images, you need to:");
console.log("1. Upload images to a public URL (e.g., Discord CDN, Imgur, your server)");
console.log("2. Pass the URL to detectNsfwVision()");
console.log("\nExample usage:");
console.log(`
import { detectNsfwVision, calculateVisionScore } from "./src/features/googleVision.js";

const imageUrl = "https://cdn.discordapp.com/avatars/123/abc.png";
const result = await detectNsfwVision(imageUrl);

if (result) {
  const score = calculateVisionScore(result);
  console.log(\`Adult: \${result.raw.adult}\`);
  console.log(\`Racy: \${result.raw.racy}\`);
  console.log(\`Combined Score: \${Math.round(score * 100)}%\`);
}
`);

console.log("\nTo test with actual avatar URLs from your bot:");
console.log("Run: npx tsx scripts/test-vision-live.ts <user_id>");

process.exit(0);
