/**
 * Pawtropolis Tech — src/features/aiDetection/sightengine.ts
 * WHAT: SightEngine API integration for AI-generated image detection.
 * WHY: One of four services used for averaged AI detection scoring.
 * DOCS: https://sightengine.com/docs/ai-generated-image-detection
 */

import { logger } from "../../lib/logger.js";
import { env } from "../../lib/env.js";

const ENABLED = !!(env.SIGHTENGINE_API_USER && env.SIGHTENGINE_API_SECRET);
const TIMEOUT_MS = 15000;

/**
 * Detect AI-generated content using SightEngine API.
 * @returns 0-1 probability of AI-generated, null if failed or not configured
 */
export async function detectSightEngine(imageUrl: string): Promise<number | null> {
  if (!ENABLED) {
    logger.debug("[sightengine] Service not configured, skipping");
    return null;
  }

  try {
    const params = new URLSearchParams({
      url: imageUrl,
      models: "genai",
      api_user: env.SIGHTENGINE_API_USER!,
      api_secret: env.SIGHTENGINE_API_SECRET!,
    });

    const response = await fetch(`https://api.sightengine.com/1.0/check.json?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, imageUrl }, "[sightengine] API request failed");
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      type?: { ai_generated?: number };
      status?: string;
    };

    // SightEngine response structure:
    // { type: { ai_generated: 0.95 }, status: "success" }
    const score = data?.type?.ai_generated;

    if (typeof score !== "number") {
      logger.warn({ data }, "[sightengine] Unexpected response format");
      return null;
    }

    logger.debug({ imageUrl, score }, "[sightengine] Detection result");
    return score;
  } catch (err) {
    logger.warn({ err, imageUrl }, "[sightengine] Detection failed");
    return null;
  }
}
