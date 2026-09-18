import { RegionMap } from "./RegionMap";
import type { RegionalComposition } from "./types";

interface RegionStageProps {
  value: RegionalComposition;
  frameWidth: number;
  frameHeight: number;
  onChange: (value: RegionalComposition) => void;
}

export function RegionStage({ value, frameWidth, frameHeight, onChange }: RegionStageProps) {
  return (
    <section className="stage stage--regions" aria-label="Regional composition stage">
      <header className="stage__header">
        <div><p className="eyebrow">Spatial stage</p><h2>Block the shot</h2></div>
        <span className="phase">
          {value.regions?.length
            ? `${value.regions.length} region${value.regions.length === 1 ? "" : "s"}`
            : `${value.rows.length} × ${value.columns.length} grid`}
        </span>
      </header>
      <p className="region-stage__instruction">
        Drag the centre handle to reposition a region, the outer handle to rotate and scale.
      </p>
      <RegionMap value={value} frameWidth={frameWidth} frameHeight={frameHeight} onChange={onChange} />
      <footer className="region-stage__legend">
        <span><i className="legend-dot legend-dot--move" /> Move</span>
        <span><i className="legend-dot legend-dot--turn" /> Rotate + scale</span>
        <small>{frameWidth} × {frameHeight} output coordinates</small>
      </footer>
    </section>
  );
}
