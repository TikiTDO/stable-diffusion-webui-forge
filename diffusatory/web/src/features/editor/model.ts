import type { PointerSample } from "../../input/pointer";
import type { PressureCalibration } from "../../input/calibration";

export type EditorLayer = "paint" | "mask";
export type EditorTool = "brush" | "erase" | "pan" | "eyedropper";
export type EditOperation = "img2img" | "inpaint";

export interface ImageEditSettings {
  denoisingStrength: number;
  maskBlur: number;
  inpaintOnlyMasked: boolean;
  inpaintPadding: number;
  /** Forge resize mode: 0 stretch, 1 crop, 2 fill. */
  resizeMode: 0 | 1 | 2;
}

export interface StrokeOperation {
  layer: EditorLayer;
  erase: boolean;
  color: string;
  size: number;
  opacity: number;
  pressure: PressureCalibration;
  samples: PointerSample[];
}

export function createStrokeOperation(
  operation: Omit<StrokeOperation, "pressure" | "samples"> & {
    pressure: PressureCalibration;
  },
): StrokeOperation {
  return {
    ...operation,
    pressure: { ...operation.pressure },
    samples: [],
  };
}

export function brushSizeFromControl(position: number): number {
  const normalized = Math.min(1, Math.max(0, position / 100));
  return Math.round(2 ** (normalized * 8));
}

export function brushControlFromSize(size: number): number {
  const bounded = Math.min(256, Math.max(1, size));
  return (Math.log2(bounded) / 8) * 100;
}
