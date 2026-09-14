import type { GenerationDraft } from "./draft";

const STORAGE_KEY = "diffusatory:model-defaults:v1";

export interface SavedModelDefault {
  modules: string[];
  sampler: string;
  scheduler: string;
  steps: number;
  cfgScale: number;
  distilledCfgScale: number;
  previewEvery: number;
}

export type SavedModelDefaults = Record<string, SavedModelDefault>;

export function checkpointPreferenceKey(checkpoint: string): string {
  return (
    checkpoint
      .replace(/\s*\[[^\]]+\]\s*$/, "")
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.(safetensors|ckpt)$/i, "")
      .toLowerCase() ?? checkpoint.toLowerCase()
  );
}

export function savedDefaultFromDraft(
  draft: GenerationDraft,
): SavedModelDefault {
  return {
    modules: [...draft.modules],
    sampler: draft.sampler,
    scheduler: draft.scheduler,
    steps: draft.steps,
    cfgScale: draft.cfgScale,
    distilledCfgScale: draft.distilledCfgScale,
    previewEvery: draft.previewEvery,
  };
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function parseSavedDefault(value: unknown): SavedModelDefault | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const steps = finiteNumber(candidate.steps, 1, 1000);
  const cfgScale = finiteNumber(candidate.cfgScale, 0, 100);
  const distilledCfgScale = finiteNumber(candidate.distilledCfgScale, 0, 100);
  const previewEvery = finiteNumber(candidate.previewEvery, 1, 1000);
  if (
    !Array.isArray(candidate.modules) ||
    !candidate.modules.every((item) => typeof item === "string") ||
    typeof candidate.sampler !== "string" ||
    typeof candidate.scheduler !== "string" ||
    steps === null ||
    cfgScale === null ||
    distilledCfgScale === null ||
    previewEvery === null
  ) {
    return null;
  }
  return {
    modules: candidate.modules,
    sampler: candidate.sampler,
    scheduler: candidate.scheduler,
    steps,
    cfgScale,
    distilledCfgScale,
    previewEvery,
  };
}

export function parseSavedModelDefaults(serialized: string | null): SavedModelDefaults {
  if (!serialized) return {};
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([checkpoint, value]) => {
        const saved = parseSavedDefault(value);
        return saved ? [[checkpoint, saved]] : [];
      }),
    );
  } catch {
    return {};
  }
}

export function loadSavedModelDefaults(): SavedModelDefaults {
  try {
    return parseSavedModelDefaults(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

export function persistSavedModelDefaults(defaults: SavedModelDefaults): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
    return true;
  } catch {
    // Generation remains available when browser storage is disabled. The UI
    // reports persistence only after updating the same in-memory map.
    return false;
  }
}
