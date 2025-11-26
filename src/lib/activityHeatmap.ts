/**
 * Pawtropolis Tech — src/lib/activityHeatmap.ts
 * WHAT: Generates multi-week activity heatmap visualization with trends analysis
 * WHY: Provides visual insight into server activity patterns over time (1-8 weeks)
 * USAGE: Called by /activity command to generate PNG heatmap
 * DATA: Queries message_activity table (populated by messageActivityLogger.ts)
 *       Migration 020 creates the table, index.ts logs messages via messageCreate event
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import { writeFile } from 'fs/promises';
import { logger } from './logger.js';
import { db } from '../db/db.js';

/**
 * Single week activity data
 */
export interface WeekData {
  /** 2D array: [day 0-6][hour 0-23] where day 0 = Monday */
  grid: number[][];
  /** Week start date (Monday) */
  startDate: Date;
  /** Week end date (Sunday) */
  endDate: Date;
  /** Calendar dates for each day (Mon-Sun) */
  dates: Date[];
}

/**
 * Multi-week activity data with trends
 */
export interface ActivityData {
  /** Array of week data, most recent first */
  weeks: WeekData[];
  /** Maximum activity value across all weeks for normalization */
  maxValue: number;
  /** Trends analysis */
  trends: TrendsData;
}

/**
 * Trends analysis results
 */
export interface TrendsData {
  busiestHours: string; // e.g. "4pm-6pm UTC" (3-hour block)
  leastActiveHours: string; // e.g. "2am-4am UTC" (3-hour block)
  peakDays: string[]; // e.g. ["Sat", "Sun"]
  quietestDays: string[];
  avgMessagesPerHour: number; // Average messages per hour across all data
  totalMessages: number;
  weekOverWeekGrowth?: number; // Percentage, only for multi-week
}

/**
 * Configuration for heatmap appearance
 */
export interface HeatmapConfig {
  width?: number;
  height?: number;
  cellWidth?: number;
  cellHeight?: number;
  padding?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  fonts?: {
    title: number;
    weekTitle: number;
    label: number;
    legend: number;
    trends: number;
  };
}

const DEFAULT_CONFIG: Required<HeatmapConfig> = {
  width: 1600,
  height: 600, // Will be adjusted based on number of weeks
  cellWidth: 48,
  cellHeight: 58,
  padding: {
    top: 60,
    bottom: 80,
    left: 160, // More space for dates
    right: 80,
  },
  fonts: {
    title: 32,
    weekTitle: 24,
    label: 16,
    legend: 16,
    trends: 16,
  },
};

/**
 * 10-step color gradient from green (low) to red (high).
 * Perceptually linear-ish progression. If you change this, test with
 * colorblind users - green-red is already rough for deuteranopia.
 * Consider adding a pattern overlay for accessibility in future.
 */
const COLOR_GRADIENT = [
  '#2ecc71', '#52c65a', '#76c042', '#9aba2b', '#beb413',
  '#e2ae00', '#f39c12', '#e67e22', '#e74c3c', '#c0392b',
];

// Background and UI colors (dark theme)
const COLORS = {
  background: '#2c2f33',
  gridLine: '#23272a',
  textPrimary: '#ffffff',
  textSecondary: '#dcddde',
  cellEmpty: '#3a3f45',
  trendsBox: '#23272a',
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Format hour in 12-hour AM/PM format
 */
function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
}

/**
 * Format date as MM/DD
 */
