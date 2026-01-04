/**
 * Pawtropolis Tech — src/features/serverAuditDocs.ts
 * WHAT: Generate comprehensive server audit documentation
 * WHY: Creates internal-info docs for roles, channels, permissions, and security issues
 * USAGE: Called by /audit docs command or scripts/audit-server-full.ts
 */

import {
  type Guild,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// All permission flags we care about for the matrix
const PERMISSION_FLAGS = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "KickMembers",
  "BanMembers",
  "ManageMessages",
  "ManageWebhooks",
  "ManageNicknames",
  "ManageEmojisAndStickers",
  "MentionEveryone",
  "ModerateMembers",
  "ViewAuditLog",
  "ViewChannel",
  "SendMessages",
  "SendMessagesInThreads",
  "CreatePublicThreads",
  "CreatePrivateThreads",
  "EmbedLinks",
  "AttachFiles",
  "AddReactions",
  "UseExternalEmojis",
  "UseExternalStickers",
  "ReadMessageHistory",
  "Connect",
  "Speak",
  "Stream",
  "MuteMembers",
  "DeafenMembers",
  "MoveMembers",
  "UseVAD",
  "PrioritySpeaker",
] as const;

// Dangerous permission combinations for security analysis
const DANGEROUS_PERMISSIONS = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "BanMembers",
  "KickMembers",
  "ManageChannels",
  "ManageWebhooks",
  "MentionEveryone",
  "ManageMessages",
  "ModerateMembers",
];

interface RoleData {
  id: string;
  name: string;
  position: number;
  color: string;
  memberCount: number;
  permissions: string[];
  mentionable: boolean;
  hoisted: boolean;
  managed: boolean;
  tags?: {
    botId?: string;
    integrationId?: string;
    premiumSubscriberRole?: boolean;
  };
}

interface ChannelOverwrite {
  id: string;
  type: "role" | "member";
  name: string;
  allow: string[];
  deny: string[];
}

interface ChannelData {
  id: string;
  name: string;
  type: string;
  position: number;
  parentId: string | null;
  parentName: string | null;
  topic: string | null;
  nsfw: boolean;
  rateLimitPerUser: number | null;
  overwrites: ChannelOverwrite[];
}

interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  id: string;
  title: string;
  affected: string;
  issue: string;
  risk: string;
  recommendation: string;
}

interface ServerData {
  name: string;
  id: string;
  ownerId: string;
  ownerTag: string;
  memberCount: number;
  createdAt: string;
  boostTier: number;
  boostCount: number;
  verificationLevel: string;
  explicitContentFilter: string;
  mfaLevel: string;
  features: string[];
  rulesChannelId: string | null;
  systemChannelId: string | null;
  description: string | null;
  vanityURLCode: string | null;
}

export interface AuditResult {
  roleCount: number;
  channelCount: number;
  issueCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  outputDir: string;
}

// Helper to get permission names from a permission bitfield
function getPermissionNames(permissions: bigint): string[] {
  const result: string[] = [];
  for (const flag of PERMISSION_FLAGS) {
    const perm = PermissionFlagsBits[flag as keyof typeof PermissionFlagsBits];
    if (perm && (permissions & perm) === perm) {
      result.push(flag);
    }
  }
  return result;
}

// Helper to convert channel type enum to readable string
function getChannelTypeName(type: ChannelType): string {
  const typeMap: Record<number, string> = {
    [ChannelType.GuildText]: "Text",
    [ChannelType.GuildVoice]: "Voice",
    [ChannelType.GuildCategory]: "Category",
    [ChannelType.GuildAnnouncement]: "Announcement",
    [ChannelType.AnnouncementThread]: "Announcement Thread",
    [ChannelType.PublicThread]: "Public Thread",
    [ChannelType.PrivateThread]: "Private Thread",
    [ChannelType.GuildStageVoice]: "Stage",
    [ChannelType.GuildForum]: "Forum",
    [ChannelType.GuildMedia]: "Media",
  };
  return typeMap[type] || `Unknown (${type})`;
}

