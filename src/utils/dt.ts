/**
 * Tiny Discord timestamp helpers
 * 'f' = Short date/time, 'R' = Relative
 */
export const toUnix = (date: Date | number): number =>
  Math.floor((date instanceof Date ? date.getTime() : date) / 1000);

export const ts = (d: Date | number, style: 'f' | 'R' = 'f'): string => `<t:${toUnix(d)}:${style}>`;

