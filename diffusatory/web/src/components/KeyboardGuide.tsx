interface KeyboardGuideProps {
  open: boolean;
  onClose: () => void;
}

const navigation = [
  ["Alt P", "Prompt"],
  ["Alt Shift P", "Negative prompt"],
  ["Alt M", "Checkpoint"],
  ["Alt F", "Frame width"],
  ["Alt Shift F", "Frame height"],
  ["Alt R", "Sampler"],
  ["Alt Shift R", "Scheduler"],
  ["Alt N", "Candidates"],
  ["Alt S", "Seed"],
  ["Alt I", "Ingredients"],
  ["Alt T", "Image tools"],
];

const surfaces = [
  ["Alt V", "Variants"],
  ["Alt E", "Draw / mask"],
  ["Alt L", "Regions"],
  ["Alt D", "New drawing"],
  ["Alt O", "Open image"],
];

const actions = [
  ["Alt G", "Generate"],
  ["Ctrl Enter", "Generate"],
  ["Alt Shift G", "Inpaint masked"],
  ["Ctrl Shift Enter", "Inpaint masked"],
  ["Alt W", "Inpaint whole frame"],
  ["Alt K", "Skip current image"],
  ["Alt X", "Cancel render"],
  ["Alt /", "Show or hide this map"],
  ["Esc", "Close viewer or this map"],
];

function ShortcutGroup({
  title,
  entries,
}: {
  title: string;
  entries: string[][];
}) {
  return (
    <section>
      <h3>{title}</h3>
      <dl>
        {entries.map(([keys, label]) => (
          <div key={keys}>
            <dt><kbd>{keys}</kbd></dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function KeyboardGuide({ open, onClose }: KeyboardGuideProps) {
  if (!open) return null;
  return (
    <div
      className="keyboard-guide"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-label="Workbench keyboard map">
        <header>
          <div>
            <p className="eyebrow">Keyboard map</p>
            <h2>Run the workbench without the mouse</h2>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="keyboard-guide__groups">
          <ShortcutGroup title="Go to" entries={navigation} />
          <ShortcutGroup title="Surfaces" entries={surfaces} />
          <ShortcutGroup title="Actions" entries={actions} />
        </div>
        <p>
          Once focused, use normal Tab, Shift Tab, arrow keys, Space, and Enter.
          The canvas keeps its compact Q/W, A/S/D/F, C/V, Z, and Shift B controls.
        </p>
      </section>
    </div>
  );
}