// Helper to get verification level name
function getVerificationLevelName(level: number): string {
  const levels = ["None", "Low", "Medium", "High", "Very High"];
  return levels[level] || `Unknown (${level})`;
}

// Helper to get explicit content filter name
function getExplicitContentFilterName(level: number): string {
  const levels = ["Disabled", "Members without roles", "All members"];
  return levels[level] || `Unknown (${level})`;
}

// Helper to get MFA level name
function getMfaLevelName(level: number): string {
  return level === 0 ? "Not required" : "Required for moderation";
}

// Fetch all role data
async function fetchRoles(guild: Guild): Promise<RoleData[]> {
  const roles = await guild.roles.fetch();
  const members = await guild.members.fetch();

  const roleData: RoleData[] = [];

  for (const role of roles.values()) {
    const memberCount = members.filter((m) => m.roles.cache.has(role.id)).size;

    const data: RoleData = {
      id: role.id,
      name: role.name,
      position: role.position,
      color: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "default",
      memberCount,
      permissions: getPermissionNames(role.permissions.bitfield),
      mentionable: role.mentionable,
      hoisted: role.hoist,
      managed: role.managed,
    };

    if (role.tags) {
      data.tags = {
        botId: role.tags.botId ?? undefined,
        integrationId: role.tags.integrationId ?? undefined,
        premiumSubscriberRole: role.tags.premiumSubscriberRole ?? undefined,
      };
    }

    roleData.push(data);
  }

  roleData.sort((a, b) => b.position - a.position);
  return roleData;
}

// Fetch all channel data
async function fetchChannels(guild: Guild, roles: RoleData[]): Promise<ChannelData[]> {
  const channels = await guild.channels.fetch();
  const roleMap = new Map(roles.map((r) => [r.id, r.name]));

  const channelData: ChannelData[] = [];

  for (const channel of channels.values()) {
    if (!channel) continue;

    const overwrites: ChannelOverwrite[] = [];
    if ("permissionOverwrites" in channel) {
      for (const [id, overwrite] of channel.permissionOverwrites.cache) {
        const allowPerms = getPermissionNames(overwrite.allow.bitfield);
        const denyPerms = getPermissionNames(overwrite.deny.bitfield);

        if (allowPerms.length === 0 && denyPerms.length === 0) continue;

        let name = id;
        let type: "role" | "member" = "role";

        if (overwrite.type === 0) {
          name = roleMap.get(id) || `Unknown Role (${id})`;
          type = "role";
        } else {
          try {
            const member = await guild.members.fetch(id);
            name = member.user.tag;
          } catch {
            name = `Unknown Member (${id})`;
          }
          type = "member";
        }

        overwrites.push({ id, type, name, allow: allowPerms, deny: denyPerms });
      }
    }

    let parentName: string | null = null;
    if (channel.parentId) {
      const parent = channels.get(channel.parentId);
      if (parent) parentName = parent.name;
    }

    channelData.push({
      id: channel.id,
      name: channel.name,
      type: getChannelTypeName(channel.type),
      position: "position" in channel ? channel.position : 0,
      parentId: channel.parentId,
      parentName,
      topic: "topic" in channel ? (channel as any).topic : null,
      nsfw: "nsfw" in channel ? (channel as any).nsfw : false,
      rateLimitPerUser: "rateLimitPerUser" in channel ? (channel as any).rateLimitPerUser : null,
      overwrites,
    });
  }

  channelData.sort((a, b) => {
    if (a.type === "Category" && b.type !== "Category") return -1;
    if (b.type === "Category" && a.type !== "Category") return 1;
    if (a.parentId !== b.parentId) {
      if (!a.parentId) return -1;
      if (!b.parentId) return 1;
      return a.parentId.localeCompare(b.parentId);
    }
    return a.position - b.position;
  });

  return channelData;
}

