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

export function upsertQuestion(
  guildId: string,
  qIndex: number,
  prompt: string,
  required: 0 | 1,
  ctx?: SqlTrackingCtx
): void {
  // Validate q_index is in range 0-4
  if (qIndex < 0 || qIndex > 4) {
    throw new Error(`Question index must be between 0 and 4, got ${qIndex}`);
  }

  const sql = `
    INSERT INTO guild_question (guild_id, q_index, prompt, required)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, q_index) DO UPDATE SET
      prompt = excluded.prompt,
      required = excluded.required
  `;

  const run = () => db.prepare(sql).run(guildId, qIndex, prompt, required);

  if (ctx) {
    withSql(ctx, sql, run);
  } else {
    run();
  }
}

export function seedDefaultQuestionsIfEmpty(
  guildId: string,
  ctx?: SqlTrackingCtx
): { inserted: number; total: number } {
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
