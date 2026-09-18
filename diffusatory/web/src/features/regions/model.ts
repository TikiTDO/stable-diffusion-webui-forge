import type {
  MovableRegion,
  RegionPoint,
  RegionalComposition,
  RegionTransform,
  ResolvedRegionCell,
  ResolvedSpatialPlan,
} from "./types";

export const MIN_TRACK_SIZE = 0.08;
export const MAX_TRACKS = 4;

export function createRegionalComposition(): RegionalComposition {
  return {
    enabled: false,
    mode: "regions",
    lockFraction: 0.25,
    regions: [],
    activeRegionId: null,
    columns: [1],
    rows: [1],
    transform: {
      centerX: 0.5,
      centerY: 0.5,
      width: 0.76,
      height: 0.76,
      rotation: 0,
    },
    softness: 0.025,
    cellPrompts: [[""]],
    backgroundEnabled: false,
    backgroundPrompt: "",
  };
}

export function cumulativeTracks(tracks: number[]): number[] {
  const total = tracks.reduce((sum, value) => sum + value, 0) || 1;
  let position = 0;
  return [
    0,
    ...tracks.map((value) => {
      position += value / total;
      return position;
    }),
  ];
}

export function moveBoundary(
  tracks: number[],
  boundaryIndex: number,
  position: number,
): number[] {
  const boundaries = cumulativeTracks(tracks);
  if (boundaryIndex <= 0 || boundaryIndex >= boundaries.length - 1) {
    return tracks;
  }
  const lower = boundaries[boundaryIndex - 1] + MIN_TRACK_SIZE;
  const upper = boundaries[boundaryIndex + 1] - MIN_TRACK_SIZE;
  const moved = Math.min(upper, Math.max(lower, position));
  const next = [...tracks];
  next[boundaryIndex - 1] = moved - boundaries[boundaryIndex - 1];
  next[boundaryIndex] = boundaries[boundaryIndex + 1] - moved;
  return next;
}

function widestTrack(tracks: number[]): number {
  return tracks.reduce(
    (winner, value, index) => (value > tracks[winner] ? index : winner),
    0,
  );
}

export function addColumn(
  composition: RegionalComposition,
): RegionalComposition {
  if (composition.columns.length >= MAX_TRACKS) return composition;
  const index = widestTrack(composition.columns);
  const value = composition.columns[index] / 2;
  const columns = [...composition.columns];
  columns.splice(index, 1, value, value);
  return {
    ...composition,
    columns,
    cellPrompts: composition.cellPrompts.map((row) => {
      const next = [...row];
      next.splice(index + 1, 0, "");
      return next;
    }),
  };
}

export function addRow(composition: RegionalComposition): RegionalComposition {
  if (composition.rows.length >= MAX_TRACKS) return composition;
  const index = widestTrack(composition.rows);
  const value = composition.rows[index] / 2;
  const rows = [...composition.rows];
  rows.splice(index, 1, value, value);
  const cellPrompts = composition.cellPrompts.map((row) => [...row]);
  cellPrompts.splice(
    index + 1,
    0,
    Array.from({ length: composition.columns.length }, () => ""),
  );
  return { ...composition, rows, cellPrompts };
}

export function updateCellPrompt(
  composition: RegionalComposition,
  row: number,
  column: number,
  prompt: string,
): RegionalComposition {
  const cellPrompts = composition.cellPrompts.map((items) => [...items]);
  cellPrompts[row][column] = prompt;
  return { ...composition, cellPrompts };
}

function rotatePoint(
  point: RegionPoint,
  center: RegionPoint,
  rotationDegrees: number,
): RegionPoint {
  const radians = (rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  };
}

export function localToFrame(
  localX: number,
  localY: number,
  transform: RegionTransform,
  frameWidth: number,
  frameHeight: number,
): RegionPoint {
  const center = {
    x: transform.centerX * frameWidth,
    y: transform.centerY * frameHeight,
  };
  return rotatePoint(
    {
      x: center.x + (localX - 0.5) * transform.width * frameWidth,
      y: center.y + (localY - 0.5) * transform.height * frameHeight,
    },
    center,
    transform.rotation,
  );
}

export function frameToLocal(
  point: RegionPoint,
  transform: RegionTransform,
  frameWidth: number,
  frameHeight: number,
): RegionPoint {
  const center = {
    x: transform.centerX * frameWidth,
    y: transform.centerY * frameHeight,
  };
  const unrotated = rotatePoint(point, center, -transform.rotation);
  return {
    x:
      (unrotated.x - center.x) / (transform.width * frameWidth) + 0.5,
    y:
      (unrotated.y - center.y) / (transform.height * frameHeight) + 0.5,
  };
}

export function regionPolygon(
  transform: RegionTransform,
  frameWidth: number,
  frameHeight: number,
): RegionPoint[] {
  return [
    localToFrame(0, 0, transform, frameWidth, frameHeight),
    localToFrame(1, 0, transform, frameWidth, frameHeight),
    localToFrame(1, 1, transform, frameWidth, frameHeight),
    localToFrame(0, 1, transform, frameWidth, frameHeight),
  ];
}

