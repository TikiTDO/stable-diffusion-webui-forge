import { describe, expect, it } from "vitest";

import {
  generationReducer,
  initialGenerationState,
  isGenerating,
  resultsFromResponse,
  summarizeGeneration,
} from "./generation";

const activeProgress = {
  active: true,
  queued: false,
  completed: false,
  progress: 0.42,
  eta: 3,
  live_preview: "data:image/webp;base64,preview",
  id_live_preview: 2,
  textinfo: "Sampling",
};

describe("generationReducer", () => {
  it("keeps an interrupt request truthful while Forge is still active", () => {
    const started = generationReducer(initialGenerationState, {
      type: "started",
      taskId: "task(diffusatory-test)",
      kind: "txt2img",
    });
    const requested = generationReducer(started, {
      type: "interrupt-requested",
    });
    const stillActive = generationReducer(requested, {
      type: "progress",
      value: activeProgress,
    });

    expect(stillActive.phase).toBe("interrupt-requested");
    expect(stillActive.progress).toBe(0.42);
    expect(stillActive.preview).toBe("data:image/webp;base64,preview");
  });

  it("only declares completion when the generation response arrives", () => {
    const running = generationReducer(initialGenerationState, {
      type: "progress",
      value: activeProgress,
    });
    const completed = generationReducer(running, {
      type: "completed",
      value: { images: ["result"], parameters: {}, info: "metadata" },
    });

    expect(running.phase).toBe("running");
    expect(completed.phase).toBe("completed");
    expect(completed.images).toEqual(["data:image/png;base64,result"]);
    expect(completed.parameters).toEqual({});
    expect(completed.info).toBe("metadata");
  });

  it("does not let a late progress response overwrite completion", () => {
    const completed = generationReducer(initialGenerationState, {
      type: "completed",
      value: { images: ["result"], parameters: {}, info: "metadata" },
    });

    expect(
      generationReducer(completed, {
        type: "progress",
        value: activeProgress,
      }),
    ).toBe(completed);
  });

  it("keeps the render active when an interrupt request itself fails", () => {
    const running = generationReducer(initialGenerationState, {
      type: "progress",
      value: activeProgress,
    });
    const controlFailed = generationReducer(running, {
      type: "control-failed",
      error: "Interrupt request failed: connection lost",
    });

    expect(controlFailed.phase).toBe("running");
    expect(controlFailed.progress).toBe(0.42);
    expect(controlFailed.error).toBe(
      "Interrupt request failed: connection lost",
    );
  });

  it("ignores a late interrupt acknowledgement after completion", () => {
    const completed = generationReducer(initialGenerationState, {
      type: "completed",
      value: { images: ["result"], parameters: {}, info: "metadata" },
    });

    expect(
      generationReducer(completed, { type: "interrupt-requested" }),
    ).toBe(completed);
    expect(
      generationReducer(completed, {
        type: "control-failed",
        error: "late control failure",
      }),
    ).toBe(completed);
  });
});

describe("isGenerating", () => {
  it("separates active and terminal phases", () => {
    expect(isGenerating("submitting")).toBe(true);
    expect(isGenerating("finishing")).toBe(true);
    expect(isGenerating("completed")).toBe(false);
    expect(isGenerating("failed")).toBe(false);
  });
});

describe("summarizeGeneration", () => {
  it("freezes the useful job description shown while Forge is busy", () => {
    expect(
      summarizeGeneration({
        kind: "txt2img",
        input: {
          prompt: ["first scene", "second scene"],
          checkpoint: "flux-four-step.safetensors",
          width: 1216,
          height: 832,
          outputs: 2,
          steps: 4,
          sampler: "Euler",
          scheduler: "simple",
        },
      }),
    ).toEqual({
      kind: "txt2img",
      prompt: "first scene",
      additionalPrompts: 1,
      checkpoint: "flux-four-step.safetensors",
      width: 1216,
      height: 832,
      outputs: 2,
      steps: 4,
      sampler: "Euler",
      scheduler: "simple",
    });
  });
});

describe("resultsFromResponse", () => {
  it("associates non-grid images with Forge's actual resolved prompts", () => {
    const results = resultsFromResponse({
      images: ["grid", "one", "two"],
      parameters: {},
      info: JSON.stringify({
        all_prompts: ["red dawn", "blue dusk"],
        all_negative_prompts: ["rain", "fog"],
        all_seeds: [10, 11],
        index_of_first_image: 1,
        infotexts: ["grid info", "one info", "two info"],
      }),
    });

    expect(results).toEqual([
      {
        image: "data:image/png;base64,grid",
        kind: "contact-sheet",
        prompt: null,
        negativePrompt: null,
        seed: null,
        infotext: "grid info",
        spatialPlan: null,
      },
      {
        image: "data:image/png;base64,one",
        kind: "image",
        prompt: "red dawn",
        negativePrompt: "rain",
        seed: 10,
        infotext: "one info",
        spatialPlan: null,
      },
      {
        image: "data:image/png;base64,two",
        kind: "image",
        prompt: "blue dusk",
        negativePrompt: "fog",
        seed: 11,
        infotext: "two info",
        spatialPlan: null,
      },
    ]);
  });

  it("does not invent provenance when Forge info is unavailable", () => {
    expect(
      resultsFromResponse({ images: ["one"], parameters: {}, info: "legacy" }),
    ).toEqual([
      {
        image: "data:image/png;base64,one",
        kind: "image",
        prompt: null,
        negativePrompt: null,
        seed: null,
        infotext: null,
        spatialPlan: null,
      },
    ]);
  });

  it("normalizes spatial provenance returned with every candidate", () => {
    const [result] = resultsFromResponse({
      images: ["one"],
      parameters: {
        diffusatory_spatial_plan: {
          version: 1,
          frame: { width: 1024, height: 1024 },
          transform: {
            center_x: 0.5,
            center_y: 0.5,
            width: 0.75,
            height: 0.75,
            rotation: 4,
          },
          softness_pixels: 20,
          cells: [
            {
              id: "r1c1",
              row: 0,
              column: 0,
              prompt: "red coat",
              polygon: [
                { x: 0, y: 0 },
                { x: 512, y: 0 },
                { x: 512, y: 1024 },
                { x: 0, y: 1024 },
              ],
            },
          ],
          background: { enabled: false, prompt: "" },
        },
      },
      info: "legacy",
    });

    expect(result.spatialPlan).toMatchObject({
      version: 1,
      softnessPixels: 20,
      transform: { centerX: 0.5, centerY: 0.5, rotation: 4 },
      cells: [{ id: "r1c1", prompt: "red coat" }],
    });
  });

  it("labels returned extras rather than assigning another image's prompt", () => {
    const results = resultsFromResponse({
      images: ["one", "control-map"],
      parameters: {},
      info: JSON.stringify({
        all_prompts: ["one prompt"],
        all_negative_prompts: [""],
        all_seeds: [5],
        index_of_first_image: 0,
        infotexts: ["one info"],
      }),
    });

    expect(results[1]?.kind).toBe("auxiliary");
    expect(results[1]?.prompt).toBeNull();
  });
});
