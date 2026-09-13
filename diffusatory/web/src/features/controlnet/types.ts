import type { ControlNetUnitInput } from "../../api/forge/types";

export type ControlSource =
  | { kind: "current" }
  | { kind: "independent"; image: string | null; name: string | null };

export interface ControlNetCondition {
  id: string;
  enabled: boolean;
  intent: string;
  module: string;
  model: string;
  source: ControlSource;
  weight: number;
  resizeMode: NonNullable<ControlNetUnitInput["resizeMode"]>;
  processorResolution: number;
  thresholdA: number;
  thresholdB: number;
  guidanceStart: number;
  guidanceEnd: number;
  pixelPerfect: boolean;
  controlMode: NonNullable<ControlNetUnitInput["controlMode"]>;
  saveDetectedMap: boolean;
  preview: string | null;
  previewStatus: "idle" | "loading" | "ready" | "failed";
  previewError: string | null;
}

export type ConditionPatch = Partial<Omit<ControlNetCondition, "id">>;
