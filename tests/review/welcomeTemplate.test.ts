// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { renderWelcomeTemplate } from "../../src/features/review.js";

/**
 * Welcome message template tests. When an applicant is accepted,
 * the bot sends a customizable welcome message with token substitution.
 *
 * Templates use curly-brace tokens like {applicant.mention} which get
 * replaced at runtime. Admins configure these per-guild, so we need to
 * handle both valid templates and edge cases like empty/whitespace input.
 */
describe("renderWelcomeTemplate", () => {
  // Tests the happy path: all supported tokens get replaced correctly.
  // The <#123> at the end verifies we don't accidentally mangle Discord's
  // native channel mention syntax while processing our custom tokens.
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

  // Edge case: admin sets a blank/whitespace-only template.
  // Rather than sending an empty welcome message (confusing for new members),
  // we fall back to a sensible default. The test verifies the default still
  // includes the applicant mention and guild name.
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
