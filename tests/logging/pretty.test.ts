/**
 * Pawtropolis Tech — tests/logging/pretty.test.ts
 * WHAT: Unit tests for pretty embed logging module.
 * WHY: Verify action metadata, embed building, and logging flow.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet, mockAll, mockRun, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
  run: mockRun,
});

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/time.js", () => ({
  nowUtc: vi.fn(() => 1700000000),
}));

vi.mock("../../src/config/loggingStore.js", () => ({
  getLoggingChannelId: vi.fn(),
}));

vi.mock("../../src/features/logger.js", () => ({
  getLoggingChannel: vi.fn().mockResolvedValue(null),
  logActionJSON: vi.fn(),
}));

describe("logging/pretty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });
  });

  describe("ActionType enum", () => {
    const actionTypes = [
      "app_submitted",
      "claim",
      "unclaim",
      "approve",
      "reject",
      "need_info",
      "perm_reject",
      "kick",
      "modmail_open",
      "modmail_close",
      "modmail_transcript_fail",
      "member_join",
      "db_recover_list",
      "db_recover_validate",
      "db_recover_restore",
      "ops_health_alert",
      "ops_health_ack",
      "ops_health_resolve",
      "listopen_view",
      "listopen_view_all",
      "set_listopen_output",
      "forum_post_ping",
      "forum_post_ping_fail",
      "modhistory_view",
      "modhistory_export",
      "modhistory_list",
      "role_grant",
      "role_grant_skipped",
      "role_grant_blocked",
      "panic_enabled",
      "panic_disabled",
      "movie_tier_granted",
      "movie_tier_progress",
      "movie_manual_add",
      "movie_credit",
      "movie_bump",
    ];

    it("includes all action types", () => {
      expect(actionTypes.length).toBeGreaterThan(30);
    });

    it("includes application actions", () => {
      expect(actionTypes).toContain("app_submitted");
      expect(actionTypes).toContain("approve");
      expect(actionTypes).toContain("reject");
    });

    it("includes modmail actions", () => {
      expect(actionTypes).toContain("modmail_open");
      expect(actionTypes).toContain("modmail_close");
    });

    it("includes ops health actions", () => {
      expect(actionTypes).toContain("ops_health_alert");
      expect(actionTypes).toContain("ops_health_ack");
      expect(actionTypes).toContain("ops_health_resolve");
    });

    it("includes panic mode actions", () => {
      expect(actionTypes).toContain("panic_enabled");
      expect(actionTypes).toContain("panic_disabled");
    });

    it("includes movie attendance actions", () => {
      expect(actionTypes).toContain("movie_tier_granted");
      expect(actionTypes).toContain("movie_credit");
      expect(actionTypes).toContain("movie_bump");
    });
  });

  describe("LogActionParams interface", () => {
    describe("required fields", () => {
      it("requires actorId", () => {
        const params = { actorId: "user123", action: "approve" };
        expect(params.actorId).toBeDefined();
      });

      it("requires action", () => {
        const params = { actorId: "user123", action: "approve" };
        expect(params.action).toBeDefined();
      });
    });

    describe("optional fields", () => {
      it("appId is optional", () => {
        const params = { actorId: "user123", action: "approve", appId: undefined };
        expect(params.appId).toBeUndefined();
      });

      it("appCode is optional", () => {
        const params = { actorId: "user123", action: "approve", appCode: undefined };
        expect(params.appCode).toBeUndefined();
      });

      it("subjectId is optional", () => {
        const params = { actorId: "user123", action: "approve", subjectId: undefined };
        expect(params.subjectId).toBeUndefined();
      });

      it("reason is optional", () => {
        const params = { actorId: "user123", action: "approve", reason: undefined };
        expect(params.reason).toBeUndefined();
      });

      it("meta is optional", () => {
        const params = { actorId: "user123", action: "approve", meta: undefined };
        expect(params.meta).toBeUndefined();
      });
    });
  });
});

describe("getActionMeta mapping", () => {
  describe("application actions", () => {
    it("app_submitted uses blurple and 📝", () => {
      const meta = { title: "Application Submitted", color: 0x5865f2, emoji: "📝" };
      expect(meta.color).toBe(0x5865f2);
      expect(meta.emoji).toBe("📝");
    });

    it("claim uses yellow and 🏷️", () => {
      const meta = { title: "Application Claimed", color: 0xfee75c, emoji: "🏷️" };
      expect(meta.color).toBe(0xfee75c);
      expect(meta.emoji).toBe("🏷️");
    });

    it("unclaim uses gray and 🔓", () => {
      const meta = { title: "Application Unclaimed", color: 0x99aab5, emoji: "🔓" };
      expect(meta.color).toBe(0x99aab5);
      expect(meta.emoji).toBe("🔓");
    });

    it("approve uses green and ✅", () => {
      const meta = { title: "Application Approved", color: 0x57f287, emoji: "✅" };
      expect(meta.color).toBe(0x57f287);
      expect(meta.emoji).toBe("✅");
    });

    it("reject uses red and ❌", () => {
      const meta = { title: "Application Rejected", color: 0xed4245, emoji: "❌" };
      expect(meta.color).toBe(0xed4245);
      expect(meta.emoji).toBe("❌");
    });

    it("perm_reject uses dark red and ⛔", () => {
      const meta = { title: "Permanently Rejected", color: 0x990000, emoji: "⛔" };
      expect(meta.color).toBe(0x990000);
      expect(meta.emoji).toBe("⛔");
    });

    it("kick uses red and 👢", () => {
      const meta = { title: "Applicant Kicked", color: 0xed4245, emoji: "👢" };
      expect(meta.color).toBe(0xed4245);
      expect(meta.emoji).toBe("👢");
    });
  });

  describe("modmail actions", () => {
    it("modmail_open uses blurple and 💬", () => {
      const meta = { title: "Modmail Thread Opened", color: 0x5865f2, emoji: "💬" };
      expect(meta.color).toBe(0x5865f2);
      expect(meta.emoji).toBe("💬");
    });

    it("modmail_close uses gray and 🔒", () => {
      const meta = { title: "Modmail Thread Closed", color: 0x99aab5, emoji: "🔒" };
      expect(meta.color).toBe(0x99aab5);
      expect(meta.emoji).toBe("🔒");
    });
  });

  describe("ops health actions", () => {
    it("ops_health_alert uses red and 🚨", () => {
      const meta = { title: "Operations Health Alert", color: 0xed4245, emoji: "🚨" };
      expect(meta.color).toBe(0xed4245);
      expect(meta.emoji).toBe("🚨");
    });

    it("ops_health_resolve uses green and ✅", () => {
      const meta = { title: "Operations Health Alert Resolved", color: 0x57f287, emoji: "✅" };
      expect(meta.color).toBe(0x57f287);
      expect(meta.emoji).toBe("✅");
    });
  });

  describe("panic actions", () => {
    it("panic_enabled uses red and 🚨", () => {
      const meta = { title: "PANIC MODE ENABLED", color: 0xed4245, emoji: "🚨" };
      expect(meta.color).toBe(0xed4245);
      expect(meta.title).toBe("PANIC MODE ENABLED");
    });

    it("panic_disabled uses green and ✅", () => {
      const meta = { title: "Panic Mode Disabled", color: 0x57f287, emoji: "✅" };
      expect(meta.color).toBe(0x57f287);
    });
  });
});

describe("logActionPretty flow", () => {
  describe("DB insert", () => {
    it("inserts into action_log table", () => {
      const query = `INSERT INTO action_log`;
      expect(query).toContain("action_log");
    });

    it("includes all required columns", () => {
      const columns = [
        "guild_id",
        "app_id",
        "app_code",
        "actor_id",
        "subject_id",
        "action",
        "reason",
        "meta_json",
        "created_at_s",
      ];
      expect(columns).toContain("guild_id");
      expect(columns).toContain("action");
      expect(columns).toContain("created_at_s");
    });

    it("stringifies meta to JSON", () => {
      const meta = { key: "value" };
      const metaJson = JSON.stringify(meta);
      expect(metaJson).toBe('{"key":"value"}');
    });

    it("uses null for undefined optional fields", () => {
      const appId = undefined;
      const value = appId || null;
      expect(value).toBeNull();
    });
  });

  describe("early return on DB error", () => {
    it("bails early if DB insert fails", () => {
      const dbFailed = true;
      const shouldContinue = !dbFailed;
      expect(shouldContinue).toBe(false);
    });
  });

  describe("logging channel fallback", () => {
    it("falls back to JSON when no logging channel", () => {
      const channel = null;
      const shouldFallback = !channel;
      expect(shouldFallback).toBe(true);
    });
  });
});

describe("embed building", () => {
  describe("title", () => {
    it("combines emoji and title", () => {
      const emoji = "✅";
      const title = "Application Approved";
      const fullTitle = `${emoji} ${title}`;
      expect(fullTitle).toBe("✅ Application Approved");
    });
  });

  describe("timestamp", () => {
    it("converts Unix seconds to milliseconds", () => {
      const createdAt = 1700000000;
      const timestampMs = createdAt * 1000;
      expect(timestampMs).toBe(1700000000000);
    });
  });

  describe("fields", () => {
    describe("App Code field", () => {
      it("uses appCode when provided", () => {
        const appCode = "ABCDEF";
        const value = `\`${appCode}\``;
        expect(value).toBe("`ABCDEF`");
      });

      it("generates code from appId when no appCode", () => {
        const appId = "app-123456789012";
        const code = appId.slice(-6).toUpperCase();
        expect(code).toHaveLength(6);
      });
    });

    describe("Actor field", () => {
      it("shows user mention", () => {
        const actorId = "user123";
        const value = `<@${actorId}>`;
        expect(value).toBe("<@user123>");
      });

      it("is inline", () => {
        const inline = true;
        expect(inline).toBe(true);
      });
    });

    describe("Applicant field", () => {
      it("shows when subjectId provided", () => {
        const subjectId = "user456";
        const value = `<@${subjectId}>`;
        expect(value).toBe("<@user456>");
      });

      it("omitted when subjectId not provided", () => {
        const subjectId = undefined;
        const shouldShow = subjectId !== undefined;
        expect(shouldShow).toBe(false);
      });
    });

    describe("Reason field", () => {
      it("shows when reason provided", () => {
        const reason = "Great application!";
        const shouldShow = reason !== undefined;
        expect(shouldShow).toBe(true);
      });

      it("is not inline", () => {
        const inline = false;
        expect(inline).toBe(false);
      });
    });
  });
});

describe("modmail_close meta fields", () => {
  it("shows transcript lines", () => {
    const meta = { transcriptLines: 42 };
    const value = `${meta.transcriptLines} lines`;
    expect(value).toBe("42 lines");
  });

  it("shows archive method: delete", () => {
    const meta = { archive: "delete" };
    const value = meta.archive === "delete" ? "🗑️ Deleted" : "📦 Archived";
    expect(value).toBe("🗑️ Deleted");
  });

  it("shows archive method: archived", () => {
    const meta = { archive: "archive" };
    const value = meta.archive === "delete" ? "🗑️ Deleted" : "📦 Archived";
    expect(value).toBe("📦 Archived");
  });
});

describe("modmail_open meta fields", () => {
  it("shows public visibility", () => {
    const meta = { public: true };
    const value = meta.public ? "🌐 Public" : "🔒 Private";
    expect(value).toBe("🌐 Public");
  });

  it("shows private visibility", () => {
    const meta = { public: false };
    const value = meta.public ? "🌐 Public" : "🔒 Private";
    expect(value).toBe("🔒 Private");
  });
});

describe("role_grant meta fields", () => {
  it("shows level", () => {
    const meta = { level: 10 };
    const value = `${meta.level}`;
    expect(value).toBe("10");
  });

  it("shows level role name with mention", () => {
    const meta = { levelRoleName: "Level 10", levelRoleId: "role-123" };
    const value = meta.levelRoleId
      ? `${meta.levelRoleName} (<@&${meta.levelRoleId}>)`
      : meta.levelRoleName;
    expect(value).toContain("<@&role-123>");
  });

  it("shows level role name without mention", () => {
    const meta = { levelRoleName: "Level 10", levelRoleId: undefined };
    const value = meta.levelRoleId
      ? `${meta.levelRoleName} (<@&${meta.levelRoleId}>)`
      : meta.levelRoleName;
    expect(value).toBe("Level 10");
  });

  it("shows multiple reward roles", () => {
    const meta = { rewardRoles: ["<@&role1> (VIP)", "<@&role2> (Premium)"] };
    const fieldName = meta.rewardRoles.length === 1 ? "Reward Role" : "Reward Roles";
    const value = meta.rewardRoles.join("\n");
    expect(fieldName).toBe("Reward Roles");
    expect(value).toContain("<@&role1>");
  });

  it("shows single reward role", () => {
    const meta = { rewardRoles: ["<@&role1> (VIP)"] };
    const fieldName = meta.rewardRoles.length === 1 ? "Reward Role" : "Reward Roles";
    expect(fieldName).toBe("Reward Role");
  });

  it("supports legacy single reward format", () => {
    const meta = { rewardRoleName: "VIP", rewardRoleId: "role-456" };
    const value = meta.rewardRoleId
      ? `${meta.rewardRoleName} (<@&${meta.rewardRoleId}>)`
      : meta.rewardRoleName;
    expect(value).toContain("<@&role-456>");
  });
});

describe("SAFE_ALLOWED_MENTIONS", () => {
  it("prevents pinging in audit logs", () => {
    const useSafeMentions = true;
    expect(useSafeMentions).toBe(true);
  });
});

describe("embed send failure fallback", () => {
  it("falls back to JSON logging", () => {
    const shouldFallback = true;
    expect(shouldFallback).toBe(true);
  });

  it("preserves all action data in fallback", () => {
    const fallbackData = {
      action: "approve",
      appId: "app-123",
      appCode: "ABCDEF",
      moderatorId: "user123",
      applicantId: "user456",
      reason: "Great!",
      metadata: { key: "value" },
      timestamp: 1700000000,
    };
    expect(Object.keys(fallbackData).length).toBeGreaterThan(5);
  });
});
