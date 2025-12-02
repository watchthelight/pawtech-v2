/**
 * Pawtropolis Tech — src/lib/validation.ts
 * WHAT: Input validation helpers for database operations.
 * WHY: Centralize validation logic to prevent invalid data from reaching the database.
 * FLOWS:
 *  - validateSnowflake(id) → throws if invalid Discord snowflake
 *  - validateNonEmpty(value, fieldName) → throws if empty/whitespace-only string
 * DOCS:
 *  - Discord snowflakes: https://discord.com/developers/docs/reference#snowflakes
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * Discord snowflake regex pattern.
 * Snowflakes are 17-20 digit numeric strings representing unique IDs.
 * The first snowflake (Discord epoch) was 2015-01-01, yielding ~17 digits.
 * Current snowflakes are ~19 digits, with room to grow to 20.
 */
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

/**
 * ValidationError
 * WHAT: Custom error class for validation failures.
 * WHY: Allows callers to distinguish validation errors from other errors.
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * validateSnowflake
 * WHAT: Validates that a string is a valid Discord snowflake ID.
 * WHY: Prevents invalid IDs from being stored in the database.
 *
 * @param id - The ID to validate
 * @param fieldName - Optional field name for error messages (e.g., "guildId", "userId")
 * @throws ValidationError if the ID is not a valid snowflake
 *
 * @example
 * validateSnowflake("123456789012345678"); // OK
 * validateSnowflake("invalid"); // throws ValidationError
 * validateSnowflake("", "userId"); // throws ValidationError: "userId cannot be empty"
 */
export function validateSnowflake(id: string, fieldName = "id"): void {
  if (!id || typeof id !== "string") {
    throw new ValidationError(`${fieldName} cannot be empty`, fieldName);
  }

  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty`, fieldName);
  }

  if (!SNOWFLAKE_PATTERN.test(trimmed)) {
    throw new ValidationError(
      `${fieldName} must be a valid Discord snowflake (17-20 digits), got: "${trimmed}"`,
      fieldName
    );
  }
}

/**
 * validateNonEmpty
 * WHAT: Validates that a string is not empty or whitespace-only.
 * WHY: Prevents empty strings from being stored where meaningful data is required.
 *
 * @param value - The string to validate
 * @param fieldName - Field name for error messages
 * @throws ValidationError if the value is empty or whitespace-only
 *
 * @example
 * validateNonEmpty("hello", "reason"); // OK
 * validateNonEmpty("", "reason"); // throws ValidationError
 * validateNonEmpty("   ", "reason"); // throws ValidationError
 */
export function validateNonEmpty(value: string, fieldName: string): void {
  if (!value || typeof value !== "string") {
    throw new ValidationError(`${fieldName} cannot be empty`, fieldName);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty or whitespace-only`, fieldName);
  }
}

/**
 * isValidSnowflake
 * WHAT: Non-throwing version of validateSnowflake.
 * WHY: For cases where you want to check validity without exception handling.
 *
 * @param id - The ID to check
 * @returns true if valid snowflake, false otherwise
 *
 * @example
 * if (isValidSnowflake(input)) {
 *   // safe to use as snowflake
 * }
 */
export function isValidSnowflake(id: unknown): id is string {
  if (!id || typeof id !== "string") {
    return false;
  }
  return SNOWFLAKE_PATTERN.test(id.trim());
}

/**
 * isNonEmpty
 * WHAT: Non-throwing version of validateNonEmpty.
 * WHY: For cases where you want to check emptiness without exception handling.
 *
 * @param value - The value to check
 * @returns true if non-empty string, false otherwise
 *
 * @example
 * if (isNonEmpty(input)) {
 *   // safe to use as non-empty string
 * }
 */
export function isNonEmpty(value: unknown): value is string {
  if (!value || typeof value !== "string") {
    return false;
  }
  return value.trim().length > 0;
}
