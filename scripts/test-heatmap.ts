/**
 * Test script for multi-week activity heatmap generation
 * USAGE: tsx scripts/test-heatmap.ts [weeks]
 */

import { generateSampleData, saveHeatmap } from '../src/lib/activityHeatmap.js';
import { join } from 'path';

async function main() {
  // Get weeks parameter from command line (default: 1)
  const weeks = parseInt(process.argv[2] || '1', 10);

  if (weeks < 1 || weeks > 8) {
    console.error('Error: weeks parameter must be between 1 and 8');
    process.exit(1);
  }

  console.log(`Generating ${weeks}-week activity heatmap...`);

  const data = generateSampleData(weeks);

  console.log('Data generated:');
  console.log(`  - Weeks: ${data.weeks.length}`);
  console.log(`  - Days per week: 7 (Mon-Sun)`);
  console.log(`  - Hours per day: 24 (0-23)`);
  console.log(`  - Max activity: ${data.maxValue}`);
  console.log(`  - Total messages: ${data.trends.totalMessages}`);
  console.log(`  - Date range: ${data.weeks[data.weeks.length - 1].startDate.toLocaleDateString()} to ${data.weeks[0].endDate.toLocaleDateString()}`);

  const filename = weeks === 1 ? 'activity-heatmap-sample.png' : `activity-heatmap-${weeks}weeks.png`;
  const outputPath = join(process.cwd(), 'assets', filename);

  await saveHeatmap(data, outputPath);

  console.log(`Heatmap saved to: ${outputPath}`);
  console.log('Open this file to view the generated heatmap!');
}

main().catch((err) => {
  console.error('Error generating heatmap:', err);
  process.exit(1);
});
