/**
 * Pawtropolis Tech — src/features/aiDetection/index.ts
 * WHAT: Orchestrates AI-generated image detection across multiple services.
 * WHY: Provides averaged, reliable AI detection by combining multiple third-party APIs.
 * FLOWS:
 *  - detectAIForImages(): Process multiple images, return results for each
 *  - detectAIForImage(): Call all 4 services in parallel, aggregate scores
 *  - buildAIDetectionEmbed(): Format results as Discord embed
 */

import { EmbedBuilder, type Message } from "discord.js";
import { detectHive } from "./hive.js";
import { detectRapidAI } from "./rapidai.js";
import { detectSightEngine } from "./sightengine.js";
import { detectOptic } from "./optic.js";
import type { AIDetectionResult, AIDetectionService, ServiceResult } from "./types.js";
import { logger } from "../../lib/logger.js";
import { getEnabledServices } from "../../store/aiDetectionToggles.js";

/*
 * We obfuscate the actual service names in the UI so users don't game the
 * system by learning which specific detectors are weak against their
 * particular flavor of AI slop. Yes, people actually do this.
 */
const SERVICE_NAMES: Record<AIDetectionService, string> = {
  hive: "Engine 1",
  rapidai: "Engine 2",
  sightengine: "Engine 3",
  optic: "Engine 4",
};

/**
 * Process a settled promise result into a ServiceResult.
 */
function processResult(
  result: PromiseSettledResult<number | null>,
  service: AIDetectionService
): ServiceResult {
  if (result.status === "fulfilled") {
    return {
      service,
      displayName: SERVICE_NAMES[service],
      score: result.value,
    };
  } else {
    const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);

    logger.warn({ service, error: errorMsg }, "[aiDetection] Service failed");

    return {
      service,
      displayName: SERVICE_NAMES[service],
      score: null,
      error: errorMsg,
    };
  }
}

/**
 * Get the detection function for a service.
 */
function getDetector(service: AIDetectionService): (url: string) => Promise<number | null> {
  switch (service) {
    case "hive":
      return detectHive;
    case "rapidai":
      return detectRapidAI;
    case "sightengine":
      return detectSightEngine;
    case "optic":
      return detectOptic;
  }
}

/**
 * Detect AI-generated content in a single image using enabled services.
 * @param guildId - Guild ID to check which services are enabled
 */
export async function detectAIForImage(
  imageUrl: string,
  imageName: string,
  guildId: string
): Promise<AIDetectionResult> {
  const enabledServices = getEnabledServices(guildId);

  logger.info(
    { imageUrl, imageName, enabledServices },
    "[aiDetection] Starting detection for image"
  );

  if (enabledServices.length === 0) {
    return {
      imageUrl,
      imageName,
      services: [],
      averageScore: null,
      successCount: 0,
      failureCount: 0,
    };
  }

  /*
   * GOTCHA: We use allSettled, not all. If one janky API is down (happens
   * more than you'd think), we still get results from the others instead
   * of the whole thing exploding. The averaging math handles missing scores.
   */
  const detectionPromises = enabledServices.map((svc) => getDetector(svc)(imageUrl));
  const results = await Promise.allSettled(detectionPromises);

  const services: ServiceResult[] = enabledServices.map((svc, i) =>
    processResult(results[i], svc)
  );

  /*
   * Only average the services that actually responded. A null score means
   * either "not configured" or "API threw up". Either way, we pretend it
   * doesn't exist rather than tanking the average with zeros.
   */
  const successfulScores = services.filter((s) => s.score !== null).map((s) => s.score!);

  const averageScore =
    successfulScores.length > 0
      ? successfulScores.reduce((a, b) => a + b, 0) / successfulScores.length
      : null;

  return {
    imageUrl,
    imageName,
    services,
    averageScore,
    successCount: successfulScores.length,
    failureCount: enabledServices.length - successfulScores.length,
  };
}

/**
 * Detect AI-generated content in multiple images.
 * Processes images sequentially to avoid overwhelming APIs.
 * @param guildId - Guild ID to check which services are enabled
 */
export async function detectAIForImages(
  images: Array<{ url: string; name: string }>,
  guildId: string
): Promise<AIDetectionResult[]> {
  const results: AIDetectionResult[] = [];

  // Sequential on purpose. Each image already fires N parallel API calls,
  // so doing images in parallel = N * M simultaneous requests = rate limits.
  for (const img of images) {
    const result = await detectAIForImage(img.url, img.name, guildId);
    results.push(result);
  }

  return results;
}

/**
 * Render a visual score bar using block characters.
 * @param score 0-1 probability
 * @returns String like "████████░░" for 80%
 */
function renderScoreBar(score: number): string {
  const filled = Math.round(score * 10);
  const empty = 10 - filled;
  // Unicode block characters. Looks pretty in Discord, horrifying in logs.
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

/**
 * Build a Discord embed displaying AI detection results.
 */
export function buildAIDetectionEmbed(results: AIDetectionResult[], message: Message): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("AI Detection Results")
    .setColor(0x3b82f6) // Blue
    .setTimestamp()
    .setFooter({ text: `Beta Feature | Message from ${message.author.tag}` });

  // Add message link at the top
  embed.setDescription(`[Jump to message](${message.url})`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const imageHeader = results.length > 1 ? `Image ${i + 1}` : "Image";

    // Build service breakdown with visual bars
    const serviceLines = result.services.map((s) => {
      if (s.score !== null) {
        const pct = Math.round(s.score * 100);
        const bar = renderScoreBar(s.score);
        return `${s.displayName}: ${bar} ${pct}%`;
      } else if (s.error) {
        return `${s.displayName}: \u274C Error`;
      } else {
        return `${s.displayName}: \u2014 Not configured`;
      }
    });

    // Average line
    let avgLine: string;
    if (result.averageScore !== null) {
      const avgPct = Math.round(result.averageScore * 100);
      avgLine = `**Overall Average: ${avgPct}% AI-generated**`;
    } else {
      avgLine = "**Overall Average: Unable to calculate**";
    }

    const totalServices = result.services.length;
    const fieldValue = [
      avgLine,
      "",
      ...serviceLines,
      "",
      totalServices > 0
        ? `${result.successCount}/${totalServices} services responded`
        : "No services enabled",
    ].join("\n");

    embed.addFields({
      name: imageHeader,
      value: fieldValue,
      inline: false,
    });
  }

  return embed;
}
