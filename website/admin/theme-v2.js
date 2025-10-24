/**
 * Dynamic Color Palette Generator (Client-Side)
 *
 * Uses Material Color Utilities for perceptually accurate color extraction
 * and WCAG-compliant palette generation.
 *
 * This is a standalone client bundle that imports from CDN.
 */

// Import Material Color Utilities from CDN
import {
  QuantizerCelebi,
  Score,
  argbFromRgb,
  redFromArgb,
  greenFromArgb,
  blueFromArgb,
  hexFromArgb,
  themeFromSourceColor,
} from "https://esm.sh/@material/material-color-utilities@0.3.0";

// ============================================================================
// CONTRAST UTILITIES (WCAG AA/AAA)
// ============================================================================

function relativeLuminance(r, g, b) {
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;

  const rL = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gL = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bL = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg.r, fg.g, fg.b);
  const l2 = relativeLuminance(bg.r, bg.g, bg.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function ensureContrast(fg, bg, targetRatio = 4.5) {
  const currentRatio = contrastRatio(fg, bg);

  if (currentRatio >= targetRatio) {
    return { fg, ratio: currentRatio, adjusted: false };
  }

  const hsl = rgbToHsl(fg.r, fg.g, fg.b);
  const bgLuminance = relativeLuminance(bg.r, bg.g, bg.b);
  const shouldLighten = bgLuminance < 0.5;

  let minL = 0;
  let maxL = 100;
  let bestFg = fg;
  let bestRatio = currentRatio;

  for (let i = 0; i < 20; i++) {
    const testL = shouldLighten ? maxL : minL;
    const testRgb = hslToRgb(hsl.h, hsl.s, testL);
    const testRatio = contrastRatio(testRgb, bg);

    if (testRatio >= targetRatio) {
      bestFg = testRgb;
      bestRatio = testRatio;

      if (shouldLighten) {
        maxL = testL;
        minL = (minL + testL) / 2;
      } else {
        minL = testL;
        maxL = (maxL + testL) / 2;
      }
    } else {
      if (shouldLighten) {
        minL = testL;
        maxL = (testL + 100) / 2;
      } else {
        maxL = testL;
        minL = testL / 2;
      }
    }

    if (Math.abs(maxL - minL) < 0.1) break;
  }

  return { fg: bestFg, ratio: bestRatio, adjusted: true };
}

// ============================================================================
// SEED EXTRACTION
// ============================================================================

async function getImagePixels(imageUrl, maxDimension = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const scale = Math.min(maxDimension / img.width, maxDimension / img.height, 1);
        canvas.width = Math.floor(img.width * scale);
        canvas.height = Math.floor(img.height * scale);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const pixels = [];
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          if (a < 128) continue; // Skip transparent

          pixels.push(argbFromRgb(r, g, b));
        }

        resolve(pixels);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageUrl;
  });
}

function blendColors(color1, color2, ratio) {
  const r1 = redFromArgb(color1);
  const g1 = greenFromArgb(color1);
  const b1 = blueFromArgb(color1);

  const r2 = redFromArgb(color2);
  const g2 = greenFromArgb(color2);
  const b2 = blueFromArgb(color2);

  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);

  return argbFromRgb(r, g, b);
}

export async function extractSeedFromImage(imageUrl, accentColorHint = null) {
  try {
    const pixels = await getImagePixels(imageUrl, 256);
    if (!pixels || pixels.length === 0) {
      console.warn("[theme] No pixels extracted");
      return null;
    }

    // Quantize using Celebi algorithm
    const quantized = QuantizerCelebi.quantize(pixels, 128);
    if (quantized.size === 0) {
      console.warn("[theme] Quantization failed");
      return null;
    }

    // Score for theme suitability
    const scored = Score.score(quantized);
    if (scored.length === 0) {
      console.warn("[theme] Scoring failed");
      return null;
    }

    let seedArgb = scored[0];

    // Blend with accent hint (20%)
    if (accentColorHint != null) {
      seedArgb = blendColors(seedArgb, accentColorHint, 0.2);
    }

    console.log("[theme] Seed extracted:", hexFromArgb(seedArgb));
    return seedArgb;
  } catch (err) {
    console.warn("[theme] Extraction failed:", err);
    return null;
  }
}

