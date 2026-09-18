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

export interface MovableRegion {
  id: string;
  name: string;
  prompt: string;
  transform: RegionTransform;
  start?: number;
  end?: number;
}

export interface RegionalComposition {
  enabled: boolean;
  mode?: "regions" | "grid";
  regions?: MovableRegion[];
  activeRegionId?: string | null;
  lockFraction?: number;
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
  start?: number;
  end?: number;
}

export interface ResolvedSpatialPlan {
  version: 1;
  frame: { width: number; height: number };
  transform: RegionTransform;
  softnessPixels: number;
  cells: ResolvedRegionCell[];
  background: {
    enabled: boolean;
    prompt: string;
    start?: number;
    end?: number;
  };
}
