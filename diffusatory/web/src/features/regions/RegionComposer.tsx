import { useMemo, type CSSProperties } from "react";

import {
  addMovableRegion,
  createRegionalComposition,
  removeMovableRegion,
  resolveSpatialPlan,
  setActiveMovableRegion,
  updateCellPrompt,
  updateMovableRegion,
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
  const isRegionsMode =
    value.mode === "regions" || (Boolean(value.regions && value.regions.length > 0) && value.mode !== "grid");

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
        <button
          type="button"
          onClick={() => {
            const initial = createRegionalComposition();
            onChange(addMovableRegion({ ...initial, enabled: true }));
          }}
        >
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
          <p>{commonPrompt.trim() || "Shared prompt above applies to all regions"}</p>
        </div>

        {isRegionsMode ? (
          <>
            <label className="region-lock-control">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Composition lock</span>
                <strong>{Math.round((value.lockFraction ?? 0.25) * 100)}% steps</strong>
              </div>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.05"
                value={value.lockFraction ?? 0.25}
                onChange={(event) =>
                  onChange({ ...value, lockFraction: event.target.valueAsNumber })
                }
              />
            </label>

            <div className="region-cell-prompts">
              {(value.regions ?? []).map((region, index) => {
                const color = CELL_COLORS[index % CELL_COLORS.length];
                const isActive = region.id === value.activeRegionId;
                return (
                  <div
                    key={region.id}
                    className={`region-card ${isActive ? "region-card--active" : ""}`}
                    style={{ "--region-color": color } as CSSProperties}
                    onClick={() => onChange(setActiveMovableRegion(value, region.id))}
                  >
                    <div className="region-card__header">
                      <span className="region-card__title">{region.name || `REGION ${index + 1}`}</span>
                      <button
                        type="button"
                        className="region-card__remove"
                        title="Remove region"
                        onClick={(e) => {
                          e.stopPropagation();
                          onChange(removeMovableRegion(value, region.id));
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={region.prompt}
                      placeholder="Region prompt…"
                      onChange={(event) =>
                        onChange(
                          updateMovableRegion(value, region.id, { prompt: event.target.value }),
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="region-add-btn"
              onClick={() => onChange(addMovableRegion(value))}
            >
              + Add region
            </button>
          </>
        ) : (
          <div className="region-cell-prompts">
            {plan.cells.map((cell, index) => (
              <label key={cell.id} style={{ "--region-color": CELL_COLORS[index % CELL_COLORS.length] } as CSSProperties}>
                <span>{cell.id.toUpperCase()}</span>
                <textarea
                  rows={2}
                  value={value.cellPrompts[cell.row][cell.column]}
                  placeholder="Region prompt…"
                  onChange={(event) => onChange(updateCellPrompt(value, cell.row, cell.column, event.target.value))}
                />
              </label>
            ))}
          </div>
        )}

        <label className="region-background-prompt">
          <span>
            <input
              type="checkbox"
              checked={value.backgroundEnabled}
              onChange={(event) => onChange({ ...value, backgroundEnabled: event.target.checked })}
            />
            {isRegionsMode ? "Background (scene & camera lock)" : "Prompt ungridded background"}
          </span>
          <textarea
            rows={2}
            disabled={!value.backgroundEnabled}
            value={value.backgroundPrompt}
            placeholder={isRegionsMode ? "Background & camera prompt for early steps…" : "Background prompt…"}
            onChange={(event) => onChange({ ...value, backgroundPrompt: event.target.value })}
          />
        </label>
      </div>

      <details className="region-plan">
        <summary>Plan geometry</summary>
        <dl>
          <div><dt>Canvas</dt><dd>{frameWidth} × {frameHeight}</dd></div>
          <div><dt>Regions</dt><dd>{isRegionsMode ? (value.regions?.length ?? 0) : plan.cells.length}</dd></div>
          {isRegionsMode ? (
            <>
              <div><dt>Lock steps</dt><dd>{Math.round((value.lockFraction ?? 0.25) * 100)}%</dd></div>
              <div><dt>Soft edge</dt><dd>{plan.softnessPixels.toFixed(1)} px</dd></div>
            </>
          ) : (
            <>
              <div><dt>Centre</dt><dd>{Math.round(value.transform.centerX * 100)}%, {Math.round(value.transform.centerY * 100)}%</dd></div>
              <div><dt>Scale</dt><dd>{Math.round(value.transform.width * 100)}% × {Math.round(value.transform.height * 100)}%</dd></div>
              <div><dt>Rotation</dt><dd>{value.transform.rotation.toFixed(1)}°</dd></div>
              <div><dt>Soft edge</dt><dd>{plan.softnessPixels.toFixed(1)} px</dd></div>
            </>
          )}
        </dl>
      </details>
    </section>
  );
}
