import {
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  MAX_TRACKS,
  addColumn,
  addRow,
  createRegionalComposition,
  cumulativeTracks,
  frameToLocal,
  localToFrame,
  moveBoundary,
  resolveSpatialPlan,
} from "./model";
import type { RegionPoint, RegionalComposition, RegionTransform } from "./types";

interface RegionMapProps {
  value: RegionalComposition;
  frameWidth: number;
  frameHeight: number;
  onChange: (value: RegionalComposition) => void;
}

type DragState =
  | { kind: "move"; pointerId: number; start: RegionPoint; transform: RegionTransform }
  | { kind: "transform"; pointerId: number; startAngle: number; startDistance: number; transform: RegionTransform }
  | { kind: "column" | "row"; pointerId: number; boundary: number; transform: RegionTransform };

type DragStart =
  | Omit<Extract<DragState, { kind: "move" }>, "pointerId">
  | Omit<Extract<DragState, { kind: "transform" }>, "pointerId">
  | Omit<Extract<DragState, { kind: "column" | "row" }>, "pointerId">;

const CELL_COLORS = [
  "#f7b267", "#9d8df1", "#72d6b2", "#f48498",
  "#7cc6fe", "#f9dc5c", "#c79ced", "#86deb7",
];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const pointsAttribute = (points: RegionPoint[]) =>
  points.map((point) => `${point.x},${point.y}`).join(" ");
const angle = (point: RegionPoint, center: RegionPoint) =>
  Math.atan2(point.y - center.y, point.x - center.x);
const distance = (point: RegionPoint, center: RegionPoint) =>
  Math.hypot(point.x - center.x, point.y - center.y);

