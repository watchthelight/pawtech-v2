/**
 * Pawtropolis Tech — src/features/aiDetection/hive.ts
 * WHAT: Hive Moderation API integration for AI-generated image detection.
 * WHY: One of four services used for averaged AI detection scoring.
 * DOCS: https://docs.thehive.ai/docs/ai-generated-media-recognition
 */

import { logger } from "../../lib/logger.js";
import { env } from "../../lib/env.js";

const ENABLED = !!env.HIVE_API_KEY;
const TIMEOUT_MS = 15000;

/**
 * Detect AI-generated content using Hive Moderation API.
 * @returns 0-1 probability of AI-generated, null if failed or not configured
 */
export async function detectHive(imageUrl: string): Promise<number | null> {
  if (!ENABLED) {
    logger.info("[hive] Service not configured (no HIVE_API_KEY), skipping");
    return null;
  }
  logger.info("[hive] Service enabled, calling API...");

  try {
    const response = await fetch("https://api.thehive.ai/api/v2/task/sync", {
      method: "POST",
      headers: {
        Authorization: `Token ${env.HIVE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: imageUrl,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, imageUrl }, "[hive] API request failed");
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      status?: Array<{
        response?: {
          output?: Array<{
            classes?: Array<{ class: string; score: number }>;
          }>;
        };
      }>;
    };

    // Hive response structure:
    // { status: [...], output: [{ classes: [{ class: "ai_generated", score: 0.95 }] }] }
    const output = data?.status?.[0]?.response?.output;
    if (!output || !Array.isArray(output)) {
      logger.warn({ data }, "[hive] Unexpected response format - no output");
      return null;
    }

    // Find the ai_generated class score
    for (const item of output) {
      if (!item.classes || !Array.isArray(item.classes)) continue;
      for (const cls of item.classes) {
        if (cls.class === "ai_generated" && typeof cls.score === "number") {
          logger.debug({ imageUrl, score: cls.score }, "[hive] Detection result");
          return cls.score;
        }
      }
    }

    logger.warn({ data }, "[hive] No ai_generated class in response");
    return null;
  } catch (err) {
    logger.warn({ err, imageUrl }, "[hive] Detection failed");
    return null;
  }
}
