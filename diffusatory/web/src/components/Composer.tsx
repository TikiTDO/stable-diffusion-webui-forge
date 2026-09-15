import type { ForgeCatalog, Lora } from "../api/forge/types";
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
import { CatalogRefreshButton } from "./CatalogRefreshButton";
import { PromptComposition } from "./PromptComposition";
import { NumberInput } from "./NumberInput";
import type { EditOperation, ImageEditSettings } from "../features/editor/model";
import { profileForCheckpoint } from "../domain/modelProfiles";
import { adjustPromptAttention } from "../domain/promptAttention";
import type { ActiveLora } from "../domain/loras";

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
  hasEditorDocument: boolean;
  hasMask: boolean;
  editSettings: ImageEditSettings;
  editDimensions: { width: number; height: number };
  onChange: (patch: Partial<GenerationDraft>) => void;
  onCheckpointChange: (checkpoint: string) => void;
  onSaveModelDefault: () => void;
  onRestoreModelDefault: () => void;
  onSaveLoraDefaults: (lora: Lora, active: ActiveLora) => Promise<void>;
  onRefreshLoras: () => Promise<number>;
  onRefreshCheckpoints: () => Promise<number>;
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
  onShowShortcuts: () => void;
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
  hasEditorDocument,
  hasMask,
  editSettings,
  editDimensions,
  onChange,
  onCheckpointChange,
  onSaveModelDefault,
  onRestoreModelDefault,
  onSaveLoraDefaults,
  onRefreshLoras,
  onRefreshCheckpoints,
  onGenerate,
  onInterrupt,
  onSkip,
  onReloadCatalog,
  onUsePromptOnly,
  onResumeEditor,
  onNewDrawing,
  onOpenImage,
  onShowShortcuts,
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
  const frameWidth = draft.width;
  const frameHeight = draft.height;
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
          <button
            type="button"
            className={!editing ? "source-context__active" : ""}
            aria-pressed={!editing}
            onClick={onUsePromptOnly}
          >
            Prompt
          </button>
          {hasEditorDocument && (
            <button
              type="button"
              className={editing ? "source-context__active" : ""}
              aria-pressed={editing}
              onClick={onResumeEditor}
            >
              Image
            </button>
          )}
          <button type="button" data-shortcut-target="draw" onClick={onNewDrawing}>Draw</button>
          <label className="open-image-button">
            Open
            <input
              type="file"
              data-shortcut-target="open-image"
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
        <div className="model-checkpoint">
          <label>
          <span>Checkpoint <kbd className="shortcut-chip" aria-hidden="true">Alt M</kbd></span>
          <select
            data-shortcut-target="model"
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
          </label>
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
          <CatalogRefreshButton
            label="Refresh checkpoints"
            noun="checkpoint"
            onRefresh={onRefreshCheckpoints}
          />
        </div>
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
          <legend>{editing ? "Next pass" : "Frame"} <kbd className="shortcut-chip" aria-hidden="true">Alt F</kbd></legend>
          {editing && (
            <small className="dimensions__truth">
              Source {editDimensions.width}×{editDimensions.height}
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
                data-shortcut-target="frame"
                min="64"
                max="2048"
                step="64"
                value={frameWidth}
                clamp={(value) => clamp(value, 64, 2048)}
                onValueChange={(width) => onChange({ width })}
              />
            </label>
            <button
              type="button"
              className="swap-dimensions"
              onClick={() =>
                onChange({ width: draft.height, height: draft.width })
              }
              aria-label="Swap width and height"
            >
              ⇄
            </button>
            <label>
              <span>Height <kbd className="shortcut-chip" aria-hidden="true">Alt Shift F</kbd></span>
              <NumberInput
                data-shortcut-target="frame-height"
                min="64"
                max="2048"
                step="64"
                value={frameHeight}
                clamp={(value) => clamp(value, 64, 2048)}
                onValueChange={(height) => onChange({ height })}
              />
            </label>
          </div>
        </fieldset>

        <label className="compact-control candidates-control">
          <span>{promptMode === "exhaustive" ? "Candidate cap" : "Candidates"} <kbd className="shortcut-chip" aria-hidden="true">Alt N</kbd></span>
          <NumberInput
            data-shortcut-target="candidates"
            min="1"
            max="8"
            value={draft.outputs}
            clamp={(value) => clamp(value, 1, 8)}
            onValueChange={(outputs) => onChange({ outputs })}
          />
        </label>

        <label className="compact-control seed-control">
          <span>Seed <kbd className="shortcut-chip" aria-hidden="true">Alt S</kbd></span>
          <NumberInput
            data-shortcut-target="seed"
            min="-1"
            value={draft.seed}
            onValueChange={(seed) => onChange({ seed })}
          />
        </label>
        </div>

        <details className="render-character">
          <summary data-shortcut-target="render">
            <strong>Render <kbd className="shortcut-chip" aria-hidden="true">Alt R</kbd></strong>
            <small>{draft.sampler} · {draft.steps} steps</small>
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
            <span>Scheduler <kbd className="shortcut-chip" aria-hidden="true">Alt Shift R</kbd></span>
            <select
              data-shortcut-target="scheduler"
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
        </details>

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
              disabled={!canGenerate || !hasMask}
              title={!hasMask ? "No mask" : "Regenerate only the masked area"}
              onClick={() => onGenerate("inpaint", true)}
            >
              <span>{generating ? "Forge is working" : "Inpaint masked"}</span>
              <kbd>Ctrl Shift ↵</kbd>
            </button>
            <button
              className="generate generate--inpaint generate--inpaint-whole"
              type="button"
              disabled={!canGenerate || !hasMask}
              title={!hasMask ? "No mask" : "Regenerate using the whole frame as context"}
              onClick={() => onGenerate("inpaint", false)}
            >
              <span>{generating ? "Forge is working" : "Inpaint whole"}</span>
            </button>
          </>
        ) : (
          <button
            className="generate"
            type="button"
            aria-keyshortcuts="Control+Enter Meta+Enter Alt+G"
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
          data-shortcut-target="skip"
          onClick={onSkip}
        >
          Skip current
        </button>
        <button
          className="interrupt"
          type="button"
          disabled={!generating}
          data-shortcut-target="cancel"
          onClick={onInterrupt}
        >
          Cancel render
        </button>
        </div>

        <div className="catalog-status">
        <span>{catalogLoading ? "Reading this instrument…" : "Current instrument"}</span>
        <button type="button" className="shortcut-map-button" onClick={onShowShortcuts}>
          Keys <kbd>Alt /</kbd>
        </button>
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
          <h2>Prompt <kbd className="shortcut-chip" aria-hidden="true">Alt P</kbd></h2>
        </div>

        <label className="prompt-field">
          <span className="sr-only">Prompt</span>
          <textarea
            data-shortcut-target="prompt"
            value={draft.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                (event.key === "ArrowUp" || event.key === "ArrowDown")
              ) {
                const target = event.currentTarget;
                const edit = adjustPromptAttention(
                  target.value,
                  target.selectionStart,
                  target.selectionEnd,
                  event.key === "ArrowUp" ? 1 : -1,
                );
                if (edit) {
                  event.preventDefault();
                  onChange({ prompt: edit.text });
                  requestAnimationFrame(() => {
                    target.setSelectionRange(edit.selectionStart, edit.selectionEnd);
                  });
                }
                return;
              }
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
          <span>Negative prompt <kbd className="shortcut-chip" aria-hidden="true">Alt Shift P</kbd></span>
          <textarea
            data-shortcut-target="negative-prompt"
            value={draft.negativePrompt}
            onChange={(event) => onChange({ negativePrompt: event.target.value })}
            onKeyDown={(event) => {
              if (
                !(event.metaKey || event.ctrlKey) ||
                (event.key !== "ArrowUp" && event.key !== "ArrowDown")
              ) return;
              const target = event.currentTarget;
              const edit = adjustPromptAttention(
                target.value,
                target.selectionStart,
                target.selectionEnd,
                event.key === "ArrowUp" ? 1 : -1,
              );
              if (!edit) return;
              event.preventDefault();
              onChange({ negativePrompt: edit.text });
              requestAnimationFrame(() => {
                target.setSelectionRange(edit.selectionStart, edit.selectionEnd);
              });
            }}
            rows={3}
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
            activeLoras={draft.loras}
            onStylesChange={(styles) => onChange({ styles })}
            onLorasChange={(loras) => onChange({ loras })}
            onInsert={insertPrompt}
            onSaveDefaults={onSaveLoraDefaults}
            onRefreshLibrary={onRefreshLoras}
          />
        )}
      </section>

      <aside className="tool-dock" aria-label="Image and conditioning tools">
        <header className="tool-dock__heading">
          <div>
            <p className="eyebrow">Image tools</p>
            <h2>Shape the frame <kbd className="shortcut-chip" aria-hidden="true">Alt T</kbd></h2>
          </div>
          <span>{conditions.length} condition{conditions.length === 1 ? "" : "s"}</span>
        </header>

        {editing && (
          <fieldset className="edit-generation-controls">
            <legend>Edit image</legend>
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
              <span>Resize source</span>
              <select
                value={editSettings.resizeMode}
                onChange={(event) =>
                  onEditSettingsChange({
                    resizeMode: Number(event.target.value) as 0 | 1 | 2,
                  })
                }
              >
                <option value={1}>Crop to frame</option>
                <option value={2}>Fit + fill</option>
                <option value={0}>Stretch</option>
              </select>
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
