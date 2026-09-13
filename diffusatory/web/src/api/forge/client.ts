import type {
  InstanceDescriptor,
  ProgressResponse,
  Txt2ImgInput,
  Txt2ImgResponse,
} from "./types";

export type Fetcher = typeof fetch;

export class ForgeApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ForgeApiError";
    this.status = status;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const detail = body.detail ?? body.message ?? body.error;
    if (typeof detail === "string" && detail.trim()) {
      message = detail;
    }
  } catch {
    // Preserve the status when Forge returned a non-JSON error page.
  }
  throw new ForgeApiError(response.status, message);
}

export function createTaskId(randomId: string = crypto.randomUUID()): string {
  return `task(diffusatory-${randomId})`;
}

export function imageSource(encoded: string): string {
  if (
    encoded.startsWith("data:") ||
    encoded.startsWith("blob:") ||
    encoded.startsWith("http://") ||
    encoded.startsWith("https://")
  ) {
    return encoded;
  }
  const mime = encoded.startsWith("/9j/")
    ? "image/jpeg"
    : encoded.startsWith("UklGR")
      ? "image/webp"
      : "image/png";
  if (encoded.startsWith("/") && mime === "image/png") {
    return encoded;
  }
  return `data:${mime};base64,${encoded}`;
}

export class ForgeClient {
  constructor(
    private readonly baseUrl = "",
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {}

  async instance(signal?: AbortSignal): Promise<InstanceDescriptor> {
    const response = await this.fetcher(
      `${this.baseUrl}/diffusatory/api/v1/instance`,
      { signal },
    );
    return readJson<InstanceDescriptor>(response);
  }

  async txt2img(
    taskId: string,
    input: Txt2ImgInput,
    signal?: AbortSignal,
  ): Promise<Txt2ImgResponse> {
    const response = await this.fetcher(`${this.baseUrl}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        prompt: input.prompt,
        negative_prompt: input.negativePrompt ?? "",
        width: input.width ?? 1024,
        height: input.height ?? 1024,
        steps: input.steps ?? 20,
        sampler_name: input.sampler ?? "Euler a",
        scheduler: input.scheduler ?? "Karras",
        cfg_scale: input.cfgScale ?? 5,
        seed: input.seed ?? -1,
        batch_size: input.outputs ?? 1,
        n_iter: 1,
        force_task_id: taskId,
        send_images: true,
        save_images: true,
      }),
    });
    return readJson<Txt2ImgResponse>(response);
  }

  async progress(
    taskId: string,
    lastPreviewId: number,
    signal?: AbortSignal,
  ): Promise<ProgressResponse> {
    const response = await this.fetcher(`${this.baseUrl}/internal/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        id_task: taskId,
        id_live_preview: lastPreviewId,
        live_preview: true,
      }),
    });
    return readJson<ProgressResponse>(response);
  }

  async interrupt(signal?: AbortSignal): Promise<void> {
    const response = await this.fetcher(`${this.baseUrl}/sdapi/v1/interrupt`, {
      method: "POST",
      signal,
    });
    await readJson<Record<string, never>>(response);
  }

  async skip(signal?: AbortSignal): Promise<void> {
    const response = await this.fetcher(`${this.baseUrl}/sdapi/v1/skip`, {
      method: "POST",
      signal,
    });
    if (!response.ok) {
      await readJson<unknown>(response);
    }
  }
}
