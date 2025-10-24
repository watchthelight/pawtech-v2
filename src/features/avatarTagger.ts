/**
 * avatarTagger.ts
 * NSFW/furry/scalie tagging using WD v3 ONNX model
 * Multi-crop strategy for better avatar coverage
 */

import { logger } from "../lib/logger.js";

export type Tag = {
  name: string;
  prob: number;
};

const TAGGER_ENABLED = process.env.NSFW_TAGGER_ENABLE === "1";
const MODEL_PATH = process.env.NSFW_TAGGER_MODEL || "./models/wd-v3-tagger.onnx";
const INPUT_SIZE = 448;
const THRESHOLD = 0.1;
const PER_CROP_BUDGET_MS = 200;
const EARLY_EXIT_EXPLICIT = 0.95;
const RISK_DEBUG = process.env.RISK_DEBUG === "1";

// WD v3 tag labels (comprehensive set for furry/scalie NSFW detection)
// Export as both TAG_NAMES (legacy) and TAG_LABELS (new standard)
export const TAG_NAMES = [
  // Rating tags
  "rating:general",
  "rating:sensitive",
  "rating:questionable",
  "rating:explicit",
  // NSFW anatomy/acts
  "nsfw",
  "explicit",
  "porn",
  "nude",
  "naked",
  "nipples",
  "areola",
  "breasts",
  "genitals",
  "penis",
  "vulva",
  "vagina",
  "pussy",
  "crotch",
  "anus",
  "spread_legs",
  "fellatio",
  "cunnilingus",
  "sex",
  "cum",
  "erection",
  "genital_focused",
  "crotch_shot",
  // Furry/scalie context
  "furry",
  "anthro",
  "feral",
  "kemono",
  "dragon",
  "scalie",
  "reptile",
  "lizard",
  "kobold",
  "werewolf",
  "taur",
  "mammal",
  "muzzle",
  "snout",
  // Pose/intent
  "presenting",
  "crotch_grab",
  "exhibitionism",
];

// Alias for standard naming
export const TAG_LABELS = TAG_NAMES;

let modelSession: any | null = null;
let modelLoadError: Error | null = null;

type CachedResult = {
  tags: Tag[];
  meanProbs: Float32Array;
  maxProbs: Float32Array;
  timestamp: number;
  meta?: TagResult["meta"];
};

const tagCache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getSession(): Promise<any | null> {
  if (!TAGGER_ENABLED) {
    return null;
  }

  if (modelLoadError) {
    return null;
  }

  if (modelSession) {
    return modelSession;
  }

  try {
    logger.info({ modelPath: MODEL_PATH }, "[avatarTagger] loading model");
    const ort = await import("onnxruntime-node" as any);
    modelSession = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
    logger.info("[avatarTagger] model loaded");
    return modelSession;
  } catch (err) {
    modelLoadError = err as Error;
    const downloadCmd =
      process.platform === "win32"
        ? `Invoke-WebRequest -Uri "https://huggingface.co/SmilingWolf/wd-v1-4-moat-tagger-v2/resolve/main/model.onnx" -OutFile "${MODEL_PATH}"`
        : `curl -L "https://huggingface.co/SmilingWolf/wd-v1-4-moat-tagger-v2/resolve/main/model.onnx" -o "${MODEL_PATH}"`;

    logger.warn(
      { error: modelLoadError.message, modelPath: MODEL_PATH },
      `[avatarTagger] Model not found at ${MODEL_PATH}. Download with:\n  ${downloadCmd}`
    );
    return null;
  }
}

type CropWindow = { x: number; y: number; w: number; h: number };

