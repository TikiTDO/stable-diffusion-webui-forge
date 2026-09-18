import { describe, expect, it } from "vitest";

import {
  appendGeneratedEditorVariations,
  buildSessionHierarchy,
  createEditorSession,
  DEFAULT_PRIMARY_SESSION,
  initialEditorVariation,
  moveVariationToSession,
  PRIMARY_SESSION_ID,
  REMOVED_SESSION_ID,
  removeVariationToTrash,
  restoreVariationFromTrash,
  selectVariationCandidate,
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
    expect(original.sessionId).toBe(PRIMARY_SESSION_ID);
    expect(working).toMatchObject({
      label: "Working edit 1",
      image: "composite",
      mask: "mask",
      width: 832,
      height: 1216,
      sessionId: PRIMARY_SESSION_ID,
    });
  });

  it("groups multiple candidates from one generate run into ONE item with candidate switching", () => {
    const original = initialEditorVariation("s:original", "source", {
      width: 1024,
      height: 1024,
    });
    const first = appendGeneratedEditorVariations(
      [original],
      "task-a",
      "img2img",
      [
        imageResult("candidate-a1"),
        { ...imageResult("sheet"), kind: "contact-sheet" },
        imageResult("candidate-a2"),
      ],
      { width: 1024, height: 1024 },
    );
    const repeated = appendGeneratedEditorVariations(
      first,
      "task-a",
      "img2img",
      [imageResult("candidate-a1"), imageResult("candidate-a2")],
      { width: 1024, height: 1024 },
    );
    const second = appendGeneratedEditorVariations(
      repeated,
      "task-b",
      "inpaint",
      [imageResult("inpaint-b1"), imageResult("inpaint-b2")],
      { width: 1024, height: 1024 },
      "s:original",
    );

    // Two generate runs -> 1 original + 2 variation items (each holding multiple candidates)
    expect(second.map((item) => item.label)).toEqual([
      "Original",
      "Variation 1",
      "Inpaint 2",
    ]);
    expect(repeated).toBe(first);
    expect(first[1].candidates).toEqual(["candidate-a1", "candidate-a2"]);
    expect(first[1].image).toBe("candidate-a1");
    expect(second[2].sourceId).toBe("s:original");

    // Test candidate selection within a variation
    const switched = selectVariationCandidate(second, second[2].id, 1);
    expect(switched[2].selectedCandidateIndex).toBe(1);
    expect(switched[2].image).toBe("inpaint-b2");
  });

  it("manages session hierarchy, movement, and trash restore", () => {
    const original = initialEditorVariation("s:original", "source", {
      width: 512,
      height: 512,
    });
    const subSession = createEditorSession("Character details", [DEFAULT_PRIMARY_SESSION]);
    expect(subSession.label).toBe("Character details");

    // Move to sub-session
    const moved = moveVariationToSession([original], original.id, subSession.id);
    expect(moved[0].sessionId).toBe(subSession.id);

    // Remove to trash
    const trashed = removeVariationToTrash(moved, original.id);
    expect(trashed[0].sessionId).toBe(REMOVED_SESSION_ID);

    // Restore from trash back to primary
    const restored = restoreVariationFromTrash(trashed, original.id, PRIMARY_SESSION_ID);
    expect(restored[0].sessionId).toBe(PRIMARY_SESSION_ID);
  });

  it("builds a session hierarchy linking child sub-sessions to parent sessions and source images", () => {
    const parentSession = DEFAULT_PRIMARY_SESSION;
    const childSession = createEditorSession(
      "Inpaint details",
      [parentSession],
      parentSession.id,
      "var-source-1",
    );

    expect(childSession.parentId).toBe(parentSession.id);
    expect(childSession.sourceImageId).toBe("var-source-1");

    const hierarchy = buildSessionHierarchy([parentSession, childSession]);
    expect(hierarchy).toHaveLength(1);
    expect(hierarchy[0].id).toBe(parentSession.id);
    expect(hierarchy[0].children).toHaveLength(1);
    expect(hierarchy[0].children[0].id).toBe(childSession.id);
    expect(hierarchy[0].children[0].sourceImageId).toBe("var-source-1");
  });
});
