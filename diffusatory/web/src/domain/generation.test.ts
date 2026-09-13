import { describe, expect, it } from "vitest";

import {
  generationReducer,
  initialGenerationState,
  isGenerating,
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
