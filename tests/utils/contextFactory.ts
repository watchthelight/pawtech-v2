/**
 * Pawtropolis Tech -- tests/utils/contextFactory.ts
 * WHAT: Factory for creating CommandContext objects for testing.
 * WHY: Commands receive a structured context; tests need to provide the same shape.
 * USAGE:
 *  import { createTestCommandContext } from "../utils/contextFactory.js";
 *  const ctx = createTestCommandContext(mockInteraction);
 *  await executeSetup(ctx);
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { vi } from "vitest";
import type { ChatInputCommandInteraction, ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import type { CommandContext, InstrumentedInteraction } from "../../src/lib/cmdWrap.js";

// ===== Context Factory =====

/**
 * Creates a test CommandContext that wraps an interaction.
 *
 * The context provides:
 * - step(): Tracks the current execution phase (useful for debugging)
 * - currentPhase(): Returns the current phase name
 * - setLastSql(): Tracks the last SQL query for error diagnostics
 * - getTraceId() / traceId: Returns a fixed trace ID for deterministic tests
 *
 * @param interaction - The Discord interaction mock
 * @param options - Optional configuration
 * @returns A CommandContext suitable for testing
 *
 * @example
 * const interaction = createMockInteraction({ guildId: "test-guild" });
 * const ctx = createTestCommandContext(interaction);
 * await executeSetup(ctx);
 * expect(ctx.currentPhase()).toBe("reply");
 */
export function createTestCommandContext<I extends InstrumentedInteraction = ChatInputCommandInteraction>(
  interaction: I,
  options: {
    traceId?: string;
    onStep?: (phase: string) => void;
    onSql?: (sql: string | null) => void;
  } = {}
): CommandContext<I> {
  const traceId = options.traceId ?? "test-trace-123";
  let currentPhase = "enter";
  let lastSql: string | null = null;

  return {
    interaction,
    step: (phase: string) => {
      currentPhase = phase;
      options.onStep?.(phase);
    },
    currentPhase: () => currentPhase,
    setLastSql: (sql: string | null) => {
      lastSql = sql;
      options.onSql?.(sql);
    },
    getTraceId: () => traceId,
    traceId,
  };
}

/**
 * Creates a spied CommandContext for verifying step/SQL calls.
 *
 * @param interaction - The Discord interaction mock
 * @returns Object with context and spy functions
 *
 * @example
 * const { ctx, stepSpy, sqlSpy } = createSpiedCommandContext(mockInteraction);
 * await someHandler(ctx);
 * expect(stepSpy).toHaveBeenCalledWith("validate_input");
 */
export function createSpiedCommandContext<I extends InstrumentedInteraction = ChatInputCommandInteraction>(
  interaction: I,
  options: { traceId?: string } = {}
): {
  ctx: CommandContext<I>;
  stepSpy: ReturnType<typeof vi.fn>;
  sqlSpy: ReturnType<typeof vi.fn>;
  phases: string[];
} {
  const stepSpy = vi.fn();
  const sqlSpy = vi.fn();
  const phases: string[] = [];

  const ctx = createTestCommandContext(interaction, {
    traceId: options.traceId,
    onStep: (phase) => {
      phases.push(phase);
      stepSpy(phase);
    },
    onSql: sqlSpy,
  });

  return { ctx, stepSpy, sqlSpy, phases };
}

// ===== Typed Context Factories =====

/**
 * Creates a CommandContext specifically for ChatInputCommandInteraction.
 */
export function createSlashCommandContext(
  interaction: ChatInputCommandInteraction,
  options: { traceId?: string } = {}
): CommandContext<ChatInputCommandInteraction> {
  return createTestCommandContext(interaction, options);
}

/**
 * Creates a CommandContext specifically for ButtonInteraction.
 */
export function createButtonContext(
  interaction: ButtonInteraction,
  options: { traceId?: string } = {}
): CommandContext<ButtonInteraction> {
  return createTestCommandContext(interaction, options);
}

/**
 * Creates a CommandContext specifically for ModalSubmitInteraction.
 */
export function createModalContext(
  interaction: ModalSubmitInteraction,
  options: { traceId?: string } = {}
): CommandContext<ModalSubmitInteraction> {
  return createTestCommandContext(interaction, options);
}

// ===== SQL Tracking Context =====

/**
 * Creates a minimal SQL tracking context for testing database utilities.
 * Use this when you only need setLastSql functionality.
 */
export function createSqlTrackingContext(): {
  ctx: { setLastSql: (sql: string | null) => void };
  getLastSql: () => string | null;
  sqlHistory: string[];
} {
  let lastSql: string | null = null;
  const sqlHistory: string[] = [];

  return {
    ctx: {
      setLastSql: (sql: string | null) => {
        lastSql = sql;
        if (sql) sqlHistory.push(sql);
      },
    },
    getLastSql: () => lastSql,
    sqlHistory,
  };
}
