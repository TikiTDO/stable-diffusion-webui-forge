import { describe, expect, it } from "vitest";

import {
  appendCandidates,
  candidatesFromGeneration,
  groupCandidateBatches,
} from "./candidates";
import { initialGenerationState, type GenerationState } from "./generation";

const completed: GenerationState = {
  ...initialGenerationState,
  phase: "completed",
  taskId: "run-1",
  kind: "txt2img",
  job: {
    kind: "txt2img",
    prompt: "one",
    additionalPrompts: 0,
    checkpoint: "model.safetensors",
    width: 1216,
    height: 832,
    outputs: 1,
    steps: 20,
    sampler: "Euler a",
    scheduler: "Karras",
  },
  results: [
    { image: "sheet", kind: "contact-sheet", prompt: null, negativePrompt: null, seed: null, infotext: null, spatialPlan: null },
    { image: "one", kind: "image", prompt: "one", negativePrompt: "", seed: 4, infotext: null, spatialPlan: null },
    { image: "map", kind: "auxiliary", prompt: null, negativePrompt: null, seed: null, infotext: null, spatialPlan: null },
  ],
};

describe("unaccepted candidates", () => {
  it("keeps only real image candidates and preserves their run provenance", () => {
    expect(candidatesFromGeneration(completed, 123)).toEqual([
      {
        id: "run-1:1",
        taskId: "run-1",
        resultIndex: 1,
        createdAt: 123,
        sourceKind: "txt2img",
        width: 1216,
        height: 832,
        result: completed.results[1],
      },
    ]);
  });

  it("does not duplicate a completed run when an effect is replayed", () => {
    const incoming = candidatesFromGeneration(completed, 123);
    expect(appendCandidates(incoming, incoming)).toEqual(incoming);
  });

  it("keeps candidates from one generation together", () => {
    const first = candidatesFromGeneration(completed, 123)[0];
    const second = {
      ...first,
      id: "run-1:2",
      resultIndex: 2,
      result: { ...first.result, image: "two" },
    };
    const later = {
      ...first,
      id: "run-2:0",
      taskId: "run-2",
      createdAt: 456,
      sourceKind: "img2img" as const,
      resultIndex: 0,
      result: { ...first.result, image: "later" },
    };

    expect(groupCandidateBatches([first, second, later])).toEqual([
      {
        taskId: "run-1",
        createdAt: 123,
        sourceKind: "txt2img",
        width: 1216,
        height: 832,
        candidates: [first, second],
      },
      {
        taskId: "run-2",
        createdAt: 456,
        sourceKind: "img2img",
        width: 1216,
        height: 832,
        candidates: [later],
      },
    ]);
  });
});
