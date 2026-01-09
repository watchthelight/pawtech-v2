/**
 * Pawtropolis Tech — tests/commands/help/data.test.ts
 * WHAT: Unit tests for the /help command SlashCommandBuilder definition.
 * WHY: Verify command structure, options, and configuration.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { data } from "../../../src/commands/help/data.js";

describe("help/data", () => {
  describe("command structure", () => {
    it("has name 'help'", () => {
      expect(data.name).toBe("help");
    });

    it("has description", () => {
      expect(data.description).toBe("Interactive help system for Pawtropolis Tech");
    });

    it("has three options", () => {
      expect(data.options).toHaveLength(3);
    });

    it("has dm_permission set to false", () => {
      expect(data.dm_permission).toBe(false);
    });

    it("has default_member_permissions set to null", () => {
      expect(data.default_member_permissions).toBeNull();
    });
  });

  describe("command option", () => {
    it("exists as first option", () => {
      const option = data.options[0];
      expect(option.name).toBe("command");
    });

    it("has correct description", () => {
      const option = data.options[0];
      expect(option.description).toBe("Get detailed help for a specific command");
    });

    it("is not required", () => {
      const option = data.options[0];
      expect(option.required).toBe(false);
    });

    it("has autocomplete enabled", () => {
      const option = data.options[0];
      expect(option.autocomplete).toBe(true);
    });
  });

  describe("search option", () => {
    it("exists as second option", () => {
      const option = data.options[1];
      expect(option.name).toBe("search");
    });

    it("has correct description", () => {
      const option = data.options[1];
      expect(option.description).toBe("Search commands by keyword");
    });

    it("is not required", () => {
      const option = data.options[1];
      expect(option.required).toBe(false);
    });

    it("does not have autocomplete", () => {
      const option = data.options[1];
      expect(option.autocomplete).toBeFalsy();
    });
  });

  describe("category option", () => {
    it("exists as third option", () => {
      const option = data.options[2];
      expect(option.name).toBe("category");
    });

    it("has correct description", () => {
      const option = data.options[2];
      expect(option.description).toBe("Browse commands by category");
    });

    it("is not required", () => {
      const option = data.options[2];
      expect(option.required).toBe(false);
    });

    it("has 9 choices", () => {
      const option = data.options[2];
      expect(option.choices).toHaveLength(9);
    });

    it("includes gate category choice", () => {
      const option = data.options[2];
      const gateChoice = option.choices?.find((c) => c.value === "gate");
      expect(gateChoice).toBeDefined();
      expect(gateChoice!.name).toBe("Gate & Verification");
    });

    it("includes config category choice", () => {
      const option = data.options[2];
      const configChoice = option.choices?.find((c) => c.value === "config");
      expect(configChoice).toBeDefined();
      expect(configChoice!.name).toBe("Configuration");
    });

    it("includes moderation category choice", () => {
      const option = data.options[2];
      const modChoice = option.choices?.find((c) => c.value === "moderation");
      expect(modChoice).toBeDefined();
      expect(modChoice!.name).toBe("Moderation");
    });

    it("includes queue category choice", () => {
      const option = data.options[2];
      const queueChoice = option.choices?.find((c) => c.value === "queue");
      expect(queueChoice).toBeDefined();
      expect(queueChoice!.name).toBe("Queue Management");
    });

    it("includes analytics category choice", () => {
      const option = data.options[2];
      const analyticsChoice = option.choices?.find((c) => c.value === "analytics");
      expect(analyticsChoice).toBeDefined();
      expect(analyticsChoice!.name).toBe("Analytics");
    });

    it("includes messaging category choice", () => {
      const option = data.options[2];
      const msgChoice = option.choices?.find((c) => c.value === "messaging");
      expect(msgChoice).toBeDefined();
      expect(msgChoice!.name).toBe("Messaging");
    });

    it("includes roles category choice", () => {
      const option = data.options[2];
      const rolesChoice = option.choices?.find((c) => c.value === "roles");
      expect(rolesChoice).toBeDefined();
      expect(rolesChoice!.name).toBe("Role Automation");
    });

    it("includes artist category choice", () => {
      const option = data.options[2];
      const artistChoice = option.choices?.find((c) => c.value === "artist");
      expect(artistChoice).toBeDefined();
      expect(artistChoice!.name).toBe("Artist System");
    });

    it("includes system category choice", () => {
      const option = data.options[2];
      const sysChoice = option.choices?.find((c) => c.value === "system");
      expect(sysChoice).toBeDefined();
      expect(sysChoice!.name).toBe("System & Maintenance");
    });
  });

  describe("all category choices", () => {
    const expectedCategories = [
      { value: "gate", name: "Gate & Verification" },
      { value: "config", name: "Configuration" },
      { value: "moderation", name: "Moderation" },
      { value: "queue", name: "Queue Management" },
      { value: "analytics", name: "Analytics" },
      { value: "messaging", name: "Messaging" },
      { value: "roles", name: "Role Automation" },
      { value: "artist", name: "Artist System" },
      { value: "system", name: "System & Maintenance" },
    ];

    it.each(expectedCategories)(
      "has $value category with label '$name'",
      ({ value, name }) => {
        const option = data.options[2];
        const choice = option.choices?.find((c) => c.value === value);
        expect(choice).toBeDefined();
        expect(choice!.name).toBe(name);
      }
    );
  });
});
