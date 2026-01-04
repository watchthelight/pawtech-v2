/**
 * Pawtropolis Tech — tests/ui/reviewCard.test.ts
 * WHAT: Unit tests for review card embed builders.
 * WHY: Verify embed construction, color coding, action rows, and truncation logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock discord.js
vi.mock("discord.js", () => {
  return {
    EmbedBuilder: class MockEmbedBuilder {
      data: {
        color?: number;
        title?: string;
        description?: string;
        fields?: Array<{ name: string; value: string; inline: boolean }>;
        thumbnail?: { url: string };
        footer?: { text: string };
        timestamp?: number;
      } = {};

      setColor(color: number) {
        this.data.color = color;
        return this;
      }

      setTitle(title: string) {
        this.data.title = title;
        return this;
      }

      setDescription(description: string) {
        this.data.description = description;
        return this;
      }

      addFields(...fields: Array<{ name: string; value: string; inline: boolean }>) {
        this.data.fields = this.data.fields || [];
        this.data.fields.push(...fields);
        return this;
      }

      setThumbnail(url: string) {
        this.data.thumbnail = { url };
        return this;
      }

      setFooter(footer: { text: string }) {
        this.data.footer = footer;
        return this;
      }

      setTimestamp(timestamp?: number) {
        this.data.timestamp = timestamp ?? Date.now();
        return this;
      }
    },
    ActionRowBuilder: class MockActionRowBuilder {
      components: unknown[] = [];
      addComponents(...components: unknown[]) {
        this.components.push(...components);
        return this;
      }
    },
    ButtonBuilder: class MockButtonBuilder {
      data: {
        custom_id?: string;
        label?: string;
        style?: number;
      } = {};

      setCustomId(id: string) {
        this.data.custom_id = id;
        return this;
      }

      setLabel(label: string) {
        this.data.label = label;
        return this;
      }

      setStyle(style: number) {
        this.data.style = style;
        return this;
      }
    },
    ButtonStyle: {
      Primary: 1,
      Secondary: 2,
      Danger: 4,
    },
  };
});

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock shortCode
vi.mock("../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(0, 6).toUpperCase()),
}));

// Mock dt (timestamp helper)
vi.mock("../../src/lib/dt.js", () => ({
  ts: vi.fn((date: Date | number, format: string) => {
    const epoch = typeof date === "number" ? Math.floor(date / 1000) : Math.floor(date.getTime() / 1000);
    return `<t:${epoch}:${format}>`;
  }),
}));

import {
  getStatusColor,
  getEmbedColor,
  googleReverseImageUrl,
  buildActionRowsV2,
  buildReviewEmbedV3,
  type ReviewCardApplication,
  type BuildEmbedOptions,
} from "../../src/ui/reviewCard.js";

describe("reviewCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getStatusColor", () => {
    it("returns green for approved", () => {
      expect(getStatusColor("approved")).toBe(0x10b981);
    });

    it("returns red for rejected", () => {
      expect(getStatusColor("rejected")).toBe(0xef4444);
    });

    it("returns red for kicked", () => {
      expect(getStatusColor("kicked")).toBe(0xef4444);
    });

    it("returns primary color for submitted", () => {
      expect(getStatusColor("submitted")).toBe(0x1e293b);
    });

    it("returns primary color for draft", () => {
      expect(getStatusColor("draft")).toBe(0x1e293b);
    });
  });

  describe("getEmbedColor", () => {
    it("returns orange when member has left regardless of status", () => {
      expect(getEmbedColor("approved", true)).toBe(0xf97316);
      expect(getEmbedColor("submitted", true)).toBe(0xf97316);
      expect(getEmbedColor("rejected", true)).toBe(0xf97316);
    });

    it("returns status color when member is present", () => {
      expect(getEmbedColor("approved", false)).toBe(0x10b981);
      expect(getEmbedColor("rejected", false)).toBe(0xef4444);
      expect(getEmbedColor("submitted", false)).toBe(0x1e293b);
    });
  });

  describe("googleReverseImageUrl", () => {
    it("returns Google Lens URL with encoded avatar URL", () => {
      const avatarUrl = "https://cdn.discordapp.com/avatars/123/abc.png";
      const result = googleReverseImageUrl(avatarUrl);
      expect(result).toContain("lens.google.com/uploadbyurl");
      expect(result).toContain(encodeURIComponent(avatarUrl));
    });

    it("handles special characters in URL", () => {
      const avatarUrl = "https://cdn.discordapp.com/avatars/123/abc.png?size=1024";
      const result = googleReverseImageUrl(avatarUrl);
      expect(result).toContain(encodeURIComponent(avatarUrl));
    });
  });

  describe("buildActionRowsV2", () => {
    const baseApp: ReviewCardApplication = {
      id: "app123456789",
      guild_id: "guild123",
      user_id: "user456",
      userTag: "TestUser#1234",
      status: "submitted",
      created_at: new Date().toISOString(),
    };

    it("returns claim button when no claim exists", () => {
      const rows = buildActionRowsV2(baseApp, null);
      expect(rows).toHaveLength(1);
      const btn = rows[0].components[0] as { data: { custom_id: string; label: string } };
      expect(btn.data.label).toBe("Claim Application");
    });

    it("returns review buttons when claimed", () => {
      const claim = {
        application_id: "app123",
        reviewer_id: "reviewer789",
        claimed_at: String(Date.now() / 1000),
      };

      const rows = buildActionRowsV2(baseApp, claim);
      expect(rows).toHaveLength(2);

      // First row: Accept, Reject, Perm Reject, Kick
      const row1Labels = rows[0].components.map((c) => (c as { data: { label: string } }).data.label);
      expect(row1Labels).toContain("Accept");
      expect(row1Labels).toContain("Reject");
      expect(row1Labels).toContain("Perm Reject");
      expect(row1Labels).toContain("Kick");

      // Second row: Modmail, Unclaim, Copy UID, Ping
      const row2Labels = rows[1].components.map((c) => (c as { data: { label: string } }).data.label);
      expect(row2Labels).toContain("Modmail");
      expect(row2Labels).toContain("Unclaim");
      expect(row2Labels).toContain("Copy UID");
    });

    it("returns no buttons for approved applications", () => {
      const approvedApp = { ...baseApp, status: "approved" as const };
      const rows = buildActionRowsV2(approvedApp, null);
      expect(rows).toHaveLength(0);
    });

    it("returns no buttons for rejected applications", () => {
      const rejectedApp = { ...baseApp, status: "rejected" as const };
      const rows = buildActionRowsV2(rejectedApp, null);
      expect(rows).toHaveLength(0);
    });

    it("returns no buttons for kicked applications", () => {
      const kickedApp = { ...baseApp, status: "kicked" as const };
      const rows = buildActionRowsV2(kickedApp, null);
      expect(rows).toHaveLength(0);
    });

    it("returns reject only when member has left", () => {
      const rows = buildActionRowsV2(baseApp, null, { memberHasLeft: true });
      expect(rows).toHaveLength(1);
      const labels = rows[0].components.map((c) => (c as { data: { label: string } }).data.label);
      expect(labels).toContain("Reject (Member Left)");
      expect(labels).toContain("Copy UID");
    });

    it("includes app code in button custom IDs", () => {
      const rows = buildActionRowsV2(baseApp, null);
      const btn = rows[0].components[0] as { data: { custom_id: string } };
      expect(btn.data.custom_id).toContain("APP123");
    });
  });

  describe("buildReviewEmbedV3", () => {
    const baseApp: ReviewCardApplication = {
      id: "app123456789abcdef",
      guild_id: "guild123",
      user_id: "user456",
      userTag: "TestUser#1234",
      avatarUrl: "https://cdn.discordapp.com/avatars/user456/abc.png",
      status: "submitted",
      created_at: new Date().toISOString(),
      submitted_at: new Date().toISOString(),
    };

    it("includes username in title", () => {
      const embed = buildReviewEmbedV3(baseApp);
      expect(embed.data.title).toContain("TestUser");
    });

    it("includes app code in title", () => {
      const embed = buildReviewEmbedV3(baseApp);
      expect(embed.data.title).toContain("APP123");
    });

    it("sets thumbnail to avatar URL", () => {
      const embed = buildReviewEmbedV3(baseApp);
      expect(embed.data.thumbnail?.url).toBe(baseApp.avatarUrl);
    });

    it("includes applicant mention in description", () => {
      const embed = buildReviewEmbedV3(baseApp);
      expect(embed.data.description).toContain(`<@${baseApp.user_id}>`);
    });

    it("shows claim status as unclaimed when no claim", () => {
      const embed = buildReviewEmbedV3(baseApp);
      expect(embed.data.description).toContain("Unclaimed");
    });

    it("shows claimer when claimed", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        claim: {
          application_id: baseApp.id,
          reviewer_id: "reviewer789",
          claimed_at: String(Math.floor(Date.now() / 1000)),
        },
      });
      expect(embed.data.description).toContain("<@reviewer789>");
    });

    it("includes answers in description", () => {
      const opts: BuildEmbedOptions = {
        answers: [
          { q_index: 0, question: "What is your name?", answer: "John Doe" },
          { q_index: 1, question: "Why join?", answer: "I love this community" },
        ],
      };

      const embed = buildReviewEmbedV3(baseApp, opts);
      expect(embed.data.description).toContain("What is your name?");
      expect(embed.data.description).toContain("John Doe");
      expect(embed.data.description).toContain("Why join?");
    });

    it("shows no answers message when empty", () => {
      const embed = buildReviewEmbedV3(baseApp, { answers: [] });
      expect(embed.data.description).toContain("no answers recorded");
    });

    it("includes flags in description", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        flags: ["⚠️ New account (< 30 days)", "🔴 Previously rejected"],
      });
      expect(embed.data.description).toContain("New account");
      expect(embed.data.description).toContain("Previously rejected");
    });

    it("shows alert when member is null", () => {
      const embed = buildReviewEmbedV3(baseApp, { member: null });
      expect(embed.data.description).toContain("Member has left");
    });

    it("includes avatar scan risk info", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        avatarScan: {
          user_id: "user456",
          guild_id: "guild123",
          finalPct: 45,
          scanMethod: "google_vision",
          scannedAt: new Date().toISOString(),
        },
      });
      expect(embed.data.description).toContain("45%");
      expect(embed.data.description).toContain("Reverse Search");
    });

    it("shows high risk badge for 50%+ scan", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        avatarScan: {
          user_id: "user456",
          guild_id: "guild123",
          finalPct: 75,
          scanMethod: "google_vision",
          scannedAt: new Date().toISOString(),
        },
      });
      expect(embed.data.description).toContain("High Risk");
      expect(embed.data.description).toContain("🔴");
    });

    it("shows medium risk badge for 25-49%", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        avatarScan: {
          user_id: "user456",
          guild_id: "guild123",
          finalPct: 35,
          scanMethod: "google_vision",
          scannedAt: new Date().toISOString(),
        },
      });
      expect(embed.data.description).toContain("Medium Risk");
      expect(embed.data.description).toContain("🟡");
    });

    it("shows low risk badge for 1-24%", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        avatarScan: {
          user_id: "user456",
          guild_id: "guild123",
          finalPct: 10,
          scanMethod: "google_vision",
          scannedAt: new Date().toISOString(),
        },
      });
      expect(embed.data.description).toContain("Low Risk");
      expect(embed.data.description).toContain("🟢");
    });

    it("shows clean badge for 0%", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        avatarScan: {
          user_id: "user456",
          guild_id: "guild123",
          finalPct: 0,
          scanMethod: "google_vision",
          scannedAt: new Date().toISOString(),
        },
      });
      expect(embed.data.description).toContain("Clean");
      expect(embed.data.description).toContain("✅");
    });

    it("includes modmail link when open", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        modmailTicket: {
          id: 1,
          thread_id: "thread123",
          status: "open",
        },
      });
      expect(embed.data.description).toContain("Open Thread");
      expect(embed.data.description).toContain("thread123");
    });

    it("includes modmail log link when closed", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        modmailTicket: {
          id: 1,
          thread_id: "thread123",
          status: "closed",
          log_channel_id: "logchan",
          log_message_id: "logmsg",
        },
      });
      expect(embed.data.description).toContain("View Log");
    });

    it("shows no modmail when null", () => {
      const embed = buildReviewEmbedV3(baseApp);
      expect(embed.data.description).toContain("None");
    });

    it("includes account created timestamp when provided", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        accountCreatedAt: Math.floor(Date.now() / 1000) - 86400 * 365,
      });
      expect(embed.data.description).toContain("Account created");
    });

    it("includes decision section for resolved apps", () => {
      const approvedApp = {
        ...baseApp,
        status: "approved" as const,
        resolution_reason: "Great answers!",
      };

      const embed = buildReviewEmbedV3(approvedApp);
      expect(embed.data.description).toContain("Decision");
      expect(embed.data.description).toContain("Approved");
      expect(embed.data.description).toContain("Great answers!");
    });

    it("shows Reason label for rejection", () => {
      const rejectedApp = {
        ...baseApp,
        status: "rejected" as const,
        resolution_reason: "Low effort answers",
      };

      const embed = buildReviewEmbedV3(rejectedApp);
      expect(embed.data.description).toContain("Reason");
      expect(embed.data.description).toContain("Low effort");
    });

    it("includes app number ordinal when provided", () => {
      const embed = buildReviewEmbedV3(baseApp, { appNumber: 3 });
      expect(embed.data.title).toContain("3rd Application");
    });

    it("handles 1st, 2nd, 3rd ordinals correctly", () => {
      const embed1 = buildReviewEmbedV3(baseApp, { appNumber: 1 });
      const embed2 = buildReviewEmbedV3(baseApp, { appNumber: 2 });
      const embed3 = buildReviewEmbedV3(baseApp, { appNumber: 3 });

      expect(embed1.data.title).toContain("1st");
      expect(embed2.data.title).toContain("2nd");
      expect(embed3.data.title).toContain("3rd");
    });

    it("handles 11th, 12th, 13th ordinals correctly", () => {
      const embed11 = buildReviewEmbedV3(baseApp, { appNumber: 11 });
      const embed12 = buildReviewEmbedV3(baseApp, { appNumber: 12 });
      const embed13 = buildReviewEmbedV3(baseApp, { appNumber: 13 });

      expect(embed11.data.title).toContain("11th");
      expect(embed12.data.title).toContain("12th");
      expect(embed13.data.title).toContain("13th");
    });

    it("includes sample indicator in footer when isSample", () => {
      const embed = buildReviewEmbedV3(baseApp, { isSample: true });
      expect(embed.data.footer?.text).toContain("Sample Preview");
    });

    it("includes app ID in footer", () => {
      const embed = buildReviewEmbedV3(baseApp);
      expect(embed.data.footer?.text).toContain("App ID:");
    });

    it("sets timestamp from submitted_at", () => {
      const embed = buildReviewEmbedV3(baseApp);
      expect(embed.data.timestamp).toBeDefined();
    });

    it("includes previous apps when provided", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        previousApps: [
          { id: "prev1", status: "rejected", submitted_at: new Date().toISOString(), resolved_at: null, resolution_reason: "Low effort" },
          { id: baseApp.id, status: "submitted", submitted_at: baseApp.submitted_at!, resolved_at: null, resolution_reason: null },
        ],
      });
      expect(embed.data.description).toContain("Application History");
    });

    it("includes recent actions when provided", () => {
      const embed = buildReviewEmbedV3(baseApp, {
        recentActions: [
          { action: "claim", moderator_id: "mod123", reason: null, created_at: Math.floor(Date.now() / 1000) },
        ],
      });
      expect(embed.data.description).toContain("Action History");
      expect(embed.data.description).toContain("claim");
    });

    it("escapes @ in username to prevent mentions", () => {
      const appWithAt = { ...baseApp, userTag: "@everyone#0000" };
      const embed = buildReviewEmbedV3(appWithAt);
      // Username should contain zero-width space after @
      expect(embed.data.title).toContain("@\u200beveryone");
    });

    it("sorts answers by q_index", () => {
      const opts: BuildEmbedOptions = {
        answers: [
          { q_index: 2, question: "Third", answer: "C" },
          { q_index: 0, question: "First", answer: "A" },
          { q_index: 1, question: "Second", answer: "B" },
        ],
      };

      const embed = buildReviewEmbedV3(baseApp, opts);
      const desc = embed.data.description!;
      const firstIndex = desc.indexOf("First");
      const secondIndex = desc.indexOf("Second");
      const thirdIndex = desc.indexOf("Third");

      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });

    it("handles null avatarUrl gracefully", () => {
      const appNoAvatar = { ...baseApp, avatarUrl: undefined };
      const embed = buildReviewEmbedV3(appNoAvatar);
      expect(embed.data.thumbnail).toBeUndefined();
    });

    it("handles missing resolution_reason", () => {
      const resolvedApp = { ...baseApp, status: "approved" as const };
      const embed = buildReviewEmbedV3(resolvedApp);
      expect(embed.data.description).toContain("Approved");
      // Should not crash
    });
  });
});
