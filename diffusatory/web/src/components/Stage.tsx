import { memo, useEffect, useRef, useState } from "react";

import { isGenerating, type GenerationState } from "../domain/generation";
import type { Candidate } from "../domain/candidates";
import { saveImage } from "../domain/imageDownload";

interface StageProps {
  generation: GenerationState;
  candidates: Candidate[];
  onEdit?: (source: string, presentation: "workspace" | "focused") => void;
  onDismissCandidate: (id: string) => void;
  onClearCandidates: () => void;
}

function formatEta(eta: number | null): string | null {
  if (eta === null || !Number.isFinite(eta) || eta <= 0) return null;
  if (eta < 60) return `${Math.ceil(eta)}s remaining`;
  return `${Math.ceil(eta / 60)}m remaining`;
}

function checkpointLabel(checkpoint: string): string {
  return checkpoint
    .replace(/\s*\[[^\]]+\]\s*$/, "")
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.safetensors$/i, "") ?? checkpoint;
}

export const Stage = memo(function Stage({
  generation,
  candidates,
  onEdit,
  onDismissCandidate,
  onClearCandidates,
}: StageProps) {
  const [viewer, setViewer] = useState<{
    image: string;
    index: number | null;
  } | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [viewerZoom, setViewerZoom] = useState(1);
  const previousCandidateCount = useRef(0);
  const selectedIndex = Math.max(
    0,
    candidates.findIndex((candidate) => candidate.id === selectedCandidateId),
  );
  const selectedCandidate = candidates[selectedIndex] ?? candidates[0] ?? null;
  const selectedResult = selectedCandidate?.result ?? null;
  const selectedImage = selectedCandidate?.result.image ?? null;
  const showingPreview = isGenerating(generation.phase) && Boolean(generation.preview);
  const activeImage =
    showingPreview && generation.preview
      ? generation.preview
      : selectedImage ?? generation.preview;
  const eta = formatEta(generation.eta);

  useEffect(() => {
    const grew = candidates.length > previousCandidateCount.current;
    previousCandidateCount.current = candidates.length;
    if (!candidates.length) {
      setSelectedCandidateId(null);
      setViewer(null);
      return;
    }
    if (
      grew ||
      !selectedCandidateId ||
      !candidates.some((candidate) => candidate.id === selectedCandidateId)
    ) {
      setSelectedCandidateId(candidates[candidates.length - 1].id);
      setViewer(null);
    }
  }, [candidates, selectedCandidateId]);

  useEffect(() => {
    if (!viewer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewer(null);
        return;
      }
      if (viewer.index === null || candidates.length < 2) return;
      if (event.key === "ArrowLeft") {
        const index =
          (viewer.index - 1 + candidates.length) % candidates.length;
        setSelectedCandidateId(candidates[index].id);
        setViewer({ image: candidates[index].result.image, index });
      } else if (event.key === "ArrowRight") {
        const index = (viewer.index + 1) % candidates.length;
        setSelectedCandidateId(candidates[index].id);
        setViewer({ image: candidates[index].result.image, index });
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [candidates, viewer]);

  const openViewer = (image: string, index: number | null) => {
    setViewerZoom(1);
    setViewer({ image, index });
  };

  const moveViewer = (direction: -1 | 1) => {
    if (!viewer || viewer.index === null || !candidates.length) return;
    const index =
      (viewer.index + direction + candidates.length) % candidates.length;
    setSelectedCandidateId(candidates[index].id);
    setViewer({ image: candidates[index].result.image, index });
  };

  const selectRelativeCandidate = (direction: -1 | 1) => {
    if (candidates.length < 2) return;
    const index =
      (selectedIndex + direction + candidates.length) % candidates.length;
    setSelectedCandidateId(candidates[index].id);
  };

  const dismissCandidate = (id: string) => {
    if (id === selectedCandidateId) {
      const remaining = candidates.filter((candidate) => candidate.id !== id);
      const adjacent = remaining[Math.min(selectedIndex, remaining.length - 1)] ?? null;
      setSelectedCandidateId(adjacent?.id ?? null);
    }
    onDismissCandidate(id);
  };

  return (
    <section className="stage" aria-label="Generation stage">
      <header className="stage__header">
        <div>
          <p className="eyebrow">Stage</p>
          <h2>{candidates.length ? "Unaccepted variants" : "Live composition"}</h2>
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
        {activeImage && (
          <button
            type="button"
            className="stage__save-image"
            onClick={() =>
              saveImage(
                activeImage,
                showingPreview
                  ? "preview"
                  : selectedResult?.seed === null || selectedResult?.seed === undefined
                    ? "image"
                  : `seed-${selectedResult.seed}`,
              )
            }
          >
            Save image
          </button>
        )}
        {selectedCandidate && candidates.length > 1 && !isGenerating(generation.phase) && (
          <nav className="stage__candidate-nav" aria-label="Browse unaccepted variants">
            <button
              type="button"
              onClick={() => selectRelativeCandidate(-1)}
              aria-label="Previous unaccepted variant"
            >
              ←
            </button>
            <span>{selectedIndex + 1} / {candidates.length}</span>
            <button
              type="button"
              onClick={() => selectRelativeCandidate(1)}
              aria-label="Next unaccepted variant"
            >
              →
            </button>
          </nav>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="result-actions">
          <div className="candidate-shelf">
            <header>
              <span>{candidates.length} unaccepted</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedCandidateId(null);
                  onClearCandidates();
                }}
              >
                Clear shelf
              </button>
            </header>
            <div className="result-tray" aria-label="Unaccepted generation candidates">
              {candidates.map((candidate, index) => (
                <div className="candidate-tile" key={candidate.id}>
                  <button
                    type="button"
                    className={selectedIndex === index ? "is-selected" : ""}
                    onClick={() => setSelectedCandidateId(candidate.id)}
                    onDoubleClick={() => openViewer(candidate.result.image, index)}
                    aria-label={`Select unaccepted candidate ${index + 1}`}
                  >
                    <img src={candidate.result.image} alt={`Unaccepted candidate ${index + 1}`} />
                    <span>{candidate.sourceKind === "img2img" ? "Edit" : `#${index + 1}`}</span>
                  </button>
                  <button
                    type="button"
                    className="candidate-dismiss"
                    aria-label={`Dismiss unaccepted candidate ${index + 1}`}
                    title="Remove from this shelf; raw output remains on disk"
                    onClick={() => dismissCandidate(candidate.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <small>Clear only hides these here; Forge’s raw output remains on disk.</small>
          </div>
          {selectedImage && onEdit && selectedResult?.kind !== "contact-sheet" && (
            <button
              type="button"
              className="refine-result"
              onClick={() => onEdit(selectedImage, "workspace")}
            >
              Edit
            </button>
          )}
        </div>
      )}

      <div className="stage__status" aria-live="polite">
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${generation.progress * 100}%` }} />
        </div>
        <div className="stage__status-copy">
          <span>{generation.text}</span>
          {eta && <span>{eta}</span>}
        </div>
        {isGenerating(generation.phase) && generation.job && (
          <div className="active-job" aria-label="Active generation">
            <div>
              <strong>
                {generation.job.kind === "img2img" ? "Editing" : "Generating"}{" "}
                {generation.job.outputs} {generation.job.outputs === 1 ? "image" : "images"}
              </strong>
              <span>
                {checkpointLabel(generation.job.checkpoint)} · {generation.job.width} ×{" "}
                {generation.job.height} · {generation.job.steps} steps ·{" "}
                {generation.job.sampler} / {generation.job.scheduler}
              </span>
            </div>
            <p>
              {generation.job.prompt || "(empty positive prompt)"}
              {generation.job.additionalPrompts
                ? ` · +${generation.job.additionalPrompts} resolved prompt${
                    generation.job.additionalPrompts === 1 ? "" : "s"
                  }`
                : ""}
            </p>
          </div>
        )}
        {generation.error && (
          <p className="stage__error" role="alert">
            {generation.error}
          </p>
        )}
      </div>

      {selectedResult && (
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
          {selectedResult.spatialPlan && (
            <details className="spatial-provenance">
              <summary>
                {selectedResult.spatialPlan.cells.length} region spatial plan · {selectedResult.spatialPlan.softnessPixels.toFixed(1)}px edge
              </summary>
              <dl>
                {selectedResult.spatialPlan.cells.map((cell) => (
                  <div key={cell.id}>
                    <dt>{cell.id}</dt>
                    <dd>
                      {cell.prompt || "common prompt only"} · {cell.polygon
                        .map((point) => `${Math.round(point.x)},${Math.round(point.y)}`)
                        .join(" · ")}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt>Complement</dt>
                  <dd>
                    {selectedResult.spatialPlan.background.enabled
                      ? selectedResult.spatialPlan.background.prompt || "common prompt only"
                      : "common prompt only"}
                  </dd>
                </div>
              </dl>
            </details>
          )}
        </section>
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
          onClick={(event) => {
            if (event.target === event.currentTarget) setViewer(null);
          }}
        >
          <div className="viewer__toolbar">
            {viewer.index !== null && candidates.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => moveViewer(-1)}
                  aria-label="Previous image"
                >
                  ←
                </button>
                <span>
                  {viewer.index + 1} / {candidates.length}
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
            {onEdit && (
              <button
                type="button"
                className="viewer__edit"
                onClick={() => {
                  onEdit(viewer.image, "focused");
                  setViewer(null);
                }}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => saveImage(viewer.image, "image")}
            >
              Save image
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
