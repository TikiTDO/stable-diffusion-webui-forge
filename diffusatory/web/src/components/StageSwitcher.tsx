export type StageSurface = "variants" | "editor" | "regions";

interface StageSwitcherProps {
  surface: StageSurface;
  candidateCount: number;
  hasEditorDocument: boolean;
  regionsEnabled: boolean;
  regionCount: number;
  sourceKind: "prompt" | "editor";
  sourceDimensions: { width: number; height: number };
  onShowVariants: () => void;
  onShowEditor: () => void;
  onShowRegions: () => void;
}

export function StageSwitcher({
  surface,
  candidateCount,
  hasEditorDocument,
  regionsEnabled,
  regionCount,
  sourceKind,
  sourceDimensions,
  onShowVariants,
  onShowEditor,
  onShowRegions,
}: StageSwitcherProps) {
  return (
    <nav className="stage-switcher" aria-label="Stage surface">
      <div className="stage-switcher__surfaces">
        <span>Stage</span>
        <button
          type="button"
          className={surface === "variants" ? "is-selected" : ""}
          aria-pressed={surface === "variants"}
          onClick={onShowVariants}
        >
          Variants <small>{candidateCount}</small>
        </button>
        <button
          type="button"
          className={surface === "editor" ? "is-selected" : ""}
          aria-pressed={surface === "editor"}
          onClick={onShowEditor}
        >
          {hasEditorDocument ? "Draw / mask" : "+ Blank canvas"}
        </button>
        <button
          type="button"
          className={surface === "regions" ? "is-selected" : ""}
          aria-pressed={surface === "regions"}
          onClick={onShowRegions}
        >
          {regionsEnabled ? "Regions" : "+ Regions"}
          {regionsEnabled && <small>{regionCount}</small>}
        </button>
      </div>
      <div className="stage-switcher__request" aria-label="Next generation source">
        <span>Next request</span>
        <strong>
          {sourceKind === "editor"
            ? `Active image · ${sourceDimensions.width} × ${sourceDimensions.height}`
            : `Prompt · ${sourceDimensions.width} × ${sourceDimensions.height}`}
        </strong>
      </div>
    </nav>
  );
}
