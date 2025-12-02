/**
 * Pawtropolis Tech -- src/commands/config/setAdvanced.ts
 * WHAT: Advanced/timing configuration handlers for /config set-advanced commands.
 * WHY: Groups all advanced timing and resilience configuration handlers together.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ChatInputCommandInteraction,
  MessageFlags,
  upsertConfig,
  getConfig,
  type CommandContext,
  replyOrEdit,
  ensureDeferred,
  logger,
  setSilentFirstMsgDays,
} from "./shared.js";

export async function executeSetFlagsThreshold(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the silent days threshold for flagging (7-365 days).
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_days");
  const days = interaction.options.getInteger("days", true);

  if (days < 7 || days > 365 || !Number.isInteger(days)) {
    await replyOrEdit(interaction, {
      content: 'Invalid days value. Must be an integer between 7 and 365.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  ctx.step("persist_threshold");
  try {
    setSilentFirstMsgDays(interaction.guildId!, days);
  } catch (err: any) {
    logger.error(
      { err, guildId: interaction.guildId, days },
      "[config] failed to set flags threshold"
    );
    await replyOrEdit(interaction, {
      content: `Failed to set threshold: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  logger.info(
    { evt: "config_set_flags_threshold", guildId: interaction.guildId, days },
    "[config] flags threshold updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Silent days threshold set to **${days} days**\n\nAccounts that stay silent for ${days}+ days before their first message will now be flagged.`,
  });
}

export async function executeSetReapplyCooldown(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const hours = interaction.options.getInteger("hours", true);
  upsertConfig(interaction.guildId!, { reapply_cooldown_hours: hours });

  logger.info(
    { evt: "config_set_reapply_cooldown", guildId: interaction.guildId, hours },
    "[config] reapply cooldown updated"
  );

  await replyOrEdit(interaction, {
    content: `Reapply cooldown set to **${hours} hours**`,
  });
}

export async function executeSetMinAccountAge(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const hours = interaction.options.getInteger("hours", true);
  upsertConfig(interaction.guildId!, { min_account_age_hours: hours });

  logger.info(
    { evt: "config_set_min_account_age", guildId: interaction.guildId, hours },
    "[config] min account age updated"
  );

  const display = hours === 0 ? "disabled (no minimum)" : `**${hours} hours** (${(hours / 24).toFixed(1)} days)`;
  await replyOrEdit(interaction, {
    content: `Minimum account age set to ${display}`,
  });
}

export async function executeSetMinJoinAge(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const hours = interaction.options.getInteger("hours", true);
  upsertConfig(interaction.guildId!, { min_join_age_hours: hours });

  logger.info(
    { evt: "config_set_min_join_age", guildId: interaction.guildId, hours },
    "[config] min join age updated"
  );

  const display = hours === 0 ? "disabled (no minimum)" : `**${hours} hours** (${(hours / 24).toFixed(1)} days)`;
  await replyOrEdit(interaction, {
    content: `Minimum time in server set to ${display}`,
  });
}

export async function executeSetGateAnswerLength(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the max character length for gate application answers.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_length");
  const length = interaction.options.getInteger("length", true);

  ctx.step("persist_length");
  upsertConfig(interaction.guildId!, { gate_answer_max_length: length });

  logger.info(
    { evt: "config_set_gate_answer_length", guildId: interaction.guildId, length },
    "[config] gate answer max length updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Gate answer max length set to **${length} characters**\n\nApplication answers will be limited to this length.`,
  });
}

export async function executeSetBannerSyncInterval(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the interval between banner sync updates.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_minutes");
  const minutes = interaction.options.getInteger("minutes", true);

  ctx.step("persist_interval");
  upsertConfig(interaction.guildId!, { banner_sync_interval_minutes: minutes });

  logger.info(
    { evt: "config_set_banner_sync_interval", guildId: interaction.guildId, minutes },
    "[config] banner sync interval updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Banner sync interval set to **${minutes} minute${minutes === 1 ? "" : "s"}**\n\nBanner updates will be rate-limited to this interval.`,
  });
}

export async function executeSetModmailForwardSize(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Sets the max size for modmail forward tracking.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  ctx.step("get_size");
  const size = interaction.options.getInteger("size", true);

  ctx.step("persist_size");
  upsertConfig(interaction.guildId!, { modmail_forward_max_size: size });

  logger.info(
    { evt: "config_set_modmail_forward_size", guildId: interaction.guildId, size },
    "[config] modmail forward max size updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Modmail forward tracking max size set to **${size.toLocaleString()} entries**\n\nOlder entries will be evicted when this limit is reached.`,
  });
}

export async function executeSetRetryConfig(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures retry settings for API calls.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const maxAttempts = interaction.options.getInteger("max_attempts");
  const initialDelay = interaction.options.getInteger("initial_delay_ms");
  const maxDelay = interaction.options.getInteger("max_delay_ms");

  if (maxAttempts === null && initialDelay === null && maxDelay === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Retry Configuration**\n` +
        `- Max attempts: ${cfg?.retry_max_attempts ?? 3}\n` +
        `- Initial delay: ${cfg?.retry_initial_delay_ms ?? 100}ms\n` +
        `- Max delay: ${cfg?.retry_max_delay_ms ?? 5000}ms\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (maxAttempts !== null) {
    updates.retry_max_attempts = maxAttempts;
    changes.push(`Max attempts: ${maxAttempts}`);
  }
  if (initialDelay !== null) {
    updates.retry_initial_delay_ms = initialDelay;
    changes.push(`Initial delay: ${initialDelay}ms`);
  }
  if (maxDelay !== null) {
    updates.retry_max_delay_ms = maxDelay;
    changes.push(`Max delay: ${maxDelay}ms`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_retry", guildId: interaction.guildId, updates },
    "[config] retry config updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Retry configuration updated:\n${changes.map(c => `- ${c}`).join("\n")}`,
  });
}

export async function executeSetCircuitBreaker(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures circuit breaker settings for API resilience.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const threshold = interaction.options.getInteger("threshold");
  const resetMs = interaction.options.getInteger("reset_ms");

  if (threshold === null && resetMs === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Circuit Breaker Configuration**\n` +
        `- Failure threshold: ${cfg?.circuit_breaker_threshold ?? 5} failures\n` +
        `- Reset time: ${cfg?.circuit_breaker_reset_ms ?? 60000}ms\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (threshold !== null) {
    updates.circuit_breaker_threshold = threshold;
    changes.push(`Failure threshold: ${threshold}`);
  }
  if (resetMs !== null) {
    updates.circuit_breaker_reset_ms = resetMs;
    changes.push(`Reset time: ${resetMs}ms`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_circuit_breaker", guildId: interaction.guildId, updates },
    "[config] circuit breaker config updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Circuit breaker configuration updated:\n${changes.map(c => `- ${c}`).join("\n")}`,
  });
}

export async function executeSetAvatarThresholds(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures avatar scan NSFW detection thresholds.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const hard = interaction.options.getNumber("hard");
  const soft = interaction.options.getNumber("soft");
  const racy = interaction.options.getNumber("racy");

  if (hard === null && soft === null && racy === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Avatar Scan Thresholds**\n` +
        `- Hard evidence: ${cfg?.avatar_scan_hard_threshold ?? 0.8}\n` +
        `- Soft evidence: ${cfg?.avatar_scan_soft_threshold ?? 0.5}\n` +
        `- Racy content: ${cfg?.avatar_scan_racy_threshold ?? 0.8}\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (hard !== null) {
    updates.avatar_scan_hard_threshold = hard;
    changes.push(`Hard evidence: ${hard}`);
  }
  if (soft !== null) {
    updates.avatar_scan_soft_threshold = soft;
    changes.push(`Soft evidence: ${soft}`);
  }
  if (racy !== null) {
    updates.avatar_scan_racy_threshold = racy;
    changes.push(`Racy content: ${racy}`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_avatar_thresholds", guildId: interaction.guildId, updates },
    "[config] avatar thresholds updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Avatar scan thresholds updated:\n${changes.map(c => `- ${c}`).join("\n")}`,
  });
}

export async function executeSetFlagRateLimit(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures flag command rate limiting.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const cooldownMs = interaction.options.getInteger("cooldown_ms");
  const ttlMs = interaction.options.getInteger("ttl_ms");

  if (cooldownMs === null && ttlMs === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Flag Rate Limit Configuration**\n` +
        `- Cooldown: ${cfg?.flag_rate_limit_ms ?? 2000}ms\n` +
        `- Cache TTL: ${cfg?.flag_cooldown_ttl_ms ?? 3600000}ms\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (cooldownMs !== null) {
    updates.flag_rate_limit_ms = cooldownMs;
    changes.push(`Cooldown: ${cooldownMs}ms`);
  }
  if (ttlMs !== null) {
    updates.flag_cooldown_ttl_ms = ttlMs;
    changes.push(`Cache TTL: ${ttlMs}ms`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_flag_rate_limit", guildId: interaction.guildId, updates },
    "[config] flag rate limit updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Flag rate limit configuration updated:\n${changes.map(c => `- ${c}`).join("\n")}`,
  });
}

export async function executeSetNotifyConfig(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * Configures forum post notification settings.
   */
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const cooldownSeconds = interaction.options.getInteger("cooldown_seconds");
  const maxPerHour = interaction.options.getInteger("max_per_hour");

  if (cooldownSeconds === null && maxPerHour === null) {
    // Show current config
    const cfg = getConfig(interaction.guildId!);
    await replyOrEdit(interaction, {
      content: `**Notify Configuration**\n` +
        `- Cooldown: ${cfg?.notify_cooldown_seconds ?? 5} seconds\n` +
        `- Max per hour: ${cfg?.notify_max_per_hour ?? 10}\n\n` +
        `Use options to change values.`,
    });
    return;
  }

  ctx.step("update_config");
  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (cooldownSeconds !== null) {
    updates.notify_cooldown_seconds = cooldownSeconds;
    changes.push(`Cooldown: ${cooldownSeconds}s`);
  }
  if (maxPerHour !== null) {
    updates.notify_max_per_hour = maxPerHour;
    changes.push(`Max per hour: ${maxPerHour}`);
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_notify_config", guildId: interaction.guildId, updates },
    "[config] notify config updated"
  );

  ctx.step("reply");
  await replyOrEdit(interaction, {
    content: `Notify configuration updated:\n${changes.map(c => `- ${c}`).join("\n")}`,
  });
}

