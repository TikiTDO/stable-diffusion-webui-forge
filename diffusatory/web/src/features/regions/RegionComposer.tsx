import { useMemo, type CSSProperties } from "react";

import {
  createRegionalComposition,
  resolveSpatialPlan,
  updateCellPrompt,
} from "./model";
import type { RegionalComposition } from "./types";

interface RegionComposerProps {
  value: RegionalComposition;
  frameWidth: number;
  frameHeight: number;
  commonPrompt: string;
  stageVisible: boolean;
  onChange: (value: RegionalComposition) => void;
  onShowStage: () => void;
}

const CELL_COLORS = [
  "#f7b267", "#9d8df1", "#72d6b2", "#f48498",
  "#7cc6fe", "#f9dc5c", "#c79ced", "#86deb7",
];

export function RegionComposer({
  value,
  frameWidth,
  frameHeight,
  commonPrompt,
  stageVisible,
  onChange,
  onShowStage,
}: RegionComposerProps) {
  const plan = useMemo(
    () => resolveSpatialPlan(value, frameWidth, frameHeight),
    [frameHeight, frameWidth, value],
  );

  if (!value.enabled) {
    return (
      <section className="region-composer region-composer--off">
        <div>
          <strong>Spatial regions</strong>
          <small>Full frame</small>
        </div>
        <button type="button" onClick={() => onChange({ ...createRegionalComposition(), enabled: true })}>
          + Place regions
        </button>
      </section>
    );
  }

  return (
    <section className="region-composer" aria-labelledby="regions-title">
      <header className="region-composer__header">
        <div>
          <h3 id="regions-title">Spatial regions</h3>
          <small>Grid active</small>
        </div>
        <div className="region-composer__actions">
          {!stageVisible && (
            <button type="button" onClick={onShowStage}>Show map</button>
          )}
          <button type="button" className="region-disable" onClick={() => onChange({ ...value, enabled: false })}>
            Whole frame
          </button>
        </div>
      </header>

      <div className="region-prompts">
        <div className="region-common">
          <span>Common to every region</span>
          <p>{commonPrompt.trim() || "Add the shared scene in the main prompt above."}</p>
        </div>
        <div className="region-cell-prompts">
          {plan.cells.map((cell, index) => (
            <label key={cell.id} style={{ "--region-color": CELL_COLORS[index % CELL_COLORS.length] } as CSSProperties}>
              <span>{cell.id.toUpperCase()}</span>
              <textarea
                rows={2}
                value={value.cellPrompts[cell.row][cell.column]}
                placeholder="What belongs here?"
                onChange={(event) => onChange(updateCellPrompt(value, cell.row, cell.column, event.target.value))}
              />
            </label>
          ))}
        </div>
        <label className="region-background-prompt">
          <span>
            <input type="checkbox" checked={value.backgroundEnabled} onChange={(event) => onChange({ ...value, backgroundEnabled: event.target.checked })} />
            Prompt the background outside the grid
          </span>
          <textarea
            rows={2}
            disabled={!value.backgroundEnabled}
            value={value.backgroundPrompt}
            placeholder="Distant environment, atmosphere, lighting…"
            onChange={(event) => onChange({ ...value, backgroundPrompt: event.target.value })}
          />
        </label>
      </div>

      <details className="region-plan">
        <summary>Inspect resolved plan</summary>
        <dl>
          <div><dt>Canvas</dt><dd>{frameWidth} × {frameHeight}</dd></div>
          <div><dt>Cells</dt><dd>{plan.cells.length}</dd></div>
          <div><dt>Centre</dt><dd>{Math.round(value.transform.centerX * 100)}%, {Math.round(value.transform.centerY * 100)}%</dd></div>
          <div><dt>Scale</dt><dd>{Math.round(value.transform.width * 100)}% × {Math.round(value.transform.height * 100)}%</dd></div>
          <div><dt>Rotation</dt><dd>{value.transform.rotation.toFixed(1)}°</dd></div>
          <div><dt>Soft edge</dt><dd>{plan.softnessPixels.toFixed(1)} px</dd></div>
        </dl>
      </details>

      <small className="region-render-note" role="status">
        Common prompt applies globally
      </small>
    </section>
  );
}
