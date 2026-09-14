import type { ResolvedSpatialPlan } from "../../features/regions/types";

export interface InstanceDescriptor {
  id: string;
  name: string;
  host: string;
  version: string;
  capabilities: string[];
}

export type ServerActivityPhase =
  | "idle"
  | "queued"
  | "preparing"
  | "loading-model"
  | "rendering"
  | "saving";

export interface ServerActivity {
  phase: ServerActivityPhase;
  busy: boolean;
  task_id: string | null;
  queue_size: number;
  progress: number | null;
  sampling_step: number;
  sampling_steps: number;
  job_index: number;
  job_count: number;
  operation: "txt2img" | "img2img" | null;
  checkpoint: string | null;
  detail: string | null;
}

export interface Txt2ImgInput {
  prompt: string | string[];
  negativePrompt?: string | string[];
  checkpoint?: string;
  modules?: string[];
  styles?: string[];
  width?: number;
  height?: number;
  steps?: number;
  sampler?: string;
  scheduler?: string;
  cfgScale?: number;
  distilledCfgScale?: number;
  seed?: number;
  outputs?: number;
  previewEvery?: number;
  controlNet?: ControlNetUnitInput[];
  spatialPlan?: ResolvedSpatialPlan;
}

export interface Img2ImgInput extends Txt2ImgInput {
  /** The exact composited source visibly shown in the editor. */
  initImage: string;
  /** White selects the region to regenerate. Omit for ordinary img2img. */
  mask?: string;
  denoisingStrength?: number;
  maskBlur?: number;
  inpaintOnlyMasked?: boolean;
  inpaintPadding?: number;
}

export type ForgeGenerationInput =
  | { kind: "txt2img"; input: Txt2ImgInput }
  | { kind: "img2img"; input: Img2ImgInput };

export interface Txt2ImgResponse {
  images: string[] | null;
  parameters: Record<string, unknown>;
  info: string;
}

export interface ImageMetadataResponse {
  /** The original Forge/A1111 generation infotext, empty when none was found. */
  info: string;
  /** Additional image metadata fields which are not the generation recipe. */
  items: Record<string, unknown>;
  /** Forge's parsed prompt and generation fields. */
  parameters: Record<string, unknown>;
}

export type PromptExpansionMode = "off" | "random" | "exhaustive";

export interface PromptExpansionInput {
  prompt: string;
  negativePrompt: string;
  mode: PromptExpansionMode;
  candidateCount: number;
  expansionSeed: number;
}

export interface PromptExpansionIssue {
  code: string;
  message: string;
  field: "prompt" | "negative_prompt";
  blocking: boolean;
}

export interface PromptRealization {
  index: number;
  prompt: string;
  negative_prompt: string;
}

export interface PromptExpansionResponse {
  mode: PromptExpansionMode;
  source_prompt: string;
  source_negative_prompt: string;
  requested_count: number;
  resolved_count: number;
  expansion_seed: number;
  engine: string;
  realizations: PromptRealization[];
  issues: PromptExpansionIssue[];
  truncated: boolean;
}

export interface ProgressResponse {
  active: boolean;
  queued: boolean;
  completed: boolean;
  progress: number | null;
  eta: number | null;
  live_preview: string | null;
  id_live_preview: number | null;
  textinfo: string | null;
}

export interface Checkpoint {
  title: string;
  model_name: string;
  hash: string | null;
  sha256: string | null;
  filename?: string;
}

export type ModelFamily = "flux" | "sdxl" | "unknown";

export interface ModelProfile {
  checkpoint: string;
  family: ModelFamily;
  component_mode: "integrated" | "external" | "unknown";
  speed_profile: "four-step" | "standard";
  recommended_modules: string[];
  defaults: {
    steps: number;
    sampler: string;
    scheduler: string;
    cfg_scale: number;
    distilled_cfg_scale: number | null;
    preview_every: number;
  };
}

export interface ModelModule {
  model_name: string;
  filename: string;
}

export interface Sampler {
  name: string;
  aliases: string[];
  options: Record<string, unknown>;
}

export interface Scheduler {
  name: string;
  label: string;
  aliases: string[] | null;
}

export interface PromptStyle {
  name: string;
  prompt: string | null;
  negative_prompt: string | null;
}

export interface Lora {
  id: string;
  name: string;
  alias: string;
  reference: string;
  relative_path: string;
  folders: string[];
  modified_at: number;
  size_bytes: number;
  model_family: "sdxl" | "flux" | "unknown";
  base_model: string | null;
  preview_url: string | null;
  description: string;
  tags: string[];
  recommended_keywords: string[];
  defaults: LoraDefaults;
}

export interface LoraKeywordDefault {
  text: string;
  weight: number;
  enabled: boolean;
}

export interface LoraDefaults {
  description: string;
  model_family: "sdxl" | "flux" | "unknown";
  preferred_strength: number;
  keywords: LoraKeywordDefault[];
  notes: string;
}

export interface EmbeddingInventory {
  loaded: Record<string, unknown>;
  skipped: Record<string, unknown>;
}

export interface ForgeOptions {
  sd_model_checkpoint?: string;
  forge_additional_modules?: string[];
  show_progress_every_n_steps?: number;
}

export interface ForgeCatalog {
  checkpoints: Checkpoint[];
  modules: ModelModule[];
  samplers: Sampler[];
  schedulers: Scheduler[];
  styles: PromptStyle[];
  loras: Lora[];
  embeddings: string[];
  modelProfiles: ModelProfile[];
  options: ForgeOptions;
}

export interface ControlNetTypeWire {
  module_list: string[];
  model_list: string[];
  default_option: string;
  default_model: string;
}

export interface ControlNetTypesResponse {
  control_types: Record<string, ControlNetTypeWire>;
}

export interface ControlNetCatalog {
  types: Record<
    string,
    {
      modules: string[];
      models: string[];
      defaultModule: string;
      defaultModel: string;
    }
  >;
}

export interface ControlNetDetectInput {
  module: string;
  image: string;
  processorResolution?: number;
  thresholdA?: number;
  thresholdB?: number;
}

export interface ControlNetDetectResponse {
  images: string[];
  info: string;
  poses?: unknown[];
}

/** A resolved ControlNet unit. Source selection remains a UI concern. */
export interface ControlNetUnitInput {
  module: string;
  model: string;
  image: string;
  weight?: number;
  resizeMode?: "Just Resize" | "Crop and Resize" | "Resize and Fill";
  processorResolution?: number;
  thresholdA?: number;
  thresholdB?: number;
  guidanceStart?: number;
  guidanceEnd?: number;
  pixelPerfect?: boolean;
  controlMode?:
    | "Balanced"
    | "My prompt is more important"
    | "ControlNet is more important";
  saveDetectedMap?: boolean;
}
