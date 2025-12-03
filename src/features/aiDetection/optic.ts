/**
 * Pawtropolis Tech — src/features/aiDetection/optic.ts
 * WHAT: Optic AI Or Not API integration for AI-generated image detection.
 * WHY: One of four services used for averaged AI detection scoring.
 * DOCS: https://www.aiornot.com/docs
 */

import { logger } from "../../lib/logger.js";
import { env } from "../../lib/env.js";

const ENABLED = !!env.OPTIC_API_KEY;
const TIMEOUT_MS = 15000;

/**
 * Detect AI-generated content using Optic AI Or Not API.
 * @returns 0-1 probability of AI-generated, null if failed or not configured
 */
export async function detectOptic(imageUrl: string): Promise<number | null> {
  if (!ENABLED) {
    logger.debug("[optic] Service not configured, skipping");
    return null;
  }

  try {
    const response = await fetch("https://api.aiornot.com/v1/reports/image", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPTIC_API_KEY}`,
        "Content-Type": "application/json",
      },
      // Yes, they call it "object" not "url". Every API is a unique snowflake.
      body: JSON.stringify({
        object: imageUrl,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, imageUrl }, "[optic] API request failed");
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      report?: {
        verdict?: string;
        ai?: { confidence?: number };
      };
    };

    /*
     * Optic returns both a verdict ("ai"/"human") and a confidence score.
     * We only use the confidence since averaging string verdicts is... tricky.
     * The verdict is basically just confidence > 0.5 anyway.
     */
    const confidence = data?.report?.ai?.confidence;

    if (typeof confidence !== "number") {
      logger.warn({ data }, "[optic] Unexpected response format");
      return null;
    }

    // Confidence is already 0-1 probability
    logger.debug({ imageUrl, score: confidence }, "[optic] Detection result");
    return confidence;
  } catch (err) {
    logger.warn({ err, imageUrl }, "[optic] Detection failed");
    return null;
  }
}
