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
      distilledCfgScale: 3.5,
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
      distilled_cfg_scale: 3.5,
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

  it("asks the native compiler for an exact prompt realization set", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, request) => {
      calls.push([input, request]);
      return json({
        mode: "random",
        source_prompt: "{dawn|dusk}",
        source_negative_prompt: "",
        requested_count: 2,
        resolved_count: 2,
        expansion_seed: 41,
        engine: "dynamicprompts 0.31.0",
        realizations: [],
        issues: [],
        truncated: false,
      });
    };

    await new ForgeClient("", fetcher).expandPrompts({
      prompt: "{dawn|dusk}",
      negativePrompt: "",
      mode: "random",
      candidateCount: 2,
      expansionSeed: 41,
    });

    expect(calls[0]?.[0]).toBe("/diffusatory/api/v1/prompts/expand");
    expect(JSON.parse(calls[0]?.[1]?.body as string)).toEqual({
      prompt: "{dawn|dusk}",
      negative_prompt: "",
      mode: "random",
      candidate_count: 2,
      expansion_seed: 41,
    });
  });

  it("sends one resolved prompt per requested image", async () => {
    let body: Record<string, unknown> | null = null;
    const fetcher: typeof fetch = async (_input, request) => {
      body = JSON.parse(request?.body as string) as Record<string, unknown>;
      return json({ images: ["a", "b"], parameters: {}, info: "{}" });
    };

    await new ForgeClient("", fetcher).txt2img("task(diffusatory-set)", {
      prompt: ["dawn", "dusk"],
      negativePrompt: ["rain", "fog"],
    });

    expect(body).toMatchObject({
      prompt: ["dawn", "dusk"],
      negative_prompt: ["rain", "fog"],
      batch_size: 2,
      n_iter: 1,
    });
  });

  it("sends a resolved spatial plan through the native Forge request", async () => {
    let body: Record<string, unknown> | null = null;
    const fetcher: typeof fetch = async (_input, request) => {
      body = JSON.parse(request?.body as string) as Record<string, unknown>;
      return json({ images: ["a"], parameters: {}, info: "{}" });
    };

    await new ForgeClient("", fetcher).txt2img("task(diffusatory-regions)", {
      prompt: "two friends",
      spatialPlan: {
        version: 1,
        frame: { width: 1024, height: 1024 },
        transform: {
          centerX: 0.5,
          centerY: 0.5,
          width: 0.75,
          height: 0.75,
          rotation: 8,
        },
        softnessPixels: 24,
        cells: [
          {
            id: "r1c1",
            row: 0,
            column: 0,
            prompt: "red coat",
            polygon: [
              { x: 128, y: 128 },
              { x: 512, y: 128 },
              { x: 512, y: 896 },
              { x: 128, y: 896 },
            ],
          },
        ],
        background: { enabled: true, prompt: "train station" },
      },
    });

    expect(body).toMatchObject({
      diffusatory_spatial_plan: {
        version: 1,
        softnessPixels: 24,
        cells: [{ id: "r1c1", prompt: "red coat" }],
        background: { enabled: true, prompt: "train station" },
      },
    });
  });

  it("sends the visible editor source and mask through img2img", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, request) => {
      calls.push([input, request]);
      return json({ images: ["abc"], parameters: {}, info: "{}" });
    };
    const client = new ForgeClient("", fetcher);

    await client.img2img("task(diffusatory-edit)", {
      prompt: "repair the sleeve",
      initImage: "data:image/png;base64,source",
      mask: "data:image/png;base64,mask",
      denoisingStrength: 0.55,
      maskBlur: 6,
      inpaintOnlyMasked: false,
      inpaintPadding: 48,
      width: 832,
      height: 1216,
      outputs: 3,
      previewEvery: 3,
    });

    expect(calls).toHaveLength(1);
    const [url, request] = calls[0];
    expect(url).toBe("/sdapi/v1/img2img");
    expect(JSON.parse(request?.body as string)).toMatchObject({
      prompt: "repair the sleeve",
      init_images: ["data:image/png;base64,source"],
      mask: "data:image/png;base64,mask",
      denoising_strength: 0.55,
      mask_blur: 6,
      inpaint_full_res: false,
      inpaint_full_res_padding: 48,
      inpainting_fill: 1,
      width: 832,
      height: 1216,
      force_task_id: "task(diffusatory-edit)",
      include_init_images: false,
      batch_size: 3,
      override_settings: {
        show_progress_every_n_steps: 3,
        show_progress_grid: true,
      },
    });
  });

  it("translates conditions into the installed ControlNet always-on script", async () => {
    let body: Record<string, unknown> | null = null;
    const fetcher: typeof fetch = async (_input, request) => {
      body = JSON.parse(request?.body as string) as Record<string, unknown>;
      return json({ images: ["abc"], parameters: {}, info: "{}" });
    };

    await new ForgeClient("", fetcher).txt2img("task(diffusatory-control)", {
      prompt: "hold the pose",
      controlNet: [
        {
          module: "openpose_full",
          model: "pose-xl",
          image: "data:image/png;base64,pose",
          controlMode: "ControlNet is more important",
        },
      ],
    });

    expect(body).toMatchObject({
      alwayson_scripts: {
        controlnet: {
          args: [
            {
              enabled: true,
              module: "openpose_full",
              model: "pose-xl",
              image: "data:image/png;base64,pose",
              control_mode: "ControlNet is more important",
            },
          ],
        },
      },
    });
  });

  it("uses ordinary img2img when the editor has no inpaint mask", async () => {
    let body: Record<string, unknown> | null = null;
    const fetcher: typeof fetch = async (_input, request) => {
      body = JSON.parse(request?.body as string) as Record<string, unknown>;
      return json({ images: ["abc"], parameters: {}, info: "{}" });
    };

    await new ForgeClient("", fetcher).img2img("task(diffusatory-edit)", {
      prompt: "",
      initImage: "data:image/png;base64,source",
    });

    expect(body).not.toHaveProperty("mask");
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
      "/diffusatory/api/v1/loras": [],
      "/sdapi/v1/embeddings": {
        loaded: { zebra: {}, amber: {} },
        skipped: {},
      },
      "/sdapi/v1/options": { sd_model_checkpoint: "model" },
      "/diffusatory/api/v1/model-profiles": [],
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

  it("discovers ControlNet intent defaults from the active instance", async () => {
    const fetcher: typeof fetch = async () =>
      json({
        control_types: {
          Depth: {
            module_list: ["depth_midas"],
            model_list: ["depth-xl"],
            default_option: "depth_midas",
            default_model: "depth-xl",
          },
        },
      });

    await expect(new ForgeClient("", fetcher).controlNetCatalog()).resolves.toEqual({
      types: {
        Depth: {
          modules: ["depth_midas"],
          models: ["depth-xl"],
          defaultModule: "depth_midas",
          defaultModel: "depth-xl",
        },
      },
    });
  });

  it("preprocesses a condition and normalizes its preview image", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, request) => {
      calls.push([input, request]);
      return json({ images: ["preview"], info: "Success" });
    };

    const result = await new ForgeClient("", fetcher).detectControlNet({
      module: "lineart_standard",
      image: "data:image/png;base64,source",
      processorResolution: 768,
    });

    expect(result.images).toEqual(["data:image/png;base64,preview"]);
    expect(calls[0]?.[0]).toBe("/controlnet/detect");
    expect(JSON.parse(calls[0]?.[1]?.body as string)).toEqual({
      controlnet_module: "lineart_standard",
      controlnet_input_images: ["data:image/png;base64,source"],
      controlnet_processor_res: 768,
    });
  });

  it("asks Forge to read generation metadata from a dropped image", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, request) => {
      calls.push([input, request]);
      return json({
        info: "a lighthouse\nSteps: 20",
        items: {},
        parameters: { Prompt: "a lighthouse", Steps: "20" },
      });
    };

    const result = await new ForgeClient("", fetcher).imageMetadata(
      "data:image/png;base64,source",
    );

    expect(result.parameters.Prompt).toBe("a lighthouse");
    expect(calls[0]?.[0]).toBe("/sdapi/v1/png-info");
    expect(JSON.parse(calls[0]?.[1]?.body as string)).toEqual({
      image: "data:image/png;base64,source",
    });
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

  it("reads the server-wide render phase independently of the current browser", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, request) => {
      calls.push([input, request]);
      return json({
        phase: "loading-model",
        busy: true,
        task_id: "task(other-client)",
        queue_size: 1,
        progress: 0,
        sampling_step: 0,
        sampling_steps: 0,
        job_index: 0,
        job_count: 0,
        operation: "txt2img",
        checkpoint: "flux.safetensors",
        detail: "flux",
      });
    };

    const result = await new ForgeClient("", fetcher).activity();

    expect(result.phase).toBe("loading-model");
    expect(result.task_id).toBe("task(other-client)");
    expect(calls[0]?.[0]).toBe("/diffusatory/api/v1/status");
    expect(calls[0]?.[1]).toEqual({ signal: undefined });
  });

  it("surfaces Forge's detail rather than an opaque HTTP failure", async () => {
    const fetcher: typeof fetch = async () =>
      json({ detail: "Checkpoint unavailable" }, { status: 422 });
    const client = new ForgeClient("", fetcher);

    await expect(
      client.txt2img("task(diffusatory-test)", { prompt: "x" }),
    ).rejects.toEqual(new ForgeApiError(422, "Checkpoint unavailable"));
  });

  it("surfaces Forge's exception type and nested error text on a 500", async () => {
    const fetcher: typeof fetch = async () =>
      json(
        {
          error: "RuntimeError",
          detail: "",
          errors: "Flux text encoders are missing",
        },
        { status: 500 },
      );
    const client = new ForgeClient("", fetcher);

    await expect(
      client.txt2img("task(diffusatory-test)", { prompt: "x" }),
    ).rejects.toEqual(
      new ForgeApiError(500, "RuntimeError: Flux text encoders are missing"),
    );
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
