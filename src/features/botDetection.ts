/**
 * Pawtropolis Tech — src/features/botDetection.ts
 * WHAT: Bot account detection heuristics for /audit command
 * WHY: Centralize detection logic for identifying suspicious bot-like accounts
 * FLOWS:
 *  - analyzeMemember(member, guildId) → AuditResult
 *  - calculateUsernameEntropy(name) → number
 *  - matchesBotPattern(name) → { match: boolean; pattern: string | null }
 *  - hasLevelRole(member, minLevel) → boolean
 *  - checkActivityLevel(guildId, userId) → Promise<{ hasActivity: boolean; firstMessageAt: number | null }>
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { GuildMember } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

// Detection thresholds
// GOTCHA: These thresholds were tuned empirically on a furry art server.
// Your mileage may vary on a corporate Discord. Adjust if false positive rate is high.
export const DETECTION_CONFIG = {
  FLAG_THRESHOLD: 4, // Minimum score to flag
  ACCOUNT_AGE_DAYS: 7, // Account younger than this is suspicious
  MIN_LEVEL: 5, // Must have at least this level to be considered engaged
  ENTROPY_THRESHOLD: 3.5, // High entropy in username = suspicious
} as const;

// Scoring weights
export const SCORING = {
  NO_AVATAR: 2,
  NEW_ACCOUNT: 3,
  NO_ACTIVITY: 2,
  LOW_LEVEL: 1,
  BOT_USERNAME: 2,
  SUSPICIOUS_BIO: 1,
} as const;

export const MAX_SCORE = Object.values(SCORING).reduce((a, b) => a + b, 0);

export interface AuditResult {
  userId: string;
  username: string;
  score: number;
  reasons: string[];
  shouldFlag: boolean;
}

export interface ActivityCheckResult {
  hasActivity: boolean;
  firstMessageAt: number | null;
  messageCount: number;
}

/**
 * Calculate Shannon entropy of a string
 * Higher entropy = more random/bot-like
 *
 * WHY Shannon entropy? It measures information density. A name like "john" has
 * low entropy (few unique chars, predictable). "xK9mQ2vL" has high entropy
 * (many unique chars, no pattern). Spambots love random strings because they
 * can generate millions of unique accounts without a naming committee.
 */
