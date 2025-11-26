// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Review Card UI Tests
 *
 * These tests verify the Discord embed rendering for application review cards.
 * The review card is the primary interface moderators use to approve/reject applications.
 *
 * Key behaviors tested:
 * - Button states based on claim/resolution status
 * - Embed fields (title, footer, avatar risk, account age)
 * - Feature flag toggling (GATE_SHOW_AVATAR_RISK)
 * - Timestamp formatting (ISO strings vs Unix epochs)
 *
 * Mock Strategy:
 * Several tests use vi.doMock to override environment variables. This is necessary
 * because the feature flags are read at module load time, so we need to reset
 * the module cache and re-import after changing the mock.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildDecisionComponents,
  formatSubmittedFooter,
  renderReviewEmbed,
  type ReviewClaimRow,
} from "../../src/features/review.js";
import { ButtonStyle } from "discord.js";
import { googleReverseImageUrl } from "../../src/features/avatarScan.js";
import { shortCode } from "../../src/lib/ids.js";
import { logger } from "../../src/lib/logger.js";
import { nowUtc } from "../../src/lib/time.js";

describe("review card UI", () => {
  // When no moderator has claimed an application, only the Claim button appears.
  // This prevents multiple mods from working on the same app simultaneously.
  it("shows Claim button when unclaimed", () => {
    const rows = buildDecisionComponents("submitted", "test-app-123", null);
    expect(rows).toHaveLength(1);
    const buttons = rows[0].components;
    expect(buttons).toHaveLength(1);
    const btnData = buttons[0].toJSON();
    expect(btnData.label).toBe("Claim");
    expect(btnData.style).toBe(ButtonStyle.Secondary);
  });

  // Once an application is resolved (approved/rejected/kicked), the action buttons
  // disappear. This prevents accidental double-actions and makes it clear the
  // review is complete.
  it("hides decision buttons for resolved applications", () => {
    const claim: ReviewClaimRow = {
      reviewer_id: "reviewer-2",
      claimed_at: new Date().toISOString(),
    };
    // Test all three terminal states
    const rowsApproved = buildDecisionComponents("approved", "test-app-789", claim);
    expect(rowsApproved).toHaveLength(0);

    const rowsRejected = buildDecisionComponents("rejected", "test-app-abc", claim);
    expect(rowsRejected).toHaveLength(0);

    const rowsKicked = buildDecisionComponents("kicked", "test-app-def", claim);
    expect(rowsKicked).toHaveLength(0);
  });

  // Comprehensive embed structure test with avatar risk feature enabled.
  // The vi.doMock/vi.resetModules dance is needed because GATE_SHOW_AVATAR_RISK
  // is evaluated at import time, not runtime.
  it("renders embed title, footer, account age, and avatar risk field with HEX6 code", async () => {
    vi.resetModules();
    // Override the feature flag to show avatar risk analysis
    vi.doMock("../../src/lib/env.js", async () => {
      const actual =
        await vi.importActual<typeof import("../../src/lib/env.js")>("../../src/lib/env.js");
      return { ...actual, GATE_SHOW_AVATAR_RISK: true };
    });

    try {
      // Re-import after mocking to get the updated feature flag value
      const { renderReviewEmbed } = await import("../../src/features/review.js");

      const submittedAt = "2025-01-15T12:34:56.000Z";
      // Account age is used to flag potential alt accounts (very new accounts)
      const accountCreatedAt = Date.UTC(2020, 4, 10, 9, 30, 0);

      const app = {
        id: "4737d4d0-2d8b-49a0-b17d-e51c1555e60d",
        guild_id: "guild-1",
        user_id: "user-1",
        status: "submitted" as const,
        created_at: submittedAt,
        submitted_at: submittedAt,
        updated_at: null,
        resolved_at: null,
        resolver_id: null,
        resolution_reason: null,
        userTag: "Paw#0001",
        avatarUrl: "https://cdn.discordapp.com/avatars/user-1/avatar.png",
        lastAction: null,
      };

      const answers = [
        {
          q_index: 0,
          question: "What brings you here?",
          answer: "Just exploring.",
        },
      ];

      // Avatar scan result from the ML classifier. finalPct is the weighted
      // combination of nsfwScore and edgeScore that determines the risk level.
      const avatarScan = {
        finalPct: 72,
        nsfwScore: 0.88,
        edgeScore: 0.3,
        reason: "both",
      };

      const embed = renderReviewEmbed(
        app,
        answers,
        [],
        avatarScan,
        null,
        accountCreatedAt
      ).toJSON();
      // shortCode extracts the first 6 chars of the UUID's hex portion
      const code = shortCode(app.id);
      const epoch = Math.floor(new Date(submittedAt).getTime() / 1000);
      const timestamp = `<t:${epoch}:f>`;
      const accountSeconds = Math.floor(accountCreatedAt / 1000);

      // Title format: "New application from @{tag} . App #{code}"
      expect(embed.title).toBe(`New application from @${app.userTag} • App #${code}`);
      // PR3: Footer now includes unified timestamps (plain text, no Discord tags)
      expect(embed.footer).toBeDefined();
      expect(embed.footer?.text).toContain("Submitted:");
      expect(embed.footer?.text).toContain("UTC");
      expect(embed.footer?.text).toMatch(/ago|just now/);
      expect(embed.footer?.text).not.toMatch(/<t:/);
      expect(embed.footer?.text).toContain("App ID:");
      expect(embed.thumbnail?.url).toBe(app.avatarUrl);

      // When GATE_SHOW_AVATAR_RISK is true, the Avatar Risk field shows:
      // - NSFW percentage from the ML classifier
      // - Link to Google reverse image search for manual verification
      const riskField = embed.fields?.find((field) => field.name === "Avatar Risk");
      expect(riskField).toBeDefined();

      const expectedLink = googleReverseImageUrl(app.avatarUrl);
      expect(riskField?.value).toContain(
        `NSFW Avatar Chance: **${avatarScan.finalPct}%**  [Reverse Search Avatar](${expectedLink})`
      );

      // Account field shows when the Discord account was created.
      // Uses Discord timestamp format for relative time ("2 years ago").
      const accountField = embed.fields?.find((field) => field.name === "Account");
      expect(accountField).toBeDefined();
      expect(accountField?.value).toBe(`Created <t:${accountSeconds}:f> • <t:${accountSeconds}:R>`);
      expect(accountField?.inline).toBe(true);
    } finally {
      // Clean up mocks to avoid polluting other tests
      vi.doUnmock("../../src/lib/env.js");
      vi.resetModules();
    }
  });

  // Feature flag test: when GATE_SHOW_AVATAR_RISK is false, the Avatar Risk
  // field is completely omitted. Only the basic reverse image search link appears.
  it("omits avatar risk field when toggle disabled", async () => {
    vi.resetModules();
    vi.doMock("../../src/lib/env.js", async () => {
      const actual =
        await vi.importActual<typeof import("../../src/lib/env.js")>("../../src/lib/env.js");
      return { ...actual, GATE_SHOW_AVATAR_RISK: false };
    });

    try {
      const { renderReviewEmbed } = await import("../../src/features/review.js");
      const { googleReverseImageUrl } = await import("../../src/features/avatarScan.js");

      const submittedAt = "2025-01-15T12:34:56.000Z";
      const accountCreatedAt = Date.UTC(2020, 4, 10, 9, 30, 0);
      const app = {
        id: "4737d4d0-2d8b-49a0-b17d-e51c1555e60d",
        guild_id: "guild-1",
        user_id: "user-1",
        status: "submitted" as const,
        created_at: submittedAt,
        submitted_at: submittedAt,
        updated_at: null,
        resolved_at: null,
        resolver_id: null,
        resolution_reason: null,
        userTag: "Paw#0001",
        avatarUrl: "https://cdn.discordapp.com/avatars/user-1/avatar.png",
        lastAction: null,
      };

      const avatarScan = {
        finalPct: 72,
        nsfwScore: 0.88,
        edgeScore: 0.3,
        reason: "soft_evidence" as const,
        furry_score: 0,
        scalie_score: 0,
        evidence: { hard: [], soft: [], safe: [] },
      };

      const embed = renderReviewEmbed(app, [], [], avatarScan, null, accountCreatedAt).toJSON();
      const expectedLink = googleReverseImageUrl(app.avatarUrl!);

      // "Avatar Risk" field should not exist when the feature is disabled
      const riskField = embed.fields?.find((field) => field.name === "Avatar Risk");
      expect(riskField).toBeUndefined();

      // But we still show the basic Avatar field with just the reverse search link
      const avatarField = embed.fields?.find((field) => field.name === "Avatar");
      expect(avatarField?.value).toBe(`[Reverse Search Avatar](${expectedLink})`);
      expect(avatarField?.value).not.toContain("NSFW Avatar Chance");
    } finally {
      vi.doUnmock("../../src/lib/env.js");
      vi.resetModules();
    }
  });

  // Edge case: some legacy applications might be missing submitted_at.
  // The footer should still render with available information.
  it("falls back to code-only footer when submission time missing", async () => {
    vi.resetModules();

    try {
      const { renderReviewEmbed } = await import("../../src/features/review.js");

      const app = {
        id: "fa46b9e6-8ae6-4c2d-8c33-05367864af23",
        guild_id: "guild-1",
        user_id: "user-1",
        status: "submitted" as const,
        created_at: "2025-01-02T03:04:05.000Z",
        submitted_at: null, // Simulating legacy data without this field
        updated_at: null,
        resolved_at: null,
        resolver_id: null,
        resolution_reason: null,
        userTag: "Paw#0002",
        avatarUrl: null, // Also testing the no-avatar case
        lastAction: null,
      };

      const embed = renderReviewEmbed(app, [], [], null, null).toJSON();
      const code = shortCode(app.id);
      // Even without submitted_at, the footer should still show the Submitted: label
      // (using created_at as fallback)
      expect(embed.footer).toBeDefined();
      expect(embed.footer?.text).toContain("Submitted:");
      expect(embed.footer?.text).not.toMatch(/<t:/);
    } finally {
      vi.resetModules();
    }
  });

  // Explicit regression test: the footer must never contain <t:...> tags.
  // This was a bug where Discord timestamps would appear differently in
  // logs vs the actual Discord client.
  it("never includes Discord timestamp tags in footer", () => {
    const now = nowUtc();
    const app = {
      id: "test-footer-timestamps-app",
      guild_id: "guild-1",
      user_id: "user-1",
      status: "submitted" as const,
      created_at: now - 3600, // 1 hour ago
      submitted_at: now - 3600,
      updated_at: now - 3600,
      resolved_at: null,
      resolver_id: null,
      resolution_reason: null,
      userTag: "TestUser#1234",
      avatarUrl: undefined,
      lastAction: null,
    };

    const embed = renderReviewEmbed(app, [], [], null, null, undefined, null, null, []).toJSON();

    // Footer must never contain Discord timestamp tags
    expect(embed.footer?.text).not.toMatch(/<t:/);

    // Footer must contain human-readable timestamps
    expect(embed.footer?.text).toMatch(/UTC/);
    expect(embed.footer?.text).toMatch(/ago|just now/);

    // Footer must contain expected structure
    expect(embed.footer?.text).toContain("Submitted:");
    expect(embed.footer?.text).toContain("App ID:");
  });
});

// Tests for the timestamp formatting helper used in footer construction
describe("formatSubmittedFooter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ISO string input (from JSON serialization)
  it("converts ISO string to Discord timestamp", () => {
    const code = "ABC123";
    const iso = "2025-02-01T08:00:00.000Z";
    const expected = Math.floor(new Date(iso).getTime() / 1000);
    const result = formatSubmittedFooter(iso, code);
    expect(result).toBe(`Submitted: <t:${expected}:f> • App #${code}`);
  });

  // Millisecond epoch input (from Date.now() or Date.getTime())
  // The function should detect this and convert to seconds.
  it("converts millisecond epoch numbers to seconds", () => {
    const code = "DEF456";
    const ms = Date.UTC(2025, 0, 15, 12, 30, 0);
    const expected = Math.floor(ms / 1000);
    const result = formatSubmittedFooter(ms, code);
    expect(result).toBe(`Submitted: <t:${expected}:f> • App #${code}`);
  });

  // Null/undefined timestamps should return null, not crash
  it("returns null when timestamp unavailable", () => {
    expect(formatSubmittedFooter(null, "GHI789")).toBeNull();
  });
});
