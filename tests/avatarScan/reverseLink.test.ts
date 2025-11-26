/**
 * WHAT: Verifies reverse image link templating (placeholder replacement and fallback query param).
 * HOW: Calls buildReverseImageUrl with custom/default templates.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { buildReverseImageUrl } from "../../src/features/avatarScan.js";

/**
 * Tests for the reverse image search URL builder.
 *
 * Real-world scenario: Staff click a link to do a reverse image search on a user's
 * avatar (e.g., checking if a profile pic was stolen from somewhere else). Guilds
 * can configure their own search engine template via image_search_url_template.
 *
 * The two cases below cover:
 * 1. Template with {avatarUrl} placeholder - standard case
 * 2. Template without placeholder - fallback behavior for misconfigured templates
 */
describe("buildReverseImageUrl", () => {
  /**
   * Happy path: Template contains {avatarUrl}, which gets replaced with
   * the URL-encoded avatar URL. Encoding is critical here because Discord
   * CDN URLs contain characters that would break query strings (slashes, colons).
   */
  it("replaces placeholder with encoded avatar url", () => {
    const url = buildReverseImageUrl(
      {
        image_search_url_template: "https://example.com/search?target={avatarUrl}",
      },
      "https://cdn.discordapp.com/avatars/123/avatar.png"
    );
    expect(url).toBe(
      "https://example.com/search?target=https%3A%2F%2Fcdn.discordapp.com%2Favatars%2F123%2Favatar.png"
    );
  });

  /**
   * Fallback case: Someone set a template URL but forgot the {avatarUrl} placeholder.
   * Rather than silently returning a broken link, we append ?avatar=... so the
   * reverse search at least has a chance of working. Not perfect, but better than nothing.
   */
  it("appends avatar query when placeholder missing", () => {
    const url = buildReverseImageUrl(
      { image_search_url_template: "https://example.com/search" },
      "https://cdn.discordapp.com/default.png"
    );
    expect(url).toBe(
      "https://example.com/search?avatar=https%3A%2F%2Fcdn.discordapp.com%2Fdefault.png"
    );
  });
});
