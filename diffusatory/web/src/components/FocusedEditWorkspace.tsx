import { forwardRef } from "react";

import type {
  ForgeCatalog,
  PromptExpansionMode,
  PromptExpansionResponse,
} from "../api/forge/types";
import type { GenerationDraft } from "../domain/draft";
import type { GenerationState } from "../domain/generation";
import {
  ImageEditor,
  type ImageEditorHandle,
} from "../features/editor/ImageEditor";
import type {
  EditOperation,
  ImageEditSettings,
} from "../features/editor/model";
import type { EditorVariation } from "../domain/editorVariations";
import { EditorVariationTray } from "./EditorVariationTray";
import { NumberInput } from "./NumberInput";
import { PromptComposition } from "./PromptComposition";
import { PromptTools } from "./PromptTools";
import { profileForCheckpoint } from "../domain/modelProfiles";

interface FocusedEditWorkspaceProps {
  documentKey: string;
  source: string | null;
  maskSource: string | null;
  dimensions: { width: number; height: number };
  dirty: boolean;
  editorError: string | null;
  editSettings: ImageEditSettings;
  draft: GenerationDraft;
  catalog: ForgeCatalog | null;
  modelIssue: string | null;
  hasSavedModelDefault: boolean;
  generation: GenerationState;
  generating: boolean;
  canGenerate: boolean;
  hasMask: boolean;
  activeOperation: EditOperation | null;
  activeInpaintScope: "masked" | "whole" | null;
  variations: EditorVariation[];
  activeVariationId: string | null;
  promptMode: PromptExpansionMode;
  expansionSeed: number;
  promptExpansion: PromptExpansionResponse | null;
  promptExpansionLoading: boolean;
  promptExpansionError: string | null;
  promptActionError: string | null;
  onReady: (width: number, height: number) => void;
  onContentChange: () => void;
  onMaskChange: (hasMask: boolean) => void;
  onDraftChange: (patch: Partial<GenerationDraft>) => void;
  onCheckpointChange: (checkpoint: string) => void;
  onSaveModelDefault: () => void;
  onRestoreModelDefault: () => void;
  onEditSettingsChange: (patch: Partial<ImageEditSettings>) => void;
  onPromptModeChange: (mode: PromptExpansionMode) => void;
  onExpansionSeedChange: (seed: number) => void;
  onShufflePromptSet: () => void;
  onGenerate: (
    operation: EditOperation,
    inpaintOnlyMasked?: boolean,
  ) => void;
  onSkip: () => void;
  onInterrupt: () => void;
  onSelectVariation: (variation: EditorVariation) => void;
  onClose: () => void;
  onShowShortcuts: () => void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function checkpointLabel(checkpoint: string): string {
  return (
    checkpoint
      .replace(/\s*\[[^\]]+\]\s*$/, "")
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.safetensors$/i, "") ?? checkpoint
  );
}

export const FocusedEditWorkspace = forwardRef<
  ImageEditorHandle,
  FocusedEditWorkspaceProps
