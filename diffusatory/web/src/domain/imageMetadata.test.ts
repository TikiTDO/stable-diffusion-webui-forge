import { describe, expect, it } from "vitest";

import type { ForgeCatalog, ImageMetadataResponse } from "../api/forge/types";
import { starterDraft } from "./draft";
import { importImageMetadata } from "./imageMetadata";

const catalog: ForgeCatalog = {
  checkpoints: [
    {
      title: "waiIllustriousSDXL_v170.safetensors [f116b0c78f]",
      model_name: "waiIllustriousSDXL_v170",
      hash: "f116b0c78f",
      sha256: null,
    },
  ],
  modules: [],
  samplers: [{ name: "Euler a", aliases: [], options: {} }],
  schedulers: [{ name: "karras", label: "Karras", aliases: null }],
  styles: [
    { name: "Ink", prompt: "ink", negative_prompt: null },
  ],
  loras: [],
  embeddings: [],
  modelProfiles: [],
  options: {},
};

function metadata(
  parameters: Record<string, unknown>,
  info = "a moonlit tower\nSteps: 31, Sampler: Euler a, CFG scale: 6",
): ImageMetadataResponse {
  return { info, items: {}, parameters };
}

describe("generation metadata import", () => {
  it("restores a known generation recipe and matches a checkpoint by hash", () => {
    const imported = importImageMetadata(
      starterDraft,
      catalog,
      metadata({
        Prompt: "a moonlit tower",
        "Negative prompt": "daylight",
        Steps: "31",
        Sampler: "Euler a",
        "Schedule type": "Karras",
        "CFG scale": "6",
        Seed: "1234",
        "Size-1": "832",
        "Size-2": "1216",
        "Model hash": "f116b0c78f",
        "Styles array": ["Ink"],
      }),
    );

    expect(imported.draft).toMatchObject({
      prompt: "a moonlit tower",
      negativePrompt: "daylight",
      checkpoint: "waiIllustriousSDXL_v170.safetensors [f116b0c78f]",
      steps: 31,
      sampler: "Euler a",
      scheduler: "karras",
      cfgScale: 6,
      seed: 1234,
      width: 832,
      height: 1216,
      styles: ["Ink"],
    });
    expect(imported.imported).toContain("checkpoint");
    expect(imported.warnings).toEqual([]);
  });

  it("restores explicit inpaint controls but ignores parser-supplied defaults", () => {
    const imported = importImageMetadata(
      starterDraft,
      catalog,
      metadata(
        {
          Prompt: "repair the sleeve",
          "Denoising strength": "0.44",
          "Mask blur": "7",
          "Inpaint area": "Only masked",
          "Masked area padding": 48,
        },
        "repair the sleeve\nDenoising strength: 0.44, Mask blur: 7, Inpaint area: Only masked, Masked area padding: 48",
      ),
    );

    expect(imported.editSettings).toEqual({
      denoisingStrength: 0.44,
      maskBlur: 7,
      inpaintOnlyMasked: true,
      inpaintPadding: 48,
    });

    const ordinary = importImageMetadata(
      starterDraft,
      catalog,
      metadata(
        {
          Prompt: "variation",
          "Denoising strength": "0.5",
          "Inpaint area": "Whole picture",
          "Masked area padding": 32,
        },
        "variation\nDenoising strength: 0.5",
      ),
    );
    expect(ordinary.editSettings).toEqual({ denoisingStrength: 0.5 });
  });

  it("keeps the current recipe when the image has no generation metadata", () => {
    const imported = importImageMetadata(
      starterDraft,
      catalog,
      { info: "", items: {}, parameters: {} },
    );

    expect(imported.hasGenerationMetadata).toBe(false);
    expect(imported.draft).toBe(starterDraft);
    expect(imported.imported).toEqual([]);
  });

  it("does not invent unavailable models, samplers, or schedulers", () => {
    const imported = importImageMetadata(
      starterDraft,
      catalog,
      metadata({
        Prompt: "foreign recipe",
        Model: "not-installed",
        Sampler: "Imaginary sampler",
        "Schedule type": "Impossible",
      }),
    );

    expect(imported.draft.checkpoint).toBe(starterDraft.checkpoint);
    expect(imported.draft.sampler).toBe(starterDraft.sampler);
    expect(imported.draft.scheduler).toBe(starterDraft.scheduler);
    expect(imported.warnings).toHaveLength(3);
  });
});
