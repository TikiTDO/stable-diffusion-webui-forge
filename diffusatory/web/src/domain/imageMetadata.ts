import type {
  DiffusatoryComposition,
  ForgeCatalog,
  ImageMetadataResponse,
} from "../api/forge/types";
import type { ImageEditSettings } from "../features/editor/model";
import type { RegionalComposition } from "../features/regions/types";
import type { GenerationDraft } from "./draft";
import { applyCheckpointProfile } from "./modelProfiles";
import {
  checkpointPreferenceKey,
  type SavedModelDefaults,
} from "./savedModelDefaults";

export interface ImageMetadataImport {
  draft: GenerationDraft;
  editSettings: Partial<ImageEditSettings>;
  regions?: RegionalComposition;
  imported: string[];
  warnings: string[];
  hasGenerationMetadata: boolean;
}

export function parseDiffusatoryComposition(
  value: unknown,
): DiffusatoryComposition | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "prompt" in value) {
    return value as DiffusatoryComposition;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // 1. Direct JSON (or double-encoded JSON string from infotext)
  try {
    let candidate: unknown = JSON.parse(trimmed);
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        // Keep candidate as string
      }
    }
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "prompt" in candidate &&
      typeof (candidate as Record<string, unknown>).prompt === "string"
    ) {
      return candidate as DiffusatoryComposition;
    }
  } catch {
    // Not raw JSON directly
  }

  // 2. Base64 encoded JSON
  try {
    const decoded = atob(trimmed);
    let candidate: unknown = JSON.parse(decoded);
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        // Keep candidate as string
      }
    }
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "prompt" in candidate &&
      typeof (candidate as Record<string, unknown>).prompt === "string"
    ) {
      return candidate as DiffusatoryComposition;
    }
  } catch {
    // Not base64
  }

  return null;
}

function hasOwn(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stringValue(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  if (typeof candidate === "string") return candidate;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }
  return null;
}

