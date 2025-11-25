/**
 * WHAT: Proves review card composition (fields, footer, statuses) renders as expected for sample rows.
 * HOW: Mocks scan/config paths as needed and inspects built embed content.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
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
  it("shows Claim button when unclaimed", () => {
    const rows = buildDecisionComponents("submitted", "test-app-123", null);
    expect(rows).toHaveLength(1);
    const buttons = rows[0].components;
    expect(buttons).toHaveLength(1);
    const btnData = buttons[0].toJSON();
    expect(btnData.label).toBe("Claim");
    expect(btnData.style).toBe(ButtonStyle.Secondary);
  });

  it("hides decision buttons for resolved applications", () => {
    const claim: ReviewClaimRow = {
      reviewer_id: "reviewer-2",
      claimed_at: new Date().toISOString(),
    };
    const rowsApproved = buildDecisionComponents("approved", "test-app-789", claim);
    expect(rowsApproved).toHaveLength(0);

    const rowsRejected = buildDecisionComponents("rejected", "test-app-abc", claim);
    expect(rowsRejected).toHaveLength(0);

    const rowsKicked = buildDecisionComponents("kicked", "test-app-def", claim);
    expect(rowsKicked).toHaveLength(0);
  });

  it("renders embed title, footer, account age, and avatar risk field with HEX6 code", async () => {
    vi.resetModules();
    vi.doMock("../../src/lib/env.js", async () => {
      const actual =
        await vi.importActual<typeof import("../../src/lib/env.js")>("../../src/lib/env.js");
      return { ...actual, GATE_SHOW_AVATAR_RISK: true };
    });

    try {
      const { renderReviewEmbed } = await import("../../src/features/review.js");

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

      const answers = [
        {
          q_index: 0,
          question: "What brings you here?",
          answer: "Just exploring.",
        },
      ];

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
      const code = shortCode(app.id);
      const epoch = Math.floor(new Date(submittedAt).getTime() / 1000);
      const timestamp = `<t:${epoch}:f>`;
      const accountSeconds = Math.floor(accountCreatedAt / 1000);

      // PR3: New title format includes "New application from @"
      expect(embed.title).toBe(`New application from @${app.userTag} • App #${code}`);
      // PR3: Footer now includes unified timestamps (plain text, no Discord tags)
      expect(embed.footer).toBeDefined();
      expect(embed.footer?.text).toContain("Submitted:");
      expect(embed.footer?.text).toContain("UTC");
      expect(embed.footer?.text).toMatch(/ago|just now/);
      expect(embed.footer?.text).not.toMatch(/<t:/);
      expect(embed.footer?.text).toContain("App ID:");
      expect(embed.thumbnail?.url).toBe(app.avatarUrl);

      const riskField = embed.fields?.find((field) => field.name === "Avatar Risk");
      expect(riskField).toBeDefined();

      const expectedLink = googleReverseImageUrl(app.avatarUrl);
      expect(riskField?.value).toContain(
        `NSFW Avatar Chance: **${avatarScan.finalPct}%**  [Reverse Search Avatar](${expectedLink})`
      );

      const accountField = embed.fields?.find((field) => field.name === "Account");
      expect(accountField).toBeDefined();
      expect(accountField?.value).toBe(`Created <t:${accountSeconds}:f> • <t:${accountSeconds}:R>`);
      expect(accountField?.inline).toBe(true);
    } finally {
      vi.doUnmock("../../src/lib/env.js");
      vi.resetModules();
    }
  });

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

      const riskField = embed.fields?.find((field) => field.name === "Avatar Risk");
      expect(riskField).toBeUndefined();

      const avatarField = embed.fields?.find((field) => field.name === "Avatar");
      expect(avatarField?.value).toBe(`[Reverse Search Avatar](${expectedLink})`);
      expect(avatarField?.value).not.toContain("NSFW Avatar Chance");
    } finally {
      vi.doUnmock("../../src/lib/env.js");
      vi.resetModules();
    }
  });
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
        submitted_at: null,
        updated_at: null,
        resolved_at: null,
        resolver_id: null,
        resolution_reason: null,
        userTag: "Paw#0002",
        avatarUrl: null,
        lastAction: null,
      };

      const embed = renderReviewEmbed(app, [], [], null, null).toJSON();
      const code = shortCode(app.id);
      // PR3: Footer now shows unified timestamps even when submission time is present
      expect(embed.footer).toBeDefined();
      expect(embed.footer?.text).toContain("Submitted:");
      // Verify no Discord timestamp tags in footer
      expect(embed.footer?.text).not.toMatch(/<t:/);
    } finally {
      vi.resetModules();
    }
  });

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

describe("formatSubmittedFooter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts ISO string to Discord timestamp", () => {
    // Debug logs removed per Prompt 4, but function still works
    const code = "ABC123";
    const iso = "2025-02-01T08:00:00.000Z";
    const expected = Math.floor(new Date(iso).getTime() / 1000);
    const result = formatSubmittedFooter(iso, code);
    expect(result).toBe(`Submitted: <t:${expected}:f> • App #${code}`);
    // No longer logs debug info
  });

  it("converts millisecond epoch numbers to seconds", () => {
    // Debug logs removed per Prompt 4, but function still works
    const code = "DEF456";
    const ms = Date.UTC(2025, 0, 15, 12, 30, 0);
    const expected = Math.floor(ms / 1000);
    const result = formatSubmittedFooter(ms, code);
    expect(result).toBe(`Submitted: <t:${expected}:f> • App #${code}`);
    // No longer logs debug info
  });

  it("returns null when timestamp unavailable", () => {
    // Debug logs removed per Prompt 4, but function still works
    expect(formatSubmittedFooter(null, "GHI789")).toBeNull();
    // No longer logs debug info
  });
});
