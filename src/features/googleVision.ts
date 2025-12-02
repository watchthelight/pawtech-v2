/**
 * Google Cloud Vision API integration for NSFW detection
 * Specifically handles cartoon/anime/furry content better than WD v3
 *
 * SafeSearch Detection is FREE when bundled with Label Detection
 * Pricing: First 1000 requests/month free, then $1.50 per 1000
 */

import { logger } from "../lib/logger.js";
import { classifyError, shouldReportToSentry, errorContext } from "../lib/errors.js";
import { captureException } from "../lib/sentry.js";

type SafeSearchLikelihood = "UNKNOWN" | "VERY_UNLIKELY" | "UNLIKELY" | "POSSIBLE" | "LIKELY" | "VERY_LIKELY";

type SafeSearchAnnotation = {
  adult: SafeSearchLikelihood;
  spoof: SafeSearchLikelihood;
  medical: SafeSearchLikelihood;
  violence: SafeSearchLikelihood;
  racy: SafeSearchLikelihood;
};

type VisionResult = {
  adultScore: number;      // 0-1 probability
  racyScore: number;       // 0-1 probability (suggestive content)
  violenceScore: number;   // 0-1 probability
  raw: SafeSearchAnnotation;
};

/** Google Vision API response shape */
type VisionAPIResponse = {
  responses?: Array<{
    safeSearchAnnotation?: SafeSearchAnnotation;
  }>;
};

// Feature flag - disabled if no API key configured. This is intentional:
// running without Vision API just means we skip this detection layer.
const GOOGLE_VISION_ENABLED = process.env.GOOGLE_VISION_API_KEY ? true : false;

/**
 * Maps Google's categorical likelihood enum to numeric probability.
 * These mappings are somewhat arbitrary - Google doesn't publish exact percentages.
 * We use conservative estimates that err toward flagging suspicious content.
 *
 * POSSIBLE at 0.5 is the "maybe" threshold - warrants human review.
 */
function likelihoodToScore(likelihood: SafeSearchLikelihood): number {
  switch (likelihood) {
    case "VERY_UNLIKELY": return 0.0;
    case "UNLIKELY": return 0.2;
    case "POSSIBLE": return 0.5;
    case "LIKELY": return 0.8;
    case "VERY_LIKELY": return 1.0;
    default: return 0.0;  // UNKNOWN treated as safe - fail open
  }
}

// Singleton pattern for client - avoid re-initializing on every request.
// Note: We don't actually use the SDK anymore (see below), but keeping the
// lazy-load pattern in case we switch back to SDK auth later.
let visionClient: any = null;

/**
 * Legacy SDK loader - kept for potential future use.
 *
 * We switched to direct HTTP API because:
 * 1. @google-cloud/vision requires service account JSON, not API keys
 * 2. API key auth via REST is simpler for this single-endpoint use case
 * 3. Avoids bundling the entire Google Cloud SDK just for SafeSearch
 */
async function loadVisionClient() {
  if (!GOOGLE_VISION_ENABLED) {
    return null;
  }

  if (visionClient) {
    return visionClient;
  }

  try {
    const vision = await import("@google-cloud/vision");

    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      logger.warn("[googleVision] GOOGLE_VISION_API_KEY not set, Vision API disabled");
      return null;
    }

    // Marker object - actual calls use HTTP API, not SDK
    visionClient = { useHttpApi: true };
    return visionClient;
  } catch (err) {
    logger.error({ err }, "[googleVision] Failed to load Vision SDK");
    return null;
  }
}

/**
 * Detect NSFW content using Google Cloud Vision SafeSearch API
 * Works well with cartoon/anime/hentai/furry content
 *
 * @param imageUrl - Public URL to the image
 * @returns VisionResult with adult/racy/violence scores (0-1)
 */
export async function detectNsfwVision(imageUrl: string): Promise<VisionResult | null> {
  if (!GOOGLE_VISION_ENABLED) {
    return null;
  }

  try {
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return null;
    }

    // Direct REST API call - simpler than SDK for API key auth.
    // Security: API key passed via X-Goog-Api-Key header instead of URL query param
    // to prevent accidental exposure in logs, browser history, or referrer headers.
    const endpoint = "https://vision.googleapis.com/v1/images:annotate";

    // We request both SAFE_SEARCH_DETECTION and LABEL_DETECTION.
    // This is a pricing optimization: SafeSearch is FREE when bundled with
    // any other detection type. Label detection is the cheapest add-on.
    const requestBody = {
      requests: [
        {
          image: {
            source: {
              imageUri: imageUrl  // Must be publicly accessible URL
            }
          },
          features: [
            {
              type: "SAFE_SEARCH_DETECTION",
              maxResults: 1
            },
            {
              type: "LABEL_DETECTION",
              maxResults: 1  // We don't use labels, just need it for free SafeSearch
            }
          ]
        }
      ]
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ status: response.status, error: errorText }, "[googleVision] API request failed");
      return null;
    }

    const data = await response.json() as VisionAPIResponse;

    if (!data.responses || !data.responses[0]) {
      logger.warn({ data }, "[googleVision] Unexpected response format");
      return null;
    }

    const safeSearch = data.responses[0].safeSearchAnnotation;

    if (!safeSearch) {
      logger.warn("[googleVision] No SafeSearch annotation in response");
      return null;
    }

    const result: VisionResult = {
      adultScore: likelihoodToScore(safeSearch.adult),
      racyScore: likelihoodToScore(safeSearch.racy),
      violenceScore: likelihoodToScore(safeSearch.violence),
      raw: safeSearch
    };

    logger.debug({
      imageUrl,
      adult: safeSearch.adult,
      racy: safeSearch.racy,
      violence: safeSearch.violence,
      scores: {
        adult: result.adultScore,
        racy: result.racyScore,
        violence: result.violenceScore
      }
    }, "[googleVision] SafeSearch result");

    return result;

  } catch (err) {
    const classified = classifyError(err);

    logger.warn({
      err,
      imageUrl: imageUrl.substring(0, 100), // Truncate for logs
      errorKind: classified.kind,
      ...errorContext(classified)
    }, "[googleVision] Detection failed");

    // Only report to Sentry if not a transient network error
    if (shouldReportToSentry(classified)) {
      captureException(err instanceof Error ? err : new Error(String(err)), {
        feature: "googleVision",
        imageUrl: imageUrl.substring(0, 100),
      });
    }

    return null;
  }
}

/**
 * Calculate combined NSFW score from Vision API results.
 *
 * Design decision: We use max() instead of weighted average because a single
 * strong signal (e.g., adult=0.9) should trigger review regardless of other
 * scores. Averaging would dilute clear violations.
 *
 * Weight rationale:
 * - Adult (1.0x): explicit content, always flag
 * - Racy (0.6x): suggestive but not explicit, might be fine for furry server
 * - Violence (0.3x): less relevant here, but gore avatars are still a concern
 *
 * @param result - VisionResult from detectNsfwVision
 * @returns Combined score 0-1, where >0.5 typically warrants review
 */
export function calculateVisionScore(result: VisionResult): number {
  const adultWeight = result.adultScore;
  const racyWeight = result.racyScore * 0.6;
  const violenceWeight = result.violenceScore * 0.3;

  return Math.max(adultWeight, racyWeight, violenceWeight);
}