export async function extractSeedWithFallback(bannerUrl, avatarUrl, accentColor) {
  // Priority 1: Use accent_color if available (most reliable, set by user)
  if (accentColor != null) {
    console.log("[theme] Using Discord accent_color as primary seed");
    return {
      argb: accentColor,
      rgb: {
        r: redFromArgb(accentColor),
        g: greenFromArgb(accentColor),
        b: blueFromArgb(accentColor),
      },
      source: "accent_color",
    };
  }

  // Priority 2: Try banner (Nitro users, most visual real estate)
  if (bannerUrl) {
    const seed = await extractSeedFromImage(bannerUrl, accentColor);
    if (seed != null) {
      return {
        argb: seed,
        rgb: { r: redFromArgb(seed), g: greenFromArgb(seed), b: blueFromArgb(seed) },
        source: "banner",
      };
    }
  }

  // Priority 3: Try avatar (fallback)
  if (avatarUrl) {
    const seed = await extractSeedFromImage(avatarUrl, accentColor);
    if (seed != null) {
      return {
        argb: seed,
        rgb: { r: redFromArgb(seed), g: greenFromArgb(seed), b: blueFromArgb(seed) },
        source: "avatar",
      };
    }
  }

  // Priority 4: Default blue
  console.log("[theme] No assets available, using default");
  const defaultArgb = argbFromRgb(110, 168, 255);
  return {
    argb: defaultArgb,
    rgb: { r: 110, g: 168, b: 255 },
    source: "default",
  };
}

// ============================================================================
// PALETTE GENERATION
// ============================================================================

function argbToRgb(argb) {
  return {
    r: redFromArgb(argb),
    g: greenFromArgb(argb),
    b: blueFromArgb(argb),
  };
}

function rgbToCss(rgb) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

export function buildDarkPalette(seedArgb, source) {
  console.log("[theme] Building palette from seed:", hexFromArgb(seedArgb));

  // Generate Material theme
  const theme = themeFromSourceColor(seedArgb);
  const dark = theme.schemes.dark;

  // Extract tonal palettes
  const primary = theme.palettes.primary;
  const secondary = theme.palettes.secondary;
  const neutral = theme.palettes.neutral;
  const neutralVariant = theme.palettes.neutralVariant;
  const error = theme.palettes.error;

  // AGGRESSIVE THEMING: Use much more saturated tones
  // Background uses primary color with low tone (dark but colored)
  const bgArgb = primary.tone(8); // Darker but with primary hue
  const panelArgb = primary.tone(15); // More visible primary tint
  const borderArgb = primary.tone(30); // Strong border color

  const textArgb = neutral.tone(98); // Brighter text
  const mutedArgb = primary.tone(70); // Muted text with primary tint

  const accentArgb = primary.tone(80); // Brighter, more vibrant
  const accent2Argb = secondary.tone(75); // Brighter secondary
  const accent3Argb = primary.tone(60); // Tertiary accent for graphs

  const dangerArgb = error.tone(75); // Brighter error
  const successArgb = argbFromRgb(76, 217, 123); // Success green

  // Convert and ensure contrast
  const bgRgb = argbToRgb(bgArgb);
  const panelRgb = argbToRgb(panelArgb);
  const textRgb = argbToRgb(textArgb);
  const mutedRgb = argbToRgb(mutedArgb);

  const textOnBg = ensureContrast(textRgb, bgRgb, 4.5);
  const mutedOnBg = ensureContrast(mutedRgb, bgRgb, 3.5);

  const accentRgb = argbToRgb(accentArgb);
  const accent2Rgb = argbToRgb(accent2Argb);
  const accent3Rgb = argbToRgb(accent3Argb);
  const dangerRgb = argbToRgb(dangerArgb);
  const successRgb = argbToRgb(successArgb);

  console.log("[theme] AGGRESSIVE palette generated:", {
    textOnBg: textOnBg.ratio.toFixed(2),
    mutedOnBg: mutedOnBg.ratio.toFixed(2),
    bgTone: 8,
    panelTone: 15,
    accentTone: 80,
  });

  return {
    // Base surfaces
    bg: rgbToCss(bgRgb),
    panel: rgbToCss(panelRgb),
    border: hexFromArgb(borderArgb),

    // Text colors
    text: rgbToCss(textOnBg.fg),
    muted: rgbToCss(mutedOnBg.fg),

    // Primary accents
    accent: rgbToCss(accentRgb),
    accent2: rgbToCss(accent2Rgb),
    accent3: rgbToCss(accent3Rgb),
    ring: `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.4)`,

    // Semantic colors
    danger: rgbToCss(dangerRgb),
    ok: rgbToCss(successRgb),
    warning: hexFromArgb(primary.tone(85)),

    // Brand
    brand: rgbToCss(accentRgb),

    // Graph colors (vibrant gradient)
    graph: {
      primary: rgbToCss(accentRgb),
      secondary: rgbToCss(accent2Rgb),
      tertiary: rgbToCss(accent3Rgb),
      success: rgbToCss(successRgb),
      danger: rgbToCss(dangerRgb),
      neutral: hexFromArgb(neutral.tone(60)),
    },

    // Metadata
    source,
    seedHex: hexFromArgb(seedArgb),
    contrastRatios: {
      textOnBg: textOnBg.ratio,
      mutedOnBg: mutedOnBg.ratio,
    },
  };
}

export function getDefaultDarkPalette() {
  const defaultSeed = argbFromRgb(110, 168, 255);
  return buildDarkPalette(defaultSeed, "default");
}
