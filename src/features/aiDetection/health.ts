/**
 * Pawtropolis Tech — src/features/aiDetection/health.ts
 * WHAT: Health check and test functions for AI detection services.
 * WHY: Validates API keys and service connectivity before saving to .env.
 */

import { logger } from "../../lib/logger.js";
import { env } from "../../lib/env.js";

/*
 * Wikipedia's PNG transparency demo image. Chosen because it's stable,
 * CORS-friendly, and definitely not AI-generated (it's just colored boxes).
 * If Wikipedia goes down, we have bigger problems.
 */
const TEST_IMAGE_URL = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/300px-PNG_transparency_demonstration_1.png";
const TIMEOUT_MS = 15000;

export interface ServiceHealth {
  service: "hive" | "illuminarty" | "sightengine" | "optic";
  displayName: string;
  configured: boolean;
  // null means we haven't tested yet, not that we're philosophically
  // uncertain about whether the service exists
  healthy: boolean | null;
  error?: string;
  docsUrl: string;
  envVars: string[];
}

/**
 * Get current configuration status for all services (without testing).
 */
export function getServiceStatus(): ServiceHealth[] {
  return [
    {
      service: "hive",
      displayName: "Hive Moderation",
      configured: !!env.HIVE_API_KEY,
      healthy: null,
      docsUrl: "https://thehive.ai/",
      envVars: ["HIVE_API_KEY"],
    },
    {
      service: "illuminarty",
      displayName: "Illuminarty",
      configured: !!env.ILLUMINARTY_API_KEY,
      healthy: null,
      docsUrl: "https://illuminarty.ai/",
      envVars: ["ILLUMINARTY_API_KEY"],
    },
    {
      service: "sightengine",
      displayName: "SightEngine",
      configured: !!(env.SIGHTENGINE_API_USER && env.SIGHTENGINE_API_SECRET),
      healthy: null,
      docsUrl: "https://sightengine.com/",
      envVars: ["SIGHTENGINE_API_USER", "SIGHTENGINE_API_SECRET"],
    },
    {
      service: "optic",
      displayName: "Optic AI Or Not",
      configured: !!env.OPTIC_API_KEY,
      healthy: null,
      docsUrl: "https://aiornot.com/",
      envVars: ["OPTIC_API_KEY"],
    },
  ];
}

/**
 * Test Hive API key.
 */
export async function testHive(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.thehive.ai/api/v2/task/sync", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: TEST_IMAGE_URL }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // 401 is "bad key", anything else is "weird server problem"
      if (response.status === 401) {
        return { success: false, error: "Invalid API key (401 Unauthorized)" };
      }
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    // We don't care about the actual result, just that the response shape
    // looks right. If output exists, the API is working.
    if (data?.status?.[0]?.response?.output) {
      return { success: true };
    }
    return { success: false, error: "Unexpected response format" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "[aiHealth] Hive test failed");
    return { success: false, error: msg };
  }
}

/**
 * Test Illuminarty API key.
 */
export async function testIlluminarty(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.illuminarty.ai/v1/detect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: TEST_IMAGE_URL }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: "Invalid API key (Unauthorized)" };
      }
      return { success: false, error: `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "[aiHealth] Illuminarty test failed");
    return { success: false, error: msg };
  }
}

/**
 * Test SightEngine API credentials.
 */
export async function testSightEngine(apiUser: string, apiSecret: string): Promise<{ success: boolean; error?: string }> {
  try {
    const params = new URLSearchParams({
      url: TEST_IMAGE_URL,
      models: "genai",
      api_user: apiUser,
      api_secret: apiSecret,
    });

    const response = await fetch(`https://api.sightengine.com/1.0/check.json?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: "Invalid credentials (Unauthorized)" };
      }
      return { success: false, error: `HTTP ${response.status}` };
    }

    /*
     * GOTCHA: SightEngine can return 200 OK with an error in the body.
     * Always check the status field. Classic API design.
     */
    const data = (await response.json()) as { status?: string; error?: { message?: string } };
    if (data.status === "success") {
      return { success: true };
    }
    if (data.error?.message) {
      return { success: false, error: data.error.message };
    }
    return { success: false, error: "Unexpected response" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "[aiHealth] SightEngine test failed");
    return { success: false, error: msg };
  }
}

/**
 * Test Optic API key.
 */
export async function testOptic(apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.aiornot.com/v1/reports/image", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ object: TEST_IMAGE_URL }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: "Invalid API key (Unauthorized)" };
      }
      return { success: false, error: `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "[aiHealth] Optic test failed");
    return { success: false, error: msg };
  }
}

/**
 * Test all currently configured services.
 * Runs tests in parallel because life's too short to wait for 4 sequential
 * health checks at 15 seconds each.
 */
export async function testAllConfigured(): Promise<ServiceHealth[]> {
  const services = getServiceStatus();

  const tests = services.map(async (svc) => {
    // Skip testing services that aren't even configured. No point
    // in asking "is this key valid" when the key is empty string.
    if (!svc.configured) {
      return svc;
    }

    let result: { success: boolean; error?: string };

    switch (svc.service) {
      case "hive":
        result = await testHive(env.HIVE_API_KEY!);
        break;
      case "illuminarty":
        result = await testIlluminarty(env.ILLUMINARTY_API_KEY!);
        break;
      case "sightengine":
        result = await testSightEngine(env.SIGHTENGINE_API_USER!, env.SIGHTENGINE_API_SECRET!);
        break;
      case "optic":
        result = await testOptic(env.OPTIC_API_KEY!);
        break;
    }

    return {
      ...svc,
      healthy: result.success,
      error: result.error,
    };
  });

  return Promise.all(tests);
}