function formatDate(date: Date): string {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${month}/${day}`;
}

/**
 * Format week range
 */
function formatWeekRange(startDate: Date, endDate: Date): string {
  const start = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const end = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `Week of ${start} – ${end}`;
}

/**
 * Draw a rounded rectangle
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Get color for a given activity value using the 10-step gradient.
 * Linear normalization against maxValue - works well for typical distributions
 * but can wash out detail when you have outlier spikes. Consider log scale
 * or percentile-based normalization if one cell dominates the entire range.
 */
function getColor(value: number, maxValue: number): string {
  if (value === 0 || maxValue === 0) return COLORS.cellEmpty;
  const normalized = Math.min(1, value / maxValue);
  const index = Math.floor(normalized * (COLOR_GRADIENT.length - 1));
  return COLOR_GRADIENT[index];
}

/**
 * Calculate trends from activity data
 */
function calculateTrends(data: ActivityData): TrendsData {
  const allGrids = data.weeks.map(w => w.grid);

  // Aggregate hourly activity across all days and weeks
  const hourlyTotals = Array(24).fill(0);
  const dayTotals = Array(7).fill(0);
  let totalMessages = 0;

  for (const grid of allGrids) {
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const value = grid[day][hour];
        hourlyTotals[hour] += value;
        dayTotals[day] += value;
        totalMessages += value;
      }
    }
  }

  // Find busiest hours using a sliding window approach (3-hour blocks).
  // This avoids calling out isolated hourly spikes and gives more actionable
  // insight like "schedule events during 4-7pm" vs "6pm had one big spike".
  // O(n) with n=24 so no perf concerns, but the slice().reduce() allocates
  // small arrays 22 times per call - not worth optimizing unless profiled.
  let maxConsecutiveSum = 0;
  let maxConsecutiveStart = 0;
  const windowSize = 3; // 3-hour window

  for (let i = 0; i <= 24 - windowSize; i++) {
    const sum = hourlyTotals.slice(i, i + windowSize).reduce((a, b) => a + b, 0);
    if (sum > maxConsecutiveSum) {
      maxConsecutiveSum = sum;
      maxConsecutiveStart = i;
    }
  }

  const busiestStart = maxConsecutiveStart;
  const busiestEnd = maxConsecutiveStart + windowSize - 1;
  const busiestHours = `${formatHour(busiestStart)}–${formatHour(busiestEnd)} UTC`;

  // Find least active hours (consecutive lowest period)
  let minConsecutiveSum = Infinity;
  let minConsecutiveStart = 0;

  for (let i = 0; i <= 24 - windowSize; i++) {
    const sum = hourlyTotals.slice(i, i + windowSize).reduce((a, b) => a + b, 0);
    if (sum < minConsecutiveSum) {
      minConsecutiveSum = sum;
      minConsecutiveStart = i;
    }
  }

  const leastActiveStart = minConsecutiveStart;
  const leastActiveEnd = minConsecutiveStart + windowSize - 1;
  const leastActiveHours = `${formatHour(leastActiveStart)}–${formatHour(leastActiveEnd)} UTC`;

  // Find peak and quietest days
  const maxDayValue = Math.max(...dayTotals);
  const minDayValue = Math.min(...dayTotals);

  const peakDays = dayTotals
    .map((val, idx) => (val === maxDayValue ? DAY_LABELS[idx] : null))
    .filter(Boolean) as string[];

  const quietestDays = dayTotals
    .map((val, idx) => (val === minDayValue ? DAY_LABELS[idx] : null))
    .filter(Boolean) as string[];

  // Average messages per hour (total messages / total hours)
  const totalHours = allGrids.length * 7 * 24;
  const avgMessagesPerHour = totalMessages / totalHours;

  // Week-over-week growth comparing most recent (index 0) to oldest week.
  // Note: This is (new - old) / old * 100, so positive = growth.
  // Edge case: if old week has zero activity, we skip to avoid Infinity/NaN.
  // For servers with wildly variable weeks, might want rolling average instead.
  let weekOverWeekGrowth: number | undefined;
  if (data.weeks.length >= 2) {
    const firstWeekTotal = data.weeks[0].grid.flat().reduce((a, b) => a + b, 0);
    const lastWeekTotal = data.weeks[data.weeks.length - 1].grid.flat().reduce((a, b) => a + b, 0);

    if (lastWeekTotal > 0) {
      weekOverWeekGrowth = ((firstWeekTotal - lastWeekTotal) / lastWeekTotal) * 100;
    }
  }

  return {
    busiestHours,
    leastActiveHours,
    peakDays,
    quietestDays,
    avgMessagesPerHour: Math.round(avgMessagesPerHour * 10) / 10,
    totalMessages,
    weekOverWeekGrowth,
  };
}

/**
 * Draw a single week heatmap
 */
function drawWeekHeatmap(
  ctx: CanvasRenderingContext2D,
  week: WeekData,
  maxValue: number,
  gridX: number,
  gridY: number,
  cfg: Required<HeatmapConfig>,
  showWeekTitle: boolean
): number {
  const cellSpacing = 2;
  const cornerRadius = 4;
  const gridWidth = 24 * cfg.cellWidth;
  const gridHeight = 7 * cfg.cellHeight;

  // Draw week title if multi-week mode
  let currentY = gridY;
  if (showWeekTitle) {
    ctx.fillStyle = COLORS.textPrimary;
    ctx.font = `bold ${cfg.fonts.weekTitle}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(formatWeekRange(week.startDate, week.endDate), gridX, currentY);
    currentY += 40;
  }

  // Draw hour labels (X-axis) - only for first week
  if (showWeekTitle || gridY === cfg.padding.top) {
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = `bold ${cfg.fonts.label}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    for (let hour = 0; hour < 24; hour++) {
      const x = gridX + hour * cfg.cellWidth + cfg.cellWidth / 2;
      ctx.fillText(formatHour(hour), x, currentY + gridHeight - 5);
    }
  }

  // Draw day labels with dates (Y-axis)
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `${cfg.fonts.label}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let day = 0; day < 7; day++) {
    const y = currentY + day * cfg.cellHeight + cfg.cellHeight / 2;
    const dateStr = formatDate(week.dates[day]);
    const label = `${DAY_LABELS[day]} (${dateStr})`;
    ctx.fillText(label, gridX - 15, y);
  }

  // Draw heatmap grid
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const x = gridX + hour * cfg.cellWidth;
      const y = currentY + day * cfg.cellHeight;
      const value = week.grid[day][hour];

      // Draw cell with color
      ctx.fillStyle = getColor(value, maxValue);
      roundRect(ctx, x + cellSpacing / 2, y + cellSpacing / 2, cfg.cellWidth - cellSpacing, cfg.cellHeight - cellSpacing, cornerRadius);
      ctx.fill();

      // Draw border
      ctx.strokeStyle = COLORS.gridLine;
      ctx.lineWidth = 1.5;
      roundRect(ctx, x + cellSpacing / 2, y + cellSpacing / 2, cfg.cellWidth - cellSpacing, cfg.cellHeight - cellSpacing, cornerRadius);
      ctx.stroke();
    }
  }

  // Draw column dividers (midnight, 6am, 12pm, 6pm)
  const dividerHours = [0, 6, 12, 18];
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 2;

  for (const hour of dividerHours) {
    const x = gridX + hour * cfg.cellWidth;
    ctx.beginPath();
    ctx.moveTo(x, currentY);
    ctx.lineTo(x, currentY + gridHeight);
    ctx.stroke();
  }

  return currentY + gridHeight;
}


