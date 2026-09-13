import { memo, useEffect, useState } from "react";

import type { GenerationState } from "../domain/generation";

interface StageProps {
  generation: GenerationState;
}

function formatEta(eta: number | null): string | null {
  if (eta === null || !Number.isFinite(eta) || eta <= 0) return null;
  if (eta < 60) return `${Math.ceil(eta)}s remaining`;
  return `${Math.ceil(eta / 60)}m remaining`;
}

export const Stage = memo(function Stage({ generation }: StageProps) {
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const activeImage = generation.images.at(-1) ?? generation.preview;
  const eta = formatEta(generation.eta);

  useEffect(() => {
    if (!viewerImage) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewerImage(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [viewerImage]);

  return (
    <section className="stage" aria-label="Generation stage">
      <header className="stage__header">
        <div>
          <p className="eyebrow">Stage</p>
          <h2>{generation.images.length ? "Result" : "Live composition"}</h2>
        </div>
        <div className={`phase phase--${generation.phase}`}>
          {generation.phase.replaceAll("-", " ")}
        </div>
      </header>

      <div className="stage__canvas">
        {activeImage ? (
          <button
            className="stage__image-button"
            type="button"
            onClick={() => setViewerImage(activeImage)}
            aria-label="Open image in viewer"
          >
            <img src={activeImage} alt="Current generated composition" />
          </button>
        ) : (
          <div className="stage__empty">
            <span className="stage__reticle" aria-hidden="true" />
            <p>The first image has not arrived yet.</p>
            <small>Your prompt stays editable while Forge works.</small>
          </div>
        )}
      </div>

      <div className="stage__status" aria-live="polite">
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${generation.progress * 100}%` }} />
        </div>
        <div className="stage__status-copy">
          <span>{generation.text}</span>
          {eta && <span>{eta}</span>}
        </div>
        {generation.error && (
          <p className="stage__error" role="alert">
            {generation.error}
          </p>
        )}
      </div>

      {generation.images.length > 1 && (
        <div className="result-tray" aria-label="Generation results">
          {generation.images.map((image, index) => (
            <button
              type="button"
              key={`${generation.taskId}-${index}`}
              onClick={() => setViewerImage(image)}
              aria-label={`Open result ${index + 1}`}
            >
              <img src={image} alt={`Generated result ${index + 1}`} />
            </button>
          ))}
        </div>
      )}

      {generation.taskId && (
        <details className="run-details">
          <summary>Run record</summary>
          <dl>
            <div>
              <dt>Task</dt>
              <dd>{generation.taskId}</dd>
            </div>
            {generation.info && (
              <div>
                <dt>Forge info</dt>
                <dd>{generation.info}</dd>
              </div>
            )}
          </dl>
        </details>
      )}

      {viewerImage && (
        <div
          className="viewer"
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          onClick={() => setViewerImage(null)}
        >
          <button
            type="button"
            className="viewer__close"
            onClick={() => setViewerImage(null)}
          >
            Close
          </button>
          <img
            src={viewerImage}
            alt="Generated composition at full size"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
});