// Fetch server metadata
async function fetchServerInfo(guild: Guild): Promise<ServerData> {
  const owner = await guild.fetchOwner();

  return {
    name: guild.name,
    id: guild.id,
    ownerId: guild.ownerId,
    ownerTag: owner.user.tag,
    memberCount: guild.memberCount,
    createdAt: guild.createdAt.toISOString(),
    boostTier: guild.premiumTier,
    boostCount: guild.premiumSubscriptionCount || 0,
    verificationLevel: getVerificationLevelName(guild.verificationLevel),
    explicitContentFilter: getExplicitContentFilterName(guild.explicitContentFilter),
    mfaLevel: getMfaLevelName(guild.mfaLevel),
    features: guild.features,
    rulesChannelId: guild.rulesChannelId,
    systemChannelId: guild.systemChannelId,
    description: guild.description,
    vanityURLCode: guild.vanityURLCode,
  };
}

// Analyze permissions for security issues
function analyzeSecurityIssues(roles: RoleData[], channels: ChannelData[]): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  let issueId = 1;

  for (const role of roles) {
    if (role.permissions.includes("Administrator") && role.name !== "@everyone") {
      issues.push({
        severity: role.managed ? "medium" : "critical",
        id: `CRIT-${String(issueId++).padStart(3, "0")}`,
        title: `Administrator Permission on ${role.managed ? "Bot" : "User"} Role`,
        affected: `Role: ${role.name} (${role.id})`,
        issue: `This role has full Administrator permission, bypassing all permission checks.`,
        risk: role.managed
          ? `Bot roles with Admin can be compromised if the bot is vulnerable.`
          : `${role.memberCount} member(s) have unrestricted server access.`,
        recommendation: role.managed
          ? `Review if bot actually needs Administrator. Most bots work with specific permissions.`
          : `Consider using specific permissions instead of Administrator. Audit who has this role.`,
      });
    }
  }

  for (const role of roles) {
    if (role.name === "@everyone") continue;

    const hasBan = role.permissions.includes("BanMembers");
    const hasManageRoles = role.permissions.includes("ManageRoles");
    const hasManageWebhooks = role.permissions.includes("ManageWebhooks");
    const hasMentionEveryone = role.permissions.includes("MentionEveryone");

    if (hasBan && hasManageRoles && !role.permissions.includes("Administrator")) {
      issues.push({
        severity: "high",
        id: `HIGH-${String(issueId++).padStart(3, "0")}`,
        title: `Privilege Escalation Risk`,
        affected: `Role: ${role.name} (${role.id})`,
        issue: `Role has both BanMembers and ManageRoles permissions.`,
        risk: `Users can potentially escalate privileges by assigning themselves roles up to this role's position.`,
        recommendation: `Ensure role is high in hierarchy and only trusted staff have it. Consider splitting permissions.`,
      });
    }

    if (hasManageWebhooks && !role.managed) {
      issues.push({
        severity: "medium",
        id: `MED-${String(issueId++).padStart(3, "0")}`,
        title: `Webhook Impersonation Risk`,
        affected: `Role: ${role.name} (${role.id})`,
        issue: `Role can create/edit webhooks.`,
        risk: `Webhooks can impersonate any user or bot. ${role.memberCount} member(s) can create fake messages.`,
        recommendation: `Limit ManageWebhooks to trusted staff only. Audit webhook usage.`,
      });
    }

    if (hasMentionEveryone && role.memberCount > 10 && !hasBan) {
      issues.push({
        severity: "low",
        id: `LOW-${String(issueId++).padStart(3, "0")}`,
        title: `Wide @everyone/@here Access`,
        affected: `Role: ${role.name} (${role.id})`,
        issue: `${role.memberCount} members can mention @everyone/@here.`,
        risk: `Potential for spam or disruption.`,
        recommendation: `Consider restricting to staff roles or specific channels only.`,
      });
    }
  }

  const everyoneRole = roles.find((r) => r.name === "@everyone");
  if (everyoneRole) {
    const dangerousEveryonePerms = everyoneRole.permissions.filter((p) =>
      DANGEROUS_PERMISSIONS.includes(p)
    );
    if (dangerousEveryonePerms.length > 0) {
      issues.push({
        severity: "critical",
        id: `CRIT-${String(issueId++).padStart(3, "0")}`,
        title: `Dangerous @everyone Permissions`,
        affected: `@everyone role`,
        issue: `@everyone has: ${dangerousEveryonePerms.join(", ")}`,
        risk: `ALL server members, including new joins, have these powerful permissions.`,
        recommendation: `Remove these permissions from @everyone immediately.`,
      });
    }
  }

  const sensitiveKeywords = ["mod", "admin", "staff", "private", "secret", "internal", "leadership", "log"];
  for (const channel of channels) {
    const nameLower = channel.name.toLowerCase();
    const isSensitive = sensitiveKeywords.some((kw) => nameLower.includes(kw));

    if (isSensitive) {
      const everyoneOverwrite = channel.overwrites.find((o) => o.type === "role" && o.name === "@everyone");
      const viewDenied = everyoneOverwrite?.deny.includes("ViewChannel");
      if (!viewDenied && channel.type !== "Category") {
        issues.push({
          severity: "medium",
          id: `MED-${String(issueId++).padStart(3, "0")}`,
          title: `Potentially Sensitive Channel Accessible`,
          affected: `Channel: #${channel.name} (${channel.id})`,
          issue: `Channel name suggests it's sensitive, but @everyone ViewChannel is not explicitly denied.`,
          risk: `May be unintentionally accessible to regular members.`,
          recommendation: `Verify channel permissions are intentional. Add explicit ViewChannel deny for @everyone if private.`,
        });
      }
    }
  }

  for (const channel of channels) {
    for (const overwrite of channel.overwrites) {
      if (overwrite.type === "role" && overwrite.name.includes("Unknown Role")) {
        issues.push({
          severity: "low",
          id: `LOW-${String(issueId++).padStart(3, "0")}`,
          title: `Orphaned Permission Overwrite`,
          affected: `Channel: #${channel.name} (${channel.id})`,
          issue: `Permission overwrite exists for deleted role: ${overwrite.id}`,
          risk: `Clutter and potential confusion. No immediate security risk.`,
          recommendation: `Clean up orphaned overwrites.`,
        });
      }
    }
  }

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}

