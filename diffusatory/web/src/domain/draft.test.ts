import { describe, expect, it } from "vitest";

import type { ForgeCatalog } from "../api/forge/types";
import { draftFromCatalog, requestFromDraft, starterDraft } from "./draft";

const catalog: ForgeCatalog = {
  checkpoints: [
    { title: "first", model_name: "first", hash: null, sha256: null },
    { title: "selected", model_name: "selected", hash: null, sha256: null },
  ],
  modules: [],
  samplers: [{ name: "Euler a", aliases: [], options: {} }],
  schedulers: [{ name: "karras", label: "Karras", aliases: null }],
  styles: [],
  loras: [],
  embeddings: [],
  options: {
    sd_model_checkpoint: "selected",
    forge_additional_modules: ["/vae.safetensors"],
    show_progress_every_n_steps: 3,
  },
};

describe("generation draft", () => {
  it("adopts the current instance model settings", () => {
    expect(draftFromCatalog(starterDraft, catalog)).toMatchObject({
      checkpoint: "selected",
      modules: ["/vae.safetensors"],
      sampler: "Euler a",
      scheduler: "karras",
      previewEvery: 3,
    });
  });

  it("trims human text without hiding the selected render controls", () => {
    expect(
      requestFromDraft({
        ...starterDraft,
        prompt: "  scene  ",
        negativePrompt: "  noise  ",
        styles: ["Story"],
        outputs: 4,
      }),
    ).toMatchObject({
      prompt: "scene",
      negativePrompt: "noise",
      styles: ["Story"],
      outputs: 4,
      width: 1024,
      height: 1024,
    });
  });
});