export function createMovableRegion(
  id: string,
  name: string,
  transform?: Partial<RegionTransform>,
  prompt = "",
  start?: number,
  end?: number,
): MovableRegion {
  return {
    id,
    name,
    prompt,
    start,
    end,
    transform: {
      centerX: 0.5,
      centerY: 0.5,
      width: 0.4,
      height: 0.4,
      rotation: 0,
      ...transform,
    },
  };
}

export function addMovableRegion(
  composition: RegionalComposition,
  preset?: Partial<MovableRegion>,
): RegionalComposition {
  const currentRegions = composition.regions ?? [];
  const nextNum = currentRegions.length + 1;
  const id = preset?.id || `reg_${Date.now()}_${nextNum}`;
  const name = preset?.name || `Region ${nextNum}`;

  const offset = ((nextNum - 1) % 4) * 0.08;
  const defaultTransform: RegionTransform = {
    centerX: Math.min(0.8, Math.max(0.2, 0.4 + offset)),
    centerY: Math.min(0.8, Math.max(0.2, 0.4 + offset)),
    width: 0.38,
    height: 0.38,
    rotation: 0,
    ...preset?.transform,
  };

  const lock = composition.lockFraction ?? 0.25;
  const newRegion: MovableRegion = {
    id,
    name,
    prompt: preset?.prompt || "",
    start: preset?.start ?? lock,
    end: preset?.end ?? 1.0,
    transform: defaultTransform,
  };

  return {
    ...composition,
    mode: "regions",
    regions: [...currentRegions, newRegion],
    activeRegionId: id,
  };
}

export function removeMovableRegion(
  composition: RegionalComposition,
  regionId: string,
): RegionalComposition {
  const currentRegions = composition.regions ?? [];
  const nextRegions = currentRegions.filter((r) => r.id !== regionId);
  let nextActiveId = composition.activeRegionId;
  if (nextActiveId === regionId) {
    nextActiveId = nextRegions.length > 0 ? nextRegions[nextRegions.length - 1].id : null;
  }
  return {
    ...composition,
    regions: nextRegions,
    activeRegionId: nextActiveId,
  };
}

export function updateMovableRegion(
  composition: RegionalComposition,
  regionId: string,
  patch: Partial<MovableRegion>,
): RegionalComposition {
  const currentRegions = composition.regions ?? [];
  const nextRegions = currentRegions.map((r) =>
    r.id === regionId
      ? {
          ...r,
          ...patch,
          transform: patch.transform
            ? { ...r.transform, ...patch.transform }
            : r.transform,
        }
      : r,
  );
  return {
    ...composition,
    regions: nextRegions,
  };
}

export function setActiveMovableRegion(
  composition: RegionalComposition,
  regionId: string | null,
): RegionalComposition {
  return {
    ...composition,
    activeRegionId: regionId,
  };
}

export function resolveSpatialPlan(
  composition: RegionalComposition,
  frameWidth: number,
  frameHeight: number,
): ResolvedSpatialPlan {
  const hasRegions = Boolean(composition.regions && composition.regions.length > 0);
  const useRegions = composition.mode === "regions" ? hasRegions : (hasRegions && composition.mode !== "grid");

  let cells: ResolvedRegionCell[];

  if (useRegions && composition.regions && composition.regions.length > 0) {
    const lock = composition.lockFraction ?? 0.25;
    cells = composition.regions.map((region, index) => ({
      id: region.id || `reg_${index + 1}`,
      row: index,
      column: 0,
      prompt: region.prompt.trim(),
      polygon: regionPolygon(region.transform, frameWidth, frameHeight),
      start: region.start ?? lock,
      end: region.end ?? 1.0,
    }));
  } else {
    const columns = cumulativeTracks(composition.columns);
    const rows = cumulativeTracks(composition.rows);
    cells = composition.cellPrompts.flatMap((prompts, row) =>
      prompts.map((prompt, column) => ({
        id: `r${row + 1}c${column + 1}`,
        row,
        column,
        prompt: prompt.trim(),
        polygon: [
          localToFrame(columns[column], rows[row], composition.transform, frameWidth, frameHeight),
          localToFrame(columns[column + 1], rows[row], composition.transform, frameWidth, frameHeight),
          localToFrame(columns[column + 1], rows[row + 1], composition.transform, frameWidth, frameHeight),
          localToFrame(columns[column], rows[row + 1], composition.transform, frameWidth, frameHeight),
        ],
      })),
    );
  }

  return {
    version: 1,
    frame: { width: frameWidth, height: frameHeight },
    transform: composition.transform,
    softnessPixels:
      composition.softness * Math.min(frameWidth, frameHeight),
    cells,
    background: {
      enabled: composition.backgroundEnabled,
      prompt: composition.backgroundPrompt.trim(),
    },
  };
}