export function calculateUsernameEntropy(name: string): number {
  if (!name || name.length === 0) return 0;

  const freq: Record<string, number> = {};
  for (const char of name) {
    freq[char] = (freq[char] || 0) + 1;
  }

  let entropy = 0;
  const len = name.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Check if username matches known bot patterns
 */
export function matchesBotPattern(name: string): { match: boolean; pattern: string | null } {
  // Default Discord names: username_1234, User12345
  // These are what Discord generates when someone signs up without picking a username.
  // Not inherently suspicious, but bots rarely bother changing them.
  if (/^[a-z]+[_-]?\d{4,}$/i.test(name)) {
    return { match: true, pattern: "default Discord format" };
  }

  // Sequential numbers at end (5+ digits)
  if (/\d{5,}$/.test(name)) {
    return { match: true, pattern: "sequential numbers" };
  }

  // Check for high entropy with mixed case/numbers (random strings)
  // EDGE CASE: This will flag legitimate users with names like "XxDragon420xX"
  // but honestly, do we really want those people anyway? (kidding, mostly)
  const hasNumbers = /\d/.test(name);
  const hasMixedCase = /[a-z]/.test(name) && /[A-Z]/.test(name);
  const entropy = calculateUsernameEntropy(name);

  if (entropy > DETECTION_CONFIG.ENTROPY_THRESHOLD && (hasNumbers || hasMixedCase) && name.length >= 8) {
    return { match: true, pattern: "high entropy random string" };
  }

  return { match: false, pattern: null };
}

/**
 * Check if member has a level role >= minLevel
 * Looks for Amaribot-style "Level X" roles
 *
 * GOTCHA: This is tightly coupled to AmariBot's role naming convention.
 * If you use MEE6 or another leveling bot with different role names,
 * this function will never match anything. You'll need to adjust the regex.
 */
export function hasLevelRole(member: GuildMember, minLevel: number = DETECTION_CONFIG.MIN_LEVEL): boolean {
  const levelPattern = /^Level\s*(\d+)$/i;

  for (const role of member.roles.cache.values()) {
    const match = role.name.match(levelPattern);
    if (match) {
      const level = parseInt(match[1], 10);
      if (level >= minLevel) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check user's activity level from database
 */
export function checkActivityLevel(guildId: string, userId: string): ActivityCheckResult {
  try {
    // Check user_activity for first_message_at
    const userActivity = db
      .prepare(`SELECT first_message_at FROM user_activity WHERE guild_id = ? AND user_id = ?`)
      .get(guildId, userId) as { first_message_at: number | null } | undefined;

    // Count messages in message_activity
    const messageCount = db
      .prepare(`SELECT COUNT(*) as count FROM message_activity WHERE guild_id = ? AND user_id = ?`)
      .get(guildId, userId) as { count: number } | undefined;

    const count = messageCount?.count ?? 0;
    const firstMessageAt = userActivity?.first_message_at ?? null;

    return {
      hasActivity: count > 0 || firstMessageAt !== null,
      firstMessageAt,
      messageCount: count,
    };
  } catch (err) {
    logger.error({ err, guildId, userId }, "[botDetection] Failed to check activity level");
    // Default to having activity to avoid false positives.
    // WHY: If the DB is having a bad day, we'd rather let a bot slip through
    // than mass-flag every legitimate user. False negatives < false positives.
    return { hasActivity: true, firstMessageAt: null, messageCount: 0 };
  }
}

/**
 * Analyze a member for bot-like characteristics
 */
export function analyzeMember(member: GuildMember, guildId: string): AuditResult {
  const reasons: string[] = [];
  let score = 0;

  const user = member.user;
  const username = user.username;

  // 1. No avatar (default profile)
  if (!user.avatar) {
    score += SCORING.NO_AVATAR;
    reasons.push("No avatar (default profile)");
  }

  // 2. Low account age (under 7 days)
  const accountAgeMs = Date.now() - user.createdTimestamp;
  const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
  if (accountAgeDays < DETECTION_CONFIG.ACCOUNT_AGE_DAYS) {
    score += SCORING.NEW_ACCOUNT;
    reasons.push(`Account ${Math.floor(accountAgeDays)} days old`);
  }

  // 3. Low server activity
  const activity = checkActivityLevel(guildId, user.id);
  if (!activity.hasActivity) {
    score += SCORING.NO_ACTIVITY;
    reasons.push("No recorded message activity");
  }

  // 4. Low server level (no Level 5+ role)
  if (!hasLevelRole(member, DETECTION_CONFIG.MIN_LEVEL)) {
    score += SCORING.LOW_LEVEL;
    reasons.push(`Below Level ${DETECTION_CONFIG.MIN_LEVEL} (no engagement)`);
  }

  // 5. Bot-like username patterns
  const patternCheck = matchesBotPattern(username);
  if (patternCheck.match) {
    score += SCORING.BOT_USERNAME;
    reasons.push(`Suspicious username: ${patternCheck.pattern}`);
  }

  // 6. Suspicious bio (if accessible) - skip for now as bio requires additional fetch
  // Could be added later with member.user.fetch() but that's expensive.
  // WHY we don't: Each fetch is an API call. Scanning 10k members = 10k API calls.
  // Discord will rate limit us into oblivion. Not worth it unless targeted.

  return {
    userId: user.id,
    username,
    score,
    reasons,
    shouldFlag: score >= DETECTION_CONFIG.FLAG_THRESHOLD,
  };
}

/**
 * Render a progress bar string
 */
export function renderProgressBar(current: number, total: number, width = 20): string {
  if (total === 0) return `[${"░".repeat(width)}] 0/0 (0%)`;

  const pct = current / total;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = "▓".repeat(filled) + "░".repeat(empty);
  return `[${bar}] ${current.toLocaleString()}/${total.toLocaleString()} (${Math.round(pct * 100)}%)`;
}

/**
 * Stats tracking for audit summary
 */
export interface AuditStats {
  noAvatar: number;
  newAccount: number;
  noActivity: number;
  lowLevel: number;
  botUsername: number;
}

export function createEmptyStats(): AuditStats {
  return {
    noAvatar: 0,
    newAccount: 0,
    noActivity: 0,
    lowLevel: 0,
    botUsername: 0,
  };
}

// This string-matching approach is fragile. If someone changes the reason text
// in analyzeMember, this silently breaks. A proper fix would use an enum or
// structured reasons, but this works and I have other problems to solve.
export function updateStats(stats: AuditStats, reasons: string[]): void {
  for (const reason of reasons) {
    if (reason.includes("No avatar")) stats.noAvatar++;
    if (reason.includes("days old")) stats.newAccount++;
    if (reason.includes("No recorded message")) stats.noActivity++;
    if (reason.includes("Below Level")) stats.lowLevel++;
    if (reason.includes("Suspicious username")) stats.botUsername++;
  }
}
