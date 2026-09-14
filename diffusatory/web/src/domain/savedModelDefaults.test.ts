import { describe, expect, it } from "vitest";

import { starterDraft } from "./draft";
import {
  checkpointPreferenceKey,
  parseSavedModelDefaults,
  savedDefaultFromDraft,
} from "./savedModelDefaults";

describe("saved model defaults", () => {
  it("uses a stable key when Forge adds a hash to the checkpoint title", () => {
    expect(
      checkpointPreferenceKey("models/storyModel.safetensors [abc123]"),
    ).toBe("storymodel");
  });

  it("captures render configuration without prompt, seed, frame, or outputs", () => {
    const saved = savedDefaultFromDraft({
      ...starterDraft,
      prompt: "private scene",
      seed: 42,
      width: 832,
      height: 1216,
      outputs: 6,
      steps: 33,
      previewEvery: 3,
    });

    expect(saved).toEqual({
      modules: [],
      sampler: "Euler a",
      scheduler: "karras",
      steps: 33,
      cfgScale: 5,
      distilledCfgScale: 3.5,
      previewEvery: 3,
    });
    expect(saved).not.toHaveProperty("prompt");
    expect(saved).not.toHaveProperty("seed");
    expect(saved).not.toHaveProperty("width");
    expect(saved).not.toHaveProperty("outputs");
  });

  it("drops malformed stored entries without losing valid defaults", () => {
    expect(
      parseSavedModelDefaults(
        JSON.stringify({
          valid: savedDefaultFromDraft(starterDraft),
          broken: { steps: "many" },
        }),
      ),
    ).toEqual({ valid: savedDefaultFromDraft(starterDraft) });
    expect(parseSavedModelDefaults("not json")).toEqual({});
  });
});