// Generate ROLES.md
function generateRolesDoc(roles: RoleData[], serverInfo: ServerData): string {
  const staffRoles = roles.filter(
    (r) => r.permissions.some((p) => DANGEROUS_PERMISSIONS.includes(p)) && r.name !== "@everyone" && !r.managed
  );
  const botRoles = roles.filter((r) => r.managed && r.tags?.botId);
  const integrationRoles = roles.filter((r) => r.managed && !r.tags?.botId);
  const boosterRole = roles.find((r) => r.tags?.premiumSubscriberRole);

  let doc = `# Server Roles — ${serverInfo.name}

**Generated:** ${new Date().toISOString()}
**Guild ID:** ${serverInfo.id}
**Total Roles:** ${roles.length}

## Summary

| Category | Count |
|----------|-------|
| Staff Roles (with mod perms) | ${staffRoles.length} |
| Bot Roles | ${botRoles.length} |
| Integration Roles | ${integrationRoles.length} |
| Booster Role | ${boosterRole ? "1" : "0"} |
| Other Roles | ${roles.length - staffRoles.length - botRoles.length - integrationRoles.length - (boosterRole ? 1 : 0)} |

---

## Role Hierarchy (by position)

| Position | Role | Color | Members | Managed | Key Permissions |
|----------|------|-------|---------|---------|-----------------|
`;

  for (const role of roles) {
    const keyPerms = role.permissions.filter((p) => DANGEROUS_PERMISSIONS.includes(p)).slice(0, 3).join(", ");
    const managed = role.managed ? (role.tags?.botId ? "Bot" : "Integration") : "";
    doc += `| ${role.position} | ${role.name} | ${role.color} | ${role.memberCount} | ${managed} | ${keyPerms || "-"} |\n`;
  }

  doc += `
---

## Permission Matrix

Legend: ✅ = Has permission | ❌ = Does not have

| Role | Admin | ManageGuild | ManageRoles | ManageChannels | Ban | Kick | ManageMsg | Webhooks |
|------|-------|-------------|-------------|----------------|-----|------|-----------|----------|
`;

  for (const role of roles.slice(0, 50)) {
    const check = (perm: string) => (role.permissions.includes(perm) ? "✅" : "❌");
    doc += `| ${role.name.substring(0, 25)} | ${check("Administrator")} | ${check("ManageGuild")} | ${check("ManageRoles")} | ${check("ManageChannels")} | ${check("BanMembers")} | ${check("KickMembers")} | ${check("ManageMessages")} | ${check("ManageWebhooks")} |\n`;
  }

  if (roles.length > 50) {
    doc += `\n*...and ${roles.length - 50} more roles (truncated for readability)*\n`;
  }

  doc += `
---

## Staff Roles (Detailed)

`;

  for (const role of staffRoles) {
    doc += `### ${role.name}
- **ID:** ${role.id}
- **Position:** ${role.position}
- **Members:** ${role.memberCount}
- **Mentionable:** ${role.mentionable ? "Yes" : "No"}
- **Hoisted:** ${role.hoisted ? "Yes" : "No"}
- **Permissions:** ${role.permissions.join(", ")}

`;
  }

  doc += `
---

## Bot Roles

`;

  for (const role of botRoles) {
    doc += `### ${role.name}
- **ID:** ${role.id}
- **Bot ID:** ${role.tags?.botId || "Unknown"}
- **Position:** ${role.position}
- **Permissions:** ${role.permissions.join(", ")}

`;
  }

  doc += `
---

## All Role IDs (for reference)

| Role | ID |
|------|----|
`;

  for (const role of roles) {
    doc += `| ${role.name} | \`${role.id}\` |\n`;
  }

  return doc;
}

