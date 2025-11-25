/**
 * Full-Width Leaderboard Image Generator
 *
 * Generates a high-PPI PNG image containing the complete moderator leaderboard table.
 * Clean, minimal, Discord-native aesthetic.
 */

import { createCanvas, CanvasRenderingContext2D } from "canvas";

// ============================================================================
// Types
// ============================================================================

export interface ModStats {
  rank: number;
  displayName: string;
  total: number;
  approvals: number;
  rejections: number;
  modmail: number;
  avgTimeSeconds: number;

  // Color data
  roleColor?: string;           // Hex color from highest role, e.g. "#E91E63"
  nameGradient?: {              // Nitro gradient (if applicable)
    colors: string[];           // Array of hex colors
    angle?: number;             // Gradient angle in degrees (default 90 = left to right)
  };
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  scale: 3,
  baseWidth: 460,
  baseRowHeight: 36,
  baseHeaderHeight: 32,
  basePaddingX: 14,
  basePaddingY: 4, // Minimal padding to blend with embed
  baseFontSize: 14,
  baseHeaderFontSize: 11,
  baseIconSize: 14,
  columnGap: 6,

  columns: [
    { key: "rank", header: "#", width: 32, align: "center" as const },
    { key: "name", header: "Moderator", width: 155, align: "left" as const },
    { key: "total", header: "Total", width: 42, align: "right" as const },
    { key: "approvals", header: "check", width: 38, align: "right" as const, icon: true },
    { key: "rejections", header: "x", width: 36, align: "right" as const, icon: true },
    { key: "modmail", header: "bubble", width: 36, align: "right" as const, icon: true },
    { key: "avgTime", header: "clock", width: 52, align: "right" as const, icon: true },
  ],
};

const COLORS = {
  background: "#131416", // Discord embed background
  text: "#FFFFFF",
  textMuted: "#B9BBBE",
  textDimmed: "rgba(255, 255, 255, 0.35)",
  green: "#57F287",
  red: "#ED4245",
  yellow: "#FEE75C",
  divider: "rgba(255, 255, 255, 0.06)", // Very subtle dividers
  gold: "#FFD700",
  silver: "#C0C0C0",
  bronze: "#CD7F32",
};

// ============================================================================
// Icon Drawing Functions (simple outlines, no backgrounds)
// ============================================================================

function drawCheckmark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = size * 0.18;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.18, y + size * 0.55);
  ctx.lineTo(x + size * 0.42, y + size * 0.78);
  ctx.lineTo(x + size * 0.85, y + size * 0.25);
  ctx.stroke();
}

function drawX(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.strokeStyle = COLORS.red;
  ctx.lineWidth = size * 0.18;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.22, y + size * 0.22);
  ctx.lineTo(x + size * 0.78, y + size * 0.78);
  ctx.moveTo(x + size * 0.78, y + size * 0.22);
  ctx.lineTo(x + size * 0.22, y + size * 0.78);
  ctx.stroke();
}

function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.fillStyle = COLORS.yellow;
  ctx.beginPath();
  const bx = x + size * 0.15;
  const by = y + size * 0.15;
  const bw = size * 0.7;
  const bh = size * 0.5;
  const r = size * 0.12;
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(bx + size * 0.4, by + bh);
  ctx.lineTo(bx + size * 0.2, by + bh + size * 0.25);
  ctx.lineTo(bx + size * 0.32, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();
}

function drawClock(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const cx = x + size * 0.5;
  const cy = y + size * 0.5;
  const radius = size * 0.38;

  ctx.strokeStyle = COLORS.textMuted;
  ctx.lineWidth = size * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.1;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - radius * 0.6);
  ctx.stroke();

  ctx.lineWidth = size * 0.08;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + radius * 0.5, cy + radius * 0.2);
  ctx.stroke();
}

