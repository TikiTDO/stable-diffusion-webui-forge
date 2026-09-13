import type { ForgeCatalog } from "../api/forge/types";
import type { ControlNetCatalog } from "../api/forge/types";
import type {
  PromptExpansionMode,
  PromptExpansionResponse,
} from "../api/forge/types";
import type { GenerationDraft } from "../domain/draft";
import { ConditionStack } from "../features/controlnet/ConditionStack";
import type {
  ConditionPatch,
  ControlNetCondition,
} from "../features/controlnet/types";
import { PromptTools } from "./PromptTools";
import { PromptComposition } from "./PromptComposition";

interface ComposerProps {
  draft: GenerationDraft;
  catalog: ForgeCatalog | null;
  catalogError: string | null;
  catalogLoading: boolean;
  generating: boolean;
  canGenerate: boolean;
  workspaceMode: "compose" | "edit";
  editSettings: {
    denoisingStrength: number;
    maskBlur: number;
    inpaintOnlyMasked: boolean;
    inpaintPadding: number;
  };
  editDimensions: { width: number; height: number };
  onChange: (patch: Partial<GenerationDraft>) => void;
  onGenerate: () => void;
  onInterrupt: () => void;
  onSkip: () => void;
  onReloadCatalog: () => void;
  onWorkspaceModeChange: (mode: "compose" | "edit") => void;
  onNewDrawing: () => void;
  onEditSettingsChange: (
    patch: Partial<ComposerProps["editSettings"]>,
  ) => void;
  controlNetCatalog: ControlNetCatalog | null;
  controlNetError: string | null;
  controlNetLoading: boolean;
  conditions: ControlNetCondition[];
  currentImageAvailable: boolean;
  onAddCondition: () => void;
  onChangeCondition: (id: string, patch: ConditionPatch) => void;
  onReplaceCondition: (condition: ControlNetCondition) => void;
  onRemoveCondition: (id: string) => void;
  onPreviewCondition: (condition: ControlNetCondition) => void;
  onReloadControlNet: () => void;
  promptMode: PromptExpansionMode;
  expansionSeed: number;
  promptExpansion: PromptExpansionResponse | null;
  promptExpansionLoading: boolean;
  promptExpansionError: string | null;
  promptActionError: string | null;
  onPromptModeChange: (mode: PromptExpansionMode) => void;
  onExpansionSeedChange: (seed: number) => void;
  onShufflePromptSet: () => void;
}

