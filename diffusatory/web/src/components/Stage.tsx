import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  groupCandidateBatches,
  type Candidate,
  type CandidateBatch,
} from "../domain/candidates";
import { isGenerating, type GenerationState } from "../domain/generation";
import { saveImage } from "../domain/imageDownload";

interface StageProps {
  generation: GenerationState;
  candidates: Candidate[];
  frameWidth: number;
  frameHeight: number;
  candidateCount: number;
  onEdit?: (source: string, presentation: "workspace" | "focused") => void;
  onDismissCandidate: (id: string) => void;
  onDismissBatch: (taskId: string) => void;
  onClearCandidates: () => void;
}

interface GridLayout {
  columns: number;
  style: CSSProperties;
  cellStyle: CSSProperties;
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

function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 3) return count;
  if (count <= 6) return count <= 4 ? 2 : 3;
  return 4;
}

function gridLayout(count: number, width: number, height: number): GridLayout {
  const safeCount = Math.max(1, Math.min(8, count));
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const columns = gridColumns(safeCount);
  const rows = Math.ceil(safeCount / columns);
  const gridAspect = (columns * safeWidth) / (rows * safeHeight);
  const maxWidth = Math.min(1120, Math.max(320, 680 * gridAspect));
  return {
    columns,
    style: {
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      maxWidth: `${maxWidth}px`,
    },
    cellStyle: { aspectRatio: `${safeWidth} / ${safeHeight}` },
  };
}

function selectBatch(
  batch: CandidateBatch,
  setSelectedBatchId: (id: string) => void,
  setSelectedCandidateId: (id: string) => void,
  setViewer: (viewer: null) => void,
) {
  setSelectedBatchId(batch.taskId);
  setSelectedCandidateId(batch.candidates[0].id);
  setViewer(null);
}

