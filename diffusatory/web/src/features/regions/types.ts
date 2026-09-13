export interface RegionPoint {
  x: number;
  y: number;
}

export interface RegionTransform {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
}

export interface RegionalComposition {
  enabled: boolean;
  columns: number[];
  rows: number[];
  transform: RegionTransform;
  softness: number;
  cellPrompts: string[][];
  backgroundEnabled: boolean;
  backgroundPrompt: string;
}

export interface ResolvedRegionCell {
  id: string;
  row: number;
  column: number;
  prompt: string;
  polygon: RegionPoint[];
}

export interface ResolvedSpatialPlan {
  frame: { width: number; height: number };
  transform: RegionTransform;
  softnessPixels: number;
  cells: ResolvedRegionCell[];
  background: { enabled: boolean; prompt: string };
}
