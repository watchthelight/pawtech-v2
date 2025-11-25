/**
 * Google Cloud Vision API integration for NSFW detection
 * Specifically handles cartoon/anime/furry content better than WD v3
 *
 * SafeSearch Detection is FREE when bundled with Label Detection
 * Pricing: First 1000 requests/month free, then $1.50 per 1000
 */

import { logger } from "../lib/logger.js";

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

const GOOGLE_VISION_ENABLED = process.env.GOOGLE_VISION_API_KEY ? true : false;

// Convert likelihood enum to probability score
function likelihoodToScore(likelihood: SafeSearchLikelihood): number {
  switch (likelihood) {
    case "VERY_UNLIKELY": return 0.0;
    case "UNLIKELY": return 0.2;
    case "POSSIBLE": return 0.5;
    case "LIKELY": return 0.8;
    case "VERY_LIKELY": return 1.0;
    default: return 0.0;
  }
}

let visionClient: any = null;

async function loadVisionClient() {
  if (!GOOGLE_VISION_ENABLED) {
    return null;
  }

  if (visionClient) {
    return visionClient;
  }

  try {
    const vision = await import("@google-cloud/vision");

    // Use API key authentication (simpler than service account for this use case)
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      logger.warn("[googleVision] GOOGLE_VISION_API_KEY not set, Vision API disabled");
      return null;
    }

    // @google-cloud/vision requires service account credentials, not API key
    // We'll use direct HTTP API instead for simplicity with API key
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

    // Use Google Vision REST API directly with API key
    const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    const requestBody = {
      requests: [
        {
          image: {
            source: {
              imageUri: imageUrl
            }
          },
          features: [
            {
              type: "SAFE_SEARCH_DETECTION",
              maxResults: 1
            },
            {
              type: "LABEL_DETECTION",
              maxResults: 1
            }
          ]
        }
      ]
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000) // 15s timeout
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
    logger.warn({ err, imageUrl }, "[googleVision] Detection failed");
    return null;
  }
}

/**
 * Calculate combined NSFW score from Vision API results
 * Prioritizes adult content, but also considers racy (suggestive) content
 *
 * @param result - VisionResult from detectNsfwVision
 * @returns Combined score 0-1
 */
export function calculateVisionScore(result: VisionResult): number {
  // Prioritize adult > racy > violence
  // Adult content gets full weight
  // Racy content gets 60% weight (suggestive but not explicit)
  // Violence gets 30% weight (less relevant for NSFW in this context)

  const adultWeight = result.adultScore;
  const racyWeight = result.racyScore * 0.6;
  const violenceWeight = result.violenceScore * 0.3;

  return Math.max(adultWeight, racyWeight, violenceWeight);
}
