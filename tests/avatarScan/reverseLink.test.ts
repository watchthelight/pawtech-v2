/**
 * WHAT: Verifies reverse image link templating (placeholder replacement and fallback query param).
 * HOW: Calls buildReverseImageUrl with custom/default templates.
 * DOCS: https://vitest.dev/guide/
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { buildReverseImageUrl } from "../../src/features/avatarScan.js";

describe("buildReverseImageUrl", () => {
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
