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

/**
 * Aggregated detection result for a single image.
 * Contains results from all 4 services, even if some failed.
 */
export type AIDetectionResult = {
  imageUrl: string;
  imageName: string;
  services: ServiceResult[];
  // null here means every single service failed or is misconfigured.
  // At that point, something is deeply wrong with the setup.
  averageScore: number | null;
  successCount: number;
  // Failures happen. A lot. APIs have bad days. Plan accordingly.
  failureCount: number;
};