// Generate CHANNELS.md
function generateChannelsDoc(channels: ChannelData[], serverInfo: ServerData): string {
  const categories = channels.filter((c) => c.type === "Category");
  const textChannels = channels.filter((c) => c.type === "Text");
  const voiceChannels = channels.filter((c) => c.type === "Voice");
  const forumChannels = channels.filter((c) => c.type === "Forum");
  const threads = channels.filter((c) => c.type.includes("Thread"));

  let doc = `# Server Channels — ${serverInfo.name}

**Generated:** ${new Date().toISOString()}
**Guild ID:** ${serverInfo.id}
**Total Channels:** ${channels.length}

## Summary

| Type | Count |
|------|-------|
| Categories | ${categories.length} |
| Text Channels | ${textChannels.length} |
| Voice Channels | ${voiceChannels.length} |
| Forum Channels | ${forumChannels.length} |
| Threads | ${threads.length} |
| Other | ${channels.length - categories.length - textChannels.length - voiceChannels.length - forumChannels.length - threads.length} |

---

## Channel Hierarchy

`;

  const uncategorized = channels.filter((c) => !c.parentId && c.type !== "Category" && !c.type.includes("Thread"));

  if (uncategorized.length > 0) {
    doc += `### (No Category)

| Channel | Type | ID | NSFW | Slowmode |
|---------|------|----|------|----------|
`;
    for (const ch of uncategorized) {
      doc += `| ${ch.name} | ${ch.type} | \`${ch.id}\` | ${ch.nsfw ? "Yes" : "No"} | ${ch.rateLimitPerUser || 0}s |\n`;
    }
    doc += "\n";
  }

  for (const category of categories) {
    const children = channels.filter((c) => c.parentId === category.id);
    doc += `### ${category.name}

**Category ID:** \`${category.id}\`

| Channel | Type | ID | NSFW | Slowmode |
|---------|------|----|------|----------|
`;
    for (const ch of children) {
      doc += `| ${ch.name} | ${ch.type} | \`${ch.id}\` | ${ch.nsfw ? "Yes" : "No"} | ${ch.rateLimitPerUser || 0}s |\n`;
    }
    doc += "\n";
  }

  doc += `---

## Permission Overwrites by Channel

`;

  for (const channel of channels) {
    if (channel.overwrites.length === 0) continue;
    doc += `### #${channel.name}

**ID:** \`${channel.id}\` | **Type:** ${channel.type}

| Target | Type | Allow | Deny |
|--------|------|-------|------|
`;
    for (const ow of channel.overwrites) {
      doc += `| ${ow.name} | ${ow.type} | ${ow.allow.join(", ") || "-"} | ${ow.deny.join(", ") || "-"} |\n`;
    }
    doc += "\n";
  }

  doc += `---

## All Channel IDs (for reference)

| Channel | Type | ID | Category |
|---------|------|----|----------|
`;

  for (const ch of channels.filter((c) => c.type !== "Category")) {
    doc += `| ${ch.name} | ${ch.type} | \`${ch.id}\` | ${ch.parentName || "-"} |\n`;
  }

  return doc;
}

