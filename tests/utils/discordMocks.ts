/**
 * Pawtropolis Tech -- tests/utils/discordMocks.ts
 * WHAT: Factory functions for creating minimal Discord.js mocks in tests.
 * WHY: Avoids boilerplate in test files and ensures consistent mock shapes.
 * USAGE:
 *  import { createMockInteraction, createMockGuild } from "../utils/discordMocks.js";
 *  const interaction = createMockInteraction({ guildId: "test-guild" });
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { vi } from "vitest";
import type {
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  TextChannel,
  User,
  Message,
  Role,
  ButtonInteraction,
  ModalSubmitInteraction,
  Client,
} from "discord.js";

// ===== User Mocks =====

/**
 * Creates a minimal User mock.
 * Discord User objects have many properties; we only mock what's commonly used in tests.
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-123",
    username: "testuser",
    discriminator: "0",
    tag: "testuser#0",
    bot: false,
    system: false,
    displayAvatarURL: vi.fn().mockReturnValue("https://cdn.discordapp.com/avatars/user-123/abc.png"),
    send: vi.fn().mockResolvedValue(undefined),
    toString: vi.fn().mockReturnValue("<@user-123>"),
    ...overrides,
  } as unknown as User;
}

// ===== Role Mocks =====

/**
 * Creates a minimal Role mock.
 */
export function createMockRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-123",
    name: "Test Role",
    color: 0x000000,
    position: 1,
    permissions: { has: vi.fn().mockReturnValue(true) },
    ...overrides,
  } as unknown as Role;
}

// ===== GuildMember Mocks =====

/**
 * Creates a minimal GuildMember mock.
 * The roles property is a RoleManager-like object with cache and add/remove methods.
 */
export function createMockMember(overrides: Partial<GuildMember> = {}): GuildMember {
  const user = createMockUser(overrides.user as Partial<User> | undefined);
  const rolesCache = new Map<string, Role>();

  return {
    id: user.id,
    user,
    displayName: user.username,
    nickname: null,
    roles: {
      cache: rolesCache,
      add: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      has: (roleId: string) => rolesCache.has(roleId),
    },
    permissions: {
      has: vi.fn().mockReturnValue(false),
    },
    send: vi.fn().mockResolvedValue(undefined),
    kick: vi.fn().mockResolvedValue(undefined),
    ban: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as GuildMember;
}

// ===== Channel Mocks =====

/**
 * Creates a minimal TextChannel mock.
 */
export function createMockChannel(overrides: Partial<TextChannel> = {}): TextChannel {
  return {
    id: "channel-123",
    name: "test-channel",
    type: 0, // GuildText
    send: vi.fn().mockResolvedValue(createMockMessage()),
    messages: {
      fetch: vi.fn().mockResolvedValue(new Map()),
    },
    permissionsFor: vi.fn().mockReturnValue({
      has: vi.fn().mockReturnValue(true),
    }),
    ...overrides,
  } as unknown as TextChannel;
}

// ===== Message Mocks =====

/**
 * Creates a minimal Message mock.
 */
export function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-123",
    content: "Test message",
    author: createMockUser(),
    channel: { id: "channel-123" },
    guild: null,
    edit: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Message;
}

// ===== Guild Mocks =====

/**
 * Creates a minimal Guild mock with configurable channels, roles, and members.
 */
export function createMockGuild(overrides: Partial<Guild> = {}): Guild {
  const channelsCache = new Map<string, TextChannel>();
  const rolesCache = new Map<string, Role>();
  const membersCache = new Map<string, GuildMember>();

  return {
    id: "guild-123",
    name: "Test Guild",
    ownerId: "owner-123",
    memberCount: 100,
    channels: {
      cache: channelsCache,
      fetch: vi.fn().mockImplementation(async (id: string) => channelsCache.get(id) ?? null),
    },
    roles: {
      cache: rolesCache,
      fetch: vi.fn().mockImplementation(async (id: string) => rolesCache.get(id) ?? null),
    },
    members: {
      cache: membersCache,
      fetch: vi.fn().mockImplementation(async (id: string) => {
        const member = membersCache.get(id);
        if (!member) throw new Error(`Unknown Member: ${id}`);
        return member;
      }),
    },
    ...overrides,
  } as unknown as Guild;
}