const ASPECTS = [
  { label: "Square", width: 1024, height: 1024 },
  { label: "Portrait", width: 832, height: 1216 },
  { label: "Landscape", width: 1216, height: 832 },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function changedNumber(
  value: number,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;
}

export function Composer({
  draft,
  catalog,
  catalogError,
  catalogLoading,
  generating,
  canGenerate,
  workspaceMode,
  editSettings,
  editDimensions,
  onChange,
  onGenerate,
  onInterrupt,
  onSkip,
  onReloadCatalog,
  onWorkspaceModeChange,
  onNewDrawing,
  onEditSettingsChange,
  controlNetCatalog,
  controlNetError,
  controlNetLoading,
  conditions,
  currentImageAvailable,
  onAddCondition,
  onChangeCondition,
  onReplaceCondition,
  onRemoveCondition,
  onPreviewCondition,
  onReloadControlNet,
  promptMode,
  expansionSeed,
  promptExpansion,
  promptExpansionLoading,
  promptExpansionError,
  promptActionError,
  onPromptModeChange,
  onExpansionSeedChange,
  onShufflePromptSet,
}: ComposerProps) {
  const editing = workspaceMode === "edit";
  const frameWidth = editing ? editDimensions.width : draft.width;
  const frameHeight = editing ? editDimensions.height : draft.height;
  const insertPrompt = (text: string) => {
    const separator = draft.prompt.trim() ? ", " : "";
    onChange({ prompt: `${draft.prompt.trimEnd()}${separator}${text}` });
  };

  return (
    <section className="composer" aria-label="Composer">
      <div className="composer__heading">
        <div>
          <p className="eyebrow">Composer</p>
          <h2>What should exist?</h2>
        </div>
        <span className="draft-label">SDXL · fast draft</span>
      </div>

      <div className="workspace-mode" aria-label="Workspace mode">
        <button
          type="button"
          className={workspaceMode === "compose" ? "is-selected" : ""}
          onClick={() => onWorkspaceModeChange("compose")}
        >
          Compose
        </button>
        <button
          type="button"
          className={workspaceMode === "edit" ? "is-selected" : ""}
          onClick={() => onWorkspaceModeChange("edit")}
        >
          Paint / inpaint
        </button>
        <button type="button" onClick={onNewDrawing}>New drawing</button>
      </div>

      <div className="model-rack">
        <label>
          <span>Checkpoint</span>
          <select
            value={draft.checkpoint}
            disabled={!catalog?.checkpoints.length}
            onChange={(event) => onChange({ checkpoint: event.target.value })}
          >
            {!catalog?.checkpoints.length && <option>Loading models…</option>}
            {catalog?.checkpoints.map((checkpoint) => (
              <option value={checkpoint.title} key={checkpoint.title}>
                {checkpoint.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>VAE / text encoder</span>
          <select
            value={draft.modules[0] ?? ""}
            disabled={!catalog}
            onChange={(event) =>
              onChange({ modules: event.target.value ? [event.target.value] : [] })
            }
          >
            <option value="">Automatic</option>
            {catalog?.modules.map((modelModule) => (
              <option value={modelModule.filename} key={modelModule.filename}>
                {modelModule.model_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="prompt-field">
        <span>Prompt</span>
        <textarea
          value={draft.prompt}
          onChange={(event) => onChange({ prompt: event.target.value })}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onGenerate();
            }
          }}
          rows={7}
          spellCheck="true"
          autoFocus
        />
      </label>

      <label className="negative-field">
        <span>Negative prompt</span>
        <textarea
          value={draft.negativePrompt}
          onChange={(event) => onChange({ negativePrompt: event.target.value })}
          rows={2}
          placeholder="What should stay out of the frame?"
        />
      </label>

      <PromptComposition
        mode={promptMode}
        expansionSeed={expansionSeed}
        response={promptExpansion}
        loading={promptExpansionLoading}
        error={promptExpansionError}
        actionError={promptActionError}
        onModeChange={onPromptModeChange}
        onExpansionSeedChange={onExpansionSeedChange}
        onShuffle={onShufflePromptSet}
      />

      {catalog && (
        <PromptTools
          catalog={catalog}
          selectedStyles={draft.styles}
          onStylesChange={(styles) => onChange({ styles })}
          onInsert={insertPrompt}
        />
      )}

      <ConditionStack
        catalog={controlNetCatalog}
        error={controlNetError}
        loading={controlNetLoading}
        conditions={conditions}
        currentImageAvailable={currentImageAvailable}
        onAdd={onAddCondition}
        onChange={onChangeCondition}
        onReplace={onReplaceCondition}
        onRemove={onRemoveCondition}
        onPreview={onPreviewCondition}
        onReload={onReloadControlNet}
      />

      <div className="draft-controls">
        <fieldset className="dimensions">
          <legend>Frame</legend>
          {editing && (
            <small className="dimensions__truth">
              Source size · resizing is not implemented yet
            </small>
          )}
          <div className="aspect-presets">
            {ASPECTS.map((aspect) => (
              <button
                type="button"
                key={aspect.label}
                className={
                  frameWidth === aspect.width && frameHeight === aspect.height
                    ? "is-selected"
                    : ""
                }
                disabled={editing}
                onClick={() =>
                  onChange({ width: aspect.width, height: aspect.height })
                }
              >
                {aspect.label}
              </button>
            ))}
          </div>
          <div className="dimension-inputs">
            <label>
              <span>W</span>
              <input
                type="number"
                min="64"
                max="2048"
                step="64"
                value={frameWidth}
                disabled={editing}
                onChange={(event) =>
                  onChange({
                    width: changedNumber(
                      event.target.valueAsNumber,
                      draft.width,
                      64,
                      2048,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="swap-dimensions"
              disabled={editing}
              onClick={() =>
                onChange({ width: draft.height, height: draft.width })
              }
              aria-label="Swap width and height"
            >
              ⇄
            </button>
            <label>
              <span>H</span>
              <input
                type="number"
                min="64"
                max="2048"
                step="64"
                value={frameHeight}
                disabled={editing}
                onChange={(event) =>
                  onChange({
                    height: changedNumber(
                      event.target.valueAsNumber,
                      draft.height,
                      64,
                      2048,
                    ),
                  })
                }
              />
            </label>
          </div>
        </fieldset>

        <label className="compact-control candidates-control">
          <span>{promptMode === "exhaustive" ? "Candidate cap" : "Candidates"}</span>
          <input
            type="number"
            min="1"
            max="8"
            value={draft.outputs}
            onChange={(event) =>
              onChange({
                outputs: changedNumber(event.target.valueAsNumber, draft.outputs, 1, 8),
              })
            }
          />
        </label>

        <label className="compact-control seed-control">
          <span>Seed</span>
          <input
            type="number"
            min="-1"
            value={draft.seed}
            onChange={(event) =>
              onChange({
                seed: Number.isFinite(event.target.valueAsNumber)
                  ? event.target.valueAsNumber
                  : draft.seed,
              })
            }
          />
        </label>
      </div>

      {workspaceMode === "edit" && (
        <fieldset className="edit-generation-controls">
          <legend>Image edit</legend>
          <label>
            <span>Denoise {editSettings.denoisingStrength.toFixed(2)}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={editSettings.denoisingStrength}
              onChange={(event) =>
                onEditSettingsChange({
                  denoisingStrength: event.target.valueAsNumber,
                })
              }
            />
          </label>
          <label>
            <span>Mask blur</span>
            <input
              type="number"
              min="0"
              max="64"
              value={editSettings.maskBlur}
              onChange={(event) =>
                onEditSettingsChange({
                  maskBlur: changedNumber(
                    event.target.valueAsNumber,
                    editSettings.maskBlur,
                    0,
                    64,
                  ),
                })
              }
            />
          </label>
          <label>
            <span>Inpaint area</span>
            <select
              value={editSettings.inpaintOnlyMasked ? "masked" : "whole"}
              onChange={(event) =>
                onEditSettingsChange({
                  inpaintOnlyMasked: event.target.value === "masked",
                })
              }
            >
              <option value="masked">Only masked</option>
              <option value="whole">Whole image</option>
            </select>
          </label>
          <label>
            <span>Mask padding</span>
            <input
              type="number"
              min="0"
              max="256"
              step="4"
              value={editSettings.inpaintPadding}
              onChange={(event) =>
                onEditSettingsChange({
                  inpaintPadding: changedNumber(
                    event.target.valueAsNumber,
                    editSettings.inpaintPadding,
                    0,
                    256,
                  ),
                })
              }
            />
          </label>
        </fieldset>
      )}

      <details className="render-character">
        <summary>
          <span>Render character</span>
          <small>
            {draft.sampler} · {draft.steps} steps · CFG {draft.cfgScale}
          </small>
        </summary>
        <div className="render-character__grid">
          <label>
            <span>Sampler</span>
            <select
              value={draft.sampler}
              onChange={(event) => onChange({ sampler: event.target.value })}
            >
              {catalog?.samplers.map((sampler) => (
                <option value={sampler.name} key={sampler.name}>
                  {sampler.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Scheduler</span>
            <select
              value={draft.scheduler}
              onChange={(event) => onChange({ scheduler: event.target.value })}
            >
              {catalog?.schedulers.map((scheduler) => (
                <option value={scheduler.name} key={scheduler.name}>
                  {scheduler.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Steps</span>
            <input
              type="number"
              min="1"
              max="150"
              value={draft.steps}
              onChange={(event) =>
                onChange({
                  steps: changedNumber(event.target.valueAsNumber, draft.steps, 1, 150),
                })
              }
            />
          </label>
          <label>
            <span>CFG</span>
            <input
              type="number"
              min="1"
              max="30"
              step="0.5"
              value={draft.cfgScale}
              onChange={(event) =>
                onChange({
                  cfgScale: changedNumber(
                    event.target.valueAsNumber,
                    draft.cfgScale,
                    1,
                    30,
                  ),
                })
              }
            />
          </label>
          <label>
            <span>Preview every</span>
            <input
              type="number"
              min="1"
              max="50"
              value={draft.previewEvery}
              onChange={(event) =>
                onChange({
                  previewEvery: changedNumber(
                    event.target.valueAsNumber,
                    draft.previewEvery,
                    1,
                    50,
                  ),
                })
              }
            />
          </label>
        </div>
      </details>

      {catalogError && (
        <div className="connection-error" role="alert">
          <span>Forge’s model catalog could not be read: {catalogError}</span>
          <button type="button" onClick={onReloadCatalog}>
            Retry
          </button>
        </div>
      )}

      <div className="composer__actions">
        <button
          className="generate"
          type="button"
          disabled={!canGenerate}
          onClick={onGenerate}
        >
          <span>
            {generating
              ? "Forge is working"
              : workspaceMode === "edit"
                ? "Generate edit"
                : "Generate"}
          </span>
          <kbd>⌘/Ctrl ↵</kbd>
        </button>
        <button
          className="interrupt"
          type="button"
          disabled={!generating}
          onClick={onSkip}
        >
          Skip current
        </button>
        <button
          className="interrupt"
          type="button"
          disabled={!generating}
          onClick={onInterrupt}
        >
          Cancel render
        </button>
      </div>

      <div className="catalog-status">
        <span>{catalogLoading ? "Reading this instrument…" : "Current instrument"}</span>
        {catalog && (
          <small>
            {catalog.checkpoints.length} checkpoint
            {catalog.checkpoints.length === 1 ? "" : "s"} · {catalog.loras.length} LoRAs ·{" "}
            {catalog.styles.length} styles
          </small>
        )}
      </div>
    </section>
  );
}