// Generate CONFLICTS.md
function generateConflictsDoc(issues: SecurityIssue[], serverInfo: ServerData): string {
  const critical = issues.filter((i) => i.severity === "critical");
  const high = issues.filter((i) => i.severity === "high");
  const medium = issues.filter((i) => i.severity === "medium");
  const low = issues.filter((i) => i.severity === "low");

  let doc = `# Permission Conflicts & Security Concerns — ${serverInfo.name}

**Generated:** ${new Date().toISOString()}
**Guild ID:** ${serverInfo.id}
**Total Issues Found:** ${issues.length}

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${critical.length} |
| 🟠 High | ${high.length} |
| 🟡 Medium | ${medium.length} |
| 🟢 Low | ${low.length} |

---

`;

  if (critical.length > 0) {
    doc += `## 🔴 Critical Issues\n\n`;
    for (const issue of critical) {
      doc += `### [${issue.id}] ${issue.title}\n\n- **Affected:** ${issue.affected}\n- **Issue:** ${issue.issue}\n- **Risk:** ${issue.risk}\n- **Recommendation:** ${issue.recommendation}\n\n---\n\n`;
    }
  }

  if (high.length > 0) {
    doc += `## 🟠 High Priority Issues\n\n`;
    for (const issue of high) {
      doc += `### [${issue.id}] ${issue.title}\n\n- **Affected:** ${issue.affected}\n- **Issue:** ${issue.issue}\n- **Risk:** ${issue.risk}\n- **Recommendation:** ${issue.recommendation}\n\n---\n\n`;
    }
  }

  if (medium.length > 0) {
    doc += `## 🟡 Medium Priority Issues\n\n`;
    for (const issue of medium) {
      doc += `### [${issue.id}] ${issue.title}\n\n- **Affected:** ${issue.affected}\n- **Issue:** ${issue.issue}\n- **Risk:** ${issue.risk}\n- **Recommendation:** ${issue.recommendation}\n\n---\n\n`;
    }
  }

  if (low.length > 0) {
    doc += `## 🟢 Low Priority / Notes\n\n`;
    for (const issue of low) {
      doc += `### [${issue.id}] ${issue.title}\n\n- **Affected:** ${issue.affected}\n- **Issue:** ${issue.issue}\n- **Risk:** ${issue.risk}\n- **Recommendation:** ${issue.recommendation}\n\n---\n\n`;
    }
  }

  if (issues.length === 0) {
    doc += `## ✅ No Issues Found\n\nNo permission conflicts or security concerns were detected.\n`;
  }

  return doc;
}

