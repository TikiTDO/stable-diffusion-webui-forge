import type {
  ControlNetCatalog,
  ControlNetUnitInput,
} from "../../api/forge/types";
import type { ControlNetCondition } from "./types";

const PREFERRED_INTENTS = [
  "Depth",
  "Lineart",
  "OpenPose",
  "IP-Adapter",
  "Canny",
];

export function orderedIntents(catalog: ControlNetCatalog): string[] {
  const names = Object.keys(catalog.types).filter((name) => name !== "All");
  return names.sort((left, right) => {
    const leftRank = PREFERRED_INTENTS.indexOf(left);
    const rightRank = PREFERRED_INTENTS.indexOf(right);
    if (leftRank !== -1 || rightRank !== -1) {
      return (leftRank === -1 ? 999 : leftRank) - (rightRank === -1 ? 999 : rightRank);
    }
    return left.localeCompare(right);
  });
}

export function createCondition(
  catalog: ControlNetCatalog,
  id: string = crypto.randomUUID(),
): ControlNetCondition {
  const intent = orderedIntents(catalog)[0] ?? "All";
  const type = catalog.types[intent] ?? catalog.types.All;
  return {
    id,
    enabled: true,
    intent,
    module: type?.defaultModule ?? "None",
    model: type?.defaultModel ?? "None",
    source: { kind: "independent", image: null, name: null },
    weight: 1,
    resizeMode: "Crop and Resize",
    processorResolution: -1,
    thresholdA: -1,
    thresholdB: -1,
    guidanceStart: 0,
    guidanceEnd: 1,
    pixelPerfect: true,
    controlMode: "Balanced",
    saveDetectedMap: true,
    preview: null,
    previewStatus: "idle",
    previewError: null,
  };
}

export function conditionForIntent(
  condition: ControlNetCondition,
  intent: string,
  catalog: ControlNetCatalog,
): ControlNetCondition {
  const type = catalog.types[intent];
  if (!type) return condition;
  return {
    ...condition,
    intent,
    module: type.defaultModule,
    model: type.defaultModel,
    preview: null,
    previewStatus: "idle",
    previewError: null,
  };
}

export function sourceForCondition(
  condition: ControlNetCondition,
  currentImage: string | null,
): string | null {
  return condition.source.kind === "current"
    ? currentImage
    : condition.source.image;
}

export function conditionIssue(
  condition: ControlNetCondition,
  currentImage: string | null,
): string | null {
  if (!condition.enabled) return null;
  if (!sourceForCondition(condition, currentImage)) {
    return condition.source.kind === "current"
      ? "The current canvas is not ready."
      : "Choose a conditioning image.";
  }
  if (!condition.module || condition.module === "None") {
    return "Choose a preprocessor.";
  }
  if (!condition.model || condition.model === "None") {
    return "Choose a ControlNet model.";
  }
  if (condition.guidanceStart > condition.guidanceEnd) {
    return "Influence must start before it ends.";
  }
  return null;
}

export function resolveConditions(
  conditions: ControlNetCondition[],
  currentImage: string | null,
): ControlNetUnitInput[] {
  return conditions.filter((condition) => condition.enabled).map((condition) => {
    const issue = conditionIssue(condition, currentImage);
    if (issue) throw new Error(`${condition.intent}: ${issue}`);
    return {
      module: condition.module,
      model: condition.model,
      image: sourceForCondition(condition, currentImage)!,
      weight: condition.weight,
      resizeMode: condition.resizeMode,
      processorResolution: condition.processorResolution,
      thresholdA: condition.thresholdA,
      thresholdB: condition.thresholdB,
      guidanceStart: condition.guidanceStart,
      guidanceEnd: condition.guidanceEnd,
      pixelPerfect: condition.pixelPerfect,
      controlMode: condition.controlMode,
      saveDetectedMap: true,
    };
  });
}
