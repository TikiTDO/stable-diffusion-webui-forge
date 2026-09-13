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

export interface GenerationState {
  phase: GenerationPhase;
  taskId: string | null;
  progress: number;
  eta: number | null;
  preview: string | null;
  previewId: number;
  images: string[];
  parameters: Record<string, unknown> | null;
  info: string | null;
  text: string;
  error: string | null;
}

export const initialGenerationState: GenerationState = {
  phase: "idle",
  taskId: null,
  progress: 0,
  eta: null,
  preview: null,
  previewId: -1,
  images: [],
  parameters: null,
  info: null,
  text: "Ready for a prompt.",
  error: null,
};

export type GenerationAction =
  | { type: "started"; taskId: string }
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

export function generationReducer(
  state: GenerationState,
  action: GenerationAction,
): GenerationState {
  switch (action.type) {
    case "started":
      return {
        ...initialGenerationState,
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
      return {
        ...state,
        phase: "completed",
        progress: 1,
        eta: null,
        images: (action.value.images ?? []).map(imageSource),
        parameters: action.value.parameters,
        info: action.value.info,
        text: action.value.images?.length
          ? "Forge returned the completed image."
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
