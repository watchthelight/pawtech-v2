/**
 * Pawtropolis Tech — tests/features/artistRotation/handlers.test.ts
 * WHAT: Unit tests for redeemreward button handlers.
 * WHY: Verify confirm/cancel flows, role removal, and job creation.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies with vi.hoisted
const {
  mockLogger,
  mockGetTicketRoles,
  mockIncrementAssignments,
  mockLogAssignment,
  mockGetArtist,
  mockGetAllArtists,
  mockProcessAssignment,
  mockCreateJob,
} = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockGetTicketRoles: vi.fn(),
  mockIncrementAssignments: vi.fn(),
  mockLogAssignment: vi.fn(),
  mockGetArtist: vi.fn(),
  mockGetAllArtists: vi.fn(),
  mockProcessAssignment: vi.fn(),
  mockCreateJob: vi.fn(),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

vi.mock("../../../src/features/artistRotation/index.js", () => ({
  getTicketRoles: mockGetTicketRoles,
  TICKET_ROLE_NAMES: {
    "role-123": "OC Headshot Ticket",
  },
  ART_TYPE_DISPLAY: {
    headshot: "OC Headshot",
    halfbody: "OC Half-body",
    emoji: "OC Emoji",
    fullbody: "OC Full-body",
  },
  incrementAssignments: mockIncrementAssignments,
  logAssignment: mockLogAssignment,
  getArtist: mockGetArtist,
  getAllArtists: mockGetAllArtists,
  processAssignment: mockProcessAssignment,
}));

vi.mock("../../../src/features/artJobs/index.js", () => ({
  createJob: mockCreateJob,
}));

// Mock discord.js
vi.mock("discord.js", () => ({
  EmbedBuilder: class {
    data: any = {};
    setTitle(title: string) {
      this.data.title = title;
      return this;
    }
    setColor(color: number) {
      this.data.color = color;
      return this;
    }
    setDescription(desc: string) {
      this.data.description = desc;
      return this;
    }
  },
}));

import {
  handleRedeemRewardButton,
  isRedeemRewardButton,
} from "../../../src/features/artistRotation/handlers.js";

describe("artistRotation/handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isRedeemRewardButton", () => {
    it("returns true for valid redeemreward customId", () => {
      expect(isRedeemRewardButton("redeemreward:123:confirm:user:type:artist:0")).toBe(true);
      expect(isRedeemRewardButton("redeemreward:123:cancel")).toBe(true);
    });

    it("returns false for non-redeemreward customId", () => {
      expect(isRedeemRewardButton("other:button:id")).toBe(false);
      expect(isRedeemRewardButton("")).toBe(false);
      expect(isRedeemRewardButton("redeemrewar:123")).toBe(false);
    });
  });

  describe("handleRedeemRewardButton", () => {
    describe("invalid customId", () => {
      it("replies with error for malformed customId", async () => {
        const mockReply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
          customId: "redeemreward:invalid",
          reply: mockReply,
        } as any;

        await handleRedeemRewardButton(interaction);

        expect(mockReply).toHaveBeenCalledWith({
          content: "Invalid button.",
          ephemeral: false,
        });
        expect(mockLogger.warn).toHaveBeenCalled();
      });

      it("handles empty customId", async () => {
        const mockReply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
          customId: "",
          reply: mockReply,
        } as any;

        await handleRedeemRewardButton(interaction);

        expect(mockReply).toHaveBeenCalledWith({
          content: "Invalid button.",
          ephemeral: false,
        });
      });

      it("handles customId without redeemreward prefix", async () => {
        const mockReply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
          customId: "other:prefix:here",
          reply: mockReply,
        } as any;

        await handleRedeemRewardButton(interaction);

        expect(mockReply).toHaveBeenCalledWith({
          content: "Invalid button.",
          ephemeral: false,
        });
      });
    });

    describe("cancel action", () => {
      it("updates message with cancelled content", async () => {
        const mockUpdate = vi.fn().mockResolvedValue(undefined);
        const interaction = {
          customId: "redeemreward:123:cancel",
          update: mockUpdate,
        } as any;

        await handleRedeemRewardButton(interaction);

        expect(mockUpdate).toHaveBeenCalledWith({
          content: "Redemption cancelled.",
          embeds: [],
          components: [],
        });
      });
    });

    describe("confirm action", () => {
      it("replies with error when not in guild", async () => {
        const mockReply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
          customId: "redeemreward:123:confirm:recipient:headshot:artist:0",
          guild: null,
          reply: mockReply,
        } as any;

        await handleRedeemRewardButton(interaction);

        expect(mockReply).toHaveBeenCalledWith({
          content: "This must be done in a server.",
          ephemeral: false,
        });
      });

      it("successfully processes assignment", async () => {
        const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
        const mockEditReply = vi.fn().mockResolvedValue(undefined);
        const mockRolesRemove = vi.fn().mockResolvedValue(undefined);
        const mockChannelSend = vi.fn().mockResolvedValue(undefined);

        const mockMember = {
          roles: {
            cache: {
              has: vi.fn().mockReturnValue(true),
            },
            remove: mockRolesRemove,
          },
        };

        const mockGuild = {
          id: "guild-123",
          members: {
            fetch: vi.fn().mockResolvedValue(mockMember),
          },
          client: {
            user: { id: "bot-123" },
          },
        };

        const interaction = {
          customId: "redeemreward:123:confirm:recipient-1:headshot:artist-1:0",
          guild: mockGuild,
          deferUpdate: mockDeferUpdate,
          editReply: mockEditReply,
          user: { id: "mod-1" },
          channel: {
            send: mockChannelSend,
            id: "channel-1",
          },
        } as any;

        mockGetTicketRoles.mockReturnValue({
          headshot: "role-123",
          halfbody: null,
          emoji: null,
          fullbody: null,
        });
        mockGetArtist.mockReturnValue({ position: 1 });
        mockGetAllArtists.mockReturnValue([{ user_id: "artist-1" }]);
        mockProcessAssignment.mockReturnValue({
          oldPosition: 1,
          newPosition: 1,
          assignmentsCount: 1,
        });
        mockLogAssignment.mockReturnValue(1);
        mockCreateJob.mockReturnValue({ jobNumber: 1 });

        await handleRedeemRewardButton(interaction);

        expect(mockDeferUpdate).toHaveBeenCalled();
        expect(mockRolesRemove).toHaveBeenCalledWith("role-123");
        expect(mockChannelSend).toHaveBeenCalledWith("$add <@artist-1>");
        expect(mockProcessAssignment).toHaveBeenCalledWith("guild-123", "artist-1");
        expect(mockLogAssignment).toHaveBeenCalled();
        expect(mockCreateJob).toHaveBeenCalled();
        expect(mockEditReply).toHaveBeenCalled();
      });

      it("handles member not having ticket role", async () => {
        const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
        const mockEditReply = vi.fn().mockResolvedValue(undefined);
        const mockChannelSend = vi.fn().mockResolvedValue(undefined);

        const mockMember = {
          roles: {
            cache: {
              has: vi.fn().mockReturnValue(false),
            },
          },
        };

        const mockGuild = {
          id: "guild-123",
          members: {
            fetch: vi.fn().mockResolvedValue(mockMember),
          },
          client: {
            user: { id: "bot-123" },
          },
        };

        const interaction = {
          customId: "redeemreward:123:confirm:recipient-1:headshot:artist-1:0",
          guild: mockGuild,
          deferUpdate: mockDeferUpdate,
          editReply: mockEditReply,
          user: { id: "mod-1" },
          channel: {
            send: mockChannelSend,
            id: "channel-1",
          },
        } as any;

        mockGetTicketRoles.mockReturnValue({
          headshot: "role-123",
          halfbody: null,
          emoji: null,
          fullbody: null,
        });
        mockGetArtist.mockReturnValue({ position: 1 });
        mockGetAllArtists.mockReturnValue([]);
        mockProcessAssignment.mockReturnValue({
          oldPosition: 1,
          newPosition: 1,
          assignmentsCount: 1,
        });
        mockLogAssignment.mockReturnValue(1);
        mockCreateJob.mockReturnValue({ jobNumber: 1 });

        await handleRedeemRewardButton(interaction);

        expect(mockEditReply).toHaveBeenCalled();
      });

      it("handles role removal failure", async () => {
        const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
        const mockEditReply = vi.fn().mockResolvedValue(undefined);
        const mockChannelSend = vi.fn().mockResolvedValue(undefined);

        const mockGuild = {
          id: "guild-123",
          members: {
            fetch: vi.fn().mockRejectedValue(new Error("Member not found")),
          },
          client: {
            user: { id: "bot-123" },
          },
        };

        const interaction = {
          customId: "redeemreward:123:confirm:recipient-1:headshot:artist-1:0",
          guild: mockGuild,
          deferUpdate: mockDeferUpdate,
          editReply: mockEditReply,
          user: { id: "mod-1" },
          channel: {
            send: mockChannelSend,
            id: "channel-1",
          },
        } as any;

        mockGetTicketRoles.mockReturnValue({
          headshot: "role-123",
          halfbody: null,
          emoji: null,
          fullbody: null,
        });
        mockGetArtist.mockReturnValue({ position: 1 });
        mockGetAllArtists.mockReturnValue([]);
        mockProcessAssignment.mockReturnValue({
          oldPosition: 1,
          newPosition: 1,
          assignmentsCount: 1,
        });
        mockLogAssignment.mockReturnValue(1);
        mockCreateJob.mockReturnValue({ jobNumber: 1 });

        await handleRedeemRewardButton(interaction);

        expect(mockLogger.warn).toHaveBeenCalled();
        expect(mockEditReply).toHaveBeenCalled();
      });

      it("handles no ticket role defined", async () => {
        const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
        const mockEditReply = vi.fn().mockResolvedValue(undefined);
        const mockChannelSend = vi.fn().mockResolvedValue(undefined);

        const mockGuild = {
          id: "guild-123",
          members: {
            fetch: vi.fn(),
          },
          client: {
            user: { id: "bot-123" },
          },
        };

        const interaction = {
          customId: "redeemreward:123:confirm:recipient-1:headshot:artist-1:0",
          guild: mockGuild,
          deferUpdate: mockDeferUpdate,
          editReply: mockEditReply,
          user: { id: "mod-1" },
          channel: {
            send: mockChannelSend,
            id: "channel-1",
          },
        } as any;

        mockGetTicketRoles.mockReturnValue({
          headshot: null,
          halfbody: null,
          emoji: null,
          fullbody: null,
        });
        mockGetArtist.mockReturnValue({ position: 1 });
        mockGetAllArtists.mockReturnValue([]);
        mockProcessAssignment.mockReturnValue({
          oldPosition: 1,
          newPosition: 1,
          assignmentsCount: 1,
        });
        mockLogAssignment.mockReturnValue(1);
        mockCreateJob.mockReturnValue({ jobNumber: 1 });

        await handleRedeemRewardButton(interaction);

        expect(mockGuild.members.fetch).not.toHaveBeenCalled();
        expect(mockEditReply).toHaveBeenCalled();
      });

      it("handles $add command failure", async () => {
        const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
        const mockEditReply = vi.fn().mockResolvedValue(undefined);

        const mockMember = {
          roles: {
            cache: { has: vi.fn().mockReturnValue(false) },
          },
        };

        const mockGuild = {
          id: "guild-123",
          members: {
            fetch: vi.fn().mockResolvedValue(mockMember),
          },
          client: {
            user: { id: "bot-123" },
          },
        };

        const interaction = {
          customId: "redeemreward:123:confirm:recipient-1:headshot:artist-1:0",
          guild: mockGuild,
          deferUpdate: mockDeferUpdate,
          editReply: mockEditReply,
          user: { id: "mod-1" },
          channel: {
            send: vi.fn().mockRejectedValue(new Error("Cannot send")),
            id: "channel-1",
          },
        } as any;

        mockGetTicketRoles.mockReturnValue({
          headshot: "role-123",
          halfbody: null,
          emoji: null,
          fullbody: null,
        });
        mockGetArtist.mockReturnValue({ position: 1 });
        mockGetAllArtists.mockReturnValue([]);
        mockProcessAssignment.mockReturnValue({
          oldPosition: 1,
          newPosition: 1,
          assignmentsCount: 1,
        });
        mockLogAssignment.mockReturnValue(1);
        mockCreateJob.mockReturnValue({ jobNumber: 1 });

        await handleRedeemRewardButton(interaction);

        expect(mockLogger.warn).toHaveBeenCalled();
      });

      it("handles channel without send method", async () => {
        const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
        const mockEditReply = vi.fn().mockResolvedValue(undefined);

        const mockMember = {
          roles: {
            cache: { has: vi.fn().mockReturnValue(false) },
          },
        };

        const mockGuild = {
          id: "guild-123",
          members: {
            fetch: vi.fn().mockResolvedValue(mockMember),
          },
          client: {
            user: { id: "bot-123" },
          },
        };

        const interaction = {
          customId: "redeemreward:123:confirm:recipient-1:headshot:artist-1:0",
          guild: mockGuild,
          deferUpdate: mockDeferUpdate,
          editReply: mockEditReply,
          user: { id: "mod-1" },
          channel: null,
        } as any;

        mockGetTicketRoles.mockReturnValue({
          headshot: "role-123",
          halfbody: null,
          emoji: null,
          fullbody: null,
        });
        mockGetArtist.mockReturnValue({ position: 1 });
        mockGetAllArtists.mockReturnValue([]);
        mockProcessAssignment.mockReturnValue({
          oldPosition: 1,
          newPosition: 1,
          assignmentsCount: 1,
        });
        mockLogAssignment.mockReturnValue(1);
        mockCreateJob.mockReturnValue({ jobNumber: 1 });

        await handleRedeemRewardButton(interaction);

        expect(mockEditReply).toHaveBeenCalled();
      });

      it("handles override mode", async () => {
        const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
        const mockEditReply = vi.fn().mockResolvedValue(undefined);
        const mockChannelSend = vi.fn().mockResolvedValue(undefined);

        const mockMember = {
          roles: {
            cache: { has: vi.fn().mockReturnValue(false) },
          },
        };

        const mockGuild = {
          id: "guild-123",
          members: {
            fetch: vi.fn().mockResolvedValue(mockMember),
          },
          client: {
            user: { id: "bot-123" },
          },
        };

        const interaction = {
          customId: "redeemreward:123:confirm:recipient-1:headshot:artist-1:1", // isOverride = 1
          guild: mockGuild,
          deferUpdate: mockDeferUpdate,
          editReply: mockEditReply,
          user: { id: "mod-1" },
          channel: {
            send: mockChannelSend,
            id: "channel-1",
          },
        } as any;

        mockGetTicketRoles.mockReturnValue({
          headshot: "role-123",
          halfbody: null,
          emoji: null,
          fullbody: null,
        });
        mockGetArtist.mockReturnValue({ position: 1 });
        mockGetAllArtists.mockReturnValue([]);
        mockLogAssignment.mockReturnValue(1);
        mockCreateJob.mockReturnValue({ jobNumber: 1 });

        await handleRedeemRewardButton(interaction);

        expect(mockIncrementAssignments).toHaveBeenCalledWith("guild-123", "artist-1");
        expect(mockProcessAssignment).not.toHaveBeenCalled();
      });

      it("handles failed queue update", async () => {
        const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
        const mockEditReply = vi.fn().mockResolvedValue(undefined);
        const mockChannelSend = vi.fn().mockResolvedValue(undefined);

        const mockMember = {
          roles: {
            cache: { has: vi.fn().mockReturnValue(false) },
          },
        };

        const mockGuild = {
          id: "guild-123",
          members: {
            fetch: vi.fn().mockResolvedValue(mockMember),
          },
          client: {
            user: { id: "bot-123" },
          },
        };

        const interaction = {
          customId: "redeemreward:123:confirm:recipient-1:headshot:artist-1:0",
          guild: mockGuild,
          deferUpdate: mockDeferUpdate,
          editReply: mockEditReply,
          user: { id: "mod-1" },
          channel: {
            send: mockChannelSend,
            id: "channel-1",
          },
        } as any;

        mockGetTicketRoles.mockReturnValue({
          headshot: "role-123",
          halfbody: null,
          emoji: null,
          fullbody: null,
        });
        mockGetArtist.mockReturnValue({ position: 1 });
        mockGetAllArtists.mockReturnValue([]);
        mockProcessAssignment.mockReturnValue(null); // Failed
        mockLogAssignment.mockReturnValue(1);
        mockCreateJob.mockReturnValue({ jobNumber: 1 });

        await handleRedeemRewardButton(interaction);

        expect(mockEditReply).toHaveBeenCalled();
      });

      it("handles artist not in queue (null position)", async () => {
        const mockDeferUpdate = vi.fn().mockResolvedValue(undefined);
        const mockEditReply = vi.fn().mockResolvedValue(undefined);
        const mockChannelSend = vi.fn().mockResolvedValue(undefined);

        const mockMember = {
          roles: {
            cache: { has: vi.fn().mockReturnValue(false) },
          },
        };

        const mockGuild = {
          id: "guild-123",
          members: {
            fetch: vi.fn().mockResolvedValue(mockMember),
          },
          client: {
            user: { id: "bot-123" },
          },
        };

        const interaction = {
          customId: "redeemreward:123:confirm:recipient-1:headshot:artist-1:0",
          guild: mockGuild,
          deferUpdate: mockDeferUpdate,
          editReply: mockEditReply,
          user: { id: "mod-1" },
          channel: {
            send: mockChannelSend,
            id: "channel-1",
          },
        } as any;

        mockGetTicketRoles.mockReturnValue({
          headshot: "role-123",
          halfbody: null,
          emoji: null,
          fullbody: null,
        });
        mockGetArtist.mockReturnValue(null); // Not in queue
        mockGetAllArtists.mockReturnValue([]);
        mockLogAssignment.mockReturnValue(1);
        mockCreateJob.mockReturnValue({ jobNumber: 1 });

        await handleRedeemRewardButton(interaction);

        expect(mockProcessAssignment).not.toHaveBeenCalled();
        expect(mockEditReply).toHaveBeenCalled();
      });
    });
  });
});
