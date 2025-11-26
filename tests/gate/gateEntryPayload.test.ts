/**
 * WHAT: Verifies the gate entry payload uses the neon card defaults (title, copy, banner, button).
 * HOW: Builds the payload with a stub guild and inspects the resulting embed/components.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { ButtonStyle, type Guild } from "discord.js";
import { buildGateEntryPayload } from "../../src/features/gate.js";

describe("gate entry payload", () => {
  it("builds the default neon gate entry card", () => {
    // Minimal Guild stub: only name and iconURL are needed by buildGateEntryPayload.
    // We cast to unknown first to bypass TypeScript's structural checks—Discord.js
    // Guild objects have 50+ properties we don't care about here.
    const guild = {
      name: "Neon City",
      iconURL: () => "https://cdn.discordapp.com/icons/neon-city/icon.png",
    } as unknown as Guild;

    const payload = buildGateEntryPayload({ guild });

    // --- Embed structure assertions ---
    // The gate card is a single embed with welcome copy, banner image, and guild icon thumbnail.
    expect(payload.embeds).toHaveLength(1);
    const embedJson = payload.embeds[0].toJSON();

    // Title interpolates the guild name—test that dynamic substitution works.
    expect(embedJson.title).toBe("Welcome to Neon City");

    // Description mentions the verification flow. These substrings confirm the copy template
    // hasn't drifted. If marketing rewrites the welcome text, update these matchers.
    expect(embedJson.description).toContain("answering 5 simple questions");
    expect(embedJson.description).toContain("**Verify**");

    // Banner uses Discord's attachment:// protocol. The actual file is in payload.files.
    expect(embedJson.image?.url).toBe("attachment://banner.webp");
    expect(embedJson.thumbnail?.url).toBe("https://cdn.discordapp.com/icons/neon-city/icon.png");

    // 0x22ccaa is the "neon teal" brand color. If this changes, the embed's sidebar
    // color in Discord will look wrong.
    expect(embedJson.color).toBe(0x22ccaa);

    // --- Button component assertions ---
    // Single action row with a single "Verify" button. The custom_id "v1:start" is the
    // routing key for the interaction handler—changing this breaks the gate flow.
    expect(payload.components).toHaveLength(1);
    const rowJson = payload.components[0].toJSON();
    expect(rowJson.components).toHaveLength(1);
    const button = rowJson.components[0];
    expect(button.label).toBe("Verify");
    expect(button.custom_id).toBe("v1:start");
    expect(button.style).toBe(ButtonStyle.Success);

    // --- File attachment assertions ---
    // The banner.webp file must be attached for the embed image to render.
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("banner.webp");
  });
});
