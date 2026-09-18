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
  sourceId?: string | null;
  sessionId?: string;
  candidates?: string[];
  selectedCandidateIndex?: number;
}

export interface EditorSession {
  id: string;
  label: string;
  collapsed?: boolean;
  parentId?: string | null;
  sourceImageId?: string | null;
}

export const PRIMARY_SESSION_ID = "primary";
export const REMOVED_SESSION_ID = "removed";

export const DEFAULT_PRIMARY_SESSION: EditorSession = {
  id: PRIMARY_SESSION_ID,
  label: "Primary variations",
  collapsed: false,
};

export function initialEditorVariation(
  id: string,
  image: string | null,
  dimensions: { width: number; height: number },
  sessionId: string = PRIMARY_SESSION_ID,
): EditorVariation {
  const candidates = image ? [image] : [];
  return {
    id,
    image,
    mask: null,
    width: dimensions.width,
    height: dimensions.height,
    label: image ? "Original" : "Blank start",
    kind: "original",
    sourceId: null,
    sessionId,
    candidates,
    selectedCandidateIndex: 0,
  };
}

export function workingEditorVariation(
  id: string,
  image: string,
  mask: string | null,
  dimensions: { width: number; height: number },
  existing: EditorVariation[],
  sourceId?: string | null,
  sessionId: string = PRIMARY_SESSION_ID,
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
    sourceId: sourceId ?? null,
    sessionId,
    candidates: [image],
    selectedCandidateIndex: 0,
  };
}

export function appendGeneratedEditorVariations(
  existing: EditorVariation[],
  taskId: string,
  operation: EditOperation,
  results: GenerationResult[],
  dimensions: { width: number; height: number },
  sourceId?: string | null,
  sessionId: string = PRIMARY_SESSION_ID,
): EditorVariation[] {
  if (existing.some((item) => item.id === taskId || item.id.startsWith(`${taskId}:`))) {
    return existing;
  }
  const images = results
    .filter((result): result is GenerationResult & { image: string } =>
      result.kind === "image" && Boolean(result.image),
    )
    .map((result) => result.image);

  if (!images.length) return existing;

  const number =
    existing.filter((item) => item.kind === "variation" || item.kind === "inpaint")
      .length + 1;

  const item: EditorVariation = {
    id: `${taskId}:0`,
    image: images[0],
    mask: null,
    width: dimensions.width,
    height: dimensions.height,
    label: `${operation === "inpaint" ? "Inpaint" : "Variation"} ${number}`,
    kind: operation === "inpaint" ? "inpaint" : "variation",
    sourceId: sourceId ?? null,
    sessionId,
    candidates: images,
    selectedCandidateIndex: 0,
  };

  return [...existing, item];
}

export function selectVariationCandidate(
  variations: EditorVariation[],
  variationId: string,
  candidateIndex: number,
): EditorVariation[] {
  return variations.map((item) => {
    if (item.id !== variationId) return item;
    const candidates = item.candidates?.length
      ? item.candidates
      : item.image
        ? [item.image]
        : [];
    if (!candidates.length) return item;
    const clampedIndex = Math.max(0, Math.min(candidateIndex, candidates.length - 1));
    return {
      ...item,
      selectedCandidateIndex: clampedIndex,
      image: candidates[clampedIndex],
    };
  });
}

export function createEditorSession(
  label: string,
  existingSessions: EditorSession[],
  parentId?: string | null,
  sourceImageId?: string | null,
): EditorSession {
  const number = existingSessions.length + 1;
  return {
    id: `session-${Date.now()}-${number}`,
    label: label.trim() || `Sub-variations ${number}`,
    collapsed: false,
    parentId: parentId ?? null,
    sourceImageId: sourceImageId ?? null,
  };
}

export interface HierarchicalSession extends EditorSession {
  children: EditorSession[];
}

export function buildSessionHierarchy(sessions: EditorSession[]): HierarchicalSession[] {
  const rootSessions: HierarchicalSession[] = [];
  const sessionMap = new Map<string, HierarchicalSession>();

  for (const session of sessions) {
    sessionMap.set(session.id, { ...session, children: [] });
  }

  for (const session of sessions) {
    const hierarchical = sessionMap.get(session.id)!;
    if (session.parentId && sessionMap.has(session.parentId)) {
      sessionMap.get(session.parentId)!.children.push(hierarchical);
    } else {
      rootSessions.push(hierarchical);
    }
  }

  return rootSessions;
}

export function moveVariationToSession(
  variations: EditorVariation[],
  variationId: string,
  targetSessionId: string,
): EditorVariation[] {
  return variations.map((item) =>
    item.id === variationId ? { ...item, sessionId: targetSessionId } : item,
  );
}

export function removeVariationToTrash(
  variations: EditorVariation[],
  variationId: string,
): EditorVariation[] {
  return variations.map((item) =>
    item.id === variationId ? { ...item, sessionId: REMOVED_SESSION_ID } : item,
  );
}

export function restoreVariationFromTrash(
  variations: EditorVariation[],
  variationId: string,
  targetSessionId: string = PRIMARY_SESSION_ID,
): EditorVariation[] {
  return variations.map((item) =>
    item.id === variationId ? { ...item, sessionId: targetSessionId } : item,
  );
}
