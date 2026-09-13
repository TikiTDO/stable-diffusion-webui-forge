import type {
  RegionPoint,
  RegionalComposition,
  RegionTransform,
  ResolvedSpatialPlan,
} from "./types";

export const MIN_TRACK_SIZE = 0.08;
export const MAX_TRACKS = 4;

export function createRegionalComposition(): RegionalComposition {
  return {
    enabled: false,
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

export function resolveSpatialPlan(
  composition: RegionalComposition,
  frameWidth: number,
  frameHeight: number,
): ResolvedSpatialPlan {
  const columns = cumulativeTracks(composition.columns);
  const rows = cumulativeTracks(composition.rows);
  const cells = composition.cellPrompts.flatMap((prompts, row) =>
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
  return {
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
