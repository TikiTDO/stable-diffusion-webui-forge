import { useState, type CSSProperties, type ReactNode } from "react";
import type { ForgeCatalog, Lora, LoraDefaults } from "../api/forge/types";
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
import {
  addMovableRegion,
  removeMovableRegion,
  setActiveMovableRegion,
  updateMovableRegion,
} from "../features/regions/model";
import {
  extractPromptGroup,
  findGroupSigils,
  moveGroupSigil,
  removePromptGroup,
  togglePromptGroup,
} from "../domain/promptGroups";
import { PromptTools } from "./PromptTools";
import { CatalogRefreshButton } from "./CatalogRefreshButton";
import { PromptComposition } from "./PromptComposition";
import { NumberInput } from "./NumberInput";
import type { EditOperation, ImageEditSettings } from "../features/editor/model";
import { profileForCheckpoint } from "../domain/modelProfiles";
import { adjustPromptAttention } from "../domain/promptAttention";
import type { ActiveLora } from "../domain/loras";

const CELL_COLORS = [
  "#f7b267", "#9d8df1", "#72d6b2", "#f48498",
  "#7cc6fe", "#f9dc5c", "#c79ced", "#86deb7",
];

interface ComposerProps {
  draft: GenerationDraft;
  /** The project picker, rendered beside the checkpoint controls. */
  projectPicker?: ReactNode;
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
  onUpdateLoraDefaults?: (lora: Lora, defaults: LoraDefaults) => Promise<void>;
  onUploadLoraPreview?: (lora: Lora, file: File) => Promise<void>;
  onRefreshLoras: () => Promise<number>;
  onRefreshCheckpoints: () => Promise<number | string>;
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
  projectPicker,
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
  onUpdateLoraDefaults,
  onUploadLoraPreview,
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
  const [variationsOpen, setVariationsOpen] = useState(false);
  const frameWidth = draft.width;
  const frameHeight = draft.height;
  const modelProfile = catalog
    ? profileForCheckpoint(catalog, draft.checkpoint)
    : null;
  const insertEmbedding = (targetId: string, text: string) => {
    const key = targetId === "negative" ? "negativePrompt" : "prompt";
    const current = draft[key];
    const separator = current.trim() ? ", " : "";
    onChange({ [key]: `${current.trimEnd()}${separator}${text}` });
  };

  const handleDropGroupSigil = (
    event: React.DragEvent<HTMLTextAreaElement>,
    currentPrompt: string,
  ) => {
    const groupId = event.dataTransfer.getData("application/x-diffusatory-group-id");
    if (!groupId) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    let insertIndex = textarea.selectionStart;
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
      if (pos) insertIndex = pos.offset;
    } else if ((document as any).caretRangeFromPoint) {
      const range = (document as any).caretRangeFromPoint(event.clientX, event.clientY);
      if (range) insertIndex = range.startOffset;
    }
    const nextPrompt = moveGroupSigil(currentPrompt, groupId, insertIndex);
    onChange({ prompt: nextPrompt });
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
          {projectPicker}
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
              <span>{generating ? "Forge is working" : "Generate edit"}</span>
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
          {!editing && (
            <div className="prompt-variations-control">
              <button
                type="button"
                className={`prompt-variations-toggle ${promptMode !== "off" ? "is-active" : ""}`}
                onClick={() => {
                  const next: Record<PromptExpansionMode, PromptExpansionMode> = {
                    off: "random",
                    random: "exhaustive",
                    exhaustive: "off",
                  };
                  onPromptModeChange(next[promptMode]);
                }}
                title={`Dynamic prompt variations: ${
                  promptMode === "off"
                    ? "As written (literal)"
                    : promptMode === "random"
                      ? "Random branch per candidate"
                      : "Every unique branch"
                }. Click to cycle mode.`}
              >
                <span>
                  {promptMode === "off"
                    ? "Variations: Off"
                    : promptMode === "random"
                      ? "Variations: Random"
                      : "Variations: All branches"}
                </span>
                {promptMode !== "off" && promptExpansion && (
                  <span className="variations-badge">
                    {promptExpansion.resolved_count}
                  </span>
                )}
              </button>
              {promptMode !== "off" && (
                <button
                  type="button"
                  className={`prompt-variations-inspect ${variationsOpen ? "is-open" : ""}`}
                  onClick={() => setVariationsOpen((prev) => !prev)}
                  title={variationsOpen ? "Hide realization list" : "Inspect resolved prompts"}
                  aria-expanded={variationsOpen}
                >
                  {variationsOpen ? "Hide" : "Inspect"}
                </button>
              )}
            </div>
          )}
        </div>