export async function executeSetAvatarScanAdvanced(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  await ensureDeferred(interaction);

  const nsfwThreshold = interaction.options.getNumber("nsfw_threshold");
  const skinEdgeThreshold = interaction.options.getNumber("skin_edge_threshold");
  const weightModel = interaction.options.getNumber("weight_model");
  const weightEdge = interaction.options.getNumber("weight_edge");

  const updates: Record<string, number> = {};
  const changes: string[] = [];

  if (nsfwThreshold !== null) {
    updates.avatar_scan_nsfw_threshold = nsfwThreshold;
    changes.push(`NSFW threshold: ${nsfwThreshold}`);
  }
  if (skinEdgeThreshold !== null) {
    updates.avatar_scan_skin_edge_threshold = skinEdgeThreshold;
    changes.push(`Skin edge threshold: ${skinEdgeThreshold}`);
  }
  if (weightModel !== null) {
    updates.avatar_scan_weight_model = weightModel;
    changes.push(`Model weight: ${weightModel}`);
  }
  if (weightEdge !== null) {
    updates.avatar_scan_weight_edge = weightEdge;
    changes.push(`Edge weight: ${weightEdge}`);
  }

  if (Object.keys(updates).length === 0) {
    await replyOrEdit(interaction, {
      content: "No values provided. Specify at least one threshold to update.",
    });
    return;
  }

  upsertConfig(interaction.guildId!, updates);

  logger.info(
    { evt: "config_set_avatar_scan_advanced", guildId: interaction.guildId, updates },
    "[config] avatar scan advanced settings updated"
  );

  await replyOrEdit(interaction, {
    content: `Avatar scan settings updated:\n${changes.map(c => `- ${c}`).join("\n")}`,
  });
}
