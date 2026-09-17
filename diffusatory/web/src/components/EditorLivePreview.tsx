import type { GenerationState } from "../domain/generation";
import type { EditOperation } from "../features/editor/model";

export interface EditorLivePreviewProps {
  generation: GenerationState;
  activeOperation: EditOperation | null;
  activeInpaintScope: "masked" | "whole" | null;
  defaultOutputs: number;
  onTogglePreview?: () => void;
  layout?: "panel" | "dialog";
}

export function EditorLivePreview({
  generation,
  activeOperation,
  activeInpaintScope,
  defaultOutputs,
  onTogglePreview,
  layout = "dialog",
}: EditorLivePreviewProps) {
  const liveOutputs = generation.job?.outputs ?? defaultOutputs;
  const liveProgress = Math.round(generation.progress * 100);

  return (
    <section
      className={`editor-live-preview focused-edit__live-render editor-live-preview--${layout}`}
      aria-label="Live edit render"
      aria-live="polite"
    >
      <header className="editor-live-preview__header">
        <div>
          <p className="eyebrow">Live edit</p>
          <h3>
            {activeOperation === "inpaint"
              ? activeInpaintScope === "masked"
                ? "Regenerating masked crop"
                : "Regenerating whole-frame"
              : "Building image variations"}
          </h3>
        </div>
        <div className="editor-live-preview__actions">
          {onTogglePreview && (
            <button
              type="button"
              className="live-preview-toggle"
              onClick={onTogglePreview}
              title="Hide generating preview to see canvas"
            >
              Canvas view
            </button>
          )}
          <span>
            {liveOutputs} candidate{liveOutputs === 1 ? "" : "s"}
          </span>
        </div>
      </header>
      <div className="focused-edit__live-plate editor-live-preview__plate">
        {generation.preview ? (
          <img
            key={generation.previewId}
            src={generation.preview}
            alt={
              liveOutputs > 1
                ? `Live contact sheet for ${liveOutputs} image variations`
                : "Live image variation preview"
            }
          />
        ) : (
          <div
            className="focused-edit__live-placeholders editor-live-preview__placeholders"
            data-count={Math.min(liveOutputs, 8)}
            aria-label="Waiting for preview steps"
          >
            {Array.from({ length: Math.min(liveOutputs, 8) }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
        )}
      </div>
      <footer className="editor-live-preview__footer">
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${liveProgress}%` }} />
        </div>
        <div>
          <strong>{liveProgress}%</strong>
          <span>{generation.text}</span>
          {generation.eta !== null && (
            <span>{Math.max(0, generation.eta).toFixed(1)}s ETA</span>
          )}
        </div>
      </footer>
    </section>
  );
}
