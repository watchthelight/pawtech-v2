/**
 * Pawtropolis Tech — tests/logging/embeds.test.ts
 * WHAT: Unit tests for logging embed builders.
 * WHY: Verify embed construction and field formatting.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";

// Mock discord.js EmbedBuilder
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
        timestamp?: string;
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

      setTimestamp() {
        this.data.timestamp = new Date().toISOString();
        return this;
      }
    },
  };
});

import { buildFlagEmbedSilentFirstMsg, type FlagEmbedParams } from "../../src/logging/embeds.js";

describe("logging/embeds", () => {
  describe("buildFlagEmbedSilentFirstMsg", () => {
    const mockUser = {
      id: "123456789012345678",
      tag: "TestUser#1234",
      toString: () => "<@123456789012345678>",
      displayAvatarURL: vi.fn(() => "https://cdn.discordapp.com/avatars/123/abc.png"),
    };

    const mockMessage = {
      id: "987654321098765432",
      channelId: "111222333444555666",
      guildId: "999888777666555444",
    };

    const mockParams: FlagEmbedParams = {
      user: mockUser as any,
      joinedAt: 1700000000,
      firstMessageAt: 1707776000,
      silentDays: 90,
      message: mockMessage as any,
    };

    it("returns an embed object", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(embed).toBeDefined();
      expect(embed.data).toBeDefined();
    });

    it("sets warning color (red)", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(embed.data.color).toBe(0xed4245);
    });

    it("sets title with warning indicator", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(embed.data.title).toContain("Silent-Since-Join");
      expect(embed.data.title).toContain("⚠️");
    });

    it("includes user mention in description", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(embed.data.description).toContain(mockUser.toString());
      expect(embed.data.description).toContain(mockUser.tag);
    });

    it("includes user ID in description", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(embed.data.description).toContain(mockUser.id);
    });

    it("includes silent days count in description", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(embed.data.description).toContain("90 days");
    });

    it("has 4 fields", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(embed.data.fields).toHaveLength(4);
    });

    it("includes join date field with Discord timestamp", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      const joinField = embed.data.fields?.find((f) => f.name.includes("Joined"));
      expect(joinField).toBeDefined();
      expect(joinField?.value).toContain(`<t:${mockParams.joinedAt}:F>`);
      expect(joinField?.inline).toBe(true);
    });

    it("includes first message field with Discord timestamp", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      const msgField = embed.data.fields?.find((f) => f.name.includes("First Message"));
      expect(msgField).toBeDefined();
      expect(msgField?.value).toContain(`<t:${mockParams.firstMessageAt}:F>`);
      expect(msgField?.inline).toBe(true);
    });

    it("includes silent duration field", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      const durationField = embed.data.fields?.find((f) => f.name.includes("Silent Duration"));
      expect(durationField).toBeDefined();
      expect(durationField?.value).toBe("90 days");
      expect(durationField?.inline).toBe(true);
    });

    it("includes message link field", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      const linkField = embed.data.fields?.find((f) => f.name.includes("Link"));
      expect(linkField).toBeDefined();
      expect(linkField?.value).toContain(mockMessage.guildId);
      expect(linkField?.value).toContain(mockMessage.channelId);
      expect(linkField?.value).toContain(mockMessage.id);
      expect(linkField?.inline).toBe(false);
    });

    it("sets user avatar as thumbnail", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(mockUser.displayAvatarURL).toHaveBeenCalledWith({ size: 128 });
      expect(embed.data.thumbnail?.url).toBe("https://cdn.discordapp.com/avatars/123/abc.png");
    });

    it("includes user ID in footer", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(embed.data.footer?.text).toContain(mockUser.id);
      expect(embed.data.footer?.text).toContain("PR8");
    });

    it("sets timestamp", () => {
      const embed = buildFlagEmbedSilentFirstMsg(mockParams);
      expect(embed.data.timestamp).toBeDefined();
    });

    it("handles different silent day values", () => {
      const shortSilence = buildFlagEmbedSilentFirstMsg({
        ...mockParams,
        silentDays: 7,
      });
      expect(shortSilence.data.description).toContain("7 days");

      const longSilence = buildFlagEmbedSilentFirstMsg({
        ...mockParams,
        silentDays: 365,
      });
      expect(longSilence.data.description).toContain("365 days");
    });
  });
});
