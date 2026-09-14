import type { ForgeCatalog, Txt2ImgInput } from "../api/forge/types";
import { applyCheckpointProfile } from "./modelProfiles";
import type { ActiveLora } from "./loras";

export interface GenerationDraft {
  prompt: string;
  negativePrompt: string;
  checkpoint: string;
  modules: string[];
  styles: string[];
  loras: ActiveLora[];
  width: number;
  height: number;
  outputs: number;
  seed: number;
  sampler: string;
  scheduler: string;
  steps: number;
  cfgScale: number;
  distilledCfgScale: number;
  previewEvery: number;
}

export const starterDraft: GenerationDraft = {
  prompt: "an observatory at blue hour, warm lamps, patient instruments",
  negativePrompt: "",
  checkpoint: "",
  modules: [],
  styles: [],
  loras: [],
  width: 1024,
  height: 1024,
  outputs: 1,
  seed: -1,
  sampler: "Euler a",
  scheduler: "karras",
  steps: 20,
  cfgScale: 5,
  distilledCfgScale: 3.5,
  previewEvery: 5,
};

export function draftFromCatalog(
  draft: GenerationDraft,
  catalog: ForgeCatalog,
): GenerationDraft {
  const checkpoint =
    catalog.checkpoints.find(
      (candidate) => candidate.title === catalog.options.sd_model_checkpoint,
    )?.title ??
    catalog.checkpoints[0]?.title ??
    draft.checkpoint;
  const sampler =
    catalog.samplers.find((candidate) => candidate.name === draft.sampler)?.name ??
    catalog.samplers[0]?.name ??
    draft.sampler;
  const scheduler =
    catalog.schedulers.find(
      (candidate) =>
        candidate.name.toLowerCase() === draft.scheduler.toLowerCase() ||
        candidate.label.toLowerCase() === draft.scheduler.toLowerCase(),
    )?.name ??
    catalog.schedulers[0]?.name ??
    draft.scheduler;

  const catalogDraft = {
    ...draft,
    checkpoint,
    modules: catalog.options.forge_additional_modules ?? draft.modules,
    sampler,
    scheduler,
    previewEvery:
      catalog.options.show_progress_every_n_steps ?? draft.previewEvery,
  };
  return applyCheckpointProfile(catalogDraft, catalog, checkpoint);
}

export function requestFromDraft(draft: GenerationDraft): Txt2ImgInput {
  return {
    prompt: draft.prompt.trim(),
    negativePrompt: draft.negativePrompt.trim(),
    checkpoint: draft.checkpoint || undefined,
    modules: draft.modules,
    styles: draft.styles,
    width: draft.width,
    height: draft.height,
    outputs: draft.outputs,
    seed: draft.seed,
    sampler: draft.sampler,
    scheduler: draft.scheduler,
    steps: draft.steps,
    cfgScale: draft.cfgScale,
    distilledCfgScale: draft.distilledCfgScale,
    previewEvery: draft.previewEvery,
  };
}