function drawHeaderIcon(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, size: number) {
  switch (type) {
    case "check":
      drawCheckmark(ctx, x, y, size);
      break;
    case "x":
      drawX(ctx, x, y, size);
      break;
    case "bubble":
      drawSpeechBubble(ctx, x, y, size);
      break;
    case "clock":
      drawClock(ctx, x, y, size);
      break;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTime(seconds: number): string {
  if (seconds === 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function getRankColor(rank: number): string {
  if (rank === 1) return COLORS.gold;
  if (rank === 2) return COLORS.silver;
  if (rank === 3) return COLORS.bronze;
  return COLORS.textMuted;
}

function stripEmoji(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{1F000}-\u{1F02F}]/gu, "")
    .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, "")
    .replace(/[\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  let truncated = stripEmoji(text);
  while (ctx.measureText(truncated).width > maxWidth && truncated.length > 3) {
    truncated = truncated.slice(0, -1);
  }
  if (truncated !== stripEmoji(text) && truncated.length > 0) {
    truncated = truncated.slice(0, -2) + "...";
  }
  return truncated || "Unknown";
}

function drawGradientText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  gradient: { colors: string[]; angle?: number }
) {
  const textWidth = ctx.measureText(text).width;
  const angle = gradient.angle ?? 90;
  const angleRad = (angle * Math.PI) / 180;

  // Calculate gradient endpoints based on angle
  const halfWidth = textWidth / 2;
  const centerX = x + halfWidth;

  const startX = centerX - Math.cos(angleRad) * halfWidth;
  const endX = centerX + Math.cos(angleRad) * halfWidth;

  const grad = ctx.createLinearGradient(startX, y, endX, y);

  gradient.colors.forEach((color, i) => {
    const stop = i / (gradient.colors.length - 1);
    grad.addColorStop(stop, color);
  });

  ctx.fillStyle = grad;
  ctx.fillText(text, x, y);
}

// ============================================================================
// Main Generator
// ============================================================================

export async function generateLeaderboardImage(stats: ModStats[]): Promise<Buffer> {
  const s = CONFIG.scale;

  const width = CONFIG.baseWidth * s;
  const headerHeight = CONFIG.baseHeaderHeight * s;
  const rowHeight = CONFIG.baseRowHeight * s;
  const paddingX = CONFIG.basePaddingX * s;
  const paddingY = CONFIG.basePaddingY * s;
  const height = paddingY + headerHeight + rowHeight * stats.length + paddingY;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Single flat background - exact Discord embed color
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // Calculate column positions
  const colPositions: number[] = [];
  let xPos = paddingX;
  for (const col of CONFIG.columns) {
    colPositions.push(xPos);
    xPos += col.width * s + CONFIG.columnGap * s;
  }

  // Draw header
  const headerY = paddingY + headerHeight / 2;
  const iconSize = CONFIG.baseIconSize * s;
  const headerFontSize = CONFIG.baseHeaderFontSize * s;

  ctx.textBaseline = "middle";

  CONFIG.columns.forEach((col, i) => {
    const colX = colPositions[i];
    const colW = col.width * s;

    if (col.icon) {
      const iconX = colX + colW - iconSize;
      const iconY = headerY - iconSize / 2;
      drawHeaderIcon(ctx, col.header, iconX, iconY, iconSize);
    } else {
      ctx.font = `bold ${headerFontSize}px Arial, sans-serif`;
      ctx.fillStyle = COLORS.textMuted;
      if (col.align === "left") {
        ctx.textAlign = "left";
        ctx.fillText(col.header, colX, headerY);
      } else if (col.align === "right") {
        ctx.textAlign = "right";
        ctx.fillText(col.header, colX + colW, headerY);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(col.header, colX + colW / 2, headerY);
      }
    }
  });

  // Subtle header divider line
  ctx.strokeStyle = COLORS.divider;
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(paddingX, paddingY + headerHeight);
  ctx.lineTo(width - paddingX, paddingY + headerHeight);
  ctx.stroke();

  // Draw rows
  const fontSize = CONFIG.baseFontSize * s;

  for (let rowIndex = 0; rowIndex < stats.length; rowIndex++) {
    const stat = stats[rowIndex];
    const rowTop = paddingY + headerHeight + rowIndex * rowHeight;
    const rowCenterY = rowTop + rowHeight / 2;

    // Subtle row divider (skip first row)
    if (rowIndex > 0) {
      ctx.strokeStyle = COLORS.divider;
      ctx.lineWidth = 1 * s;
      ctx.beginPath();
      ctx.moveTo(paddingX, rowTop);
      ctx.lineTo(width - paddingX, rowTop);
      ctx.stroke();
    }

    ctx.textBaseline = "middle";

    // Rank column (colored for top 3)
    ctx.font = `${fontSize}px "Consolas", "Monaco", monospace`;
    ctx.fillStyle = getRankColor(stat.rank);
    ctx.textAlign = "center";
    ctx.fillText(`${stat.rank}.`, colPositions[0] + (CONFIG.columns[0].width * s) / 2, rowCenterY);

    // Name column (with role color or gradient)
    ctx.font = `500 ${fontSize}px Arial, "Segoe UI", sans-serif`;
    ctx.textAlign = "left";
    const maxNameWidth = CONFIG.columns[1].width * s - 8;
    const displayName = truncateText(ctx, stat.displayName, maxNameWidth);

    if (stat.nameGradient && stat.nameGradient.colors.length >= 2) {
      drawGradientText(ctx, displayName, colPositions[1], rowCenterY, stat.nameGradient);
    } else if (stat.roleColor && stat.roleColor !== "#000000") {
      ctx.fillStyle = stat.roleColor;
      ctx.fillText(displayName, colPositions[1], rowCenterY);
    } else {
      ctx.fillStyle = COLORS.text;
      ctx.fillText(displayName, colPositions[1], rowCenterY);
    }

    // Stats columns
    ctx.font = `${fontSize}px "Consolas", "Monaco", monospace`;

    // Total
    ctx.fillStyle = stat.total === 0 ? COLORS.textDimmed : COLORS.text;
    ctx.textAlign = "right";
    ctx.fillText(stat.total.toString(), colPositions[2] + CONFIG.columns[2].width * s, rowCenterY);

    // Approvals (green)
    ctx.fillStyle = stat.approvals === 0 ? COLORS.textDimmed : COLORS.green;
    ctx.fillText(stat.approvals.toString(), colPositions[3] + CONFIG.columns[3].width * s, rowCenterY);

    // Rejections (red)
    ctx.fillStyle = stat.rejections === 0 ? COLORS.textDimmed : COLORS.red;
    ctx.fillText(stat.rejections.toString(), colPositions[4] + CONFIG.columns[4].width * s, rowCenterY);

    // Modmail (yellow)
    ctx.fillStyle = stat.modmail === 0 ? COLORS.textDimmed : COLORS.yellow;
    ctx.fillText(stat.modmail.toString(), colPositions[5] + CONFIG.columns[5].width * s, rowCenterY);

    // Time (muted)
    ctx.fillStyle = stat.avgTimeSeconds === 0 ? COLORS.textDimmed : COLORS.textMuted;
    ctx.fillText(formatTime(stat.avgTimeSeconds), colPositions[6] + CONFIG.columns[6].width * s, rowCenterY);
  }

  // No rounded corners - square edges blend with embed
  return canvas.toBuffer("image/png");
}

// Alias for backwards compatibility
export async function generateStatsImage(stats: ModStats[]): Promise<Buffer> {
  return generateLeaderboardImage(stats);
}
