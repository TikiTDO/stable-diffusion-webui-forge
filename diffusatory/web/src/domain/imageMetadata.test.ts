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

  it("restores structured prompt, negative prompt, loras, and regions from Diffusatory composition", () => {
    const composition = {
      version: 1,
      prompt: "clean authored prompt",
      negativePrompt: "clean negative prompt",
      loras: [
        {
          id: "lora-1",
          name: "Ink Style",
          reference: "ink",
          enabled: true,
          strength: 0.75,
          keywords: [{ text: "ink sketch", weight: 1.1, enabled: true }],
        },
      ],
      regions: {
        enabled: true,
        columns: [0.5, 0.5],
        rows: [1.0],
        transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0 },
        softness: 8,
        cellPrompts: [["left tower", "right sky"]],
        backgroundEnabled: true,
        backgroundPrompt: "distant hills",
      },
    };

    const imported = importImageMetadata(
      starterDraft,
      catalog,
      metadata({
        Prompt: "clean authored prompt, ink sketch, <lora:ink:0.75>",
        "Negative prompt": "clean negative prompt",
        "Diffusatory composition": JSON.stringify(composition),
        Steps: "20",
      }),
    );

    expect(imported.draft.prompt).toBe("clean authored prompt");
    expect(imported.draft.negativePrompt).toBe("clean negative prompt");
    expect(imported.draft.loras).toHaveLength(1);
    expect(imported.draft.loras[0].name).toBe("Ink Style");
    expect(imported.draft.loras[0].strength).toBe(0.75);
    expect(imported.regions).toBeDefined();
    expect(imported.regions?.backgroundPrompt).toBe("distant hills");
    expect(imported.imported).toContain("prompt");
    expect(imported.imported).toContain("negative prompt");
    expect(imported.imported).toContain("loras");
    expect(imported.imported).toContain("regions");
  });

  it("restores composition from base64-encoded Diffusatory composition", () => {
    const composition = {
      version: 1,
      prompt: "astronomer at dusk",
      loras: [],
    };
    const b64 = btoa(JSON.stringify(composition));

    const imported = importImageMetadata(
      starterDraft,
      catalog,
      metadata({
        Prompt: "astronomer at dusk",
        "Diffusatory composition": b64,
      }),
    );

    expect(imported.draft.prompt).toBe("astronomer at dusk");
    expect(imported.imported).toContain("prompt");
    expect(imported.imported).toContain("loras");
  });

  it("restores promptGroups from Diffusatory composition", () => {
    const composition = {
      version: 1,
      prompt: "portrait of ⟦g:hero_1⟧ in rain",
      promptGroups: [
        { id: "hero_1", label: "Hero", text: "cyberpunk detective", enabled: true },
      ],
    };

    const imported = importImageMetadata(
      starterDraft,
      catalog,
      metadata({
        Prompt: "portrait of cyberpunk detective in rain",
        "Diffusatory composition": JSON.stringify(composition),
      }),
    );

    expect(imported.draft.prompt).toBe("portrait of ⟦g:hero_1⟧ in rain");
    expect(imported.draft.promptGroups).toEqual([
      { id: "hero_1", label: "Hero", text: "cyberpunk detective", enabled: true },
    ]);
    expect(imported.imported).toContain("prompt groups");
  });
});

