import type { EditorVariation } from "../domain/editorVariations";

interface EditorVariationTrayProps {
  variations: EditorVariation[];
  activeId: string | null;
  onSelect: (variation: EditorVariation) => void;
}

export function EditorVariationTray({
  variations,
  activeId,
  onSelect,
}: EditorVariationTrayProps) {
  return (
    <section className="editor-variations" aria-label="Edit session variations">
      <header>
        <strong>Session variations</strong>
        <span>{variations.length} available</span>
      </header>
      <div className="editor-variations__tray">
        {variations.map((variation) => (
          <button
            type="button"
            key={variation.id}
            className={variation.id === activeId ? "is-selected" : ""}
            onClick={() => onSelect(variation)}
            aria-pressed={variation.id === activeId}
            title={`Use ${variation.label.toLowerCase()} as the current edit source`}
          >
            {variation.image ? (
              <img src={variation.image} alt="" />
            ) : (
              <span className="editor-variations__blank" aria-hidden="true" />
            )}
            <span>{variation.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