// ===== Client Mocks =====

/**
 * Creates a minimal Client mock.
 */
export function createMockClient(overrides: Partial<Client> = {}): Client {
  const usersCache = new Map<string, User>();
  const guildsCache = new Map<string, Guild>();

  return {
    user: createMockUser({ id: "bot-123", username: "TestBot", bot: true }),
    users: {
      cache: usersCache,
      fetch: vi.fn().mockImplementation(async (id: string) => {
        return usersCache.get(id) ?? createMockUser({ id });
      }),
    },
    guilds: {
      cache: guildsCache,
      fetch: vi.fn().mockImplementation(async (id: string) => guildsCache.get(id) ?? null),
    },
    ...overrides,
  } as unknown as Client;
}

// ===== Interaction Mocks =====

/**
 * Options configuration for interaction options mock.
 */
type MockOptionsConfig = {
  getString?: Record<string, string | null>;
  getBoolean?: Record<string, boolean | null>;
  getInteger?: Record<string, number | null>;
  getChannel?: Record<string, TextChannel | null>;
  getRole?: Record<string, Role | null>;
  getUser?: Record<string, User | null>;
  getMember?: Record<string, GuildMember | null>;
  getSubcommand?: string;
  getSubcommandGroup?: string | null;
};

/**
 * Creates a mock options object for slash command interactions.
 */
function createMockOptions(config: MockOptionsConfig = {}) {
  return {
    getString: vi.fn().mockImplementation((name: string, required?: boolean) => {
      const value = config.getString?.[name] ?? null;
      if (required && value === null) throw new Error(`Missing required option: ${name}`);
      return value;
    }),
    getBoolean: vi.fn().mockImplementation((name: string, required?: boolean) => {
      const value = config.getBoolean?.[name] ?? null;
      if (required && value === null) throw new Error(`Missing required option: ${name}`);
      return value;
    }),
    getInteger: vi.fn().mockImplementation((name: string, required?: boolean) => {
      const value = config.getInteger?.[name] ?? null;
      if (required && value === null) throw new Error(`Missing required option: ${name}`);
      return value;
    }),
    getChannel: vi.fn().mockImplementation((name: string, required?: boolean) => {
      const value = config.getChannel?.[name] ?? null;
      if (required && value === null) throw new Error(`Missing required option: ${name}`);
      return value;
    }),
    getRole: vi.fn().mockImplementation((name: string, required?: boolean) => {
      const value = config.getRole?.[name] ?? null;
      if (required && value === null) throw new Error(`Missing required option: ${name}`);
      return value;
    }),
    getUser: vi.fn().mockImplementation((name: string, required?: boolean) => {
      const value = config.getUser?.[name] ?? null;
      if (required && value === null) throw new Error(`Missing required option: ${name}`);
      return value;
    }),
    getMember: vi.fn().mockImplementation((name: string, required?: boolean) => {
      const value = config.getMember?.[name] ?? null;
      if (required && value === null) throw new Error(`Missing required option: ${name}`);
      return value;
    }),
    getSubcommand: vi.fn().mockReturnValue(config.getSubcommand ?? "default"),
    getSubcommandGroup: vi.fn().mockReturnValue(config.getSubcommandGroup ?? null),
  };
}

/**
 * Creates a minimal ChatInputCommandInteraction mock.
 *
 * This is the primary mock for testing slash command handlers. The mock includes:
 * - User and member info
 * - Guild context
 * - Options with configurable return values
 * - Reply/defer/edit methods
 *
 * @example
 * const interaction = createMockInteraction({
 *   guildId: "my-guild",
 *   options: { getString: { reason: "test reason" } },
 * });
 */
