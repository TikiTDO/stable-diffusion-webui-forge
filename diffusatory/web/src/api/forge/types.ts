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
  width?: number;
  height?: number;
  steps?: number;
  sampler?: string;
  scheduler?: string;
  cfgScale?: number;
  seed?: number;
  outputs?: number;
}

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