function generateCropWindows(width: number, height: number): CropWindow[] {
  const cropSize = Math.max(1, Math.min(width ?? INPUT_SIZE, height ?? INPUT_SIZE));
  const maxX = Math.max(0, (width ?? cropSize) - cropSize);
  const maxY = Math.max(0, (height ?? cropSize) - cropSize);
  const centerX = Math.round(maxX / 2);
  const centerY = Math.round(maxY / 2);

  return [
    { x: centerX, y: centerY, w: cropSize, h: cropSize }, // center
    { x: 0, y: 0, w: cropSize, h: cropSize }, // top-left
    { x: maxX, y: 0, w: cropSize, h: cropSize }, // top-right
    { x: 0, y: maxY, w: cropSize, h: cropSize }, // bottom-left
    { x: maxX, y: maxY, w: cropSize, h: cropSize }, // bottom-right
  ];
}

async function preprocessImage(url: string): Promise<Buffer | null> {
  try {
    const downloadUrl = url.includes("?") ? `${url}&size=1024` : `${url}?size=1024`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(downloadUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn({ status: response.status, url }, "[avatarTagger] fetch failed");
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length < 100) {
      logger.warn({ size: buffer.length, url }, "[avatarTagger] buffer too small");
      return null;
    }

    return buffer;
  } catch (err) {
    logger.warn({ error: (err as Error).message, url }, "[avatarTagger] preprocess failed");
    return null;
  }
}

type TensorData = {
  hwc: Float32Array;
  chw: Float32Array;
};

async function bufferToTensor(
  buffer: Buffer,
  crop: CropWindow | null,
  flip = false
): Promise<TensorData | null> {
  try {
    const sharp = await import("sharp" as any);
    const sharpFactory = sharp.default ?? sharp;
    const linearKernel = sharp.kernel?.linear ?? "linear";

    let pipeline = sharpFactory(buffer).removeAlpha().toColourspace("srgb");

    // Apply crop if specified
    if (crop) {
      pipeline = pipeline.extract({
        left: crop.x,
        top: crop.y,
        width: crop.w,
        height: crop.h,
      });
    }

    // Apply flip if needed
    if (flip) {
      pipeline = pipeline.flop();
    }

    // Resize to 448x448
    const { data, info } = await pipeline
      .resize(INPUT_SIZE, INPUT_SIZE, { fit: "cover", kernel: linearKernel })
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 3) {
      logger.warn({ channels: info.channels }, "[avatarTagger] unexpected channel count");
      return null;
    }

    const H = info.height;
    const W = info.width;
    const C = info.channels;

    // Normalize to [-1, 1] and prepare both HWC and CHW layouts
    const hwc = new Float32Array(H * W * C);
    const chw = new Float32Array(C * H * W);

    // Build HWC (channels last) and CHW (channels first) simultaneously
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let c = 0; c < C; c++) {
          const i = (y * W + x) * C + c; // HWC index in source
          const v = data[i] / 255; // [0,1]
          const normalized = (v - 0.5) / 0.5; // [-1,1]

          // HWC layout: [H, W, C]
          hwc[(y * W + x) * C + c] = normalized;

          // CHW layout: [C, H, W]
          chw[c * H * W + y * W + x] = normalized;
        }
      }
    }

    return { hwc, chw };
  } catch (err) {
    logger.warn({ error: (err as Error).message }, "[avatarTagger] buffer conversion failed");
    return null;
  }
}

type LayoutMode = "NHWC" | "NCHW";
let detectedLayout: LayoutMode | null = null;
let layoutProbeLogged = false;

function isDimensionMismatch(err: unknown): boolean {
  if (!err) return false;
  const message = (err as Error)?.message ?? "";
  if (message.length === 0) return false;
  return (
    /Got:\s*3\s*Expected:\s*448/i.test(message) ||
    message.includes("Got: 448 Expected: 3") ||
    message.includes("Invalid rank") ||
    message.includes("Invalid shape")
  );
}

