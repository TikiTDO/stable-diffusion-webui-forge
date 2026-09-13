import { memo, useEffect, useState } from "react";

import type { GenerationState } from "../domain/generation";

interface StageProps {
  generation: GenerationState;
  onRefine?: (source: string) => void;
}

function formatEta(eta: number | null): string | null {
  if (eta === null || !Number.isFinite(eta) || eta <= 0) return null;
  if (eta < 60) return `${Math.ceil(eta)}s remaining`;
  return `${Math.ceil(eta / 60)}m remaining`;
}

export const Stage = memo(function Stage({ generation, onRefine }: StageProps) {
  const [viewer, setViewer] = useState<{
    image: string;
    index: number | null;
  } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewerZoom, setViewerZoom] = useState(1);
  const selectedResult =
    generation.results[selectedIndex] ?? generation.results[0] ?? null;
  const selectedImage = generation.images[selectedIndex] ?? generation.images[0];
  const activeImage = selectedImage ?? generation.preview;
  const eta = formatEta(generation.eta);

  useEffect(() => {
    setSelectedIndex(0);
    setViewer(null);
  }, [generation.taskId]);

  useEffect(() => {
    if (!viewer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewer(null);
        return;
      }
      if (viewer.index === null || generation.images.length < 2) return;
      if (event.key === "ArrowLeft") {
        const index =
          (viewer.index - 1 + generation.images.length) %
          generation.images.length;
        setSelectedIndex(index);
        setViewer({ image: generation.images[index], index });
      } else if (event.key === "ArrowRight") {
        const index = (viewer.index + 1) % generation.images.length;
        setSelectedIndex(index);
        setViewer({ image: generation.images[index], index });
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [generation.images, viewer]);

  const openViewer = (image: string, index: number | null) => {
    setViewerZoom(1);
    setViewer({ image, index });
  };

  const moveViewer = (direction: -1 | 1) => {
    if (!viewer || viewer.index === null || !generation.images.length) return;
    const index =
      (viewer.index + direction + generation.images.length) %
      generation.images.length;
    setSelectedIndex(index);
    setViewer({ image: generation.images[index], index });
  };

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
            onClick={() =>
              openViewer(activeImage, selectedImage ? selectedIndex : null)
            }
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

      {selectedResult && generation.phase === "completed" && (
        <section className="resolved-prompt" aria-label="Resolved prompt">
          <header>
            <strong>
              {selectedResult.kind === "contact-sheet"
                ? "Contact sheet"
                : selectedResult.kind === "auxiliary"
                  ? "Auxiliary image"
                  : "Resolved prompt"}
            </strong>
            {selectedResult.seed !== null && (
              <span>Image seed {selectedResult.seed}</span>
            )}
          </header>
          {selectedResult.prompt !== null ? (
            <p>{selectedResult.prompt || "(empty positive prompt)"}</p>
          ) : (
            <p className="resolved-prompt__note">
              {selectedResult.kind === "contact-sheet"
                ? "This overview combines the individual prompt realizations below."
                : "Forge did not return per-image prompt provenance for this output."}
            </p>
          )}
          {selectedResult.negativePrompt && (
            <small>Without: {selectedResult.negativePrompt}</small>
          )}
        </section>
      )}

      {generation.images.length > 0 && (
        <div className="result-actions">
          <div className="result-tray" aria-label="Generation results">
            {generation.images.map((image, index) => (
              <button
                type="button"
                key={`${generation.taskId}-${index}`}
                className={selectedIndex === index ? "is-selected" : ""}
                onClick={() => setSelectedIndex(index)}
                onDoubleClick={() => openViewer(image, index)}
                aria-label={`Select result ${index + 1}`}
              >
                <img src={image} alt={`Generated result ${index + 1}`} />
                {generation.results[index]?.kind === "contact-sheet" && (
                  <span>Sheet</span>
                )}
                {generation.results[index]?.kind === "auxiliary" && (
                  <span>Map</span>
                )}
              </button>
            ))}
          </div>
          {selectedImage && onRefine && selectedResult?.kind !== "contact-sheet" && (
            <button
              type="button"
              className="refine-result"
              onClick={() => onRefine(selectedImage)}
            >
              Paint / inpaint this shot
            </button>
          )}
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
            {generation.parameters && (
              <div>
                <dt>Request</dt>
                <dd>{JSON.stringify(generation.parameters)}</dd>
              </div>
            )}
          </dl>
        </details>
      )}

      {viewer && (
        <div
          className="viewer"
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
        >
          <div className="viewer__toolbar">
            {viewer.index !== null && generation.images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => moveViewer(-1)}
                  aria-label="Previous image"
                >
                  ←
                </button>
                <span>
                  {viewer.index + 1} / {generation.images.length}
                </span>
                <button
                  type="button"
                  onClick={() => moveViewer(1)}
                  aria-label="Next image"
                >
                  →
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setViewerZoom((zoom) => Math.max(1, zoom - 0.5))}
              disabled={viewerZoom <= 1}
              aria-label="Zoom out"
            >
              −
            </button>
            <span>{Math.round(viewerZoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setViewerZoom((zoom) => Math.min(4, zoom + 0.5))}
              disabled={viewerZoom >= 4}
              aria-label="Zoom in"
            >
              +
            </button>
            <button type="button" onClick={() => setViewerZoom(1)}>
              Fit
            </button>
            <button type="button" onClick={() => setViewer(null)}>
              Close
            </button>
          </div>
          <div
            className="viewer__viewport"
            onClick={() => setViewer(null)}
          >
            <div
              className="viewer__canvas"
              style={{
                width: `${viewerZoom * 100}%`,
                height: `${viewerZoom * 100}%`,
              }}
            >
              <img
                src={viewer.image}
                alt="Generated composition at full size"
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
