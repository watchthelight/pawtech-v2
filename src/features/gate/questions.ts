/**
 * Pawtropolis Tech — src/features/gate/questions.ts
 * WHAT: Reads/seeds gate questions for a guild.
 * WHY: Decouples question storage from modal rendering logic.
 * FLOWS:
 *  - getQuestions(): SELECT ordered prompts for guild
 *  - seedDefaultQuestionsIfEmpty(): INSERT default rows in a transaction
 * DOCS:
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { db } from "../../db/db.js";
import { withSql, type SqlTrackingCtx } from "../../lib/cmdWrap.js";

export type QuestionRow = { q_index: number; prompt: string; required: 0 | 1 };

// Default questions seeded for new guilds. These are intentionally simple
// to verify the applicant is human, 18+, and has read the rules.
// Question 4 (password) is the "read the rules" check - must match whatever
// is in the server's rules channel.
export const DEFAULT_QUESTIONS: ReadonlyArray<QuestionRow> = [
  { q_index: 0, prompt: "What is your age?", required: 1 },
  { q_index: 1, prompt: "How did you find this server?", required: 1 },
  { q_index: 2, prompt: "What tend to be your goals here?", required: 1 },
  { q_index: 3, prompt: "What does a furry mean to you?", required: 1 },
  { q_index: 4, prompt: "What is the password stated in our rules?", required: 1 },
];

export function getQuestions(guildId: string) {
  // SELECT question rows ordered by index; required is 0/1 integer
  return db
    .prepare(
      `
    SELECT q_index, prompt, required
    FROM guild_question
    WHERE guild_id = ?
    ORDER BY q_index ASC
  `
    )
    .all(guildId) as Array<{ q_index: number; prompt: string; required: number }>;
}

export function getQuestionCount(guildId: string) {
  // Simple count; used to detect whether to seed defaults
  const row = db
    .prepare(`SELECT COUNT(*) as n FROM guild_question WHERE guild_id = ?`)
    .get(guildId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Create or update a question. The 0-4 index limit is enforced because Discord
 * modals only support 5 text inputs max, and we map questions 1:1 to modal inputs.
 * Changing this would require multi-page modal logic changes in gate.ts.
 */
export function upsertQuestion(
  guildId: string,
  qIndex: number,
  prompt: string,
  required: 0 | 1,
  ctx?: SqlTrackingCtx
): void {
  if (qIndex < 0 || qIndex > 4) {
    throw new Error(`Question index must be between 0 and 4, got ${qIndex}`);
  }

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Question prompt must be a non-empty string');
  }

  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length === 0) {
    throw new Error('Question prompt cannot be empty or whitespace only');
  }

  if (trimmedPrompt.length > 45) {
    throw new Error('Question prompt must be 45 characters or less (Discord modal label limit)');
  }

  if (required !== 0 && required !== 1) {
    throw new Error(`Question required flag must be 0 or 1, got ${required}`);
  }

  if (!guildId || typeof guildId !== 'string' || guildId.trim().length === 0) {
    throw new Error('Guild ID must be a non-empty string');
  }

  const sql = `
    INSERT INTO guild_question (guild_id, q_index, prompt, required)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, q_index) DO UPDATE SET
      prompt = excluded.prompt,
      required = excluded.required
  `;

  const run = () => db.prepare(sql).run(guildId, qIndex, trimmedPrompt, required);

  if (ctx) {
    withSql(ctx, sql, run);
  } else {
    run();
  }
}

/**
 * Idempotent seeding - only inserts if guild has zero questions.
 * Wrapped in a transaction so we don't end up with partial question sets
 * if something fails mid-insert (e.g., disk full, connection drop).
 *
 * Returns { inserted, total } so callers know if seeding actually happened.
 * Common pattern: call on bot join or /setup command.
 */
export function seedDefaultQuestionsIfEmpty(
  guildId: string,
  ctx?: SqlTrackingCtx
): { inserted: number; total: number } {
  if (!guildId || typeof guildId !== 'string' || guildId.trim().length === 0) {
    throw new Error('Guild ID must be a non-empty string');
  }

  const count = getQuestionCount(guildId);
  if (count > 0) return { inserted: 0, total: count };

  const tx = db.transaction(() => {
    const sql = `INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)`;
    const stmt = db.prepare(sql);
    for (const q of DEFAULT_QUESTIONS) {
      if (ctx) {
        withSql(ctx, sql, () => stmt.run(guildId, q.q_index, q.prompt, q.required));
      } else {
        stmt.run(guildId, q.q_index, q.prompt, q.required);
      }
    }
  });
  tx();

  const total = getQuestionCount(guildId);
  return { inserted: total - count, total };
}
