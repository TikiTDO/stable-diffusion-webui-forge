import { describe, expect, it } from "vitest";

import { appendCandidates, candidatesFromGeneration } from "./candidates";
import { initialGenerationState, type GenerationState } from "./generation";

const completed: GenerationState = {
  ...initialGenerationState,
  phase: "completed",
  taskId: "run-1",
  kind: "txt2img",
  results: [
    { image: "sheet", kind: "contact-sheet", prompt: null, negativePrompt: null, seed: null, infotext: null },
    { image: "one", kind: "image", prompt: "one", negativePrompt: "", seed: 4, infotext: null },
    { image: "map", kind: "auxiliary", prompt: null, negativePrompt: null, seed: null, infotext: null },
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
        result: completed.results[1],
      },
    ]);
  });

  it("does not duplicate a completed run when an effect is replayed", () => {
    const incoming = candidatesFromGeneration(completed, 123);
    expect(appendCandidates(incoming, incoming)).toEqual(incoming);
  });
});
