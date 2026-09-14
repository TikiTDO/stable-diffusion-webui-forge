import type { GenerationResult, GenerationState } from "./generation";

export interface Candidate {
  id: string;
  taskId: string;
  resultIndex: number;
  createdAt: number;
  sourceKind: "txt2img" | "img2img";
  width: number;
  height: number;
  result: GenerationResult;
}

export interface CandidateBatch {
  taskId: string;
  createdAt: number;
  sourceKind: "txt2img" | "img2img";
  width: number;
  height: number;
  candidates: Candidate[];
}

export function candidatesFromGeneration(
  generation: GenerationState,
  createdAt: number = Date.now(),
): Candidate[] {
  if (
    generation.phase !== "completed" ||
    !generation.taskId ||
    !generation.kind
  ) {
    return [];
  }
  return generation.results.flatMap((result, resultIndex) =>
    result.kind === "image"
      ? [
          {
            id: `${generation.taskId}:${resultIndex}`,
            taskId: generation.taskId!,
            resultIndex,
            createdAt,
            sourceKind: generation.kind!,
            width: generation.job?.width ?? 1024,
            height: generation.job?.height ?? 1024,
            result,
          },
        ]
      : [],
  );
}

export function appendCandidates(
  current: Candidate[],
  incoming: Candidate[],
): Candidate[] {
  const known = new Set(current.map((candidate) => candidate.id));
  return [...current, ...incoming.filter((candidate) => !known.has(candidate.id))];
}

export function groupCandidateBatches(
  candidates: Candidate[],
): CandidateBatch[] {
  const batches = new Map<string, CandidateBatch>();
  for (const candidate of candidates) {
    const batch = batches.get(candidate.taskId);
    if (batch) {
      batch.candidates.push(candidate);
      continue;
    }
    batches.set(candidate.taskId, {
      taskId: candidate.taskId,
      createdAt: candidate.createdAt,
      sourceKind: candidate.sourceKind,
      width: candidate.width,
      height: candidate.height,
      candidates: [candidate],
    });
  }
  return [...batches.values()];
}