        {regionalComposition.enabled ? (
          <div className="regional-left-column">
            <label className="region-background-field">
              <div className="region-field-header">
                <span>Background prompt <small>(scene & camera lock)</small></span>
                <label className="region-background-toggle">
                  <input
                    type="checkbox"
                    checked={regionalComposition.backgroundEnabled}
                    onChange={(e) =>
                      onRegionalCompositionChange({
                        ...regionalComposition,
                        backgroundEnabled: e.target.checked,
                      })
                    }
                  />
                  Enable
                </label>
              </div>
              <textarea
                rows={3}
                disabled={!regionalComposition.backgroundEnabled}
                value={regionalComposition.backgroundPrompt}
                placeholder="Background scene, environment, lighting, and camera angle (runs first to lock composition)..."
                onChange={(e) =>
                  onRegionalCompositionChange({
                    ...regionalComposition,
                    backgroundPrompt: e.target.value,
                  })
                }
              />
            </label>

            <div className="regional-prompts-list">
              {(regionalComposition.regions ?? []).map((region, index) => {
                const color = CELL_COLORS[index % CELL_COLORS.length];
                const isActive = region.id === regionalComposition.activeRegionId;
                return (
                  <div
                    key={region.id}
                    className={`regional-block ${isActive ? "regional-block--active" : ""}`}
                    style={{ "--region-color": color } as CSSProperties}
                    onClick={() =>
                      onRegionalCompositionChange(
                        setActiveMovableRegion(regionalComposition, region.id),
                      )
                    }
                  >
                    <div className="regional-block__header">
                      <span className="regional-block__title">
                        <span className="regional-block__dot" />
                        {region.name || `Region ${index + 1}`}
                      </span>
                      <div className="regional-block__actions">
                        {(regionalComposition.regions?.length ?? 0) > 1 && (
                          <button
                            type="button"
                            className="regional-block__remove"
                            title="Remove region"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRegionalCompositionChange(
                                removeMovableRegion(regionalComposition, region.id),
                              );
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      rows={3}
                      value={region.prompt}
                      placeholder={`Prompt for ${region.name || `Region ${index + 1}`}…`}
                      onChange={(e) =>
                        onRegionalCompositionChange(
                          updateMovableRegion(regionalComposition, region.id, {
                            prompt: e.target.value,
                          }),
                        )
                      }
                    />
                  </div>
                );
              })}
              <button
                type="button"
                className="regional-add-btn"
                onClick={() =>
                  onRegionalCompositionChange(addMovableRegion(regionalComposition))
                }
              >
                + Add region
              </button>
            </div>

            <details className="common-prompt-strip" open>
              <summary>
                <span>Common prompt & LoRAs</span>
                <small>{draft.prompt ? `${draft.prompt.slice(0, 35)}…` : "Global styles and LoRAs applied across all regions"}</small>
              </summary>
              <label className="common-prompt-field">
                <textarea
                  rows={2}
                  value={draft.prompt}
                  placeholder="Common styles, atmosphere, and LoRA tags applied to all regions…"
                  onChange={(e) => onChange({ prompt: e.target.value })}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => handleDropGroupSigil(event, draft.prompt)}
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
                    if (
                      (event.altKey || event.metaKey || event.ctrlKey) &&
                      event.key.toLowerCase() === "g"
                    ) {
                      const target = event.currentTarget;
                      if (target.selectionStart !== target.selectionEnd) {
                        event.preventDefault();
                        const { nextPrompt, nextGroups } = extractPromptGroup(
                          target.value,
                          target.selectionStart,
                          target.selectionEnd,
                          draft.promptGroups,
                        );
                        onChange({ prompt: nextPrompt, promptGroups: nextGroups });
                        return;
                      }
                    }
                  }}
                />
              </label>
            </details>
          </div>
        ) : (
          <div className="prompt-field-wrapper">
            {findGroupSigils(draft.prompt).length > 0 && (
              <div className="prompt-active-tokens" aria-label="Tokens in active prompt">
                <span className="prompt-active-tokens__label">In prompt:</span>
                {findGroupSigils(draft.prompt).map((groupId) => {
                  const group = draft.promptGroups?.find((g) => g.id === groupId);
                  if (!group) return null;
                  return (
                    <div
                      key={groupId}
                      className={`prompt-sigil-chip ${group.enabled ? "is-enabled" : "is-disabled"}`}
                      title={`⟦g:${group.id}⟧: "${group.text}" (Drag to reposition within prompt)`}
                      draggable={true}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", `⟦g:${group.id}⟧`);
                        event.dataTransfer.setData("application/x-diffusatory-group-id", group.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                    >
                      <span className="prompt-sigil-chip__grip" aria-hidden="true">⋮⋮</span>
                      <span className="prompt-sigil-chip__name">{group.label}</span>
                      <button
                        type="button"
                        className="prompt-sigil-chip__remove"
                        title="Remove from prompt"
                        onClick={() => {
                          const { nextPrompt, nextGroups } = removePromptGroup(
                            draft.prompt,
                            draft.promptGroups!,
                            group.id,
                            false,
                          );
                          onChange({ prompt: nextPrompt, promptGroups: nextGroups });
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <label className="prompt-field">
              <span className="sr-only">Prompt</span>
              <textarea
                data-shortcut-target="prompt"
                value={draft.prompt}
                onChange={(event) => onChange({ prompt: event.target.value })}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => handleDropGroupSigil(event, draft.prompt)}
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
                  if (
                    (event.altKey || event.metaKey || event.ctrlKey) &&
                    event.key.toLowerCase() === "g"
                  ) {
                    const target = event.currentTarget;
                    if (target.selectionStart !== target.selectionEnd) {
                      event.preventDefault();
                      const { nextPrompt, nextGroups } = extractPromptGroup(
                        target.value,
                        target.selectionStart,
                        target.selectionEnd,
                        draft.promptGroups,
                      );
                      onChange({ prompt: nextPrompt, promptGroups: nextGroups });
                      return;
                    }
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
          </div>
        )}

        {draft.promptGroups && draft.promptGroups.length > 0 && (
          <div className="prompt-groups-bar" aria-label="Prompt groups">
            <span className="prompt-groups-label">Groups:</span>
            {draft.promptGroups.map((group) => (
              <div
                key={group.id}
                className={`prompt-group-chip ${group.enabled ? "is-enabled" : "is-disabled"}`}
                title={`⟦g:${group.id}⟧: "${group.text}" (Drag into prompt, click to toggle, ↩ to inline)`}
                draggable={true}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", `⟦g:${group.id}⟧`);
                  event.dataTransfer.setData("application/x-diffusatory-group-id", group.id);
                  event.dataTransfer.effectAllowed = "copyMove";
                }}
              >
                <button
                  type="button"
                  className="prompt-group-chip__toggle"
                  onClick={() =>
                    onChange({
                      promptGroups: togglePromptGroup(draft.promptGroups!, group.id),
                    })
                  }
                >
                  <span className="prompt-group-chip__status">{group.enabled ? "●" : "○"}</span>
                  <span className="prompt-group-chip__label">{group.label}</span>
                </button>
                <button
                  type="button"
                  className="prompt-group-chip__inline"
                  title="Inline back into prompt"
                  onClick={() => {
                    const { nextPrompt, nextGroups } = removePromptGroup(
                      draft.prompt,
                      draft.promptGroups!,
                      group.id,
                      true,
                    );
                    onChange({ prompt: nextPrompt, promptGroups: nextGroups });
                  }}
                >
                  ↩
                </button>
                <button
                  type="button"
                  className="prompt-group-chip__remove"
                  title="Remove group and token"
                  onClick={() => {
                    const { nextPrompt, nextGroups } = removePromptGroup(
                      draft.prompt,
                      draft.promptGroups!,
                      group.id,
                      false,
                    );
                    onChange({ prompt: nextPrompt, promptGroups: nextGroups });
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

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

        {!editing && variationsOpen && (
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
        )}

        {catalog && (
          <PromptTools
            catalog={catalog}
            selectedStyles={draft.styles}
            activeLoras={draft.loras}
            embeddingTargets={[
              { id: "prompt", label: "Prompt" },
              { id: "negative", label: "Negative prompt" },
            ]}
            onStylesChange={(styles) => onChange({ styles })}
            onLorasChange={(loras) => onChange({ loras })}
            onInsertEmbedding={insertEmbedding}
            onSaveDefaults={onSaveLoraDefaults}
            onUpdateLoraDefaults={onUpdateLoraDefaults}
            onUploadLoraPreview={onUploadLoraPreview}
            onRefreshLibrary={onRefreshLoras}
          />
        )}
      </section>

      <aside className="tool-dock" aria-label="Image and conditioning tools">
        <header className="tool-dock__heading">
          <div>
            <p className="eyebrow">Spatial & guides</p>
            <h2>Tools <kbd className="shortcut-chip" aria-hidden="true">Alt T</kbd></h2>
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
          promptsOnLeft={true}
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
