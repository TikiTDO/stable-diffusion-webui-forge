import type { GenerationResult, GenerationState } from "./generation";

export interface Candidate {
  id: string;
  taskId: string;
  resultIndex: number;
  createdAt: number;
  sourceKind: "txt2img" | "img2img";
  result: GenerationResult;
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
