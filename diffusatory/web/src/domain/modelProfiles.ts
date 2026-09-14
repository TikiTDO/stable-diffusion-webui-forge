import type {
  ForgeCatalog,
  ModelProfile,
  ModelModule,
} from "../api/forge/types";
import type { GenerationDraft } from "./draft";
import type { SavedModelDefault } from "./savedModelDefaults";

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fluxDefaults(name: string, fourStep: boolean): ModelProfile["defaults"] {
  if (name.includes("c4pacitorxv1")) {
    return {
      steps: 42,
      sampler: "DEIS",
      scheduler: "Beta",
      cfg_scale: 1,
      distilled_cfg_scale: 3.5,
      preview_every: 5,
    };
  }
  if (name.includes("redcrafthybridh3krea2dualreveal5sfwultra")) {
    return {
      steps: 15,
      sampler: "DPM++ 2M",
      scheduler: "SGM Uniform",
      cfg_scale: 1,
      distilled_cfg_scale: 3.5,
      preview_every: 3,
    };
  }
  if (name.includes("ultrarealfinetunev4")) {
    return {
      steps: 35,
      sampler: "DPM++ 2M",
      scheduler: "Beta",
      cfg_scale: 1,
      distilled_cfg_scale: 3,
      preview_every: 5,
    };
  }
  return {
    steps: fourStep ? 4 : 20,
    sampler: "Euler",
    scheduler: "Simple",
    cfg_scale: 1,
    distilled_cfg_scale: 3.5,
    preview_every: fourStep ? 1 : 5,
  };
}

function fallbackProfile(checkpoint: string): ModelProfile {
  const name = compact(checkpoint);
  const knownFlux =
    name.includes("c4pacitorxv1") ||
    name.includes("redcrafthybridh3krea2dualreveal5sfwultra") ||
    name.includes("ultrarealfinetunev4");
  const family = name.includes("flux") || name.includes("schnell") || knownFlux
    ? "flux"
    : name.includes("sdxl") || name.includes("illustrious") || name.includes("pony")
      ? "sdxl"
      : "unknown";
  const fourStep = name.includes("4steps") || name.includes("foursteps") || name.includes("schnell");
  const integratedFlux = family === "flux" && (name.includes("aio") || name.includes("allinone"));

  if (family === "flux") {
    return {
      checkpoint,
      family,
      component_mode: integratedFlux ? "integrated" : "external",
      speed_profile: fourStep ? "four-step" : "standard",
      recommended_modules: integratedFlux
        ? []
        : [
            "clip_l.safetensors",
            "t5xxl_fp8_e4m3fn.safetensors",
            "diffusion_pytorch_model.safetensors",
          ],
      defaults: fluxDefaults(name, fourStep),
    };
  }

  return {
    checkpoint,
    family,
    component_mode: family === "sdxl" ? "integrated" : "unknown",
    speed_profile: "standard",
    recommended_modules: [],
    defaults: {
      steps: 20,
      sampler: "Euler a",
      scheduler: "Karras",
      cfg_scale: 5,
      distilled_cfg_scale: null,
      preview_every: 5,
    },
  };
}

export function profileForCheckpoint(
  catalog: ForgeCatalog,
  checkpoint: string,
): ModelProfile {
  return (
    catalog.modelProfiles.find((profile) => profile.checkpoint === checkpoint) ??
    fallbackProfile(checkpoint)
  );
}

function selectNamed<T extends { name: string }>(
  options: T[],
  requested: string,
  fallback: string,
): string {
  const normalized = requested.toLowerCase();
  return (
    options.find((option) => option.name.toLowerCase() === normalized)?.name ??
    options.find((option) => option.name.toLowerCase() === fallback.toLowerCase())?.name ??
    options[0]?.name ??
    requested
  );
}

function selectScheduler(
  catalog: ForgeCatalog,
  requested: string,
  fallback?: string,
): string {
  const normalized = requested.toLowerCase();
  return (
    catalog.schedulers.find(
      (scheduler) =>
        scheduler.name.toLowerCase() === normalized ||
        scheduler.label.toLowerCase() === normalized,
    )?.name ??
    (fallback
      ? catalog.schedulers.find(
          (scheduler) =>
            scheduler.name.toLowerCase() === fallback.toLowerCase() ||
            scheduler.label.toLowerCase() === fallback.toLowerCase(),
        )?.name
      : undefined) ??
    catalog.schedulers[0]?.name ??
    requested
  );
}

function moduleBasename(modelModule: ModelModule): string {
  return modelModule.filename.split(/[\\/]/).at(-1) ?? modelModule.filename;
}

function selectedModuleNames(modules: string[]): Set<string> {
  return new Set(
    modules.flatMap((module) => [module, module.split(/[\\/]/).at(-1) ?? module]),
  );
}

export function recommendedModules(
  catalog: ForgeCatalog,
  profile: ModelProfile,
): string[] {
  return profile.recommended_modules.flatMap((required) => {
    const found = catalog.modules.find(
      (candidate) =>
        candidate.model_name === required || moduleBasename(candidate) === required,
    );
    return found ? [found.filename] : [];
  });
}

export function missingRecommendedModules(
  profile: ModelProfile,
  selectedModules: string[],
): string[] {
  if (profile.component_mode !== "external") return [];
  const selected = selectedModuleNames(selectedModules);
  return profile.recommended_modules.filter((required) => !selected.has(required));
}

export function modelReadinessIssue(
  catalog: ForgeCatalog,
  draft: GenerationDraft,
): string | null {
  const profile = profileForCheckpoint(catalog, draft.checkpoint);
  const missing = missingRecommendedModules(profile, draft.modules);
  if (!missing.length) return null;
  return `This ${profile.family.toUpperCase()} checkpoint still needs ${missing.join(
    ", ",
  )}. Select the required components before generating.`;
}

export function applyCheckpointProfile(
  draft: GenerationDraft,
  catalog: ForgeCatalog,
  checkpoint: string,
  savedDefault?: SavedModelDefault,
): GenerationDraft {
  const profile = profileForCheckpoint(catalog, checkpoint);
  const profiled =
    profile.family === "unknown"
      ? { ...draft, checkpoint }
      : {
          ...draft,
          checkpoint,
          modules: recommendedModules(catalog, profile),
          sampler: selectNamed(
            catalog.samplers,
            profile.defaults.sampler,
            draft.sampler,
          ),
          scheduler: selectScheduler(catalog, profile.defaults.scheduler),
          steps: profile.defaults.steps,
          cfgScale: profile.defaults.cfg_scale,
          distilledCfgScale: profile.defaults.distilled_cfg_scale ?? 3.5,
          previewEvery: profile.defaults.preview_every,
        };
  if (!savedDefault) return profiled;

  const modules = savedDefault.modules.flatMap((savedModule) => {
    const basename = savedModule.split(/[\\/]/).at(-1) ?? savedModule;
    const match = catalog.modules.find(
      (modelModule) =>
        modelModule.filename === savedModule ||
        modelModule.model_name === savedModule ||
        moduleBasename(modelModule) === basename,
    );
    return match ? [match.filename] : [];
  });
  return {
    ...profiled,
    modules,
    sampler: selectNamed(catalog.samplers, savedDefault.sampler, profiled.sampler),
    scheduler: selectScheduler(catalog, savedDefault.scheduler, profiled.scheduler),
    steps: savedDefault.steps,
    cfgScale: savedDefault.cfgScale,
    distilledCfgScale: savedDefault.distilledCfgScale,
    previewEvery: savedDefault.previewEvery,
  };
}
