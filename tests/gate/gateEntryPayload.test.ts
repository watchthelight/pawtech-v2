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
    const guild = {
      name: "Neon City",
      iconURL: () => "https://cdn.discordapp.com/icons/neon-city/icon.png",
    } as unknown as Guild;

    const payload = buildGateEntryPayload({ guild });

    expect(payload.embeds).toHaveLength(1);
    const embedJson = payload.embeds[0].toJSON();

    expect(embedJson.title).toBe("Welcome to Neon City");
    expect(embedJson.description).toContain("answering 5 simple questions");
    expect(embedJson.description).toContain("**Verify**");
    expect(embedJson.image?.url).toBe("attachment://banner.webp");
    expect(embedJson.thumbnail?.url).toBe("https://cdn.discordapp.com/icons/neon-city/icon.png");
    expect(embedJson.color).toBe(0x22ccaa);

    expect(payload.components).toHaveLength(1);
    const rowJson = payload.components[0].toJSON();
    expect(rowJson.components).toHaveLength(1);
    const button = rowJson.components[0];
    expect(button.label).toBe("Verify");
    expect(button.custom_id).toBe("v1:start");
    expect(button.style).toBe(ButtonStyle.Success);

    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("banner.webp");
  });
});