async function runInference(tensorData: TensorData): Promise<Float32Array | null> {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const ort = await import("onnxruntime-node" as any);
  const inputName = session.inputNames?.[0];
  if (!inputName) {
    logger.warn("[avatarTagger] missing input name");
    return null;
  }

  const runWithLayout = async (layout: LayoutMode) => {
    const inputTensor =
      layout === "NHWC"
        ? new ort.Tensor("float32", tensorData.hwc, [1, INPUT_SIZE, INPUT_SIZE, 3])
        : new ort.Tensor("float32", tensorData.chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);

    const feeds: Record<string, any> = { [inputName]: inputTensor };
    const results = await session.run(feeds);
    const outputName = session.outputNames?.[0];
    const output = outputName ? results[outputName] : undefined;

    if (!output || !(output.data instanceof Float32Array)) {
      logger.warn("[avatarTagger] unexpected output format");
      return null;
    }
    return output.data as Float32Array;
  };

  if (detectedLayout) {
    try {
      return await runWithLayout(detectedLayout);
    } catch (err) {
      logger.warn(
        { error: (err as Error).message, layout: detectedLayout },
        "[avatarTagger] cached layout failed, will retry detection"
      );
      detectedLayout = null;
    }
  }

  const meta = session.inputMetadata?.[inputName];
  const dims = (meta?.dims ?? meta?.shape ?? []) as Array<number | string>;

  const dimsStr = dims.map((d) => (Number.isFinite(d as number) ? Number(d) : String(d)));
  let layoutToTry: LayoutMode = "NCHW";

  if (dimsStr.length === 4) {
    if (String(dimsStr[1]) === "3") {
      layoutToTry = "NCHW";
    } else if (String(dimsStr[3]) === "3") {
      layoutToTry = "NHWC";
    }
  }

  if (!layoutProbeLogged) {
    logger.info(
      { layout_detected: layoutToTry, dims: dimsStr },
      "[avatarTagger] input layout probe"
    );
    layoutProbeLogged = true;
  }

  try {
    const output = await runWithLayout(layoutToTry);
    if (output) {
      detectedLayout = layoutToTry;
      return output;
    }
  } catch (err) {
    if (!isDimensionMismatch(err)) {
      logger.warn(
        { error: (err as Error).message, layout: layoutToTry },
        "[avatarTagger] inference failed"
      );
      return null;
    }

    const retryLayout: LayoutMode = layoutToTry === "NHWC" ? "NCHW" : "NHWC";
    logger.info(
      { layout_retry: retryLayout, tried: layoutToTry },
      "[avatarTagger] dimension mismatch retry"
    );
    try {
      const output = await runWithLayout(retryLayout);
      if (output) {
        detectedLayout = retryLayout;
        return output;
      }
    } catch (retryErr) {
      logger.warn(
        { error: (retryErr as Error).message, layout: retryLayout },
        "[avatarTagger] retry inference failed"
      );
      return null;
    }
  }

  return null;
}

export type MultiCropResult = {
  meanProbs: Float32Array;
  maxProbs: Float32Array;
  cropsUsed: number;
  earlyExit: boolean;
  timedOut: boolean;
};

async function runMultiCropInference(buffer: Buffer): Promise<MultiCropResult | null> {
  const sharp = await import("sharp" as any);
  const sharpFactory = sharp.default ?? sharp;
  const metadata = await sharpFactory(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    logger.warn("[avatarTagger] failed to get image dimensions");
    return null;
  }

  const crops = generateCropWindows(metadata.width, metadata.height);
  const allProbs: Float32Array[] = [];
  let earlyExit = false;
  let timedOut = false;

  const explicitIdx = TAG_NAMES.indexOf("explicit");
  const nsfwIdx = TAG_NAMES.indexOf("nsfw");

  for (const crop of crops) {
    const cropStart = Date.now();
    const tensorData = await bufferToTensor(buffer, crop);
    if (!tensorData) {
      continue;
    }

    const probs = await runInference(tensorData);
    if (probs) {
      allProbs.push(probs);

      const explicit = explicitIdx >= 0 ? probs[explicitIdx] : 0;
      const nsfw = nsfwIdx >= 0 ? probs[nsfwIdx] : 0;
      if (Math.max(explicit, nsfw) >= EARLY_EXIT_EXPLICIT) {
        earlyExit = true;
        break;
      }
    }

    const elapsed = Date.now() - cropStart;
    if (elapsed > PER_CROP_BUDGET_MS) {
      timedOut = true;
      logger.info({ timeout_fallback: true, elapsed }, "[avatarTagger] crop exceeded budget");
      break;
    }
  }

  if (allProbs.length === 0) {
    return null;
  }

  const numTags = allProbs[0].length;
  const meanProbs = new Float32Array(numTags);
  const maxProbs = new Float32Array(numTags);

  for (let i = 0; i < numTags; i++) {
    let sum = 0;
    let max = 0;
    for (const probs of allProbs) {
      sum += probs[i];
      if (probs[i] > max) {
        max = probs[i];
      }
    }
    meanProbs[i] = sum / allProbs.length;
    maxProbs[i] = max;
  }

  return {
    meanProbs,
    maxProbs,
    cropsUsed: allProbs.length,
    earlyExit,
    timedOut,
  };
}