/**
 * Generate multi-week activity heatmap with trends as PNG buffer
 */
export async function generateHeatmap(
  data: ActivityData,
  config: HeatmapConfig = {}
): Promise<Buffer> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const numWeeks = data.weeks.length;
  const gridWidth = 24 * cfg.cellWidth;
  const gridHeight = 7 * cfg.cellHeight;

  // Calculate canvas height based on number of weeks
  const weekSpacing = 60;
  const weekHeaderHeight = numWeeks > 1 ? 40 : 0;
  const singleWeekHeight = gridHeight + weekHeaderHeight;
  const allWeeksHeight = singleWeekHeight * numWeeks + weekSpacing * (numWeeks - 1);
  const legendHeight = 100;

  const totalHeight = cfg.padding.top + allWeeksHeight + legendHeight + cfg.padding.bottom;

  const canvas = createCanvas(cfg.width, totalHeight);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, cfg.width, totalHeight);

  const gridX = cfg.padding.left;
  let currentY = cfg.padding.top;

  // Draw each week
  for (let i = 0; i < numWeeks; i++) {
    const week = data.weeks[i];
    const endY = drawWeekHeatmap(ctx, week, data.maxValue, gridX, currentY, cfg, numWeeks > 1);
    currentY = endY + weekSpacing;
  }

  // Draw legend
  const legendY = currentY;
  const legendWidth = 400;
  const legendBarHeight = 24;
  const legendX = gridX + (gridWidth - legendWidth) / 2;

  // Empty cell indicator
  const emptyIndicatorSize = legendBarHeight;
  const emptyIndicatorX = legendX - 100;

  ctx.fillStyle = COLORS.cellEmpty;
  ctx.fillRect(emptyIndicatorX, legendY, emptyIndicatorSize, emptyIndicatorSize);
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(emptyIndicatorX, legendY, emptyIndicatorSize, emptyIndicatorSize);

  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `${cfg.fonts.legend}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('0', emptyIndicatorX + emptyIndicatorSize + 8, legendY + emptyIndicatorSize / 2);

  // Gradient bar
  const gradientStepWidth = legendWidth / COLOR_GRADIENT.length;
  for (let i = 0; i < COLOR_GRADIENT.length; i++) {
    ctx.fillStyle = COLOR_GRADIENT[i];
    ctx.fillRect(legendX + i * gradientStepWidth, legendY, gradientStepWidth, legendBarHeight);
  }

  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(legendX, legendY, legendWidth, legendBarHeight);

  // Legend labels
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `${cfg.fonts.legend}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Low', legendX, legendY + legendBarHeight + 10);

  ctx.textAlign = 'right';
  ctx.fillText(`High (${data.maxValue})`, legendX + legendWidth, legendY + legendBarHeight + 10);

  // UTC label
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = `${cfg.fonts.legend - 2}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('All times shown are UTC', emptyIndicatorX, legendY + legendBarHeight + 50);

  return canvas.toBuffer('image/png');
}

/**
 * Fetch multi-week activity data from database.
 *
 * Performance note: Each week is a separate query. For 8 weeks this means
 * 8 round trips to SQLite. Could batch into one query with week bucketing,
 * but current latency is fine (<50ms total) and the code is clearer this way.
 *
 * The 8-week cap exists because the canvas gets absurdly tall beyond that
 * and the data becomes less actionable anyway.
 */
export function fetchActivityData(guildId: string, weeks: number = 1): ActivityData {
  if (weeks < 1 || weeks > 8) {
    throw new Error('weeks parameter must be between 1 and 8');
  }

  const now = new Date();
  const weeksData: WeekData[] = [];

  // Fetch data for each week, most recent first
  for (let weekOffset = 0; weekOffset < weeks; weekOffset++) {
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() - (weekOffset * 7));

    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 7);

    const startTimestamp = Math.floor(weekStart.getTime() / 1000);
    const endTimestamp = Math.floor(weekEnd.getTime() / 1000);

    // Query message_activity for this week
    const rows = db
      .prepare(
        `SELECT created_at_s
         FROM message_activity
         WHERE guild_id = ? AND created_at_s >= ? AND created_at_s <= ?
         ORDER BY created_at_s ASC`
      )
      .all(guildId, startTimestamp, endTimestamp) as Array<{ created_at_s: number }>;

    // Initialize grid
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const dates: Date[] = [];

    // Calculate dates for this week (Monday-Sunday).
    // The (day + 6) % 7 trick converts Sunday=0 to 6, Monday=1 to 0, etc.
    // This aligns with ISO week standard where Monday is first day.
    const mondayOfWeek = new Date(weekStart);
    const daysSinceMonday = (mondayOfWeek.getUTCDay() + 6) % 7;
    mondayOfWeek.setDate(mondayOfWeek.getDate() - daysSinceMonday);

    for (let i = 0; i < 7; i++) {
      const date = new Date(mondayOfWeek);
      date.setDate(mondayOfWeek.getDate() + i);
      dates.push(date);
    }

    // Aggregate actions by day and hour.
    // Using UTC throughout to avoid DST headaches - all times in heatmap are UTC.
    // dayIndex conversion: JS Sunday=0 becomes index 6 (end of week).
    for (const row of rows) {
      const date = new Date(row.created_at_s * 1000);
      const dayOfWeek = date.getUTCDay();
      const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const hour = date.getUTCHours();
      grid[dayIndex][hour] += 1;
    }

    weeksData.push({
      grid,
      startDate: dates[0],
      endDate: dates[6],
      dates,
    });
  }

  // Calculate global max value across all weeks for consistent color scaling.
  // The ", 1" ensures we never divide by zero in getColor(). An empty server
  // with zero messages everywhere will just show all cells as empty color.
  const maxValue = Math.max(...weeksData.flatMap(w => w.grid.flat()), 1);

  // Build activity data
  const activityData: ActivityData = {
    weeks: weeksData,
    maxValue,
    trends: {} as TrendsData, // Will be calculated
  };

  // Calculate trends
  activityData.trends = calculateTrends(activityData);

  logger.info(
    { guildId, weeks, totalMessages: activityData.trends.totalMessages, maxValue },
    '[heatmap] fetched multi-week activity data'
  );

  return activityData;
}

/**
 * Generate sample multi-week data for testing
 */
export function generateSampleData(weeks: number = 1): ActivityData {
  if (weeks < 1 || weeks > 8) weeks = 1;

  const weeksData: WeekData[] = [];
  const now = new Date();

  for (let weekOffset = 0; weekOffset < weeks; weekOffset++) {
    const grid: number[][] = [];
    const dates: Date[] = [];

    // Calculate week dates
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() - (weekOffset * 7));
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 7);

    const mondayOfWeek = new Date(weekStart);
    const daysSinceMonday = (mondayOfWeek.getUTCDay() + 6) % 7;
    mondayOfWeek.setDate(mondayOfWeek.getDate() - daysSinceMonday);

    for (let i = 0; i < 7; i++) {
      const date = new Date(mondayOfWeek);
      date.setDate(mondayOfWeek.getDate() + i);
      dates.push(date);
    }

    // Generate sample data with variation per week
    const weekMultiplier = 1 - (weekOffset * 0.15); // Older weeks slightly less active

    for (let day = 0; day < 7; day++) {
      const dayData: number[] = [];
      for (let hour = 0; hour < 24; hour++) {
        const isWeekend = day >= 5;
        const isNight = hour < 6 || hour > 23;
        const isPeakTime = hour >= 12 && hour <= 22;

        let baseActivity = 0;
        if (isNight) {
          baseActivity = Math.random() * 10;
        } else if (isPeakTime) {
          baseActivity = Math.random() * 100 + (isWeekend ? 50 : 30);
        } else {
          baseActivity = Math.random() * 50;
        }

        dayData.push(Math.floor(baseActivity * weekMultiplier));
      }
      grid.push(dayData);
    }

    weeksData.push({
      grid,
      startDate: dates[0],
      endDate: dates[6],
      dates,
    });
  }

  const maxValue = Math.max(...weeksData.flatMap(w => w.grid.flat()), 1);

  const activityData: ActivityData = {
    weeks: weeksData,
    maxValue,
    trends: {} as TrendsData,
  };

  activityData.trends = calculateTrends(activityData);

  return activityData;
}

/**
 * Save heatmap to file (for testing/debugging)
 */
export async function saveHeatmap(
  data: ActivityData,
  outputPath: string,
  config?: HeatmapConfig
): Promise<void> {
  const buffer = await generateHeatmap(data, config);
  await writeFile(outputPath, buffer);
  logger.info({ outputPath, size: buffer.length, weeks: data.weeks.length }, '[heatmap] saved to file');
}
