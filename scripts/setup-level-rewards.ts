/**
 * Setup level tiers and rewards for Pawtropolis
 * Usage: npx dotenvx run -- tsx scripts/setup-level-rewards.ts
 */

import Database from "better-sqlite3";
import { join } from "node:path";

const GUILD_ID = "896070888594759740";

// Level tiers (roles assigned by Amaribot)
const LEVEL_TIERS = [
  { level: 1, roleId: "896070888712175687", name: "Newcomer Fur ‹‹ LVL 1 ››" },
  { level: 5, roleId: "896070888712175688", name: "Beginner Fur ‹‹ LVL 5 ››" },
  { level: 10, roleId: "896070888712175689", name: "Chatty Fur ‹‹ LVL 10 ››" },
  { level: 15, roleId: "1280767926147878962", name: "Engaged Fur ‹‹ LVL 15 ››" },
  { level: 20, roleId: "896070888712175690", name: "Active Fur ‹‹ LVL 20 ››" },
  { level: 30, roleId: "896070888712175691", name: "Known Fur ‹‹ LVL 30 ››" },
  { level: 40, roleId: "1216956340245631006", name: "Experienced Fur ‹‹ LVL 40 ››" },
  { level: 50, roleId: "896070888712175692", name: "Noble Fur ‹‹ LVL 50 ››" },
  { level: 60, roleId: "1214944241050976276", name: "Veteran Fur ‹‹ LVL 60 ››" },
  { level: 70, roleId: "1280766451208421407", name: "Elite Fur ‹‹ LVL 70 ››" },
  { level: 80, roleId: "1280766659539501117", name: "Legendary Fur ‹‹ LVL 80 ››" },
  { level: 90, roleId: "1280766667999285329", name: "Mythic Fur ‹‹ LVL 90 ››" },
  { level: 100, roleId: "896070888712175693", name: "Eternal Fur ‹‹ LVL 100+ ››" },
];

// Level rewards (roles to grant when reaching each level)
const LEVEL_REWARDS = [
  // Level 15 rewards
  { level: 15, roleId: "1385194063841722439", name: "Byte Token [Common]" },

  // Level 30 rewards
  { level: 30, roleId: "1385194838890119229", name: "Byte Token [Rare]" },

  // Level 50 rewards
  { level: 50, roleId: "1385054283904323665", name: "AllByte Token [Epic]" },
  { level: 50, roleId: "929950578379993108", name: "OC Headshot Ticket" },

  // Level 60 rewards
  { level: 60, roleId: "1385195450856112198", name: "Byte Token [Mythic]" },

  // Level 80 rewards
  { level: 80, roleId: "1385054324295733278", name: "Byte Token [Legendary]" },
  { level: 80, roleId: "1385195806579097600", name: "AllByte Token [Legendary]" },

  // Level 100 rewards
  { level: 100, roleId: "1385195929459494952", name: "AllByte Token [Mythic]" },
  { level: 100, roleId: "1385195450856112198", name: "Byte Token [Mythic]" },
  { level: 100, roleId: "929950578379993108", name: "OC Headshot Ticket" },
];

async function main() {
  const dbPath = join(process.cwd(), "data", "data.db");
  const db = new Database(dbPath);

  console.log("Setting up level tiers and rewards for Pawtropolis...\n");

  // Insert level tiers
  console.log("=== Level Tiers ===");
  const tierStmt = db.prepare(`
    INSERT OR REPLACE INTO role_tiers (guild_id, tier_type, threshold, role_id, tier_name)
    VALUES (?, 'level', ?, ?, ?)
  `);

  for (const tier of LEVEL_TIERS) {
    tierStmt.run(GUILD_ID, tier.level, tier.roleId, tier.name);
    console.log(`  ✓ Level ${tier.level}: ${tier.name}`);
  }

  // Insert level rewards
  console.log("\n=== Level Rewards ===");
  const rewardStmt = db.prepare(`
    INSERT OR REPLACE INTO level_rewards (guild_id, level, role_id, role_name)
    VALUES (?, ?, ?, ?)
  `);

  for (const reward of LEVEL_REWARDS) {
    rewardStmt.run(GUILD_ID, reward.level, reward.roleId, reward.name);
    console.log(`  ✓ Level ${reward.level}: ${reward.name}`);
  }

  // Verify
  console.log("\n=== Verification ===");
  const tierCount = db.prepare("SELECT COUNT(*) as count FROM role_tiers WHERE guild_id = ? AND tier_type = 'level'").get(GUILD_ID) as { count: number };
  const rewardCount = db.prepare("SELECT COUNT(*) as count FROM level_rewards WHERE guild_id = ?").get(GUILD_ID) as { count: number };

  console.log(`  Level tiers configured: ${tierCount.count}`);
  console.log(`  Level rewards configured: ${rewardCount.count}`);

  db.close();
  console.log("\n✅ Setup complete!");
}

main().catch(console.error);