export function createMockInteraction(
  overrides: Partial<ChatInputCommandInteraction> & { options?: MockOptionsConfig } = {}
): ChatInputCommandInteraction {
  const { options: optionsConfig, ...rest } = overrides;
  const user = createMockUser(rest.user as Partial<User> | undefined);
  const guild = createMockGuild(rest.guild as Partial<Guild> | undefined);
  const member = createMockMember({ user, ...rest.member as Partial<GuildMember> | undefined });

  return {
    id: "interaction-123",
    user,
    member,
    guild,
    guildId: guild.id,
    channelId: "channel-123",
    channel: createMockChannel(),
    client: createMockClient(),
    commandName: "test",
    deferred: false,
    replied: false,
    options: createMockOptions(optionsConfig),
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockImplementation(async function(this: ChatInputCommandInteraction) {
      (this as { deferred: boolean }).deferred = true;
      return undefined;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    isCommand: vi.fn().mockReturnValue(true),
    isChatInputCommand: vi.fn().mockReturnValue(true),
    ...rest,
  } as unknown as ChatInputCommandInteraction;
}

/**
 * Creates a minimal ButtonInteraction mock.
 */
export function createMockButtonInteraction(
  overrides: Partial<ButtonInteraction> = {}
): ButtonInteraction {
  const user = createMockUser(overrides.user as Partial<User> | undefined);
  const guild = createMockGuild(overrides.guild as Partial<Guild> | undefined);
  const member = createMockMember({ user, ...overrides.member as Partial<GuildMember> | undefined });

  return {
    id: "button-interaction-123",
    customId: "v1:test:button",
    user,
    member,
    guild,
    guildId: guild.id,
    channelId: "channel-123",
    channel: createMockChannel(),
    client: createMockClient(),
    deferred: false,
    replied: false,
    message: createMockMessage(),
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockImplementation(async function(this: ButtonInteraction) {
      (this as { deferred: boolean }).deferred = true;
      return undefined;
    }),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    isButton: vi.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as ButtonInteraction;
}

/**
 * Creates a minimal ModalSubmitInteraction mock.
 */
export function createMockModalInteraction(
  overrides: Partial<ModalSubmitInteraction> & { fields?: Record<string, string> } = {}
): ModalSubmitInteraction {
  const { fields: fieldsConfig, ...rest } = overrides;
  const user = createMockUser(rest.user as Partial<User> | undefined);
  const guild = createMockGuild(rest.guild as Partial<Guild> | undefined);
  const member = createMockMember({ user, ...rest.member as Partial<GuildMember> | undefined });

  return {
    id: "modal-interaction-123",
    customId: "v1:test:modal",
    user,
    member,
    guild,
    guildId: guild.id,
    channelId: "channel-123",
    channel: createMockChannel(),
    client: createMockClient(),
    deferred: false,
    replied: false,
    fields: {
      getTextInputValue: vi.fn().mockImplementation((name: string) => {
        return fieldsConfig?.[name] ?? "";
      }),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockImplementation(async function(this: ModalSubmitInteraction) {
      (this as { deferred: boolean }).deferred = true;
      return undefined;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    isModalSubmit: vi.fn().mockReturnValue(true),
    inGuild: vi.fn().mockReturnValue(true),
    ...rest,
  } as unknown as ModalSubmitInteraction;
}

// ===== Discord Error Mocks =====

/**
 * Creates a mock Discord API error with the correct shape.
 * Useful for testing error handling paths.
 *
 * @param code - Discord API error code (e.g., 10062, 50013, 40060)
 * @param message - Error message
 * @param httpStatus - HTTP status code (optional)
 */
export function createDiscordAPIError(
  code: number,
  message: string,
  httpStatus = 400
): Error & { code: number; httpStatus: number; name: string } {
  const error = new Error(message) as Error & { code: number; httpStatus: number; name: string };
  error.name = "DiscordAPIError";
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

/**
 * Creates a network error with Node.js error codes.
 */
export function createNetworkError(
  code: string,
  message = `Network error: ${code}`
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

/**
 * Creates a SQLite error with the correct shape.
 */
export function createSqliteError(
  code: string,
  message: string,
  sql?: string
): Error & { code: string; name: string; sql?: string } {
  const error = new Error(message) as Error & { code: string; name: string; sql?: string };
  error.name = "SqliteError";
  error.code = code;
  if (sql) error.sql = sql;
  return error;
}
