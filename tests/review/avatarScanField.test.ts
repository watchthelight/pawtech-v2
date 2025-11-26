/**
 * Tests for buildReverseImageUrl which generates reverse-image-search links
 * for moderator review embeds. Mods click these to check if an avatar is stolen
 * artwork, AI-generated slop, or a known problematic image.
 *
 * Guilds can configure their preferred search engine (Google Lens, TinEye, etc.)
 * via the image_search_url_template config field.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { buildReverseImageUrl } from "../../src/features/avatarScan.js";
import type { GuildConfig } from "../../src/lib/config.js";

describe("avatar scan field and lens link", () => {
  /**
   * The default/common case: Google Lens with {avatarUrl} placeholder.
   * Note the URL encoding - Discord CDN URLs contain special chars that
   * need escaping in query strings.
   */
  it("builds correct Google Lens URL with template", () => {
    const cfg: Pick<GuildConfig, "image_search_url_template"> = {
      image_search_url_template: "https://lens.google.com/uploadbyurl?url={avatarUrl}",
    };
    const avatarUrl = "https://cdn.discordapp.com/avatars/123/abc.png";
    const result = buildReverseImageUrl(cfg, avatarUrl);
    expect(result).toBe(
      "https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fcdn.discordapp.com%2Favatars%2F123%2Fabc.png"
    );
  });

  /**
   * Some guilds prefer alternative search engines. The template system
   * is flexible enough to support any service that accepts a URL parameter.
   */
  it("builds URL with custom template", () => {
    const cfg: Pick<GuildConfig, "image_search_url_template"> = {
      image_search_url_template: "https://example.com/search?img={avatarUrl}",
    };
    const avatarUrl = "https://cdn.discordapp.com/avatars/456/def.png";
    const result = buildReverseImageUrl(cfg, avatarUrl);
    expect(result).toBe(
      "https://example.com/search?img=https%3A%2F%2Fcdn.discordapp.com%2Favatars%2F456%2Fdef.png"
    );
  });

  /**
   * Fallback behavior when admins forget to include {avatarUrl} in their template.
   * Rather than breaking, we append ?avatar= to make it work anyway.
   */
  it("appends avatar param when template lacks placeholder", () => {
    const cfg: Pick<GuildConfig, "image_search_url_template"> = {
      image_search_url_template: "https://example.com/search",
    };
    const avatarUrl = "https://cdn.discordapp.com/avatars/789/ghi.png";
    const result = buildReverseImageUrl(cfg, avatarUrl);
    expect(result).toBe(
      "https://example.com/search?avatar=https%3A%2F%2Fcdn.discordapp.com%2Favatars%2F789%2Fghi.png"
    );
  });

  /**
   * Edge case: template already has query params (contains ?). We need to use &
   * instead of ? to avoid malformed URLs. This is a common mistake in configs.
   */
  it("appends with & when template already has query params", () => {
    const cfg: Pick<GuildConfig, "image_search_url_template"> = {
      image_search_url_template: "https://example.com/search?foo=bar",
    };
    const avatarUrl = "https://cdn.discordapp.com/avatars/000/jkl.png";
    const result = buildReverseImageUrl(cfg, avatarUrl);
    expect(result).toBe(
      "https://example.com/search?foo=bar&avatar=https%3A%2F%2Fcdn.discordapp.com%2Favatars%2F000%2Fjkl.png"
    );
  });
});