>(function FocusedEditWorkspace(
  {
    documentKey,
    source,
    maskSource,
    dimensions,
    dirty,
    editorError,
    editSettings,
    draft,
    catalog,
    modelIssue,
    hasSavedModelDefault,
    generation,
    generating,
    canGenerate,
    hasMask,
    activeOperation,
    activeInpaintScope,
    variations,
    activeVariationId,
    promptMode,
    expansionSeed,
    promptExpansion,
    promptExpansionLoading,
    promptExpansionError,
    promptActionError,
    onReady,
    onContentChange,
    onMaskChange,
    onDraftChange,
    onCheckpointChange,
    onSaveModelDefault,
    onRestoreModelDefault,
    onEditSettingsChange,
    onPromptModeChange,
    onExpansionSeedChange,
    onShufflePromptSet,
    onGenerate,
    onSkip,
    onInterrupt,
    onSelectVariation,
    onClose,
    onShowShortcuts,
  },
  ref,
) {
  const insertPrompt = (text: string) => {
    const separator = draft.prompt.trim() ? ", " : "";
    onDraftChange({ prompt: `${draft.prompt.trimEnd()}${separator}${text}` });
  };
  const modelProfile = catalog
    ? profileForCheckpoint(catalog, draft.checkpoint)
    : null;
  const showingLiveEdit = generating && generation.kind === "img2img";
  const liveOutputs = generation.job?.outputs ?? draft.outputs;
  const liveProgress = Math.round(generation.progress * 100);

  return (
    <section
      className="focused-edit"
      role="dialog"
      aria-modal="true"
      aria-label="Focused image editor"
    >
      <header className="focused-edit__header">
        <div>
          <p className="eyebrow">Focused edit</p>
          <h2>{source ? "Work directly on this shot" : "Draw a new source"}</h2>
        </div>
        <div className="focused-edit__truth">
          <span>{dimensions.width} × {dimensions.height}</span>
          <span>{checkpointLabel(draft.checkpoint)}</span>
          {dirty && <strong>Local paint not yet rendered</strong>}
        </div>
        <button type="button" className="close-editor" onClick={onClose}>
          Close editor
        </button>
        <button type="button" className="shortcut-map-button" onClick={onShowShortcuts}>
          Keys <kbd>Alt /</kbd>
        </button>
      </header>

      <div className="focused-edit__body">
        <div className="focused-edit__canvas">
          {editorError && (
            <p className="stage__error" role="alert">{editorError}</p>
          )}
          <div
            className={`focused-edit__editor-plane ${
              showingLiveEdit ? "is-obscured" : ""
            }`}
            aria-hidden={showingLiveEdit}
          >
            <ImageEditor
              key={documentKey}
              ref={ref}
              source={source}
              maskSource={maskSource}
              width={dimensions.width}
              height={dimensions.height}
              shortcutsActive={!showingLiveEdit}
              onReady={onReady}
              onContentChange={onContentChange}
              onMaskChange={onMaskChange}
            />
          </div>
          {showingLiveEdit && (
            <section
              className="focused-edit__live-render"
              aria-label="Live edit render"
              aria-live="polite"
            >
              <header>
                <div>
                  <p className="eyebrow">Live edit</p>
                  <h3>
                    {activeOperation === "inpaint"
                      ? activeInpaintScope === "masked"
                        ? "Regenerating the masked crop"
                        : "Regenerating with whole-frame context"
                      : "Building image variations"}
                  </h3>
                </div>
                <span>
                  {liveOutputs} candidate{liveOutputs === 1 ? "" : "s"} · every
                  3 steps
                </span>
              </header>
              <div className="focused-edit__live-plate">
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
                    className="focused-edit__live-placeholders"
                    data-count={Math.min(liveOutputs, 8)}
                    aria-label="Waiting for the first three-step preview"
                  >
                    {Array.from({ length: Math.min(liveOutputs, 8) }, (_, index) => (
                      <span key={index}>{index + 1}</span>
                    ))}
                  </div>
                )}
              </div>
              <footer>
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
          )}
          <EditorVariationTray
            variations={variations}
            activeId={activeVariationId}
            onSelect={onSelectVariation}
          />
        </div>

        <aside className="focused-edit__rail" aria-label="Focused edit controls">
          <section className="focused-edit__model">
            <div className="focused-edit__section-heading">
              <div>
                <p className="eyebrow">Model and render</p>
                <h3>Next pass</h3>
              </div>
              {modelProfile && (
                <span>
                  {modelProfile.family.toUpperCase()} · {modelProfile.defaults.steps}-step base
                </span>
              )}
            </div>
            <label className="focused-edit__checkpoint">
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
            <div className="focused-edit__model-default">
              <span>
                {hasSavedModelDefault
                  ? "Your saved recipe is active"
                  : "Built-in family/model recipe"}
              </span>
              <button type="button" onClick={onSaveModelDefault}>
                {hasSavedModelDefault ? "Update default" : "Save as default"}
              </button>
              {hasSavedModelDefault && (
                <button type="button" onClick={onRestoreModelDefault}>
                  Restore built-in
                </button>
              )}
            </div>
            {catalog && catalog.modules.length > 0 && (
              <details className="focused-edit__components">
                <summary>
                  Components · {draft.modules.length
                    ? `${draft.modules.length} selected`
                    : modelProfile?.component_mode === "integrated"
                      ? "built into checkpoint"
                      : "automatic"}
                </summary>
                <div>
                  {catalog.modules.map((modelModule) => (
                    <label key={modelModule.filename}>
                      <input
                        type="checkbox"
                        checked={draft.modules.includes(modelModule.filename)}
                        onChange={(event) =>
                          onDraftChange({
                            modules: event.target.checked
                              ? [...draft.modules, modelModule.filename]
                              : draft.modules.filter(
                                  (item) => item !== modelModule.filename,
                                ),
                          })
                        }
                      />
                      <span>{modelModule.model_name}</span>
                    </label>
                  ))}
                </div>
              </details>
            )}
            <div className="focused-edit__render-grid">
              <label>
                  <span>Sampler <kbd className="shortcut-chip" aria-hidden="true">Alt R</kbd></span>
                  <select
                    data-shortcut-target="render"
                  value={draft.sampler}
                  onChange={(event) => onDraftChange({ sampler: event.target.value })}
                >
                  {catalog?.samplers.map((sampler) => (
                    <option value={sampler.name} key={sampler.name}>{sampler.name}</option>
                  ))}
                </select>
              </label>
              <label>
                  <span>Scheduler <kbd className="shortcut-chip" aria-hidden="true">Alt Shift R</kbd></span>
                  <select
                    data-shortcut-target="scheduler"
                  value={draft.scheduler}
                  onChange={(event) => onDraftChange({ scheduler: event.target.value })}
                >
                  {catalog?.schedulers.map((scheduler) => (
                    <option value={scheduler.name} key={scheduler.name}>{scheduler.label}</option>
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
                  onValueChange={(steps) => onDraftChange({ steps })}
                />
              </label>
              <label>
                <span>CFG</span>
                <NumberInput
                  min="0"
                  max="30"
                  step="0.5"
                  value={draft.cfgScale}
                  clamp={(value) => clamp(value, 0, 30)}
                  onValueChange={(cfgScale) => onDraftChange({ cfgScale })}
                />
              </label>
              {modelProfile?.family === "flux" && (
                <label>
                  <span>Guidance</span>
                  <NumberInput
                    min="0"
                    max="30"
                    step="0.1"
                    value={draft.distilledCfgScale}
                    clamp={(value) => clamp(value, 0, 30)}
                    onValueChange={(distilledCfgScale) =>
                      onDraftChange({ distilledCfgScale })
                    }
                  />
                </label>
              )}
              <label>
                  <span>Candidates <kbd className="shortcut-chip" aria-hidden="true">Alt N</kbd></span>
                  <NumberInput
                    data-shortcut-target="candidates"
                  min="1"
                  max="8"
                  value={draft.outputs}
                  clamp={(value) => clamp(value, 1, 8)}
                  onValueChange={(outputs) => onDraftChange({ outputs })}
                  />
              </label>
              <label>
                <span>Seed <kbd className="shortcut-chip" aria-hidden="true">Alt S</kbd></span>
                <NumberInput
                  data-shortcut-target="seed"
                  min="-1"
                  value={draft.seed}
                  onValueChange={(seed) => onDraftChange({ seed })}
                />
              </label>
              <div className="focused-edit__preview-cadence">
                <span>Live preview</span>
                <strong>Every 3 steps</strong>
              </div>
            </div>
            {modelIssue && <p className="stage__error" role="alert">{modelIssue}</p>}
          </section>

          <section className="focused-edit__operation">
            <header>
              <div>
                <p className="eyebrow">Edit controls</p>
                <h3>Prepare either pass</h3>
              </div>
              <span>Choose when you generate</span>
            </header>
            <label>
              <span>Denoise <strong>{editSettings.denoisingStrength.toFixed(2)}</strong> <kbd className="shortcut-chip" aria-hidden="true">Alt T</kbd></span>
              <input
                data-shortcut-target="tools"
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
            <div className="focused-edit__inpaint-settings">
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
            </div>
          </section>

          <section className="focused-edit__prompt">
            <div className="focused-edit__section-heading">
              <h3>Prompt <kbd className="shortcut-chip" aria-hidden="true">Alt P</kbd></h3>
              <span>{draft.outputs} candidate{draft.outputs === 1 ? "" : "s"}</span>
            </div>
            <label>
              <span className="sr-only">Prompt</span>
              <textarea
                data-shortcut-target="prompt"
                rows={6}
                value={draft.prompt}
                onChange={(event) => onDraftChange({ prompt: event.target.value })}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    onGenerate(
                      event.shiftKey ? "inpaint" : "img2img",
                      event.shiftKey ? true : undefined,
                    );
                  }
                }}
              />
            </label>
            <label>
              <span>Negative prompt <kbd className="shortcut-chip" aria-hidden="true">Alt Shift P</kbd></span>
              <textarea
                data-shortcut-target="negative-prompt"
                rows={3}
                value={draft.negativePrompt}
                onChange={(event) =>
                  onDraftChange({ negativePrompt: event.target.value })
                }
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
          </section>

          {catalog && (
            <PromptTools
              catalog={catalog}
              selectedStyles={draft.styles}
              onStylesChange={(styles) => onDraftChange({ styles })}
              onInsert={insertPrompt}
            />
          )}

          {(generating || generation.error) && (
            <section className="focused-edit__results" aria-live="polite">
              <header>
                <strong>{generating ? "Forge is editing" : "Recent edited outputs"}</strong>
                <span>{generation.text}</span>
              </header>
              {generation.error && (
                <p className="stage__error" role="alert">{generation.error}</p>
              )}
            </section>
          )}

          <div className="focused-edit__actions">
            <button
              type="button"
              className="generate"
              disabled={!canGenerate}
              onClick={() => onGenerate("img2img")}
            >
              {generating && activeOperation === "img2img"
                ? "Making variation…"
                : "Generate variation"}
              <kbd>Ctrl ↵</kbd>
            </button>
            <button
              type="button"
              className="generate generate--inpaint"
              disabled={!canGenerate || !hasMask}
              title={!hasMask ? "No mask" : "Regenerate only the masked area"}
              onClick={() => onGenerate("inpaint", true)}
            >
              {generating &&
              activeOperation === "inpaint" &&
              activeInpaintScope === "masked"
                ? "Inpainting mask…"
                : "Inpaint masked"}
              <kbd>Ctrl Shift ↵</kbd>
            </button>
            <button
              type="button"
              className="generate generate--inpaint generate--inpaint-whole"
              disabled={!canGenerate || !hasMask}
              title={!hasMask ? "No mask" : "Regenerate using the whole frame as context"}
              onClick={() => onGenerate("inpaint", false)}
            >
              {generating &&
              activeOperation === "inpaint" &&
              activeInpaintScope === "whole"
                ? "Inpainting whole…"
                : "Inpaint whole"}
            </button>
            <button type="button" data-shortcut-target="skip" disabled={!generating} onClick={onSkip}>
              Skip
            </button>
            <button type="button" data-shortcut-target="cancel" disabled={!generating} onClick={onInterrupt}>
              Cancel
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
});
