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
        <span className="phase">{value.rows.length} × {value.columns.length} grid</span>
      </header>
      <p className="region-stage__instruction">
        Pen the centre dot to move the foreground, the diamond to turn and scale, and a broad divider to resize adjacent cells.
      </p>
      <RegionMap value={value} frameWidth={frameWidth} frameHeight={frameHeight} onChange={onChange} />
      <footer className="region-stage__legend">
        <span><i className="legend-dot legend-dot--move" /> Move</span>
        <span><i className="legend-dot legend-dot--turn" /> Rotate + scale</span>
        <span><i className="legend-line" /> Resize boundary</span>
        <small>{frameWidth} × {frameHeight} output coordinates</small>
      </footer>
    </section>
  );
}
