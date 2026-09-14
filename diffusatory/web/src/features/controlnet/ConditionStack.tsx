import type { ControlNetCatalog } from "../../api/forge/types";
import { NumberInput } from "../../components/NumberInput";
import {
  conditionForIntent,
  conditionIssue,
  orderedIntents,
} from "./model";
import type { ConditionPatch, ControlNetCondition } from "./types";

interface ConditionStackProps {
  catalog: ControlNetCatalog | null;
  error: string | null;
  loading: boolean;
  conditions: ControlNetCondition[];
  currentImageAvailable: boolean;
  onAdd: () => void;
  onChange: (id: string, patch: ConditionPatch) => void;
  onReplace: (condition: ControlNetCondition) => void;
  onRemove: (id: string) => void;
  onPreview: (condition: ControlNetCondition) => void;
  onReload: () => void;
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The selected image could not be read."));
    reader.onerror = () => reject(reader.error ?? new Error("Image read failed."));
    reader.readAsDataURL(file);
  });
}

export function ConditionStack({
  catalog,
  error,
  loading,
  conditions,
  currentImageAvailable,
  onAdd,
  onChange,
  onReplace,
  onRemove,
  onPreview,
  onReload,
}: ConditionStackProps) {
  const intents = catalog ? orderedIntents(catalog) : [];

  return (
    <section className="condition-stack" aria-labelledby="conditions-title">
      <header className="condition-stack__header">
        <div>
          <p className="eyebrow">Composition guides</p>
          <h3 id="conditions-title">Conditions</h3>
          <small>Give the model structure, pose, depth, or a visual reference.</small>
        </div>
        <button
          type="button"
          className="add-condition"
          disabled={!catalog || conditions.length >= 3}
          onClick={onAdd}
        >
          + Add condition
        </button>
      </header>

      {loading && <p className="condition-stack__notice">Reading ControlNet tools…</p>}
      {error && (
        <div className="condition-stack__notice is-error" role="alert">
          <span>ControlNet is unavailable: {error}</span>
          <button type="button" onClick={onReload}>Retry</button>
        </div>
      )}

      {conditions.length === 0 && !loading && !error && (
        <button type="button" className="condition-empty" onClick={onAdd}>
          <strong>Add a guide when words are not enough.</strong>
          <span>Pose, depth, line art, reference image, edges, and more.</span>
        </button>
      )}

      <div className="condition-list">
        {conditions.map((condition, index) => {
          const type = catalog?.types[condition.intent];
          const issue = conditionIssue(
            condition,
            currentImageAvailable ? "available" : null,
          );
          const sourceImage =
            condition.source.kind === "independent"
              ? condition.source.image
              : null;
          return (
            <article
              className={`condition-card ${condition.enabled ? "" : "is-disabled"}`}
              key={condition.id}
            >
              <header className="condition-card__header">
                <span className="condition-number">{index + 1}</span>
                <label className="condition-intent">
                  <span>Guide by</span>
                  <select
                    value={condition.intent}
                    disabled={!catalog}
                    onChange={(event) => {
                      if (!catalog) return;
                      onReplace(
                        conditionForIntent(condition, event.target.value, catalog),
                      );
                    }}
                  >
                    {intents.map((intent) => (
                      <option value={intent} key={intent}>{intent}</option>
                    ))}
                  </select>
                </label>
                <label className="condition-enabled">
                  <input
                    type="checkbox"
                    checked={condition.enabled}
                    onChange={(event) =>
                      onChange(condition.id, { enabled: event.target.checked })
                    }
                  />
                  Use
                </label>
                <button
                  type="button"
                  className="condition-remove"
                  aria-label={`Remove condition ${index + 1}`}
                  onClick={() => onRemove(condition.id)}
                >
                  ×
                </button>
              </header>

              <div className="condition-card__body">
                <div className="condition-source">
                  <div className="condition-source__switch">
                    <button
                      type="button"
                      className={condition.source.kind === "current" ? "is-selected" : ""}
                      disabled={!currentImageAvailable}
                      title={
                        currentImageAvailable
                          ? "Use the visible paint / inpaint canvas"
                          : "Open an image in the editor first"
                      }
                      onClick={() => onChange(condition.id, { source: { kind: "current" } })}
                    >
                      Current canvas
                    </button>
                    <label className={condition.source.kind === "independent" ? "is-selected" : ""}>
                      <span>Choose image</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          void fileAsDataUrl(file)
                            .then((image) =>
                              onChange(condition.id, {
                                source: {
                                  kind: "independent",
                                  image,
                                  name: file.name,
                                },
                              }),
                            )
                            .catch((error: unknown) =>
                              onChange(condition.id, {
                                previewStatus: "failed",
                                previewError:
                                  error instanceof Error
                                    ? error.message
                                    : "The image could not be read.",
                              }),
                            );
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  <div className="condition-source__preview">
                    {condition.source.kind === "current" ? (
                      <div className="current-canvas-token">
                        <span aria-hidden="true">◎</span>
                        <strong>Live canvas</strong>
                        <small>Paint included at render time</small>
                      </div>
                    ) : sourceImage ? (
                      <>
                        <img src={sourceImage} alt="Condition source" />
                        <small>{condition.source.name}</small>
                      </>
                    ) : (
                      <div className="condition-source__placeholder">
                        <span aria-hidden="true">↥</span>
                        <small>Independent image source</small>
                      </div>
                    )}
                  </div>
                </div>

                <div className="condition-method">
                  <label>
                    <span>Read image as</span>
                    <select
                      value={condition.module}
                      onChange={(event) =>
                        onChange(condition.id, {
                          module: event.target.value,
                          preview: null,
                          previewStatus: "idle",
                          previewError: null,
                        })
                      }
                    >
                      {type?.modules.map((module) => (
                        <option value={module} key={module}>{module}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Control model</span>
                    <select
                      value={condition.model}
                      onChange={(event) => onChange(condition.id, { model: event.target.value })}
                    >
                      {type?.models.map((model) => (
                        <option value={model} key={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="preview-condition"
                    disabled={Boolean(issue) || condition.previewStatus === "loading"}
                    onClick={() => onPreview(condition)}
                  >
                    {condition.previewStatus === "loading" ? "Reading…" : "Inspect guide"}
                  </button>
                </div>

                {(condition.preview || condition.previewError) && (
                  <div className="condition-output" aria-live="polite">
                    {condition.preview ? (
                      <>
                        <img src={condition.preview} alt={`${condition.intent} preprocessor result`} />
                        <small>This is the guide Forge will derive from the source.</small>
                      </>
                    ) : (
                      <p role="alert">{condition.previewError}</p>
                    )}
                  </div>
                )}
              </div>

              <details className="condition-tuning">
                <summary>
                  <span>Tune condition</span>
                  <small>{condition.weight.toFixed(2)} weight · {condition.controlMode}</small>
                </summary>
                <div className="condition-tuning__grid">
                  <label>
                    <span>Weight {condition.weight.toFixed(2)}</span>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={condition.weight}
                      onChange={(event) => onChange(condition.id, { weight: event.target.valueAsNumber })}
                    />
                  </label>
                  <label>
                    <span>Fit</span>
                    <select
                      value={condition.resizeMode}
                      onChange={(event) =>
                        onChange(condition.id, {
                          resizeMode: event.target.value as ControlNetCondition["resizeMode"],
                        })
                      }
                    >
                      <option>Crop and Resize</option>
                      <option>Resize and Fill</option>
                      <option>Just Resize</option>
                    </select>
                  </label>
                  <label>
                    <span>Priority</span>
                    <select
                      value={condition.controlMode}
                      onChange={(event) =>
                        onChange(condition.id, {
                          controlMode: event.target.value as ControlNetCondition["controlMode"],
                        })
                      }
                    >
                      <option>Balanced</option>
                      <option>My prompt is more important</option>
                      <option>ControlNet is more important</option>
                    </select>
                  </label>
                  <label className="condition-check">
                    <input
                      type="checkbox"
                      checked={condition.pixelPerfect}
                      onChange={(event) => onChange(condition.id, { pixelPerfect: event.target.checked })}
                    />
                    Pixel perfect resolution
                  </label>
                  <label>
                    <span>Starts {condition.guidanceStart.toFixed(2)}</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={condition.guidanceStart}
                      onChange={(event) => onChange(condition.id, { guidanceStart: event.target.valueAsNumber })}
                    />
                  </label>
                  <label>
                    <span>Ends {condition.guidanceEnd.toFixed(2)}</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={condition.guidanceEnd}
                      onChange={(event) => onChange(condition.id, { guidanceEnd: event.target.valueAsNumber })}
                    />
                  </label>
                  <label>
                    <span>Processor resolution</span>
                    <NumberInput
                      min="-1"
                      max="2048"
                      step="64"
                      value={condition.processorResolution}
                      disabled={condition.pixelPerfect}
                      clamp={(value) => Math.min(2048, Math.max(-1, value))}
                      onValueChange={(processorResolution) =>
                        onChange(condition.id, { processorResolution })
                      }
                    />
                  </label>
                  <label>
                    <span>Threshold A</span>
                    <NumberInput
                      min="-1"
                      value={condition.thresholdA}
                      onValueChange={(thresholdA) =>
                        onChange(condition.id, { thresholdA })
                      }
                    />
                  </label>
                  <label>
                    <span>Threshold B</span>
                    <NumberInput
                      min="-1"
                      value={condition.thresholdB}
                      onValueChange={(thresholdB) =>
                        onChange(condition.id, { thresholdB })
                      }
                    />
                  </label>
                </div>
              </details>

              {issue && condition.enabled && <p className="condition-issue">{issue}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
