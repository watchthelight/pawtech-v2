/**
 * Pawtropolis Tech — src/features/aiDetection/illuminarty.ts
 * WHAT: Illuminarty API integration for AI-generated image detection.
 * WHY: One of four services used for averaged AI detection scoring.
 * DOCS: https://illuminarty.ai/docs (API documentation)
 */

import { logger } from "../../lib/logger.js";
import { env } from "../../lib/env.js";

const ENABLED = !!env.ILLUMINARTY_API_KEY;
const TIMEOUT_MS = 15000;

/**
 * Detect AI-generated content using Illuminarty API.
 * @returns 0-1 probability of AI-generated, null if failed or not configured
 */
export async function detectIlluminarty(imageUrl: string): Promise<number | null> {
  if (!ENABLED) {
    logger.debug("[illuminarty] Service not configured, skipping");
    return null;
  }

  try {
    const response = await fetch("https://api.illuminarty.ai/v1/detect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ILLUMINARTY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: imageUrl,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, imageUrl }, "[illuminarty] API request failed");
      throw new Error(`HTTP ${response.status}`);
    }

    /*
     * Illuminarty can't decide what to call the score field. We've seen
     * ai_probability, probability, and score in the wild. Check all three
     * and pray one of them exists.
     */
    const data = (await response.json()) as {
      ai_probability?: number;
      probability?: number;
      score?: number;
    };

    // Nullish coalesce through all the possible field names
    const score = data?.ai_probability ?? data?.probability ?? data?.score;

    if (typeof score !== "number") {
      logger.warn({ data }, "[illuminarty] Unexpected response format");
      return null;
    }

    logger.debug({ imageUrl, score }, "[illuminarty] Detection result");
    return score;
  } catch (err) {
    logger.warn({ err, imageUrl }, "[illuminarty] Detection failed");
    return null;
  }
}
