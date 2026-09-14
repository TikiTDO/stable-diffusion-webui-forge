import { describe, expect, it } from "vitest";

import type { ForgeCatalog } from "../api/forge/types";
import { starterDraft } from "./draft";
import {
  applyCheckpointProfile,
  missingRecommendedModules,
  modelReadinessIssue,
  profileForCheckpoint,
} from "./modelProfiles";

const catalog: ForgeCatalog = {
  checkpoints: [],
  modules: [
    { model_name: "clip_l.safetensors", filename: "/models/text_encoder/clip_l.safetensors" },
    { model_name: "t5xxl_fp8_e4m3fn.safetensors", filename: "/models/text_encoder/t5xxl_fp8_e4m3fn.safetensors" },
    { model_name: "diffusion_pytorch_model.safetensors", filename: "/models/VAE/diffusion_pytorch_model.safetensors" },
  ],
  samplers: [
    { name: "Euler a", aliases: [], options: {} },
    { name: "Euler", aliases: [], options: {} },
    { name: "DEIS", aliases: [], options: {} },
    { name: "DPM++ 2M", aliases: [], options: {} },
  ],
  schedulers: [
    { name: "karras", label: "Karras", aliases: null },
    { name: "simple", label: "Simple", aliases: null },
    { name: "beta", label: "Beta", aliases: null },
    { name: "sgm_uniform", label: "SGM Uniform", aliases: null },
  ],
  styles: [],
  loras: [],
  embeddings: [],
  modelProfiles: [],
  options: {},
};

describe("checkpoint profiles", () => {
  it("makes the component Flux four-step checkpoint a complete request", () => {
    const switched = applyCheckpointProfile(
      starterDraft,
      catalog,
      "fluxFusionV24StepsGGUFNF4_V2Fp8.safetensors",
    );

    expect(switched).toMatchObject({
      steps: 4,
      sampler: "Euler",
      scheduler: "simple",
      cfgScale: 1,
      distilledCfgScale: 3.5,
      modules: [
        "/models/text_encoder/clip_l.safetensors",
        "/models/text_encoder/t5xxl_fp8_e4m3fn.safetensors",
        "/models/VAE/diffusion_pytorch_model.safetensors",
      ],
    });
  });

  it("uses SDXL defaults and its integrated components", () => {
    const switched = applyCheckpointProfile(
      { ...starterDraft, steps: 4, cfgScale: 1, modules: ["old"] },
      catalog,
      "waiIllustriousSDXL_v170.safetensors",
    );

    expect(switched).toMatchObject({
      steps: 20,
      sampler: "Euler a",
      scheduler: "karras",
      cfgScale: 5,
      modules: [],
    });
  });

  it.each([
    ["c4pacitor_xV1_pruned_fp8.safetensors", 42, "DEIS", "beta", 3.5],
    [
      "redcraftHybridH3Krea2dual_reveal5SFWULTRA.safetensors",
      15,
      "DPM++ 2M",
      "sgm_uniform",
      3.5,
    ],
    ["ultrarealFineTune_v4_full_fp8.safetensors", 35, "DPM++ 2M", "beta", 3],
  ])(
    "applies the installed recipe for %s",
    (checkpoint, steps, sampler, scheduler, distilledCfgScale) => {
      const switched = applyCheckpointProfile(starterDraft, catalog, checkpoint);

      expect(switched).toMatchObject({
        checkpoint,
        steps,
        sampler,
        scheduler,
        cfgScale: 1,
        distilledCfgScale,
        modules: [
          "/models/text_encoder/clip_l.safetensors",
          "/models/text_encoder/t5xxl_fp8_e4m3fn.safetensors",
          "/models/VAE/diffusion_pytorch_model.safetensors",
        ],
      });
    },
  );

  it("does not invent settings for an unknown architecture", () => {
    const original = { ...starterDraft, steps: 17, modules: ["custom"] };
    expect(applyCheckpointProfile(original, catalog, "mystery.safetensors")).toEqual({
      ...original,
      checkpoint: "mystery.safetensors",
    });
    expect(profileForCheckpoint(catalog, "mystery.safetensors").family).toBe("unknown");
  });

  it("reports a component checkpoint whose required encoder was deselected", () => {
    const checkpoint = "fluxFusionV24StepsGGUFNF4_V2Fp8.safetensors";
    const profiled = applyCheckpointProfile(starterDraft, catalog, checkpoint);
    const profile = profileForCheckpoint(catalog, checkpoint);

    expect(missingRecommendedModules(profile, profiled.modules)).toEqual([]);
    const incomplete = {
      ...profiled,
      modules: profiled.modules.filter(
        (module) => !module.endsWith("clip_l.safetensors"),
      ),
    };
    expect(modelReadinessIssue(catalog, incomplete)).toContain("clip_l.safetensors");
  });

  it.each([
    ["flux", 20, "Euler", "simple", 1, 3.5],
    ["sdxl", 20, "Euler a", "karras", 5, 3.5],
  ] as const)(
    "uses the family recipe for an unlisted %s model",
    (family, steps, sampler, scheduler, cfgScale, distilledCfgScale) => {
      const checkpoint = `obscure-${family}-checkpoint.safetensors`;
      const familyCatalog: ForgeCatalog = {
        ...catalog,
        modelProfiles: [
          {
            checkpoint,
            family,
            component_mode: family === "flux" ? "external" : "integrated",
            speed_profile: "standard",
            recommended_modules: family === "flux"
              ? [
                  "clip_l.safetensors",
                  "t5xxl_fp8_e4m3fn.safetensors",
                  "diffusion_pytorch_model.safetensors",
                ]
              : [],
            defaults: {
              steps,
              sampler,
              scheduler,
              cfg_scale: cfgScale,
              distilled_cfg_scale: family === "flux" ? distilledCfgScale : null,
              preview_every: 5,
            },
          },
        ],
      };

      expect(applyCheckpointProfile(starterDraft, familyCatalog, checkpoint)).toMatchObject({
        steps,
        sampler,
        scheduler,
        cfgScale,
        distilledCfgScale,
      });
    },
  );

  it("lets a saved per-model recipe override the family recipe", () => {
    const switched = applyCheckpointProfile(
      starterDraft,
      catalog,
      "fluxFusionV24StepsGGUFNF4_V2Fp8.safetensors",
      {
        modules: ["clip_l.safetensors"],
        sampler: "DEIS",
        scheduler: "beta",
        steps: 12,
        cfgScale: 1.5,
        distilledCfgScale: 2.75,
        previewEvery: 2,
      },
    );

    expect(switched).toMatchObject({
      steps: 12,
      sampler: "DEIS",
      scheduler: "beta",
      cfgScale: 1.5,
      distilledCfgScale: 2.75,
      previewEvery: 2,
      modules: ["/models/text_encoder/clip_l.safetensors"],
    });
  });
});
