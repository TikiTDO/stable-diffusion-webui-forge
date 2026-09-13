import { describe, expect, it } from "vitest";

import {
  createTaskId,
  ForgeApiError,
  ForgeClient,
  imageSource,
} from "./client";

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("ForgeClient", () => {
  it("maps a Diffusatory draft onto the existing txt2img contract", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, request) => {
      calls.push([input, request]);
      return json({ images: ["abc"], parameters: {}, info: "{}" });
    };
    const client = new ForgeClient("", fetcher);

    await client.txt2img("task(diffusatory-test)", {
      prompt: "moonlit observatory",
      negativePrompt: "daylight",
      checkpoint: "story-xl.safetensors [abc123]",
      modules: ["/models/vae/story.safetensors"],
      styles: ["Cinematic"],
      previewEvery: 5,
    });

    expect(calls).toHaveLength(1);
    const [url, request] = calls[0];
    expect(url).toBe("/sdapi/v1/txt2img");
    expect(JSON.parse(request?.body as string)).toMatchObject({
      prompt: "moonlit observatory",
      negative_prompt: "daylight",
      styles: ["Cinematic"],
      width: 1024,
      height: 1024,
      steps: 20,
      sampler_name: "Euler a",
      scheduler: "Karras",
      cfg_scale: 5,
      batch_size: 1,
      n_iter: 1,
      force_task_id: "task(diffusatory-test)",
      override_settings: {
        sd_model_checkpoint: "story-xl.safetensors [abc123]",
        forge_additional_modules: ["/models/vae/story.safetensors"],
        show_progress_every_n_steps: 5,
      },
      override_settings_restore_afterwards: false,
    });
  });

  it("loads and normalizes the current Forge catalog", async () => {
    const responses: Record<string, unknown> = {
      "/sdapi/v1/sd-models": [
        { title: "model", model_name: "model", hash: null, sha256: null },
      ],
      "/sdapi/v1/sd-modules": [],
      "/sdapi/v1/samplers": [],
      "/sdapi/v1/schedulers": [],
      "/sdapi/v1/prompt-styles": [
        { name: "divider", prompt: null, negative_prompt: null },
        { name: "useful", prompt: "cinematic", negative_prompt: null },
      ],
      "/sdapi/v1/loras": [],
      "/sdapi/v1/embeddings": {
        loaded: { zebra: {}, amber: {} },
        skipped: {},
      },
      "/sdapi/v1/options": { sd_model_checkpoint: "model" },
    };
    const fetcher: typeof fetch = async (input) => {
      const path = String(input);
      return json(responses[path]);
    };
    const client = new ForgeClient("", fetcher);

    const catalog = await client.catalog();

    expect(catalog.checkpoints[0]?.title).toBe("model");
    expect(catalog.styles.map((style) => style.name)).toEqual(["useful"]);
    expect(catalog.embeddings).toEqual(["amber", "zebra"]);
  });

  it("polls the task-aware progress route with the preview revision", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, request) => {
      calls.push([input, request]);
      return json({
        active: true,
        queued: false,
        completed: false,
        progress: 0.5,
        eta: 2,
        live_preview: null,
        id_live_preview: 7,
        textinfo: "Sampling",
      });
    };
    const client = new ForgeClient("", fetcher);

    await client.progress("task(diffusatory-test)", 6);

    const [url, request] = calls[0];
    expect(url).toBe("/internal/progress");
    expect(JSON.parse(request?.body as string)).toEqual({
      id_task: "task(diffusatory-test)",
      id_live_preview: 6,
      live_preview: true,
    });
  });

  it("surfaces Forge's detail rather than an opaque HTTP failure", async () => {
    const fetcher: typeof fetch = async () =>
      json({ detail: "Checkpoint unavailable" }, { status: 422 });
    const client = new ForgeClient("", fetcher);

    await expect(
      client.txt2img("task(diffusatory-test)", { prompt: "x" }),
    ).rejects.toEqual(new ForgeApiError(422, "Checkpoint unavailable"));
  });
});

describe("wire helpers", () => {
  it("uses Forge's recognizable task-id shape", () => {
    expect(createTaskId("abc")).toBe("task(diffusatory-abc)");
  });

  it("does not double-wrap data URLs", () => {
    expect(imageSource("raw-base64")).toBe("data:image/png;base64,raw-base64");
    expect(imageSource("data:image/webp;base64,ready")).toBe(
      "data:image/webp;base64,ready",
    );
    expect(imageSource("/9j/jpeg")).toBe("data:image/jpeg;base64,/9j/jpeg");
    expect(imageSource("UklGRwebp")).toBe("data:image/webp;base64,UklGRwebp");
  });
});