export const Stage = memo(function Stage({
  generation,
  candidates,
  frameWidth,
  frameHeight,
  candidateCount,
  onEdit,
  onDismissCandidate,
  onDismissBatch,
  onClearCandidates,
}: StageProps) {
  const batches = useMemo(() => groupCandidateBatches(candidates), [candidates]);
  const [viewer, setViewer] = useState<{ image: string; index: number | null } | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [viewerZoom, setViewerZoom] = useState(1);
  const previousLastBatchId = useRef<string | null>(null);
  const activeBatch =
    batches.find((batch) => batch.taskId === selectedBatchId) ??
    batches.at(-1) ??
    null;
  const activeCandidates = activeBatch?.candidates ?? [];
  const selectedIndex = Math.max(
    0,
    activeCandidates.findIndex((candidate) => candidate.id === selectedCandidateId),
  );
  const selectedCandidate = activeCandidates[selectedIndex] ?? activeCandidates[0] ?? null;
  const selectedResult = selectedCandidate?.result ?? null;
  const selectedImage = selectedCandidate?.result.image ?? null;
  const showingLiveGeneration = isGenerating(generation.phase);
  const plannedWidth = showingLiveGeneration
    ? generation.job?.width ?? frameWidth
    : activeBatch?.width ?? frameWidth;
  const plannedHeight = showingLiveGeneration
    ? generation.job?.height ?? frameHeight
    : activeBatch?.height ?? frameHeight;
  const plannedCount = showingLiveGeneration
    ? generation.job?.outputs ?? candidateCount
    : activeBatch?.candidates.length ?? candidateCount;
  const layout = gridLayout(plannedCount, plannedWidth, plannedHeight);
  const eta = formatEta(generation.eta);

  useEffect(() => {
    const latest = batches.at(-1) ?? null;
    if (!latest) {
      previousLastBatchId.current = null;
      setSelectedBatchId(null);
      setSelectedCandidateId(null);
      setViewer(null);
      return;
    }
    const newBatch = latest.taskId !== previousLastBatchId.current;
    previousLastBatchId.current = latest.taskId;
    const selectedBatch = batches.find((batch) => batch.taskId === selectedBatchId);
    if (newBatch || !selectedBatch) {
      setSelectedBatchId(latest.taskId);
      setSelectedCandidateId(latest.candidates[0].id);
      setViewer(null);
      return;
    }
    if (!selectedBatch.candidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(selectedBatch.candidates[0].id);
      setViewer(null);
    }
  }, [batches, selectedBatchId, selectedCandidateId]);

  useEffect(() => {
    if (!viewer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewer(null);
        return;
      }
      if (viewer.index === null || activeCandidates.length < 2) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const index =
          (viewer.index + direction + activeCandidates.length) % activeCandidates.length;
        setSelectedCandidateId(activeCandidates[index].id);
        setViewer({ image: activeCandidates[index].result.image, index });
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [activeCandidates, viewer]);

  const openViewer = (image: string, index: number | null) => {
    setViewerZoom(1);
    setViewer({ image, index });
  };

  const moveViewer = (direction: -1 | 1) => {
    if (!viewer || viewer.index === null || !activeCandidates.length) return;
    const index =
      (viewer.index + direction + activeCandidates.length) % activeCandidates.length;
    setSelectedCandidateId(activeCandidates[index].id);
    setViewer({ image: activeCandidates[index].result.image, index });
  };

  const dismissCandidate = (id: string) => {
    if (id === selectedCandidateId) {
      const remaining = activeCandidates.filter((candidate) => candidate.id !== id);
      const adjacent = remaining[Math.min(selectedIndex, remaining.length - 1)] ?? null;
      setSelectedCandidateId(adjacent?.id ?? null);
    }
    onDismissCandidate(id);
  };

  const skeleton = (
    <div
      className="stage__candidate-grid stage__candidate-grid--skeleton"
      style={layout.style}
      aria-label={`Empty ${plannedWidth} by ${plannedHeight} frame with ${plannedCount} ${plannedCount === 1 ? "candidate" : "candidates"}`}
    >
      {Array.from({ length: Math.max(1, Math.min(8, plannedCount)) }, (_, index) => (
        <div className="stage__skeleton-cell" style={layout.cellStyle} key={index}>
          <span>{index + 1}</span>
        </div>
      ))}
    </div>
  );

  return (
    <section className="stage" aria-label="Generation stage">
      <header className="stage__header">
        <div>
          <p className="eyebrow">Stage</p>
          <h2>{candidates.length ? "Unaccepted generations" : "Live composition"}</h2>
        </div>
        <div className={`phase phase--${generation.phase}`}>
          {generation.phase.replaceAll("-", " ")}
        </div>
      </header>

      <div className="stage__canvas">
        {showingLiveGeneration ? (
          generation.preview ? (
            <button
              className="stage__live-preview"
              style={layout.style}
              type="button"
              onClick={() => openViewer(generation.preview!, null)}
              aria-label="Open live generation preview"
            >
              <img src={generation.preview} alt="Live generation preview" />
            </button>
          ) : skeleton
        ) : activeBatch ? (
          <div
            className={`stage__candidate-grid ${activeCandidates.length > 1 ? "is-batch" : "is-single"}`}
            style={layout.style}
            aria-label={`${activeCandidates.length} candidates from the selected generation`}
          >
            {activeCandidates.map((candidate, index) => (
              <div
                className={`stage__candidate-cell ${selectedCandidate?.id === candidate.id ? "is-selected" : ""}`}
                style={layout.cellStyle}
                key={candidate.id}
              >
                <button
                  type="button"
                  className="stage__candidate-select"
                  onClick={() => setSelectedCandidateId(candidate.id)}
                  onDoubleClick={() => openViewer(candidate.result.image, index)}
                  aria-label={`Select candidate ${index + 1} of ${activeCandidates.length}`}
                >
                  <img src={candidate.result.image} alt={`Generation candidate ${index + 1}`} />
                  {activeCandidates.length > 1 && <span>{index + 1}</span>}
                </button>
                <button
                  type="button"
                  className="stage__candidate-dismiss"
                  aria-label={`Dismiss candidate ${index + 1}`}
                  title="Remove from this workbench; raw output remains on disk"
                  onClick={() => dismissCandidate(candidate.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : skeleton}

        {(showingLiveGeneration ? generation.preview : selectedImage) && (
          <div className="stage__selection-actions">
            {!showingLiveGeneration && selectedImage && onEdit && (
              <button type="button" onClick={() => onEdit(selectedImage, "workspace")}>
                Edit selected
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const image = showingLiveGeneration ? generation.preview : selectedImage;
                if (!image) return;
                saveImage(
                  image,
                  showingLiveGeneration
                    ? "preview"
                    : selectedResult?.seed === null || selectedResult?.seed === undefined
                      ? "image"
                      : `seed-${selectedResult.seed}`,
                );
              }}
            >
              {showingLiveGeneration ? "Save preview" : "Save selected"}
            </button>
          </div>
        )}
      </div>

      {batches.length > 0 && (
        <div className="candidate-shelf">
          <header>
            <span>
              {batches.length} unaccepted {batches.length === 1 ? "generation" : "generations"} · {candidates.length} {candidates.length === 1 ? "image" : "images"}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedBatchId(null);
                setSelectedCandidateId(null);
                onClearCandidates();
              }}
            >
              Clear shelf
            </button>
          </header>
          <div className="batch-tray" aria-label="Unaccepted generation batches">
            {batches.map((batch, batchIndex) => {
              const miniLayout = gridLayout(batch.candidates.length, batch.width, batch.height);
              return (
                <div
                  className={`batch-tile ${activeBatch?.taskId === batch.taskId ? "is-selected" : ""}`}
                  key={batch.taskId}
                >
                  <button
                    type="button"
                    className="batch-tile__select"
                    onClick={() =>
                      selectBatch(batch, setSelectedBatchId, setSelectedCandidateId, setViewer)
                    }
                    aria-label={`Show generation ${batchIndex + 1} with ${batch.candidates.length} candidates`}
                  >
                    <span
                      className="batch-tile__grid"
                      style={{ gridTemplateColumns: `repeat(${miniLayout.columns}, minmax(0, 1fr))` }}
                    >
                      {batch.candidates.map((candidate) => (
                        <img src={candidate.result.image} alt="" key={candidate.id} />
                      ))}
                    </span>
                    <span className="batch-tile__label">
                      Run {batchIndex + 1} · {batch.candidates.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="batch-tile__dismiss"
                    onClick={() => onDismissBatch(batch.taskId)}
                    aria-label={`Dismiss generation ${batchIndex + 1}`}
                    title="Remove this generation from the workbench; raw output remains on disk"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <small>Clearing this shelf does not remove Forge’s raw output from disk.</small>
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
        {showingLiveGeneration && generation.job && (
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
                ? ` · +${generation.job.additionalPrompts} resolved prompt${generation.job.additionalPrompts === 1 ? "" : "s"}`
                : ""}
            </p>
          </div>
        )}
        {generation.error && <p className="stage__error" role="alert">{generation.error}</p>}
      </div>

      {selectedResult && (
        <section className="resolved-prompt" aria-label="Resolved prompt">
          <header>
            <strong>Resolved prompt</strong>
            {selectedResult.seed !== null && <span>Image seed {selectedResult.seed}</span>}
          </header>
          {selectedResult.prompt !== null ? (
            <p>{selectedResult.prompt || "(empty positive prompt)"}</p>
          ) : (
            <p className="resolved-prompt__note">Forge did not return per-image prompt provenance for this output.</p>
          )}
          {selectedResult.negativePrompt && <small>Without: {selectedResult.negativePrompt}</small>}
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
            <div><dt>Task</dt><dd>{generation.taskId}</dd></div>
            {generation.info && <div><dt>Forge info</dt><dd>{generation.info}</dd></div>}
            {generation.parameters && <div><dt>Request</dt><dd>{JSON.stringify(generation.parameters)}</dd></div>}
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
            {viewer.index !== null && activeCandidates.length > 1 && (
              <>
                <button type="button" onClick={() => moveViewer(-1)} aria-label="Previous image">←</button>
                <span>{viewer.index + 1} / {activeCandidates.length}</span>
                <button type="button" onClick={() => moveViewer(1)} aria-label="Next image">→</button>
              </>
            )}
            <button type="button" onClick={() => setViewerZoom((zoom) => Math.max(1, zoom - 0.5))} disabled={viewerZoom <= 1} aria-label="Zoom out">−</button>
            <span>{Math.round(viewerZoom * 100)}%</span>
            <button type="button" onClick={() => setViewerZoom((zoom) => Math.min(4, zoom + 0.5))} disabled={viewerZoom >= 4} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => setViewerZoom(1)}>Fit</button>
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
            <button type="button" onClick={() => saveImage(viewer.image, "image")}>Save image</button>
            <button type="button" onClick={() => setViewer(null)}>Close</button>
          </div>
          <div className="viewer__viewport" onClick={() => setViewer(null)}>
            <div className="viewer__canvas" style={{ width: `${viewerZoom * 100}%`, height: `${viewerZoom * 100}%` }}>
              <img src={viewer.image} alt="Generated composition at full size" onClick={(event) => event.stopPropagation()} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
