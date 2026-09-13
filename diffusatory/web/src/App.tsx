import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ForgeClient } from "./api/forge/client";
import type {
  InstanceDescriptor,
  PromptExpansionInput,
  PromptExpansionMode,
} from "./api/forge/types";
import { Composer } from "./components/Composer";
import { Stage } from "./components/Stage";
import {
  StageSwitcher,
  type StageSurface,
} from "./components/StageSwitcher";
import {
  ImageEditor,
  type ImageEditorHandle,
} from "./features/editor/ImageEditor";
import {
  conditionIssue,
  createCondition,
  resolveConditions,
  sourceForCondition,
} from "./features/controlnet/model";
import type {
  ConditionPatch,
  ControlNetCondition,
} from "./features/controlnet/types";
import { useControlNetCatalog } from "./features/controlnet/useControlNetCatalog";
import {
  createRegionalComposition,
  resolveSpatialPlan,
} from "./features/regions/model";
import { RegionStage } from "./features/regions/RegionStage";
import {
  draftFromCatalog,
  requestFromDraft,
  starterDraft,
} from "./domain/draft";
import { useForgeCatalog } from "./domain/useForgeCatalog";
import { useForgeGeneration } from "./domain/useForgeGeneration";
import { usePromptExpansion } from "./domain/usePromptExpansion";
import {
  appendCandidates,
  candidatesFromGeneration,
  type Candidate,
} from "./domain/candidates";

function newExpansionSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
}

