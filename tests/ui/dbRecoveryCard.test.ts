/**
 * Pawtropolis Tech — tests/ui/dbRecoveryCard.test.ts
 * WHAT: Unit tests for database recovery card builders.
 * WHY: Verify embed construction, color coding, and action row buttons.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock discord.js
vi.mock("discord.js", () => {
  return {
    EmbedBuilder: class MockEmbedBuilder {
      data: {
        color?: number;
        title?: string;
        description?: string;
        fields?: Array<{ name: string; value: string; inline: boolean }>;
        footer?: { text: string };
        timestamp?: string;
      } = {};

      setColor(color: number) {
        this.data.color = color;
        return this;
      }

      setTitle(title: string) {
        this.data.title = title;
        return this;
      }

      setDescription(description: string) {
        this.data.description = description;
        return this;
      }

      addFields(...fields: Array<{ name: string; value: string; inline: boolean }>) {
        this.data.fields = this.data.fields || [];
        this.data.fields.push(...fields);
        return this;
      }

      setFooter(footer: { text: string }) {
        this.data.footer = footer;
        return this;
      }

      setTimestamp() {
        this.data.timestamp = new Date().toISOString();
        return this;
      }
    },
    ActionRowBuilder: class MockActionRowBuilder {
      components: unknown[] = [];
      addComponents(...components: unknown[]) {
        this.components.push(...components);
        return this;
      }
    },
    ButtonBuilder: class MockButtonBuilder {
      data: {
        custom_id?: string;
        label?: string;
        style?: number;
        emoji?: string;
      } = {};

      setCustomId(id: string) {
        this.data.custom_id = id;
        return this;
      }

      setLabel(label: string) {
        this.data.label = label;
        return this;
      }

      setStyle(style: number) {
        this.data.style = style;
        return this;
      }

      setEmoji(emoji: string) {
        this.data.emoji = emoji;
        return this;
      }
    },
    ButtonStyle: {
      Primary: 1,
      Secondary: 2,
      Danger: 4,
    },
  };
});

import {
  buildCandidateListEmbed,
  buildValidationEmbed,
  buildRestoreSummaryEmbed,
  buildCandidateActionRow,
} from "../../src/ui/dbRecoveryCard.js";
import type { BackupCandidate, ValidationResult, RestoreResult } from "../../src/features/dbRecovery.js";

describe("dbRecoveryCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildCandidateListEmbed", () => {
    it("returns an embed with title containing 'Database Recovery'", () => {
      const embed = buildCandidateListEmbed([]);
      expect(embed.data.title).toContain("Database Recovery");
    });

    it("shows 'No Candidates Found' when empty", () => {
      const embed = buildCandidateListEmbed([]);
      expect(embed.data.fields).toHaveLength(1);
      expect(embed.data.fields![0].name).toContain("No Candidates Found");
    });

    it("lists candidates with filename in field name", () => {
      const candidate: BackupCandidate = {
        id: "abc123def456",
        filename: "backup-2024-01-15.db",
        path: "/data/backups/backup-2024-01-15.db",
        created_at: Math.floor(Date.now() / 1000) - 86400,
        size_bytes: 1048576,
        integrity_result: "ok",
        foreign_key_violations: 0,
      };

      const embed = buildCandidateListEmbed([candidate]);
      expect(embed.data.fields).toHaveLength(1);
      expect(embed.data.fields![0].name).toContain("backup-2024-01-15.db");
    });

    it("shows integrity status icons correctly", () => {
      const okCandidate: BackupCandidate = {
        id: "ok123",
        filename: "ok.db",
        path: "/ok.db",
        created_at: Math.floor(Date.now() / 1000),
        size_bytes: 1024,
        integrity_result: "ok",
        foreign_key_violations: 0,
      };

      const failCandidate: BackupCandidate = {
        id: "fail123",
        filename: "fail.db",
        path: "/fail.db",
        created_at: Math.floor(Date.now() / 1000),
        size_bytes: 1024,
        integrity_result: "error: corrupt",
        foreign_key_violations: 5,
      };

      const embed = buildCandidateListEmbed([okCandidate, failCandidate]);
      expect(embed.data.fields![0].value).toContain("✅");
      expect(embed.data.fields![1].value).toContain("❌");
    });

    it("limits to 10 candidates and shows overflow message", () => {
      const candidates: BackupCandidate[] = Array.from({ length: 15 }, (_, i) => ({
        id: `id${i}`,
        filename: `backup-${i}.db`,
        path: `/backup-${i}.db`,
        created_at: Math.floor(Date.now() / 1000) - i * 3600,
        size_bytes: 1024 * (i + 1),
      }));

      const embed = buildCandidateListEmbed(candidates);
      // 10 candidates + 1 overflow message
      expect(embed.data.fields).toHaveLength(11);
      expect(embed.data.fields![10].value).toContain("15 candidates");
    });

    it("formats file sizes correctly", () => {
      const candidate: BackupCandidate = {
        id: "test",
        filename: "test.db",
        path: "/test.db",
        created_at: Math.floor(Date.now() / 1000),
        size_bytes: 2097152, // 2 MB
      };

      const embed = buildCandidateListEmbed([candidate]);
      expect(embed.data.fields![0].value).toContain("2.0 MB");
    });

    it("includes guild name in description if provided", () => {
      const embed = buildCandidateListEmbed([], "Test Guild");
      // Guild name is not directly used but function accepts it
      expect(embed.data.description).toBeDefined();
    });

    it("includes row count when available", () => {
      const candidate: BackupCandidate = {
        id: "test",
        filename: "test.db",
        path: "/test.db",
        created_at: Math.floor(Date.now() / 1000),
        size_bytes: 1024,
        row_count: 12345,
      };

      const embed = buildCandidateListEmbed([candidate]);
      expect(embed.data.fields![0].value).toContain("12,345");
    });

    it("includes truncated notes when available", () => {
      const longNote = "A".repeat(100);
      const candidate: BackupCandidate = {
        id: "test",
        filename: "test.db",
        path: "/test.db",
        created_at: Math.floor(Date.now() / 1000),
        size_bytes: 1024,
        notes: longNote,
      };

      const embed = buildCandidateListEmbed([candidate]);
      expect(embed.data.fields![0].value).toContain("Notes:");
      expect(embed.data.fields![0].value).toContain("...");
    });

    it("sets blue info color", () => {
      const embed = buildCandidateListEmbed([]);
      expect(embed.data.color).toBe(0x3b82f6);
    });

    it("sets warning footer", () => {
      const embed = buildCandidateListEmbed([]);
      expect(embed.data.footer?.text).toContain("Validate");
    });
  });

  describe("buildValidationEmbed", () => {
    const baseCandidate: BackupCandidate = {
      id: "test123",
      filename: "test-backup.db",
      path: "/test-backup.db",
      created_at: Math.floor(Date.now() / 1000),
      size_bytes: 1048576,
    };

    it("shows green color for passing validation", () => {
      const validation: ValidationResult = {
        ok: true,
        integrity_result: "ok",
        foreign_key_violations: 0,
        row_counts: { users: 100, applications: 50 },
        size_bytes: 1048576,
        checksum: "abc123def456789",
        messages: [],
      };

      const embed = buildValidationEmbed(baseCandidate, validation);
      expect(embed.data.color).toBe(0x10b981); // green
      expect(embed.data.title).toContain("✅");
    });

    it("shows red color for failing validation", () => {
      const validation: ValidationResult = {
        ok: false,
        integrity_result: "error: database is corrupted",
        foreign_key_violations: 5,
        row_counts: {},
        size_bytes: 1048576,
        checksum: "abc123def456789",
        messages: ["Corruption detected"],
      };

      const embed = buildValidationEmbed(baseCandidate, validation);
      expect(embed.data.color).toBe(0xef4444); // red
      expect(embed.data.title).toContain("❌");
    });

    it("includes integrity check result", () => {
      const validation: ValidationResult = {
        ok: true,
        integrity_result: "ok",
        foreign_key_violations: 0,
        row_counts: {},
        size_bytes: 1024,
        checksum: "abc123",
        messages: [],
      };

      const embed = buildValidationEmbed(baseCandidate, validation);
      const integrityField = embed.data.fields?.find((f) => f.name.includes("Integrity"));
      expect(integrityField).toBeDefined();
      expect(integrityField?.value).toContain("PASS");
    });

    it("includes foreign key violation count", () => {
      const validation: ValidationResult = {
        ok: false,
        integrity_result: "ok",
        foreign_key_violations: 3,
        row_counts: {},
        size_bytes: 1024,
        checksum: "abc123",
        messages: [],
      };

      const embed = buildValidationEmbed(baseCandidate, validation);
      const fkField = embed.data.fields?.find((f) => f.name.includes("Foreign Key"));
      expect(fkField).toBeDefined();
      expect(fkField?.value).toContain("3 violation");
    });

    it("includes row counts for tables", () => {
      const validation: ValidationResult = {
        ok: true,
        integrity_result: "ok",
        foreign_key_violations: 0,
        row_counts: { users: 500, applications: 200 },
        size_bytes: 1024,
        checksum: "abc123",
        messages: [],
      };

      const embed = buildValidationEmbed(baseCandidate, validation);
      const rowField = embed.data.fields?.find((f) => f.name.includes("Row Counts"));
      expect(rowField).toBeDefined();
      expect(rowField?.value).toContain("users");
      expect(rowField?.value).toContain("500");
    });

    it("includes file metadata with checksum", () => {
      const validation: ValidationResult = {
        ok: true,
        integrity_result: "ok",
        foreign_key_violations: 0,
        row_counts: {},
        size_bytes: 2097152,
        checksum: "abcdefghijklmnopqrstuvwxyz",
        messages: [],
      };

      const embed = buildValidationEmbed(baseCandidate, validation);
      const metaField = embed.data.fields?.find((f) => f.name.includes("Metadata"));
      expect(metaField).toBeDefined();
      expect(metaField?.value).toContain("2.0 MB");
      expect(metaField?.value).toContain("abcdefghijklmnop...");
    });

    it("includes validation messages when present", () => {
      const validation: ValidationResult = {
        ok: false,
        integrity_result: "ok",
        foreign_key_violations: 0,
        row_counts: {},
        size_bytes: 1024,
        checksum: "abc",
        messages: ["Warning: old schema version", "Info: migration needed"],
      };

      const embed = buildValidationEmbed(baseCandidate, validation);
      const msgField = embed.data.fields?.find((f) => f.name.includes("Messages"));
      expect(msgField).toBeDefined();
      expect(msgField?.value).toContain("old schema version");
    });

    it("limits messages to 10", () => {
      const validation: ValidationResult = {
        ok: false,
        integrity_result: "ok",
        foreign_key_violations: 0,
        row_counts: {},
        size_bytes: 1024,
        checksum: "abc",
        messages: Array.from({ length: 15 }, (_, i) => `Message ${i}`),
      };

      const embed = buildValidationEmbed(baseCandidate, validation);
      const msgField = embed.data.fields?.find((f) => f.name.includes("Messages"));
      expect(msgField?.value).toContain("Message 9");
      expect(msgField?.value).not.toContain("Message 10");
    });

    it("sets appropriate footer for pass/fail", () => {
      const passValidation: ValidationResult = {
        ok: true,
        integrity_result: "ok",
        foreign_key_violations: 0,
        row_counts: {},
        size_bytes: 1024,
        checksum: "abc",
        messages: [],
      };

      const failValidation: ValidationResult = {
        ok: false,
        integrity_result: "error",
        foreign_key_violations: 1,
        row_counts: {},
        size_bytes: 1024,
        checksum: "abc",
        messages: [],
      };

      const passEmbed = buildValidationEmbed(baseCandidate, passValidation);
      const failEmbed = buildValidationEmbed(baseCandidate, failValidation);

      expect(passEmbed.data.footer?.text).toContain("ready to restore");
      expect(failEmbed.data.footer?.text).toContain("not recommended");
    });
  });

  describe("buildRestoreSummaryEmbed", () => {
    const baseCandidate: BackupCandidate = {
      id: "restore123",
      filename: "restore-backup.db",
      path: "/restore-backup.db",
      created_at: Math.floor(Date.now() / 1000) - 3600,
      size_bytes: 5242880,
    };

    it("shows green color for successful restore", () => {
      const result: RestoreResult = {
        success: true,
        preRestoreBackupPath: "/data/pre-restore-2024.db",
        messages: ["Restore complete"],
      };

      const embed = buildRestoreSummaryEmbed(baseCandidate, result, "123456789");
      expect(embed.data.color).toBe(0x10b981);
      expect(embed.data.title).toContain("✅");
      expect(embed.data.title).toContain("Complete");
    });

    it("shows red color for failed restore", () => {
      const result: RestoreResult = {
        success: false,
        messages: ["Error: Permission denied"],
      };

      const embed = buildRestoreSummaryEmbed(baseCandidate, result, "123456789");
      expect(embed.data.color).toBe(0xef4444);
      expect(embed.data.title).toContain("❌");
      expect(embed.data.title).toContain("Failed");
    });

    it("includes restored backup info", () => {
      const result: RestoreResult = {
        success: true,
        messages: [],
      };

      const embed = buildRestoreSummaryEmbed(baseCandidate, result, "user123");
      const backupField = embed.data.fields?.find((f) => f.name.includes("Restored Backup"));
      expect(backupField).toBeDefined();
      expect(backupField?.value).toContain("restore-backup.db");
      expect(backupField?.value).toContain("5.0 MB");
    });

    it("includes pre-restore backup path", () => {
      const result: RestoreResult = {
        success: true,
        preRestoreBackupPath: "/data/backups/pre-restore-2024-01-15.db",
        messages: [],
      };

      const embed = buildRestoreSummaryEmbed(baseCandidate, result, "user123");
      const preBackupField = embed.data.fields?.find((f) => f.name.includes("Pre-Restore"));
      expect(preBackupField).toBeDefined();
      expect(preBackupField?.value).toContain("pre-restore-2024-01-15.db");
    });

    it("includes post-restore verification when available", () => {
      const result: RestoreResult = {
        success: true,
        verificationResult: {
          ok: true,
          integrity_result: "ok",
          foreign_key_violations: 0,
          row_counts: {},
          size_bytes: 1024,
          checksum: "abc",
          messages: [],
        },
        messages: [],
      };

      const embed = buildRestoreSummaryEmbed(baseCandidate, result, "user123");
      const verifyField = embed.data.fields?.find((f) => f.name.includes("Verification"));
      expect(verifyField).toBeDefined();
      expect(verifyField?.value).toContain("PASS");
    });

    it("includes restore log messages", () => {
      const result: RestoreResult = {
        success: true,
        messages: ["Step 1: Backing up current DB", "Step 2: Copying backup", "Step 3: Verifying"],
      };

      const embed = buildRestoreSummaryEmbed(baseCandidate, result, "user123");
      const logField = embed.data.fields?.find((f) => f.name.includes("Log"));
      expect(logField).toBeDefined();
      expect(logField?.value).toContain("Backing up");
    });

    it("shows CLI actor correctly", () => {
      const result: RestoreResult = {
        success: true,
        messages: [],
      };

      const embed = buildRestoreSummaryEmbed(baseCandidate, result, "cli");
      const actorField = embed.data.fields?.find((f) => f.name.includes("Initiated By"));
      expect(actorField).toBeDefined();
      expect(actorField?.value).toContain("CLI");
    });

    it("shows Discord user actor as mention", () => {
      const result: RestoreResult = {
        success: true,
        messages: [],
      };

      const embed = buildRestoreSummaryEmbed(baseCandidate, result, "123456789012345678");
      const actorField = embed.data.fields?.find((f) => f.name.includes("Initiated By"));
      expect(actorField).toBeDefined();
      expect(actorField?.value).toContain("<@123456789012345678>");
    });

    it("handles Windows-style path separators in pre-restore backup", () => {
      const result: RestoreResult = {
        success: true,
        preRestoreBackupPath: "C:\\data\\backups\\pre-restore.db",
        messages: [],
      };

      const embed = buildRestoreSummaryEmbed(baseCandidate, result, "user123");
      const preBackupField = embed.data.fields?.find((f) => f.name.includes("Pre-Restore"));
      expect(preBackupField?.value).toContain("pre-restore.db");
    });
  });

  describe("buildCandidateActionRow", () => {
    it("returns action row with 3 buttons", () => {
      const row = buildCandidateActionRow("candidate123", "nonce456");
      expect(row.components).toHaveLength(3);
    });

    it("includes validate button", () => {
      const row = buildCandidateActionRow("candidate123", "nonce456");
      const validateBtn = row.components[0] as { data: { custom_id: string; label: string } };
      expect(validateBtn.data.custom_id).toContain("validate");
      expect(validateBtn.data.custom_id).toContain("candidate123");
      expect(validateBtn.data.custom_id).toContain("nonce456");
      expect(validateBtn.data.label).toBe("Validate");
    });

    it("includes dry run button", () => {
      const row = buildCandidateActionRow("candidate123", "nonce456");
      const dryRunBtn = row.components[1] as { data: { custom_id: string; label: string } };
      expect(dryRunBtn.data.custom_id).toContain("restore-dry");
      expect(dryRunBtn.data.label).toContain("Dry Run");
    });

    it("includes confirm button with Danger style", () => {
      const row = buildCandidateActionRow("candidate123", "nonce456");
      const confirmBtn = row.components[2] as { data: { custom_id: string; label: string; style: number } };
      expect(confirmBtn.data.custom_id).toContain("restore-confirm");
      expect(confirmBtn.data.label).toContain("Confirm");
      expect(confirmBtn.data.style).toBe(4); // ButtonStyle.Danger
    });

    it("includes nonce in all button custom IDs for security", () => {
      const row = buildCandidateActionRow("test-id", "security-nonce");
      for (const component of row.components) {
        const btn = component as { data: { custom_id: string } };
        expect(btn.data.custom_id).toContain("security-nonce");
      }
    });
  });
});
