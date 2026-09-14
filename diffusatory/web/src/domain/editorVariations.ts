import type { GenerationResult } from "./generation";
import type { EditOperation } from "../features/editor/model";

export type EditorVariationKind =
  | "original"
  | "working"
  | "variation"
  | "inpaint";

export interface EditorVariation {
  id: string;
  image: string | null;
  mask: string | null;
  width: number;
  height: number;
  label: string;
  kind: EditorVariationKind;
}

export function initialEditorVariation(
  id: string,
  image: string | null,
  dimensions: { width: number; height: number },
): EditorVariation {
  return {
    id,
    image,
    mask: null,
    width: dimensions.width,
    height: dimensions.height,
    label: image ? "Original" : "Blank start",
    kind: "original",
  };
}

export function workingEditorVariation(
  id: string,
  image: string,
  mask: string | null,
  dimensions: { width: number; height: number },
  existing: EditorVariation[],
): EditorVariation {
  const number = existing.filter((item) => item.kind === "working").length + 1;
  return {
    id,
    image,
    mask,
    width: dimensions.width,
    height: dimensions.height,
    label: `Working edit ${number}`,
    kind: "working",
  };
}

export function appendGeneratedEditorVariations(
  existing: EditorVariation[],
  taskId: string,
  operation: EditOperation,
  results: GenerationResult[],
  dimensions: { width: number; height: number },
): EditorVariation[] {
  if (existing.some((item) => item.id.startsWith(`${taskId}:`))) {
    return existing;
  }
  const known = new Set(existing.map((item) => item.id));
  let number = existing.filter(
    (item) => item.kind === "variation" || item.kind === "inpaint",
  ).length;
  const additions = results.flatMap((result, index) => {
    if (result.kind !== "image") return [];
    const id = `${taskId}:${index}`;
    if (known.has(id)) return [];
    number += 1;
    return [{
      id,
      image: result.image,
      mask: null,
      width: dimensions.width,
      height: dimensions.height,
      label: `${operation === "inpaint" ? "Inpaint" : "Variation"} ${number}`,
      kind: operation === "inpaint" ? "inpaint" as const : "variation" as const,
    }];
  });
  return additions.length ? [...existing, ...additions] : existing;
}
