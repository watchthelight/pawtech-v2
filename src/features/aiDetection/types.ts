/**
 * Pawtropolis Tech — src/features/aiDetection/types.ts
 * WHAT: Type definitions for AI-generated image detection.
 * WHY: Shared types between orchestrator and service integrations.
 */

/** Supported AI detection service identifiers */
export type AIDetectionService = "hive" | "illuminarty" | "sightengine" | "optic";

/** Result from a single detection service */
export type ServiceResult = {
  service: AIDetectionService;
  displayName: string;
  /** 0-1 probability of AI-generated, null if service failed or not configured */
  score: number | null;
  /** Error message if service failed */
  error?: string;
};

/** Aggregated detection result for a single image */
export type AIDetectionResult = {
  imageUrl: string;
  imageName: string;
  services: ServiceResult[];
  /** Average of successful service scores, null if all failed */
  averageScore: number | null;
  successCount: number;
  failureCount: number;
};
