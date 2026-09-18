import type {
  DiffusatoryComposition,
  PromptExpansionInput,
  PromptExpansionMode,
  Txt2ImgInput,
} from "../api/forge/types";
import { requestFromDraft, type GenerationDraft } from "./draft";
import { compilePromptWithLoras } from "./loras";
import { expandPromptGroups } from "./promptGroups";
import { resolveSpatialPlan } from "../features/regions/model";
import type { RegionalComposition } from "../features/regions/types";

export interface AssembleGenerationRequestOptions {
  draft: GenerationDraft;
  realizations: Array<{ prompt: string; negative_prompt: string }>;
  controlNet?: any[];
  regionalComposition?: RegionalComposition;
  activeDimensions?: { width: number; height: number };
}

/**
 * Builds the canonical PromptExpansionInput from the current draft, ensuring
 * prompt groups are expanded so expansion endpoints operate on resolved text.
 */
export function buildPromptExpansionInput(
  draft: Pick<GenerationDraft, "prompt" | "negativePrompt" | "promptGroups" | "outputs">,
  mode: PromptExpansionMode,
  expansionSeed?: number,
): PromptExpansionInput {
  return {
    prompt: expandPromptGroups(draft.prompt, draft.promptGroups).trim(),
    negativePrompt: draft.negativePrompt.trim(),
    mode,
    candidateCount: draft.outputs,
    expansionSeed: expansionSeed ?? 0,
  };
}

/**
 * Canonical production generation request assembler used by App.tsx.
 * Resolves prompt group sigils in each realization, applies LoRAs,
 * attaches spatial plans, and bundles the Diffusatory composition snapshot.
 */
export function assembleGenerationRequest(
  options: AssembleGenerationRequestOptions,
): Txt2ImgInput {
  const {
    draft,
    realizations,
    controlNet,
    regionalComposition,
    activeDimensions,
  } = options;

  const composition: DiffusatoryComposition = {
    version: 1,
    prompt: draft.prompt,
    negativePrompt: draft.negativePrompt,
    loras: draft.loras,
    promptGroups: draft.promptGroups,
    ...(regionalComposition?.enabled ? { regions: regionalComposition } : {}),
  };

  const finalPrompts = realizations.map((item) =>
    compilePromptWithLoras(
      expandPromptGroups(item.prompt, draft.promptGroups),
      draft.loras,
    ),
  );

  const finalNegativePrompts = realizations.map((item) => item.negative_prompt);

  return {
    ...requestFromDraft(draft),
    prompt: finalPrompts,
    negativePrompt: finalNegativePrompts,
    outputs: realizations.length,
    controlNet,
    composition,
    ...(regionalComposition?.enabled && activeDimensions
      ? {
          spatialPlan: resolveSpatialPlan(
            regionalComposition,
            activeDimensions.width,
            activeDimensions.height,
          ),
        }
      : {}),
  };
}
