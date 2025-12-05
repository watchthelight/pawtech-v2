/**
 * Pawtropolis Tech — src/features/aiDetection/rapidai.ts
 * WHAT: RapidAPI AI Art Detection integration for AI-generated image detection.
 * WHY: One of four services used for averaged AI detection scoring.
 * DOCS: https://rapidapi.com/hammas.majeed/api/ai-generated-image-detection-api
 */

import { logger } from "../../lib/logger.js";
import { env } from "../../lib/env.js";

const ENABLED = !!env.RAPIDAPI_KEY;
const TIMEOUT_MS = 15000;

const RAPIDAPI_HOST = "ai-generated-image-detection-api.p.rapidapi.com";

/**
 * Detect AI-generated content using RapidAPI AI Art Detection.
 * @returns 0-1 probability of AI-generated, null if failed or not configured
 */
export async function detectRapidAI(imageUrl: string): Promise<number | null> {
  if (!ENABLED) {
    logger.debug("[rapidai] Service not configured, skipping");
    return null;
  }

  try {
    const response = await fetch(`https://${RAPIDAPI_HOST}/v1/image/detect-ai-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": env.RAPIDAPI_KEY!,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
      },
      body: JSON.stringify({
        type: "url",
        url: imageUrl,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, imageUrl }, "[rapidai] API request failed");
      throw new Error(`HTTP ${response.status}`);
    }

    /*
     * RapidAPI AI Art Detection response format can vary. Common fields:
     * - ai_generated_probability / probability / score / ai_score
     * - prediction: "AI generated" | "Original"
     * We check multiple possible field names for resilience.
     */
    const data = (await response.json()) as {
      ai_generated_probability?: number;
      probability?: number;
      score?: number;
      ai_score?: number;
      prediction?: string;
    };

    // Try various field names that might contain the score
    let score = data?.ai_generated_probability ?? data?.probability ?? data?.score ?? data?.ai_score;

    // If we got a prediction string but no score, infer from prediction
    if (typeof score !== "number" && data?.prediction) {
      const pred = data.prediction.toLowerCase();
      if (pred.includes("ai") || pred.includes("generated")) {
        score = 0.9; // High confidence AI
      } else if (pred.includes("original") || pred.includes("human") || pred.includes("real")) {
        score = 0.1; // Low confidence AI (likely human)
      }
    }

    if (typeof score !== "number") {
      logger.warn({ data }, "[rapidai] Unexpected response format");
      return null;
    }

    // Normalize score to 0-1 range if it's in percentage (0-100)
    if (score > 1) {
      score = score / 100;
    }

    logger.debug({ imageUrl, score }, "[rapidai] Detection result");
    return score;
  } catch (err) {
    logger.warn({ err, imageUrl }, "[rapidai] Detection failed");
    return null;
  }
}
