import { imageSource } from "../api/forge/client";
import type { ProgressResponse, Txt2ImgResponse } from "../api/forge/types";

export type GenerationPhase =
  | "idle"
  | "submitting"
  | "queued"
  | "running"
  | "interrupt-requested"
  | "finishing"
  | "completed"
  | "failed";

export interface GenerationResult {
  image: string;
  kind: "image" | "contact-sheet" | "auxiliary";
  prompt: string | null;
  negativePrompt: string | null;
  seed: number | null;
  infotext: string | null;
}

export interface GenerationState {
  kind: "txt2img" | "img2img" | null;
  phase: GenerationPhase;
  taskId: string | null;
  progress: number;
  eta: number | null;
  preview: string | null;
  previewId: number;
  images: string[];
  results: GenerationResult[];
  parameters: Record<string, unknown> | null;
  info: string | null;
  text: string;
  error: string | null;
}

export const initialGenerationState: GenerationState = {
  kind: null,
  phase: "idle",
  taskId: null,
  progress: 0,
  eta: null,
  preview: null,
  previewId: -1,
  images: [],
  results: [],
  parameters: null,
  info: null,
  text: "Ready for a prompt.",
  error: null,
};

export type GenerationAction =
  | { type: "started"; taskId: string; kind: "txt2img" | "img2img" }
  | { type: "progress"; value: ProgressResponse }
  | { type: "interrupt-requested" }
  | { type: "control-failed"; error: string }
  | { type: "completed"; value: Txt2ImgResponse }
  | { type: "failed"; error: string }
  | { type: "reset" };

export function isGenerating(phase: GenerationPhase): boolean {
  return [
    "submitting",
    "queued",
    "running",
    "interrupt-requested",
    "finishing",
  ].includes(phase);
}

interface ProcessedInfo {
  all_prompts?: unknown;
  all_negative_prompts?: unknown;
  all_seeds?: unknown;
  index_of_first_image?: unknown;
  infotexts?: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number => typeof item === "number" && Number.isFinite(item),
      )
    : [];
}

export function resultsFromResponse(value: Txt2ImgResponse): GenerationResult[] {
  const images = (value.images ?? []).map(imageSource);
  let info: ProcessedInfo = {};
  let hasProcessedInfo = false;
  try {
    const parsed = JSON.parse(value.info) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      info = parsed as ProcessedInfo;
      hasProcessedInfo = true;
    }
  } catch {
    // A result remains usable even when an older Forge build omitted JSON info.
  }

  const prompts = stringArray(info.all_prompts);
  const negativePrompts = stringArray(info.all_negative_prompts);
  const seeds = numberArray(info.all_seeds);
  const infotexts = stringArray(info.infotexts);
  const firstImage =
    typeof info.index_of_first_image === "number" &&
    Number.isInteger(info.index_of_first_image) &&
    info.index_of_first_image >= 0 &&
    info.index_of_first_image <= images.length
      ? info.index_of_first_image
      : 0;

  return images.map((image, imageIndex) => {
    if (imageIndex < firstImage) {
      return {
        image,
        kind: "contact-sheet",
        prompt: null,
        negativePrompt: null,
        seed: null,
        infotext: infotexts[imageIndex] ?? null,
      };
    }
    const sampleIndex = imageIndex - firstImage;
    const kind =
      !hasProcessedInfo || sampleIndex < prompts.length ? "image" : "auxiliary";
    return {
      image,
      kind,
      prompt: prompts[sampleIndex] ?? null,
      negativePrompt: negativePrompts[sampleIndex] ?? null,
      seed: seeds[sampleIndex] ?? null,
      infotext: infotexts[imageIndex] ?? null,
    };
  });
}

export function generationReducer(
  state: GenerationState,
  action: GenerationAction,
): GenerationState {
  switch (action.type) {
    case "started":
      return {
        ...initialGenerationState,
        kind: action.kind,
        phase: "submitting",
        taskId: action.taskId,
        text: "Submitting to Forge…",
      };
    case "progress": {
      if (state.phase === "completed" || state.phase === "failed") return state;
      const value = action.value;
      const preview = value.live_preview
        ? imageSource(value.live_preview)
        : state.preview;
      const previewId = value.id_live_preview ?? state.previewId;
      const interrupted = state.phase === "interrupt-requested";
      let phase: GenerationPhase = state.phase;
      if (value.active) phase = "running";
      else if (value.queued) phase = "queued";
      else if (value.completed) phase = "finishing";
      if (interrupted && phase !== "finishing") phase = "interrupt-requested";
      return {
        ...state,
        phase,
        progress: value.progress ?? state.progress,
        eta: value.eta,
        preview,
        previewId,
        text:
          value.textinfo ??
          (value.queued
            ? "Waiting for the GPU…"
            : value.active
              ? "Sampling…"
              : state.text),
      };
    }
    case "interrupt-requested":
      if (state.phase === "completed" || state.phase === "failed") return state;
      return {
        ...state,
        phase: "interrupt-requested",
        text: "Interrupt requested; waiting for Forge to stop safely…",
      };
    case "control-failed":
      if (state.phase === "completed" || state.phase === "failed") return state;
      return {
        ...state,
        error: action.error,
      };
    case "completed":
      const results = resultsFromResponse(action.value);
      return {
        ...state,
        phase: "completed",
        progress: 1,
        eta: null,
        images: results.map((result) => result.image),
        results,
        parameters: action.value.parameters,
        info: action.value.info,
        text: action.value.images?.length
          ? `Forge returned ${action.value.images.length} completed ${
              action.value.images.length === 1 ? "image" : "images"
            }.`
          : "Forge completed without returning an image.",
        error: null,
      };
    case "failed":
      return {
        ...state,
        phase: "failed",
        eta: null,
        text: "Generation did not complete.",
        error: action.error,
      };
    case "reset":
      return initialGenerationState;
  }
}