export function RegionMap({ value, frameWidth, frameHeight, onChange }: RegionMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const plan = useMemo(
    () => resolveSpatialPlan(value, frameWidth, frameHeight),
    [frameHeight, frameWidth, value],
  );
  const columnBoundaries = cumulativeTracks(value.columns);
  const rowBoundaries = cumulativeTracks(value.rows);
  const center = { x: value.transform.centerX * frameWidth, y: value.transform.centerY * frameHeight };
  const transformHandle = localToFrame(1, 0, value.transform, frameWidth, frameHeight);

  const eventPoint = (event: ReactPointerEvent<SVGElement>): RegionPoint => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (matrix) {
      const transformed = point.matrixTransform(matrix.inverse());
      return { x: transformed.x, y: transformed.y };
    }
    const bounds = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * frameWidth,
      y: ((event.clientY - bounds.top) / bounds.height) * frameHeight,
    };
  };

  const beginDrag = (event: ReactPointerEvent<SVGElement>, state: DragStart) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { ...state, pointerId: event.pointerId } as DragState;
  };

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = eventPoint(event);
    if (state.kind === "move") {
      onChange({
        ...value,
        transform: {
          ...state.transform,
          centerX: clamp(state.transform.centerX + (point.x - state.start.x) / frameWidth, -0.25, 1.25),
          centerY: clamp(state.transform.centerY + (point.y - state.start.y) / frameHeight, -0.25, 1.25),
        },
      });
      return;
    }
    if (state.kind === "transform") {
      const startCenter = {
        x: state.transform.centerX * frameWidth,
        y: state.transform.centerY * frameHeight,
      };
      const scale = distance(point, startCenter) / state.startDistance;
      onChange({
        ...value,
        transform: {
          ...state.transform,
          width: clamp(state.transform.width * scale, 0.16, 1.6),
          height: clamp(state.transform.height * scale, 0.16, 1.6),
          rotation: state.transform.rotation + ((angle(point, startCenter) - state.startAngle) * 180) / Math.PI,
        },
      });
      return;
    }
    const local = frameToLocal(point, state.transform, frameWidth, frameHeight);
    onChange({
      ...value,
      ...(state.kind === "column"
        ? { columns: moveBoundary(value.columns, state.boundary, local.x) }
        : { rows: moveBoundary(value.rows, state.boundary, local.y) }),
    });
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  return (
    <div className="region-map-workspace">
      <div className="region-tools" aria-label="Region grid tools">
        <button type="button" disabled={value.columns.length >= MAX_TRACKS} onClick={() => onChange(addColumn(value))}>+ Column</button>
        <button type="button" disabled={value.rows.length >= MAX_TRACKS} onClick={() => onChange(addRow(value))}>+ Row</button>
        <button type="button" onClick={() => onChange({ ...value, transform: createRegionalComposition().transform })}>Centre grid</button>
        <label>
          <span>Soft edge {Math.round(value.softness * 100)}%</span>
          <input type="range" min="0" max="0.12" step="0.005" value={value.softness} onChange={(event) => onChange({ ...value, softness: event.target.valueAsNumber })} />
        </label>
      </div>

      <div className="region-map-frame">
        <div
          className="region-map"
          style={{
            aspectRatio: `${frameWidth} / ${frameHeight}`,
            "--frame-ratio": frameWidth / frameHeight,
          } as CSSProperties}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${frameWidth} ${frameHeight}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${value.rows.length} by ${value.columns.length} transformable region grid`}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <defs>
              <pattern id="region-grid-paper" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,.035)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width={frameWidth} height={frameHeight} fill="url(#region-grid-paper)" />
            {plan.cells.map((cell, index) => {
              const label = localToFrame(
                (columnBoundaries[cell.column] + columnBoundaries[cell.column + 1]) / 2,
                (rowBoundaries[cell.row] + rowBoundaries[cell.row + 1]) / 2,
                value.transform,
                frameWidth,
                frameHeight,
              );
              const color = CELL_COLORS[index % CELL_COLORS.length];
              return (
                <g key={cell.id}>
                  <polygon points={pointsAttribute(cell.polygon)} fill={color} fillOpacity={cell.prompt ? 0.2 : 0.1} stroke={color} strokeOpacity={0.82} strokeWidth={Math.max(1.5, plan.softnessPixels)} strokeLinejoin="round" />
                  <polygon points={pointsAttribute(cell.polygon)} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" fill={color} className="region-map__label">{cell.id.toUpperCase()}</text>
                </g>
              );
            })}
            {columnBoundaries.slice(1, -1).map((position, index) => {
              const start = localToFrame(position, 0, value.transform, frameWidth, frameHeight);
              const end = localToFrame(position, 1, value.transform, frameWidth, frameHeight);
              return <line key={`column-${index}`} className="region-map__boundary region-map__boundary--column" x1={start.x} y1={start.y} x2={end.x} y2={end.y} onPointerDown={(event) => beginDrag(event, { kind: "column", boundary: index + 1, transform: value.transform })} />;
            })}
            {rowBoundaries.slice(1, -1).map((position, index) => {
              const start = localToFrame(0, position, value.transform, frameWidth, frameHeight);
              const end = localToFrame(1, position, value.transform, frameWidth, frameHeight);
              return <line key={`row-${index}`} className="region-map__boundary region-map__boundary--row" x1={start.x} y1={start.y} x2={end.x} y2={end.y} onPointerDown={(event) => beginDrag(event, { kind: "row", boundary: index + 1, transform: value.transform })} />;
            })}
            <line x1={center.x} y1={center.y} x2={transformHandle.x} y2={transformHandle.y} className="region-map__transform-arm" />
            <circle cx={center.x} cy={center.y} r={18} className="region-map__move" onPointerDown={(event) => beginDrag(event, { kind: "move", start: eventPoint(event), transform: value.transform })} />
            <rect x={transformHandle.x - 13} y={transformHandle.y - 13} width={26} height={26} rx={4} className="region-map__transform" transform={`rotate(45 ${transformHandle.x} ${transformHandle.y})`} onPointerDown={(event) => beginDrag(event, { kind: "transform", startAngle: angle(eventPoint(event), center), startDistance: Math.max(1, distance(eventPoint(event), center)), transform: value.transform })} />
          </svg>
          <span className="region-map__background">BACKGROUND COMPLEMENT</span>
        </div>
      </div>
    </div>
  );
}