export default function App() {
  const client = useMemo(() => new ForgeClient(), []);
  const [instance, setInstance] = useState<InstanceDescriptor | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [draft, setDraft] = useState(starterDraft);
  const [promptMode, setPromptMode] = useState<PromptExpansionMode>("off");
  const [expansionSeed, setExpansionSeed] = useState(newExpansionSeed);
  const [promptActionError, setPromptActionError] = useState<string | null>(null);
  const [canvasView, setCanvasView] = useState<StageSurface>("variants");
  const [generationSource, setGenerationSource] = useState<"prompt" | "editor">("prompt");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [editorSource, setEditorSource] = useState<string | null>(null);
  const [editorSession, setEditorSession] = useState(0);
  const [editorDimensions, setEditorDimensions] = useState({
    width: 1024,
    height: 1024,
  });
  const [editorReady, setEditorReady] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [conditions, setConditions] = useState<ControlNetCondition[]>([]);
  const [regionalComposition, setRegionalComposition] = useState(
    createRegionalComposition,
  );
  const [editSettings, setEditSettings] = useState({
    denoisingStrength: 0.6,
    maskBlur: 4,
    inpaintOnlyMasked: true,
    inpaintPadding: 32,
  });
  const editorRef = useRef<ImageEditorHandle>(null);
  const catalogApplied = useRef(false);
  const previewRuns = useRef(new Map<string, number>());
  const { catalog, error: catalogError, loading: catalogLoading, reload } =
    useForgeCatalog(client);
  const {
    catalog: controlNetCatalog,
    error: controlNetError,
    loading: controlNetLoading,
    reload: reloadControlNet,
  } = useControlNetCatalog(client);
  const { state, generate, interrupt, skip, generating } =
    useForgeGeneration(client);
  const sourceActive = generationSource === "editor";
  const activeDimensions = sourceActive ? editorDimensions : {
    width: draft.width,
    height: draft.height,
  };

  useEffect(() => {
    const incoming = candidatesFromGeneration(state);
    if (incoming.length) {
      setCandidates((current) => appendCandidates(current, incoming));
    }
  }, [state]);
  const promptExpansionInput = useMemo<PromptExpansionInput>(
    () => ({
      prompt: draft.prompt.trim(),
      negativePrompt: draft.negativePrompt.trim(),
      mode: promptMode,
      candidateCount: draft.outputs,
      expansionSeed,
    }),
    [draft.negativePrompt, draft.outputs, draft.prompt, expansionSeed, promptMode],
  );
  const promptExpansionEnabled = Boolean(
    instance?.capabilities.includes("prompt-expansion"),
  );
  const promptExpansion = usePromptExpansion(
    client,
    promptExpansionInput,
    promptExpansionEnabled,
  );

  useEffect(() => setPromptActionError(null), [promptExpansionInput]);

  const loadInstance = useCallback(
    async (signal?: AbortSignal) => {
      setInstanceError(null);
      try {
        setInstance(await client.instance(signal));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setInstanceError(
          error instanceof Error ? error.message : "Instance unavailable",
        );
      }
    },
    [client],
  );

  useEffect(() => {
    const abort = new AbortController();
    void loadInstance(abort.signal);
    return () => abort.abort();
  }, [loadInstance]);

  useEffect(() => {
    if (!catalog || catalogApplied.current) return;
    catalogApplied.current = true;
    setDraft((current) => draftFromCatalog(current, catalog));
  }, [catalog]);

  const currentImageAvailable = editorSession > 0 && editorReady;
  const conditionsReady = conditions.every(
    (condition) =>
      !conditionIssue(
        condition,
        currentImageAvailable ? "available" : null,
      ),
  );
  const canGenerate =
    (sourceActive || Boolean(draft.prompt.trim())) &&
    !generating &&
    Boolean(
      instance?.capabilities.includes(
        sourceActive ? "img2img" : "txt2img",
      ),
    ) &&
    (!sourceActive || editorReady) &&
    Boolean(catalog) &&
    conditionsReady &&
    promptExpansionEnabled &&
    !promptExpansion.loading &&
    Boolean(promptExpansion.response?.resolved_count) &&
    !promptExpansion.response?.issues.some((issue) => issue.blocking) &&
    (!regionalComposition.enabled ||
      Boolean(instance?.capabilities.includes("spatial-conditioning")));

  const changeCondition = useCallback((id: string, patch: ConditionPatch) => {
    const invalidatesPreview =
      "source" in patch ||
      "module" in patch ||
      "processorResolution" in patch ||
      "thresholdA" in patch ||
      "thresholdB" in patch;
    if (invalidatesPreview) {
      previewRuns.current.set(id, (previewRuns.current.get(id) ?? 0) + 1);
    }
    setConditions((current) =>
      current.map((condition) =>
        condition.id === id
          ? {
              ...condition,
              ...(invalidatesPreview
                ? {
                    preview: null,
                    previewStatus: "idle" as const,
                    previewError: null,
                  }
                : {}),
              ...patch,
            }
          : condition,
      ),
    );
  }, []);

  const replaceCondition = useCallback((replacement: ControlNetCondition) => {
    setConditions((current) =>
      current.map((condition) =>
        condition.id === replacement.id ? replacement : condition,
      ),
    );
  }, []);

  const currentEditorImage = useCallback((): string | null => {
    if (!editorReady) return null;
    return editorRef.current?.exportForGeneration()?.initImage ?? null;
  }, [editorReady]);

  const previewCondition = useCallback(
    async (condition: ControlNetCondition) => {
      const image = sourceForCondition(condition, currentEditorImage());
      if (!image) {
        changeCondition(condition.id, {
          previewStatus: "failed",
          previewError: "The condition source is not ready.",
        });
        return;
      }
      changeCondition(condition.id, {
        previewStatus: "loading",
        previewError: null,
      });
      const run = (previewRuns.current.get(condition.id) ?? 0) + 1;
      previewRuns.current.set(condition.id, run);
      try {
        const result = await client.detectControlNet({
          module: condition.module,
          image,
          processorResolution: condition.processorResolution,
          thresholdA: condition.thresholdA,
          thresholdB: condition.thresholdB,
        });
        if (previewRuns.current.get(condition.id) !== run) return;
        changeCondition(condition.id, {
          preview: result.images[0] ?? null,
          previewStatus: "ready",
          previewError: result.images.length
            ? null
            : "The preprocessor returned no image.",
        });
      } catch (error) {
        if (previewRuns.current.get(condition.id) !== run) return;
        changeCondition(condition.id, {
          previewStatus: "failed",
          previewError:
            error instanceof Error ? error.message : "Preprocessing failed.",
        });
      }
    },
    [changeCondition, client, currentEditorImage],
  );

  const submit = async () => {
    if (!canGenerate) return;
    setEditorError(null);
    setPromptActionError(null);
    const editor = editorReady
      ? editorRef.current?.exportForGeneration() ?? null
      : null;
    const currentImage = editor?.initImage ?? null;
    let controlNet;
    try {
      controlNet = resolveConditions(conditions, currentImage);
    } catch (error) {
      setEditorError(
        error instanceof Error ? error.message : "A condition is incomplete.",
      );
      return;
    }
    let promptSet;
    try {
      promptSet = await client.expandPrompts(promptExpansionInput);
    } catch (error) {
      setPromptActionError(
        error instanceof Error ? error.message : "The prompt set could not be resolved.",
      );
      return;
    }
    const blockingIssue = promptSet.issues.find((issue) => issue.blocking);
    if (blockingIssue || !promptSet.realizations.length) {
      setPromptActionError(
        blockingIssue?.message ?? "The prompt set did not produce an image request.",
      );
      return;
    }
    const request = {
      ...requestFromDraft(draft),
      prompt: promptSet.realizations.map((item) => item.prompt),
      negativePrompt: promptSet.realizations.map((item) => item.negative_prompt),
      outputs: promptSet.realizations.length,
      controlNet,
      ...(regionalComposition.enabled
        ? {
            spatialPlan: resolveSpatialPlan(
              regionalComposition,
              activeDimensions.width,
              activeDimensions.height,
            ),
          }
        : {}),
    };
    if (!sourceActive) {
      await generate({ kind: "txt2img", input: request });
      setCanvasView("variants");
      return;
    }
    if (!editor) {
      setEditorError("The visible editor source is not ready yet.");
      return;
    }
    await generate({
      kind: "img2img",
      input: {
        ...request,
        initImage: editor.initImage,
        mask: editor.mask ?? undefined,
        width: editor.width,
        height: editor.height,
        ...editSettings,
      },
    });
    setCanvasView("variants");
  };

  const openEditor = useCallback(
    (source: string | null) => {
      setEditorReady(false);
      setEditorError(null);
      setEditorSource(source);
      setEditorDimensions({ width: draft.width, height: draft.height });
      setEditorSession((current) => current + 1);
      setGenerationSource("editor");
      setCanvasView("editor");
    },
    [draft.height, draft.width],
  );
  const handleEditorReady = useCallback((width: number, height: number) => {
    setEditorDimensions({ width, height });
    setEditorReady(true);
  }, []);
  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ◉
          </span>
          <div>
            <p className="eyebrow">Visual story workbench</p>
            <h1>Diffusatory</h1>
          </div>
        </div>
        <div className="instance">
          <span
            className={`instance__light ${instance ? "is-ready" : ""}`}
            aria-hidden="true"
          />
          <div>
            <strong>{instance?.name ?? "Finding the local instrument…"}</strong>
            <small>
              {instance
                ? `${instance.host} · ${instance.version.slice(0, 8)}`
                : instanceError ?? "Reading capabilities"}
            </small>
          </div>
        </div>
      </header>

      <main className="workspace">
        <Composer
          draft={draft}
          catalog={catalog}
          catalogError={catalogError}
          catalogLoading={catalogLoading}
          generating={generating}
          canGenerate={canGenerate}
          sourceActive={sourceActive}
          editorVisible={canvasView === "editor"}
          hasEditorDocument={editorSession > 0}
          editSettings={editSettings}
          editDimensions={editorDimensions}
          onChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
          onGenerate={() => void submit()}
          onInterrupt={() => void interrupt()}
          onSkip={() => void skip()}
          onReloadCatalog={() => {
            reload();
            void loadInstance();
          }}
          onUsePromptOnly={() => {
            setGenerationSource("prompt");
            setCanvasView("variants");
          }}
          onResumeEditor={() => {
            setGenerationSource("editor");
            setCanvasView("editor");
          }}
          onNewDrawing={() => openEditor(null)}
          onEditSettingsChange={(patch) =>
            setEditSettings((current) => ({ ...current, ...patch }))
          }
          controlNetCatalog={controlNetCatalog}
          controlNetError={controlNetError}
          controlNetLoading={controlNetLoading}
          conditions={conditions}
          regionalComposition={regionalComposition}
          regionalStageVisible={canvasView === "regions"}
          onShowRegionalStage={() => setCanvasView("regions")}
          onRegionalCompositionChange={(next) => {
            const enabledNow = regionalComposition.enabled;
            setRegionalComposition(next);
            if (!enabledNow && next.enabled) setCanvasView("regions");
            if (enabledNow && !next.enabled && canvasView === "regions") {
              setCanvasView(sourceActive ? "editor" : "variants");
            }
          }}
          promptMode={promptMode}
          expansionSeed={expansionSeed}
          promptExpansion={promptExpansion.response}
          promptExpansionLoading={promptExpansion.loading}
          promptExpansionError={promptExpansion.error}
          promptActionError={promptActionError}
          onPromptModeChange={setPromptMode}
          onExpansionSeedChange={setExpansionSeed}
          onShufflePromptSet={() => setExpansionSeed(newExpansionSeed())}
          currentImageAvailable={currentImageAvailable}
          onAddCondition={() => {
            if (!controlNetCatalog || conditions.length >= 3) return;
            setConditions((current) => [
              ...current,
              createCondition(controlNetCatalog),
            ]);
          }}
          onChangeCondition={changeCondition}
          onReplaceCondition={replaceCondition}
          onRemoveCondition={(id) =>
            setConditions((current) => {
              previewRuns.current.delete(id);
              return current.filter((condition) => condition.id !== id);
            })
          }
          onPreviewCondition={(condition) => void previewCondition(condition)}
          onReloadControlNet={reloadControlNet}
        />

        <div className="stage-column">
          <StageSwitcher
            surface={canvasView}
            candidateCount={candidates.length}
            hasEditorDocument={editorSession > 0}
            regionsEnabled={regionalComposition.enabled}
            regionCount={regionalComposition.rows.length * regionalComposition.columns.length}
            sourceKind={generationSource}
            sourceDimensions={activeDimensions}
            onShowVariants={() => setCanvasView("variants")}
            onShowEditor={() => {
              if (editorSession > 0) {
                setGenerationSource("editor");
                setCanvasView("editor");
              } else {
                openEditor(null);
              }
            }}
            onShowRegions={() => {
              if (!regionalComposition.enabled) {
                setRegionalComposition({
                  ...createRegionalComposition(),
                  enabled: true,
                });
              }
              setCanvasView("regions");
            }}
          />
          <div className="workspace-pane" hidden={canvasView !== "variants"}>
            <Stage
              generation={state}
              candidates={candidates}
              onRefine={openEditor}
              onDismissCandidate={(id) =>
                setCandidates((current) => current.filter((candidate) => candidate.id !== id))
              }
              onClearCandidates={() => setCandidates([])}
            />
          </div>
          <div className="workspace-pane" hidden={canvasView !== "regions"}>
            <RegionStage
              value={regionalComposition}
              frameWidth={activeDimensions.width}
              frameHeight={activeDimensions.height}
              onChange={setRegionalComposition}
            />
          </div>
          {editorSession > 0 && (
            <div className="workspace-pane" hidden={canvasView !== "editor"}>
            <section className="stage stage--editor" aria-label="Editing stage">
              <header className="stage__header">
                <div>
                  <p className="eyebrow">Editor</p>
                  <h2>{editorSource ? "Refine this shot" : "Draw the source"}</h2>
                </div>
                <button
                  type="button"
                  className="return-to-results"
                  onClick={() => setCanvasView("variants")}
                >
                  Return to results
                </button>
              </header>
              {editorError && (
                <p className="stage__error" role="alert">{editorError}</p>
              )}
              <ImageEditor
                key={editorSession}
                ref={editorRef}
                source={editorSource}
                width={editorDimensions.width}
                height={editorDimensions.height}
                onReady={handleEditorReady}
                onContentChange={() =>
                  setConditions((current) =>
                    current.map((condition) =>
                      condition.source.kind === "current" && condition.preview
                        ? {
                            ...condition,
                            preview: null,
                            previewStatus: "idle",
                            previewError: null,
                          }
                        : condition,
                    ),
                  )
                }
              />
              {state.kind === "img2img" && state.images.length > 0 && (
                <div className="edit-results" aria-label="Edited candidates">
                  <div>
                    <strong>Edited candidates</strong>
                    <small>Choose one to continue painting on it.</small>
                  </div>
                  <div className="edit-results__tray">
                    {state.images.map((image, index) => (
                      <button
                        type="button"
                        key={`${state.taskId}-edit-${index}`}
                        onClick={() => openEditor(image)}
                        aria-label={`Use edited candidate ${index + 1} as source`}
                      >
                        <img src={image} alt={`Edited candidate ${index + 1}`} />
                        <span>Use as source</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="return-to-results"
                    onClick={() => setCanvasView("variants")}
                  >
                    Compare full size
                  </button>
                </div>
              )}
            </section>
            </div>
          )}
        </div>
      </main>

      <footer className="footer">
        <span>React client · existing Forge engine</span>
        <span>Gradio remains available during parity</span>
      </footer>
    </div>
  );
}
