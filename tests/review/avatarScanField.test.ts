/**
 * WHAT: Proves the avatar scan field builds correct reverse-image links from guild config.
 * HOW: Calls buildReverseImageUrl with different templates and asserts final URLs.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { buildReverseImageUrl } from "../../src/features/avatarScan.js";
import type { GuildConfig } from "../../src/lib/config.js";

describe("avatar scan field and lens link", () => {
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