export type TagResult = {
  tags: Tag[];
  meanProbs: Float32Array;
  maxProbs: Float32Array;
  meta?: {
    cropsUsed: number;
    earlyExit: boolean;
    timedOut: boolean;
    layout: LayoutMode | null;
  };
};

export async function tagImage(
  url: string,
  opts: { traceId?: string | null } = {}
): Promise<TagResult | null> {
  if (!TAGGER_ENABLED) {
    return null;
  }

  const cacheKey = url;
  const cached = tagCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    if (RISK_DEBUG) {
      logger.info({ url, traceId: opts.traceId ?? null, cache: true }, "[avatarTagger] cache hit");
    } else {
      logger.debug({ url }, "[avatarTagger] cache hit");
    }
    return {
      tags: cached.tags,
      meanProbs: cached.meanProbs,
      maxProbs: cached.maxProbs,
      meta: cached.meta,
    };
  }

  try {
    const buffer = await preprocessImage(url);
    if (!buffer) {
      return null;
    }

    const result = await runMultiCropInference(buffer);
    if (!result) {
      return null;
    }

    const { cropsUsed, earlyExit, timedOut } = result;
    const tags: Tag[] = [];
    for (let i = 0; i < Math.min(result.maxProbs.length, TAG_NAMES.length); i++) {
      if (result.maxProbs[i] > THRESHOLD) {
        tags.push({
          name: TAG_NAMES[i],
          prob: result.maxProbs[i],
        });
      }
    }

    tags.sort((a, b) => b.prob - a.prob);

    const topTags = tags.slice(0, 5).map((tag) => ({
      tag: tag.name,
      p: Math.round(tag.prob * 1000) / 1000,
    }));

    const logPayload = {
      url,
      traceId: opts.traceId ?? null,
      crops_used: cropsUsed,
      early_exit: earlyExit,
      timeout_fallback: timedOut,
      layout: detectedLayout,
      top_tags: topTags,
    };

    if (RISK_DEBUG) {
      logger.info(logPayload, "[avatarTagger] tag_summary");
    } else {
      logger.debug(logPayload, "[avatarTagger] tag_summary");
    }

    tagCache.set(cacheKey, {
      tags,
      meanProbs: result.meanProbs,
      maxProbs: result.maxProbs,
      timestamp: now,
      meta: {
        cropsUsed,
        earlyExit,
        timedOut,
        layout: detectedLayout,
      },
    });

    if (tagCache.size > 100) {
      const entries = Array.from(tagCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < 20; i++) {
        tagCache.delete(entries[i][0]);
      }
    }

    return {
      tags,
      meanProbs: result.meanProbs,
      maxProbs: result.maxProbs,
      meta: {
        cropsUsed,
        earlyExit,
        timedOut,
        layout: detectedLayout,
      },
    };
  } catch (err) {
    logger.warn({ error: (err as Error).message, url }, "[avatarTagger] tagImage failed");
    return null;
  }
}
