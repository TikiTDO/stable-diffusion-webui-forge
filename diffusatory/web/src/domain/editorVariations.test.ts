import { describe, expect, it } from "vitest";

import {
  appendGeneratedEditorVariations,
  initialEditorVariation,
  workingEditorVariation,
} from "./editorVariations";
import type { GenerationResult } from "./generation";

const imageResult = (image: string): GenerationResult => ({
  image,
  kind: "image",
  prompt: null,
  negativePrompt: null,
  seed: null,
  infotext: null,
  spatialPlan: null,
});

describe("editor variations", () => {
  it("starts with the source and preserves a working paint and mask snapshot", () => {
    const original = initialEditorVariation("s:original", "source", {
      width: 832,
      height: 1216,
    });
    const working = workingEditorVariation(
      "s:working:1",
      "composite",
      "mask",
      { width: 832, height: 1216 },
      [original],
    );

    expect(original.label).toBe("Original");
    expect(working).toMatchObject({
      label: "Working edit 1",
      image: "composite",
      mask: "mask",
      width: 832,
      height: 1216,
    });
  });

  it("appends every image result across runs without duplicating a completed task", () => {
    const original = initialEditorVariation("s:original", "source", {
      width: 1024,
      height: 1024,
    });
    const first = appendGeneratedEditorVariations(
      [original],
      "task-a",
      "img2img",
      [
        imageResult("a"),
        { ...imageResult("sheet"), kind: "contact-sheet" },
        imageResult("b"),
      ],
      { width: 1024, height: 1024 },
    );
    const repeated = appendGeneratedEditorVariations(
      first,
      "task-a",
      "img2img",
      [imageResult("a"), imageResult("b")],
      { width: 1024, height: 1024 },
    );
    const second = appendGeneratedEditorVariations(
      repeated,
      "task-b",
      "inpaint",
      [imageResult("c")],
      { width: 1024, height: 1024 },
    );

    expect(first.map((item) => item.label)).toEqual([
      "Original",
      "Variation 1",
      "Variation 2",
    ]);
    expect(repeated).toBe(first);
    expect(second.map((item) => item.label)).toEqual([
      "Original",
      "Variation 1",
      "Variation 2",
      "Inpaint 3",
    ]);
  });
});
