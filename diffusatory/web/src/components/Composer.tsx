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
import { RegionComposer } from "../features/regions/RegionComposer";
import type { RegionalComposition } from "../features/regions/types";
import { PromptTools } from "./PromptTools";
import { PromptComposition } from "./PromptComposition";
import { NumberInput } from "./NumberInput";
import type { EditOperation, ImageEditSettings } from "../features/editor/model";
import { profileForCheckpoint } from "../domain/modelProfiles";

interface ComposerProps {
  draft: GenerationDraft;
  catalog: ForgeCatalog | null;
  catalogError: string | null;
  catalogLoading: boolean;
  modelIssue: string | null;
  hasSavedModelDefault: boolean;
  generating: boolean;
  canGenerate: boolean;
  sourceActive: boolean;
  editorVisible: boolean;
  hasEditorDocument: boolean;
  editSettings: ImageEditSettings;
  editDimensions: { width: number; height: number };
  onChange: (patch: Partial<GenerationDraft>) => void;
  onCheckpointChange: (checkpoint: string) => void;
  onSaveModelDefault: () => void;
  onRestoreModelDefault: () => void;
  onGenerate: (
    operation?: EditOperation,
    inpaintOnlyMasked?: boolean,
  ) => void;
  onInterrupt: () => void;
  onSkip: () => void;
  onReloadCatalog: () => void;
  onUsePromptOnly: () => void;
  onResumeEditor: () => void;
  onNewDrawing: () => void;
  onOpenImage: (file: File) => void;
  onEditSettingsChange: (
    patch: Partial<ComposerProps["editSettings"]>,
  ) => void;
  controlNetCatalog: ControlNetCatalog | null;
  controlNetError: string | null;
  controlNetLoading: boolean;
  conditions: ControlNetCondition[];
  regionalComposition: RegionalComposition;
  regionalStageVisible: boolean;
  onRegionalCompositionChange: (value: RegionalComposition) => void;
  onShowRegionalStage: () => void;
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
  { label: "Square", ratio: "1:1", shape: "square", width: 1024, height: 1024 },
  { label: "Portrait", ratio: "2:3", shape: "portrait", width: 832, height: 1216 },
  { label: "Landscape", ratio: "3:2", shape: "landscape", width: 1216, height: 832 },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function Composer({
  draft,
  catalog,
  catalogError,
  catalogLoading,
  modelIssue,
  hasSavedModelDefault,
  generating,
  canGenerate,
  sourceActive,
  editorVisible,
  hasEditorDocument,
  editSettings,
  editDimensions,
  onChange,
  onCheckpointChange,
  onSaveModelDefault,
  onRestoreModelDefault,
  onGenerate,
  onInterrupt,
  onSkip,
  onReloadCatalog,
  onUsePromptOnly,
  onResumeEditor,
  onNewDrawing,
  onOpenImage,
  onEditSettingsChange,
  controlNetCatalog,
  controlNetError,
  controlNetLoading,
  conditions,
  regionalComposition,
  regionalStageVisible,
  onRegionalCompositionChange,
  onShowRegionalStage,
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
  const editing = sourceActive;
  const frameWidth = editing ? editDimensions.width : draft.width;
  const frameHeight = editing ? editDimensions.height : draft.height;
  const modelProfile = catalog
    ? profileForCheckpoint(catalog, draft.checkpoint)
    : null;
  const insertPrompt = (text: string) => {
    const separator = draft.prompt.trim() ? ", " : "";
    onChange({ prompt: `${draft.prompt.trimEnd()}${separator}${text}` });
  };

  return (
    <>
      <section className="workbench-rack" aria-label="Generation controls">
        <div className="source-context" aria-label="Generation source">
          <span className="source-context__active" aria-current="true">
            {editing ? "Image" : "Prompt"}
          </span>
          {editing && <button type="button" onClick={onUsePromptOnly}>Prompt</button>}
          {editing && !editorVisible && (
            <button type="button" onClick={onResumeEditor}>Show image</button>
          )}
          {!editing && hasEditorDocument && (
            <button type="button" onClick={onResumeEditor}>Image</button>
          )}
          <button type="button" onClick={onNewDrawing}>Draw</button>
          <label className="open-image-button">
            Open
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onOpenImage(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <div className="model-rack">
        <label className="model-checkpoint">
          <span>Checkpoint</span>
          <select
            value={draft.checkpoint}
            disabled={!catalog?.checkpoints.length}
            onChange={(event) => onCheckpointChange(event.target.value)}
          >
            {!catalog?.checkpoints.length && <option>Loading models…</option>}
            {catalog?.checkpoints.map((checkpoint) => (
              <option value={checkpoint.title} key={checkpoint.title}>
                {checkpoint.title}
              </option>
            ))}
          </select>
          {modelProfile && (
            <small className="model-profile">
              {modelProfile.family === "unknown"
                ? "Unclassified model"
                : `${modelProfile.family.toUpperCase()} · ${
                    modelProfile.speed_profile === "four-step"
                      ? "4-step"
                      : `${modelProfile.defaults.steps}-step default`
                  } · ${
                    modelProfile.component_mode === "integrated"
                      ? "integrated components"
                      : `${modelProfile.recommended_modules.length} external components`
                  }`}
            </small>
          )}
        </label>
        <details className="model-components">
          <summary>
            <span>Components</span>
            <strong>
              {draft.modules.length
                ? `${draft.modules.length} selected`
                : modelProfile?.component_mode === "integrated"
                  ? "Built into checkpoint"
                  : "Automatic"}
            </strong>
          </summary>
          <div>
            {catalog?.modules.map((modelModule) => (
              <label key={modelModule.filename}>
                <input
                  type="checkbox"
                  checked={draft.modules.includes(modelModule.filename)}
                  onChange={(event) =>
                    onChange({
                      modules: event.target.checked
                        ? [...draft.modules, modelModule.filename]
                        : draft.modules.filter((item) => item !== modelModule.filename),
                    })
                  }
                />
                <span>{modelModule.model_name}</span>
              </label>
            ))}
          </div>
        </details>
        <div className="model-default-row">
          <span className="model-default-state">
            {hasSavedModelDefault
              ? "Your saved recipe overrides the family default"
              : "Using the built-in model recipe"}
          </span>
          <span className="model-default-actions">
            <button type="button" onClick={onSaveModelDefault}>
              {hasSavedModelDefault ? "Update default" : "Save current as default"}
            </button>
            {hasSavedModelDefault && (
              <button type="button" onClick={onRestoreModelDefault}>
                Restore built-in
              </button>
            )}
          </span>
        </div>
        </div>

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
                aria-label={`${aspect.label} ${aspect.ratio}, ${aspect.width} by ${aspect.height}`}
                title={`${aspect.label} · ${aspect.ratio} · ${aspect.width} × ${aspect.height}`}
                onClick={() =>
                  onChange({ width: aspect.width, height: aspect.height })
                }
              >
                <span className="aspect-preset__preview" aria-hidden="true">
                  <span className={`aspect-preset__shape aspect-preset__shape--${aspect.shape}`} />
                </span>
                <span className="aspect-preset__copy">
                  <strong>{aspect.label}</strong>
                  <small>{aspect.width}×{aspect.height}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="dimension-inputs" aria-label="Custom frame dimensions">
            <label>
              <span>Width</span>
              <NumberInput
                min="64"
                max="2048"
                step="64"
                value={frameWidth}
                disabled={editing}
                clamp={(value) => clamp(value, 64, 2048)}
                onValueChange={(width) => onChange({ width })}
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
              <span>Height</span>
              <NumberInput
                min="64"
                max="2048"
                step="64"
                value={frameHeight}
                disabled={editing}
                clamp={(value) => clamp(value, 64, 2048)}
                onValueChange={(height) => onChange({ height })}
              />
            </label>
          </div>
        </fieldset>

        <label className="compact-control candidates-control">
          <span>{promptMode === "exhaustive" ? "Candidate cap" : "Candidates"}</span>
          <NumberInput
            min="1"
            max="8"
            value={draft.outputs}
            clamp={(value) => clamp(value, 1, 8)}
            onValueChange={(outputs) => onChange({ outputs })}
          />
        </label>

        <label className="compact-control seed-control">
          <span>Seed</span>
          <NumberInput
            min="-1"
            value={draft.seed}
            onValueChange={(seed) => onChange({ seed })}
          />
        </label>
        </div>

        <section className="render-character" aria-label="Render character">
          <header>
            <strong>Render</strong>
            <small>{draft.sampler} · {draft.steps} steps</small>
          </header>
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
            <NumberInput
              min="1"
              max="150"
              value={draft.steps}
              clamp={(value) => clamp(value, 1, 150)}
              onValueChange={(steps) => onChange({ steps })}
            />
          </label>
          <label>
            <span>CFG</span>
            <NumberInput
              min="1"
              max="30"
              step="0.5"
              value={draft.cfgScale}
              clamp={(value) => clamp(value, 1, 30)}
              onValueChange={(cfgScale) => onChange({ cfgScale })}
            />
          </label>
          {editing ? (
            <div className="edit-preview-cadence">
              <span>Live preview</span>
              <strong>Every 3 steps</strong>
            </div>
          ) : (
            <label>
              <span>Preview every</span>
              <NumberInput
                min="1"
                max="50"
                value={draft.previewEvery}
                clamp={(value) => clamp(value, 1, 50)}
                onValueChange={(previewEvery) => onChange({ previewEvery })}
              />
            </label>
          )}
          </div>
        </section>

      {catalogError && (
        <div className="connection-error" role="alert">
          <span>Forge’s model catalog could not be read: {catalogError}</span>
          <button type="button" onClick={onReloadCatalog}>
            Retry
          </button>
        </div>
      )}
      {modelIssue && (
        <div className="connection-error model-readiness-error" role="alert">
          <span>{modelIssue}</span>
        </div>
      )}

        <div className={`composer__actions ${editing ? "composer__actions--editing" : ""}`}>
        {editing ? (
          <>
            <button
              className="generate"
              type="button"
              disabled={!canGenerate}
              onClick={() => onGenerate("img2img")}
            >
              <span>{generating ? "Forge is working" : "Generate variation"}</span>
              <kbd>Ctrl ↵</kbd>
            </button>
            <button
              className="generate generate--inpaint"
              type="button"
              disabled={!canGenerate}
              onClick={() => onGenerate("inpaint", true)}
            >
              <span>{generating ? "Forge is working" : "Inpaint masked"}</span>
              <kbd>Ctrl Shift ↵</kbd>
            </button>
            <button
              className="generate generate--inpaint generate--inpaint-whole"
              type="button"
              disabled={!canGenerate}
              onClick={() => onGenerate("inpaint", false)}
            >
              <span>{generating ? "Forge is working" : "Inpaint whole"}</span>
            </button>
          </>
        ) : (
          <button
            className="generate"
            type="button"
            disabled={!canGenerate}
            onClick={() => onGenerate()}
          >
            <span>{generating ? "Forge is working" : "Generate"}</span>
            <kbd>Ctrl ↵</kbd>
          </button>
        )}
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

      <section className="composer prompt-dock" aria-label="Prompt composer">
        <div className="composer__heading">
          <div>
            <p className="eyebrow">Prompt</p>
            <h2>Describe the shot</h2>
          </div>
          <span className="draft-label">live</span>
        </div>

        <label className="prompt-field">
          <span>Prompt</span>
          <textarea
            value={draft.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                onGenerate(
                  editing ? (event.shiftKey ? "inpaint" : "img2img") : undefined,
                  event.shiftKey ? true : undefined,
                );
              }
            }}
            rows={9}
            spellCheck="true"
            autoFocus
          />
        </label>

        <label className="negative-field">
          <span>Negative prompt</span>
          <textarea
            value={draft.negativePrompt}
            onChange={(event) => onChange({ negativePrompt: event.target.value })}
            rows={3}
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
      </section>

      <aside className="tool-dock" aria-label="Image and conditioning tools">
        <header className="tool-dock__heading">
          <div>
            <p className="eyebrow">Image tools</p>
            <h2>Shape the frame</h2>
          </div>
          <span>{conditions.length} condition{conditions.length === 1 ? "" : "s"}</span>
        </header>

        {editing && (
          <fieldset className="edit-generation-controls">
            <legend>Edit image</legend>
            <small>Paint and mask stay available; choose the operation when generating.</small>
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
            <>
                <label>
                  <span>Mask blur</span>
                  <NumberInput
                    min="0"
                    max="64"
                    value={editSettings.maskBlur}
                    clamp={(value) => clamp(value, 0, 64)}
                    onValueChange={(maskBlur) => onEditSettingsChange({ maskBlur })}
                  />
                </label>
                <label>
                  <span>Padding</span>
                  <NumberInput
                    min="0"
                    max="256"
                    step="4"
                    value={editSettings.inpaintPadding}
                    clamp={(value) => clamp(value, 0, 256)}
                    onValueChange={(inpaintPadding) =>
                      onEditSettingsChange({ inpaintPadding })
                    }
                  />
                </label>
            </>
          </fieldset>
        )}

        <RegionComposer
          value={regionalComposition}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          commonPrompt={draft.prompt}
          stageVisible={regionalStageVisible}
          onChange={onRegionalCompositionChange}
          onShowStage={onShowRegionalStage}
        />

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
      </aside>
    </>
  );
}
