import type { ControlNetUnitInput } from "./types";

export interface ControlNetUnitWire {
  input_mode: "simple";
  use_preview_as_input: false;
  enabled: true;
  module: string;
  model: string;
  image: string;
  weight: number;
  resize_mode: NonNullable<ControlNetUnitInput["resizeMode"]>;
  processor_res: number;
  threshold_a: number;
  threshold_b: number;
  guidance_start: number;
  guidance_end: number;
  pixel_perfect: boolean;
  control_mode: NonNullable<ControlNetUnitInput["controlMode"]>;
  save_detected_map: boolean;
}

export function controlNetUnitWire(
  unit: ControlNetUnitInput,
): ControlNetUnitWire {
  return {
    input_mode: "simple",
    use_preview_as_input: false,
    enabled: true,
    module: unit.module,
    model: unit.model,
    image: unit.image,
    weight: unit.weight ?? 1,
    resize_mode: unit.resizeMode ?? "Crop and Resize",
    processor_res: unit.processorResolution ?? -1,
    threshold_a: unit.thresholdA ?? -1,
    threshold_b: unit.thresholdB ?? -1,
    guidance_start: unit.guidanceStart ?? 0,
    guidance_end: unit.guidanceEnd ?? 1,
    pixel_perfect: unit.pixelPerfect ?? true,
    control_mode: unit.controlMode ?? "Balanced",
    save_detected_map: unit.saveDetectedMap ?? true,
  };
}

export function controlNetAlwaysOnScripts(
  units: ControlNetUnitInput[] | undefined,
): Record<string, { args: ControlNetUnitWire[] }> {
  if (!units?.length) return {};
  return { controlnet: { args: units.map(controlNetUnitWire) } };
}