// Generate SERVER-INFO.md
function generateServerInfoDoc(serverInfo: ServerData, roles: RoleData[], channels: ChannelData[]): string {
  return `# Server Information — ${serverInfo.name}

**Generated:** ${new Date().toISOString()}

---

## General Information

| Property | Value |
|----------|-------|
| Server Name | ${serverInfo.name} |
| Server ID | \`${serverInfo.id}\` |
| Owner | ${serverInfo.ownerTag} (\`${serverInfo.ownerId}\`) |
| Created | ${new Date(serverInfo.createdAt).toLocaleDateString()} |
| Member Count | ${serverInfo.memberCount.toLocaleString()} |
| Description | ${serverInfo.description || "None"} |

---

## Server Settings

| Setting | Value |
|---------|-------|
| Verification Level | ${serverInfo.verificationLevel} |
| Explicit Content Filter | ${serverInfo.explicitContentFilter} |
| 2FA for Mods | ${serverInfo.mfaLevel} |
| Boost Tier | Level ${serverInfo.boostTier} |
| Boost Count | ${serverInfo.boostCount} |
| Vanity URL | ${serverInfo.vanityURLCode ? `discord.gg/${serverInfo.vanityURLCode}` : "None"} |

---

## Special Channels

| Channel | ID |
|---------|-----|
| Rules Channel | ${serverInfo.rulesChannelId ? `\`${serverInfo.rulesChannelId}\`` : "Not set"} |
| System Channel | ${serverInfo.systemChannelId ? `\`${serverInfo.systemChannelId}\`` : "Not set"} |

---

## Server Features

${serverInfo.features.length > 0 ? serverInfo.features.map((f) => `- ${f}`).join("\n") : "No special features enabled."}

---

## Statistics

| Metric | Count |
|--------|-------|
| Total Roles | ${roles.length} |
| Total Channels | ${channels.length} |
| Categories | ${channels.filter((c) => c.type === "Category").length} |
| Text Channels | ${channels.filter((c) => c.type === "Text").length} |
| Voice Channels | ${channels.filter((c) => c.type === "Voice").length} |
| Forum Channels | ${channels.filter((c) => c.type === "Forum").length} |

---

## Role Distribution

| Category | Count |
|----------|-------|
| Roles with Admin | ${roles.filter((r) => r.permissions.includes("Administrator")).length} |
| Roles with Mod Perms | ${roles.filter((r) => r.permissions.includes("BanMembers") || r.permissions.includes("KickMembers")).length} |
| Bot Roles | ${roles.filter((r) => r.tags?.botId).length} |
| Mentionable Roles | ${roles.filter((r) => r.mentionable).length} |
| Hoisted Roles | ${roles.filter((r) => r.hoisted).length} |

---

## Channel Settings Overview

| Setting | Count |
|---------|-------|
| NSFW Channels | ${channels.filter((c) => c.nsfw).length} |
| Channels with Slowmode | ${channels.filter((c) => c.rateLimitPerUser && c.rateLimitPerUser > 0).length} |
| Channels with Custom Perms | ${channels.filter((c) => c.overwrites.length > 0).length} |
`;
}

/**
 * Generate server audit documentation
 * @param guild - The Discord guild to audit
 * @param outputDir - Output directory (default: docs/internal-info)
 * @returns Audit result summary
 */
export async function generateAuditDocs(guild: Guild, outputDir?: string): Promise<AuditResult> {
  const OUTPUT_DIR = outputDir || join(process.cwd(), "docs/internal-info");

  // Fetch all data
  const roles = await fetchRoles(guild);
  const channels = await fetchChannels(guild, roles);
  const serverInfo = await fetchServerInfo(guild);
  const issues = analyzeSecurityIssues(roles, channels);

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Generate and write docs
  writeFileSync(join(OUTPUT_DIR, "ROLES.md"), generateRolesDoc(roles, serverInfo));
  writeFileSync(join(OUTPUT_DIR, "CHANNELS.md"), generateChannelsDoc(channels, serverInfo));
  writeFileSync(join(OUTPUT_DIR, "CONFLICTS.md"), generateConflictsDoc(issues, serverInfo));
  writeFileSync(join(OUTPUT_DIR, "SERVER-INFO.md"), generateServerInfoDoc(serverInfo, roles, channels));

  const critical = issues.filter((i) => i.severity === "critical").length;
  const high = issues.filter((i) => i.severity === "high").length;
  const medium = issues.filter((i) => i.severity === "medium").length;
  const low = issues.filter((i) => i.severity === "low").length;

  return {
    roleCount: roles.length,
    channelCount: channels.length,
    issueCount: issues.length,
    criticalCount: critical,
    highCount: high,
    mediumCount: medium,
    lowCount: low,
    outputDir: OUTPUT_DIR,
  };
}
