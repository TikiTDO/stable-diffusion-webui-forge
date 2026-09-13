export interface InstanceDescriptor {
  id: string;
  name: string;
  host: string;
  version: string;
  capabilities: string[];
}

export interface Txt2ImgInput {
  prompt: string;
  negativePrompt?: string;
  checkpoint?: string;
  modules?: string[];
  styles?: string[];
  width?: number;
  height?: number;
  steps?: number;
  sampler?: string;
  scheduler?: string;
  cfgScale?: number;
  seed?: number;
  outputs?: number;
  previewEvery?: number;
  controlNet?: ControlNetUnitInput[];
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
  name: string;
  alias: string;
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
