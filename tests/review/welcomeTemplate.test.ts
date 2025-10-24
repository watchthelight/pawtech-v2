// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { renderWelcomeTemplate } from "../../src/features/review.js";

describe("renderWelcomeTemplate", () => {
  it("resolves tokens and preserves channel mentions", () => {
    const template =
      "Hello {applicant.mention}! Tag:{applicant.tag} Display:{applicant.display} Guild:{guild.name} <#123>";
    const result = renderWelcomeTemplate({
      template,
      guildName: "Pawtropolis",
      applicant: {
        id: "42",
        tag: "Paw#0001",
        display: "Paw",
      },
    });
    expect(result).toBe("Hello <@42>! Tag:Paw#0001 Display:Paw Guild:Pawtropolis <#123>");
  });

  it("falls back to default template when value empty", () => {
    const result = renderWelcomeTemplate({
      template: "   ",
      guildName: "Pawtropolis",
      applicant: {
        id: "99",
        tag: "Watcher#9999",
        display: "Watcher",
      },
    });
    expect(result).toContain("<@99>");
    expect(result).toContain("Pawtropolis");
  });
});
/**
 * WHAT: Proves welcome template rendering substitutes applicant tokens and respects defaults.
 * HOW: Calls renderWelcomeTemplate with minimal config and checks output string.
 * DOCS: https://vitest.dev/guide/
 */