function numericValue(
  value: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number | null {
  const parsed = Number(value[key]);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function modelKey(value: string): string {
  return value
    .replace(/\s*\[[^\]]+\]\s*$/, "")
    .split(/[\\/]/)
    .at(-1)!
    .replace(/\.(safetensors|ckpt)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findCheckpoint(
  catalog: ForgeCatalog,
  parameters: Record<string, unknown>,
): ForgeCatalog["checkpoints"][number] | null {
  const model = stringValue(parameters, "Model");
  const hash = stringValue(parameters, "Model hash")?.toLowerCase();
  if (hash) {
    const byHash = catalog.checkpoints.find((checkpoint) => {
      const candidates = [checkpoint.hash, checkpoint.sha256]
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => candidate.toLowerCase());
      return candidates.some(
        (candidate) => candidate === hash || candidate.startsWith(hash),
      );
    });
    if (byHash) return byHash;
  }
  if (!model) return null;
  const requested = modelKey(model);
  return (
    catalog.checkpoints.find(
      (checkpoint) =>
        modelKey(checkpoint.title) === requested ||
        modelKey(checkpoint.model_name) === requested,
    ) ?? null
  );
}

function optionName(
  requested: string,
  options: Array<{ name: string; label?: string }>,
): string | null {
  const normalized = requested.toLowerCase();
  return (
    options.find(
      (option) =>
        option.name.toLowerCase() === normalized ||
        option.label?.toLowerCase() === normalized,
    )?.name ?? null
  );
}

function styleArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return null;
}

/**
 * Apply only settings which Forge positively recovered from image metadata.
 * Pixels without a generation record remain useful editor sources, but they
 * never get a guessed recipe.
 */
export function importImageMetadata(
  current: GenerationDraft,
  catalog: ForgeCatalog | null,
  metadata: ImageMetadataResponse,
  savedModelDefaults: SavedModelDefaults = {},
): ImageMetadataImport {
  const parameters = metadata.parameters ?? {};
  const hasGenerationMetadata = Boolean(metadata.info.trim());
  if (!hasGenerationMetadata) {
    return {
      draft: current,
      editSettings: {},
      imported: [],
      warnings: [],
      hasGenerationMetadata: false,
    };
  }

  const imported: string[] = [];
  const warnings: string[] = [];
  let draft = { ...current };
  const checkpointReference =
    stringValue(parameters, "Model") ?? stringValue(parameters, "Model hash");
  if (catalog) {
    const checkpoint = findCheckpoint(catalog, parameters);
    if (checkpoint) {
      draft = applyCheckpointProfile(
        draft,
        catalog,
        checkpoint.title,
        savedModelDefaults[checkpointPreferenceKey(checkpoint.title)],
      );
      imported.push("checkpoint");
    } else if (checkpointReference) {
      warnings.push(`Checkpoint ${checkpointReference} is not installed here.`);
    }
  } else if (checkpointReference) {
    warnings.push("The model catalog was unavailable, so the checkpoint was not changed.");
  }

  const compositionRaw =
    parameters["Diffusatory composition"] ??
    parameters["diffusatory_composition"];
  const composition = parseDiffusatoryComposition(compositionRaw);

  let regions: RegionalComposition | undefined;
  if (composition) {
    draft.prompt = composition.prompt;
    imported.push("prompt");

    if (composition.negativePrompt !== undefined) {
      draft.negativePrompt = composition.negativePrompt;
      imported.push("negative prompt");
    }

    if (Array.isArray(composition.loras)) {
      draft.loras = composition.loras;
      imported.push("loras");
    }

    if (composition.regions && typeof composition.regions === "object") {
      regions = composition.regions as RegionalComposition;
      imported.push("regions");
    }
  } else {
    if (hasOwn(parameters, "Prompt")) {
      const prompt = stringValue(parameters, "Prompt");
      if (prompt !== null) {
        draft.prompt = prompt;
        imported.push("prompt");
      }
    }
    if (hasOwn(parameters, "Negative prompt")) {
      const negativePrompt = stringValue(parameters, "Negative prompt");
      if (negativePrompt !== null) {
        draft.negativePrompt = negativePrompt;
        imported.push("negative prompt");
      }
    }
  }

  const steps = numericValue(parameters, "Steps", 1, 1000);
  if (steps !== null) {
    draft.steps = Math.round(steps);
    imported.push("steps");
  }
  const cfgScale = numericValue(parameters, "CFG scale", 0, 100);
  if (cfgScale !== null) {
    draft.cfgScale = cfgScale;
    imported.push("CFG");
  }
  const distilledCfgScale = numericValue(
    parameters,
    "Distilled CFG Scale",
    0,
    100,
  );
  if (distilledCfgScale !== null) {
    draft.distilledCfgScale = distilledCfgScale;
    imported.push("guidance");
  }
  const seed = numericValue(parameters, "Seed", -1, 2 ** 53 - 1);
  if (seed !== null) {
    draft.seed = Math.round(seed);
    imported.push("seed");
  }
  const width = numericValue(parameters, "Size-1", 1, 16384);
  const height = numericValue(parameters, "Size-2", 1, 16384);
  if (width !== null && height !== null) {
    draft.width = Math.round(width);
    draft.height = Math.round(height);
    imported.push("frame");
  }
  const batchSize = numericValue(parameters, "Batch size", 1, 100);
  if (batchSize !== null) {
    draft.outputs = Math.min(8, Math.round(batchSize));
    imported.push("candidate count");
  }

  const sampler = stringValue(parameters, "Sampler");
  if (sampler) {
    const resolved = catalog
      ? optionName(sampler, catalog.samplers)
      : sampler;
    if (resolved) {
      draft.sampler = resolved;
      imported.push("sampler");
    } else {
      warnings.push(`Sampler ${sampler} is not available here.`);
    }
  }
  const scheduler = stringValue(parameters, "Schedule type");
  if (scheduler) {
    const resolved = catalog
      ? optionName(scheduler, catalog.schedulers)
      : scheduler;
    if (resolved) {
      draft.scheduler = resolved;
      imported.push("scheduler");
    } else {
      warnings.push(`Scheduler ${scheduler} is not available here.`);
    }
  }

  const styles = styleArray(parameters["Styles array"]);
  if (styles) {
    const knownStyles = catalog
      ? new Set(catalog.styles.map((style) => style.name))
      : null;
    const accepted = knownStyles
      ? styles.filter((style) => knownStyles.has(style))
      : styles;
    draft.styles = accepted;
    imported.push("styles");
    const missing = styles.filter((style) => !accepted.includes(style));
    if (missing.length) {
      warnings.push(`Unavailable styles were skipped: ${missing.join(", ")}.`);
    }
  }

  const editSettings: Partial<ImageEditSettings> = {};
  const denoisingStrength = numericValue(
    parameters,
    "Denoising strength",
    0,
    1,
  );
  if (denoisingStrength !== null) {
    editSettings.denoisingStrength = denoisingStrength;
    imported.push("denoise");
  }
  const maskBlur = numericValue(parameters, "Mask blur", 0, 256);
  if (maskBlur !== null) {
    editSettings.maskBlur = Math.round(maskBlur);
    imported.push("mask blur");
  }
  const padding = numericValue(parameters, "Masked area padding", 0, 2048);
  if (padding !== null && /Masked area padding\s*:/i.test(metadata.info)) {
    editSettings.inpaintPadding = Math.round(padding);
    imported.push("inpaint padding");
  }
  const inpaintArea = stringValue(parameters, "Inpaint area");
  if (inpaintArea && /Inpaint area\s*:/i.test(metadata.info)) {
    editSettings.inpaintOnlyMasked = /only masked/i.test(inpaintArea);
    imported.push("inpaint area");
  }
  return {
    draft,
    editSettings,
    ...(regions ? { regions } : {}),
    imported: [...new Set(imported)],
    warnings,
    hasGenerationMetadata,
  };
}
