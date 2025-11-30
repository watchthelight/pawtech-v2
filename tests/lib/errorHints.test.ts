/**
 * WHAT: Proves human hints derived from error names/codes are stable (e.g., 10062, 40060, 50013).
 * HOW: Unit-tests hintFor mapping with representative payloads.
 * DOCS: https://vitest.dev/guide/
 *
 * These tests lock the error-to-hint mapping. If you add new error codes or change
 * existing hints, update these tests. The hints appear in user-facing error cards,
 * so changes should be deliberate.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { hintFor } from "../../src/lib/errorCard.js";

describe("hintFor", () => {
  /**
   * SQLite schema errors happen when:
   * - Running on an old DB after a migration
   * - Factory reset leaving orphaned __old tables
   * - Version mismatch between code and schema
   *
   * The hint tells users to use truncate-only reset, which is safer than DROP.
   */
  it("returns migration hint for sqlite missing table", () => {
    const err = new Error("no such table: main.application");
    err.name = "SqliteError";
    expect(hintFor(err)).toBe("Schema mismatch; avoid legacy __old; use truncate-only reset.");
  });

  /**
   * Discord API error 10003 = Unknown Channel.
   * Channel was deleted or bot lacks visibility to see it.
   */
  it("returns unknown channel hint for error code 10003", () => {
    const err = { code: 10003 };
    expect(hintFor(err)).toBe("Channel not found. It may have been deleted or bot lacks visibility.");
  });

  /**
   * Discord API error 10008 = Unknown Message.
   * Message was deleted or is in a channel the bot can't access.
   */
  it("returns unknown message hint for error code 10008", () => {
    const err = { code: 10008 };
    expect(hintFor(err)).toBe("Message not found. It may have been deleted or is in an inaccessible channel.");
  });

  /**
   * Discord API error 10062 = Unknown Interaction.
   * The 3-second initial response window expired before handler responded.
   */
  it("returns interaction expired hint for error code 10062", () => {
    const err = { code: 10062 };
    expect(hintFor(err)).toBe("Interaction expired; handler didn't defer in time.");
  });

  /**
   * Discord API error 30001 = Maximum number of guilds reached.
   * Bot has joined too many servers (default limit is 100).
   */
  it("returns max guilds hint for error code 30001", () => {
    const err = { code: 30001 };
    expect(hintFor(err)).toBe("Bot has reached maximum number of servers. Contact Discord support to increase limit.");
  });

  /**
   * Discord API error 30007 = Maximum number of webhooks reached.
   * Channel has hit its webhook limit.
   */
  it("returns max webhooks hint for error code 30007", () => {
    const err = { code: 30007 };
    expect(hintFor(err)).toBe("Maximum webhooks reached in this channel. Delete unused webhooks first.");
  });

  /**
   * Discord API error 30010 = Maximum number of roles reached.
   * Guild has hit its role limit (250 roles).
   */
  it("returns max roles hint for error code 30010", () => {
    const err = { code: 30010 };
    expect(hintFor(err)).toBe("Maximum roles reached in this server. Delete unused roles first.");
  });

  /**
   * Discord API error 30013 = Maximum number of reactions reached.
   * Message has hit its reaction limit (20 unique emoji reactions).
   */
  it("returns max reactions hint for error code 30013", () => {
    const err = { code: 30013 };
    expect(hintFor(err)).toBe("Maximum reactions reached on this message. Cannot add more.");
  });

  /**
   * Discord API error 40001 = Unauthorized.
   * Bot token is invalid or missing required OAuth2 scope.
   */
  it("returns unauthorized hint for error code 40001", () => {
    const err = { code: 40001 };
    expect(hintFor(err)).toBe("Bot authentication failed. Token may be invalid or missing required scope.");
  });

  /**
   * Discord API error 40060 = Already acknowledged.
   * Code tried to reply to an interaction that was already replied to.
   */
  it("returns double reply hint for error code 40060", () => {
    const err = { code: 40060 };
    expect(hintFor(err)).toBe("Already acknowledged; avoid double reply.");
  });

  /**
   * Discord API error 50001 = Missing Access.
   * Bot can't access the resource (channel, guild, etc) due to permissions.
   */
  it("returns missing access hint for error code 50001", () => {
    const err = { code: 50001 };
    expect(hintFor(err)).toBe("Bot lacks access to this resource. Check channel visibility and role permissions.");
  });

  /**
   * Discord API error 50013 = Missing Permissions.
   * Common causes: bot role too low, channel overwrites blocking bot, missing intents.
   * This is one of the most frequent Discord errors bots encounter.
   */
  it("returns missing permission hint for Discord error code", () => {
    // Discord errors come as objects with numeric codes, not Error instances.
    const err = { code: 50013 };
    expect(hintFor(err)).toBe("Missing Discord permission in this channel.");
  });

  /**
   * Discord API error 50035 = Invalid Form Body.
   * Malformed API request, usually indicates a bug in the bot code.
   */
  it("returns invalid form body hint for error code 50035", () => {
    const err = { code: 50035 };
    expect(hintFor(err)).toBe("Invalid request format. This is likely a bot bug; report to staff with trace ID.");
  });

  /**
   * Custom error from modal router when customId doesn't match any handler.
   */
  it("returns modal handler hint for unhandled modal error", () => {
    const err = new Error("Unhandled modal: v1:modal:abc123:p0");
    expect(hintFor(err)).toBe("Form ID didn't match any handler. If your modal id includes a session segment (v1:modal:<uuid>:p0), make sure the router regex matches it.");
  });

  /**
   * Fallback for unrecognized errors. Important that this never throws—
   * we always want SOME hint displayed, even if it's generic.
   */
  it("falls back to default message", () => {
    expect(hintFor(new Error("weird"))).toBe("Unexpected error. Try again or contact staff.");
  });
});
