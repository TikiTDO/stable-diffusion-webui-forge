import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ForgeClient } from "./api/forge/client";
import type {
  DiffusatoryComposition,
  InstanceDescriptor,
  Lora,
  LoraDefaults,
  PromptExpansionInput,
  PromptExpansionMode,
  ServerActivity,
} from "./api/forge/types";
import { Composer } from "./components/Composer";
import { FocusedEditWorkspace } from "./components/FocusedEditWorkspace";
import { KeyboardGuide } from "./components/KeyboardGuide";
import { Stage } from "./components/Stage";
import {
  StageSwitcher,
  type StageSurface,
} from "./components/StageSwitcher";
import {
  ImageEditor,
  type ImageEditorHandle,
} from "./features/editor/ImageEditor";
import type {
  EditOperation,
  ImageEditSettings,
} from "./features/editor/model";
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
import { expandPromptGroups } from "./domain/promptGroups";
import { useForgeCatalog } from "./domain/useForgeCatalog";
import { useForgeGeneration } from "./domain/useForgeGeneration";
import { useServerActivity } from "./domain/useServerActivity";
import { useProject } from "./domain/useProject";
import { ProjectPicker } from "./components/ProjectPicker";
import { usePromptExpansion } from "./domain/usePromptExpansion";
import {
  appendCandidates,
  candidatesFromGeneration,
  type Candidate,
} from "./domain/candidates";
import {
  applyCheckpointProfile,
  modelReadinessIssue,
} from "./domain/modelProfiles";
import { importImageMetadata } from "./domain/imageMetadata";
import {
  checkpointPreferenceKey,
  loadSavedModelDefaults,
  persistSavedModelDefaults,
  savedDefaultFromDraft,
} from "./domain/savedModelDefaults";
import {
  appendGeneratedEditorVariations,
  createEditorSession,
  DEFAULT_PRIMARY_SESSION,
  initialEditorVariation,
  moveVariationToSession,
  PRIMARY_SESSION_ID,
  REMOVED_SESSION_ID,
  removeVariationToTrash,
  restoreVariationFromTrash,
  selectVariationCandidate,
  workingEditorVariation,
  type EditorSession,
  type EditorVariation,
} from "./domain/editorVariations";
import { EditorVariationTray } from "./components/EditorVariationTray";
import { EditorLivePreview } from "./components/EditorLivePreview";
import { workbenchShortcutFor } from "./domain/workbenchShortcuts";
import {
  compilePromptWithLoras,
  defaultsFromActiveLora,
  type ActiveLora,
} from "./domain/loras";

interface EditorOpenOptions {
  dimensions?: { width: number; height: number };
}

interface ImageImportNotice {
  kind: "loading" | "success" | "warning" | "error";
  message: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The image reader returned no data."));
    reader.onerror = () => reject(reader.error ?? new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(source: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("The selected file is not a decodable image."));
    image.src = source;
  });
}

function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(?:png|jpe?g|webp)$/i.test(file.name)
  );
}

function newExpansionSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
}

function serverActivityPresentation(
  activity: ServerActivity | null,
  activityError: string | null,
  state: ReturnType<typeof useForgeGeneration>["state"],
) {
  if (state.phase === "submitting" && activity?.task_id !== state.taskId) {
    return {
      label: "Submitting render",
      detail: state.job
        ? `${state.job.width} × ${state.job.height} · ${state.job.checkpoint}`
        : "Sending the render request",
      busy: true,
      failed: false,
    };
  }
  if (!activity) {
    return {
      label: activityError ? "Status unavailable" : "Reading status…",
      detail: activityError ?? "Connecting to the render server",
      busy: false,
      failed: Boolean(activityError),
    };
  }

  const taskIsOurs = activity.task_id === state.taskId;
  const localJob = taskIsOurs ? state.job : null;
  const checkpoint = activity.checkpoint ?? localJob?.checkpoint ?? null;
  const model = checkpoint?.split(/[\\/]/).at(-1) ?? null;
  const step =
    activity.sampling_steps > 0
      ? `Step ${Math.min(activity.sampling_step + 1, activity.sampling_steps)} of ${activity.sampling_steps}`
      : null;
  const progress =
    activity.progress === null
      ? null
      : `${Math.round(activity.progress * 100)}%`;
  const detail = (...parts: Array<string | null | undefined>) =>
    parts.filter(Boolean).join(" · ");

  switch (activity.phase) {
    case "queued":
      return {
        label: "Waiting for renderer",
        detail: `${activity.queue_size} ${activity.queue_size === 1 ? "job" : "jobs"} queued`,
        busy: true,
        failed: false,
      };
    case "loading-model":
      return {
        label: "Loading model",
        detail: detail(activity.detail, model, activity.queue_size ? `${activity.queue_size} queued` : null),
        busy: true,
        failed: false,
      };
    case "rendering":
      return {
        label: detail(
          "Rendering",
          localJob?.outputs
            ? `${localJob.outputs} ${localJob.outputs === 1 ? "image" : "images"}`
            : null,
          progress,
        ),
        detail: detail(step, activity.detail, model),
        busy: true,
        failed: false,
      };
    case "saving":
      return {
        label: "Saving outputs",
        detail: detail(activity.detail, model),
        busy: true,
        failed: false,
      };
    case "preparing":
      return {
        label: "Preparing render",
        detail: detail(activity.detail, model),
        busy: true,
        failed: false,
      };
    default:
      return {
        label: "Idle",
        detail: model ? `Ready · ${model}` : "Ready",
        busy: false,
        failed: false,
      };
  }
}

function visibleShortcutTarget(name: string): HTMLElement | null {
  const matches = document.querySelectorAll<HTMLElement>(
    `[data-shortcut-target="${name}"]`,
  );
  const focusedWorkspace = document.querySelector<HTMLElement>(".focused-edit");
  return [...matches].reverse().find(
    (element) =>
      (!focusedWorkspace || focusedWorkspace.contains(element)) &&
      element.getClientRects().length > 0 &&
      !element.closest("[hidden]") &&
      window.getComputedStyle(element).visibility !== "hidden",
  ) ?? null;
}

function focusShortcutTarget(name: string): boolean {
  const target = visibleShortcutTarget(name);
  if (!target) return false;
  target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  target.focus({ preventScroll: true });
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.select();
  }
  return true;
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
  const [editorMaskSource, setEditorMaskSource] = useState<string | null>(null);
  const [editorSession, setEditorSession] = useState(0);
  const [editorDocumentRevision, setEditorDocumentRevision] = useState(0);
  const [editorDimensions, setEditorDimensions] = useState({
    width: 1024,
    height: 1024,
  });
  const [editorReady, setEditorReady] = useState(false);
  const [editorHasMask, setEditorHasMask] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorVariations, setEditorVariations] = useState<EditorVariation[]>([]);
  const [activeEditorVariationId, setActiveEditorVariationId] = useState<string | null>(null);
  const [editorSessions, setEditorSessions] = useState<EditorSession[]>([
    DEFAULT_PRIMARY_SESSION,
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>(PRIMARY_SESSION_ID);
  const handleAddSession = useCallback(
    (label: string, parentId?: string | null, sourceImageId?: string | null) => {
      setEditorSessions((current) => {
        const next = createEditorSession(label, current, parentId, sourceImageId);
        setActiveSessionId(next.id);
        return [...current, next];
      });
    },
    [],
  );
  const handleToggleSessionCollapse = useCallback((sessionId: string) => {
    setEditorSessions((current) =>
      current.map((s) => (s.id === sessionId ? { ...s, collapsed: !s.collapsed } : s)),
    );
  }, []);
  const handleMoveVariation = useCallback(
    (variationId: string, targetSessionId: string) => {
      setEditorVariations((current) =>
        moveVariationToSession(current, variationId, targetSessionId),
      );
    },
    [],
  );
  const loadEditorVariation = useCallback((variation: EditorVariation) => {
    setEditorReady(false);
    setEditorHasMask(false);
    setEditorError(null);
    setEditorSource(variation.image);
    setEditorMaskSource(variation.mask);
    setEditorDimensions({ width: variation.width, height: variation.height });
    setDraft((current) => ({
      ...current,
      width: variation.width,
      height: variation.height,
    }));
    setEditorDirty(false);
    setActiveEditorVariationId(variation.id);
    setEditorDocumentRevision((current) => current + 1);
    setGenerationSource("editor");
    setCanvasView("editor");
  }, []);
  const [activeEditOperation, setActiveEditOperation] = useState<EditOperation | null>(null);
  const [activeInpaintScope, setActiveInpaintScope] = useState<
    "masked" | "whole" | null
  >(null);
  const [editorPresentation, setEditorPresentation] = useState<
    "workspace" | "focused"
  >("workspace");
  const [showLivePreview, setShowLivePreview] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem("diffusatory:showLivePreview");
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const handleToggleLivePreview = useCallback(() => {
    setShowLivePreview((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem("diffusatory:showLivePreview", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  const handleTogglePresentation = useCallback(() => {
    setEditorPresentation((prev) => (prev === "focused" ? "workspace" : "focused"));
  }, []);
  const [imageImportNotice, setImageImportNotice] =
    useState<ImageImportNotice | null>(null);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [keyboardGuideOpen, setKeyboardGuideOpen] = useState(false);
  const [savedModelDefaults, setSavedModelDefaults] = useState(
    loadSavedModelDefaults,
  );
  const [conditions, setConditions] = useState<ControlNetCondition[]>([]);
  const [regionalComposition, setRegionalComposition] = useState(
    createRegionalComposition,
  );
  const [editSettings, setEditSettings] = useState<ImageEditSettings>({
    denoisingStrength: 0.6,
    maskBlur: 4,
    inpaintOnlyMasked: true,
    inpaintPadding: 32,
    resizeMode: 1,
  });
  const editorRef = useRef<ImageEditorHandle>(null);
  const editorSessionSequence = useRef(0);
  const editorSnapshotSequence = useRef(0);
  const pendingEditorRun = useRef<{
    session: number;
    operation: EditOperation;
    dimensions: { width: number; height: number };
    sourceId?: string | null;
    targetSessionId?: string;
  } | null>(null);
  const catalogApplied = useRef(false);
  const previewRuns = useRef(new Map<string, number>());
  const {
    catalog,
    error: catalogError,
    loading: catalogLoading,
    reload,
    refreshLoras,
    refreshCheckpoints,
  } = useForgeCatalog(client);
  const {
    catalog: controlNetCatalog,
    error: controlNetError,
    loading: controlNetLoading,
    reload: reloadControlNet,
  } = useControlNetCatalog(client);
  const { state, generate, interrupt, skip, generating } =
    useForgeGeneration(client);
  const projectSession = useProject(client);
  const copyResultsToProject = projectSession.copyResults;
  useEffect(() => {
    if (state.phase !== "completed" || !state.taskId) return;
    void copyResultsToProject(state.taskId, state.results);
  }, [copyResultsToProject, state.phase, state.results, state.taskId]);
  const { activity: serverActivity, error: serverActivityError } =
    useServerActivity(client, state.phase);
  const activity = serverActivityPresentation(
    serverActivity,
    serverActivityError,
    state,
  );
  const sourceActive = generationSource === "editor";
  const activeDimensions = sourceActive ? editorDimensions : {
    width: draft.width,
    height: draft.height,
  };
  const modelIssue = useMemo(
    () => (catalog ? modelReadinessIssue(catalog, draft) : null),
    [catalog, draft],
  );

  useEffect(() => {
    const incoming = candidatesFromGeneration(state);
    if (incoming.length) {
      setCandidates((current) => appendCandidates(current, incoming));
    }
  }, [state]);
  useEffect(() => {
    const pending = pendingEditorRun.current;
    if (!pending || state.kind !== "img2img") return;
    if (state.phase === "failed") {
      pendingEditorRun.current = null;
      setActiveEditOperation(null);
      setActiveInpaintScope(null);
      return;
    }
    if (state.phase !== "completed" || !state.taskId) return;
    if (pending.session === editorSession) {
      const targetSessionId = pending.targetSessionId ?? PRIMARY_SESSION_ID;
      setEditorVariations((current) => {
        const next = appendGeneratedEditorVariations(
          current,
          state.taskId!,
          pending.operation,
          state.results,
          pending.dimensions,
          pending.sourceId,
          targetSessionId,
        );
        const newlyAdded = next.find((item) => item.id === `${state.taskId}:0`);
        if (newlyAdded) {
          loadEditorVariation(newlyAdded);
        }
        return next;
      });
    }
    pendingEditorRun.current = null;
    setActiveEditOperation(null);
    setActiveInpaintScope(null);
  }, [editorSession, loadEditorVariation, state.kind, state.phase, state.results, state.taskId]);
  const promptExpansionInput = useMemo<PromptExpansionInput>(
    () => ({
      prompt: expandPromptGroups(draft.prompt, draft.promptGroups).trim(),
      negativePrompt: draft.negativePrompt.trim(),
      mode: promptMode,
      candidateCount: draft.outputs,
      expansionSeed,
    }),
    [draft.negativePrompt, draft.outputs, draft.prompt, draft.promptGroups, expansionSeed, promptMode],
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
    setDraft((current) => {
      const catalogDraft = draftFromCatalog(current, catalog);
      return applyCheckpointProfile(
        catalogDraft,
        catalog,
        catalogDraft.checkpoint,
        savedModelDefaults[checkpointPreferenceKey(catalogDraft.checkpoint)],
      );
    });
  }, [catalog, savedModelDefaults]);

  const changeCheckpoint = useCallback(
    (checkpoint: string) => {
      if (!catalog) return;
      setDraft((current) =>
        applyCheckpointProfile(
          current,
          catalog,
          checkpoint,
          savedModelDefaults[checkpointPreferenceKey(checkpoint)],
        ),
      );
    },
    [catalog, savedModelDefaults],
  );

  const saveCurrentModelDefault = useCallback(() => {
    const key = checkpointPreferenceKey(draft.checkpoint);
    const next = {
      ...savedModelDefaults,
      [key]: savedDefaultFromDraft(draft),
    };
    const persisted = persistSavedModelDefaults(next);
    setSavedModelDefaults(next);
    setImageImportNotice({
      kind: persisted ? "success" : "warning",
      message: persisted
        ? `Saved the current render recipe as ${draft.checkpoint}'s default in this browser.`
        : "Applied this model default for the current session, but browser storage is unavailable.",
    });
  }, [draft, savedModelDefaults]);

  const restoreCurrentModelDefault = useCallback(() => {
    if (!catalog) return;
    const key = checkpointPreferenceKey(draft.checkpoint);
    const next = { ...savedModelDefaults };
    delete next[key];
    const persisted = persistSavedModelDefaults(next);
    setSavedModelDefaults(next);
    setDraft((current) =>
      applyCheckpointProfile(current, catalog, current.checkpoint),
    );
    setImageImportNotice({
      kind: persisted ? "success" : "warning",
      message: persisted
        ? "Restored this checkpoint's built-in family recipe."
        : "Restored the built-in recipe for this session, but browser storage is unavailable.",
    });
  }, [catalog, draft.checkpoint, savedModelDefaults]);

  const saveCurrentLoraDefaults = useCallback(
    async (lora: Lora, active: ActiveLora) => {
      await client.saveLoraDefaults(
        lora.id,
        defaultsFromActiveLora(active, lora),
      );
      reload();
      setImageImportNotice({
        kind: "success",
        message: `Saved defaults for ${lora.name}.`,
      });
    },
    [client, reload],
  );

  const updateLoraDefaults = useCallback(
    async (lora: Lora, defaults: LoraDefaults) => {
      await client.saveLoraDefaults(lora.id, defaults);
      reload();
      setImageImportNotice({
        kind: "success",
        message: `Updated defaults for ${lora.name}.`,
      });
    },
    [client, reload],
  );

  const uploadLoraPreview = useCallback(
    async (lora: Lora, file: File) => {
      await client.uploadLoraPreview(lora.id, file);
      reload();
      setImageImportNotice({
        kind: "success",
        message: `Updated preview for ${lora.name}.`,
      });
    },
    [client, reload],
  );

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
    !modelIssue &&
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

  const submit = async (
    requestedOperation?: EditOperation,
    inpaintOnlyMasked?: boolean,
  ) => {
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
    const composition: DiffusatoryComposition = {
      version: 1,
      prompt: draft.prompt,
      negativePrompt: draft.negativePrompt,
      loras: draft.loras,
      promptGroups: draft.promptGroups,
      ...(regionalComposition.enabled
        ? { regions: regionalComposition }
        : {}),
    };
    const request = {
      ...requestFromDraft(draft),
      prompt: promptSet.realizations.map((item) =>
        compilePromptWithLoras(
          expandPromptGroups(item.prompt, draft.promptGroups),
          draft.loras,
        ),
      ),
      negativePrompt: promptSet.realizations.map((item) => item.negative_prompt),
      outputs: promptSet.realizations.length,
      controlNet,
      composition,
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
    const operation = requestedOperation ?? "img2img";
    const effectiveEditSettings =
      operation === "inpaint" && inpaintOnlyMasked !== undefined
        ? { ...editSettings, inpaintOnlyMasked }
        : editSettings;
    if (!editor) {
      setEditorError("The visible editor source is not ready yet.");
      return;
    }
    if (operation === "inpaint" && !editor.mask) {
      setEditorError("Paint an inpaint mask before generating.");
      return;
    }
    if (editorDirty) {
      const snapshotId = `session-${editorSession}:working-${++editorSnapshotSequence.current}`;
      setEditorVariations((current) => [
        ...current,
        workingEditorVariation(
          snapshotId,
          editor.initImage,
          editor.mask,
          { width: editor.width, height: editor.height },
          current,
          activeEditorVariationId,
        ),
      ]);
      setEditorDirty(false);
    }
    pendingEditorRun.current = {
      session: editorSession,
      operation,
      sourceId: activeEditorVariationId,
      targetSessionId: activeSessionId,
      dimensions:
        operation === "inpaint" && effectiveEditSettings.inpaintOnlyMasked
          ? { width: editor.width, height: editor.height }
          : { width: draft.width, height: draft.height },
    };
    setActiveEditOperation(operation);
    setActiveInpaintScope(
      operation === "inpaint"
        ? effectiveEditSettings.inpaintOnlyMasked
          ? "masked"
          : "whole"
        : null,
    );
    await generate({
      kind: "img2img",
      input: {
        ...request,
        initImage: editor.initImage,
        mask: operation === "inpaint" ? editor.mask ?? undefined : undefined,
        width: draft.width,
        height: draft.height,
        previewEvery: 3,
        ...effectiveEditSettings,
      },
    });
  };

  const submitShortcutRef = useRef(submit);
  submitShortcutRef.current = submit;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const shortcut = workbenchShortcutFor(event);
      if (!shortcut) return;
      if (shortcut.kind === "close") {
        if (keyboardGuideOpen) {
          event.preventDefault();
          setKeyboardGuideOpen(false);
          return;
        }
        if (editorSession > 0 && editorPresentation === "focused") {
          event.preventDefault();
          setEditorPresentation("workspace");
          return;
        }
        return;
      }
      if (shortcut.kind === "help") {
        event.preventDefault();
        setKeyboardGuideOpen((open) => !open);
        return;
      }
      if (keyboardGuideOpen) setKeyboardGuideOpen(false);
      if (shortcut.kind === "generate") {
        event.preventDefault();
        void submitShortcutRef.current(
          sourceActive
            ? shortcut.operation === "masked" || shortcut.operation === "whole"
              ? "inpaint"
              : "img2img"
            : undefined,
          sourceActive && shortcut.operation !== "default"
            ? shortcut.operation === "masked"
            : undefined,
        );
        return;
      }
      if (shortcut.kind === "focus") {
        if (focusShortcutTarget(shortcut.target)) event.preventDefault();
        return;
      }
      const target = visibleShortcutTarget(shortcut.target);
      if (target && !(target instanceof HTMLButtonElement && target.disabled)) {
        event.preventDefault();
        target.click();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [keyboardGuideOpen, sourceActive]);

  const openEditor = useCallback(
    (
      source: string | null,
      presentation: "workspace" | "focused" = "workspace",
      options: EditorOpenOptions = {},
    ) => {
      const dimensions = options.dimensions ?? {
        width: draft.width,
        height: draft.height,
      };
      const session = ++editorSessionSequence.current;
      const original = initialEditorVariation(
        `session-${session}:original`,
        source,
        dimensions,
      );
      setEditorReady(false);
      setEditorHasMask(false);
      setEditorError(null);
      setActiveEditOperation(null);
      setActiveInpaintScope(null);
      setEditorSource(source);
      setEditorMaskSource(null);
      setEditorDirty(false);
      setEditorDimensions(dimensions);
      setDraft((current) => ({
        ...current,
        width: dimensions.width,
        height: dimensions.height,
      }));
      setEditorSession(session);
      setEditorDocumentRevision(0);
      setEditorSessions([DEFAULT_PRIMARY_SESSION]);
      setEditorVariations([original]);
      setActiveEditorVariationId(original.id);
      setEditorPresentation(presentation);
      setGenerationSource("editor");
      setCanvasView("editor");
    },
    [draft.height, draft.width],
  );
  const replaceEditor = useCallback(
    (
      source: string | null,
      presentation: "workspace" | "focused" = "workspace",
      options: EditorOpenOptions = {},
    ): boolean => {
      if (
        editorSession > 0 &&
        editorDirty &&
        !window.confirm(
          "Replace the current image and discard its uncommitted paint and mask?",
        )
      ) {
        return false;
      }
      openEditor(source, presentation, options);
      return true;
    },
    [editorDirty, editorSession, openEditor],
  );
  const selectEditorVariation = useCallback(
    (variation: EditorVariation) => {
      if (variation.id === activeEditorVariationId && !editorDirty) return;
      if (editorDirty) {
        const current = editorRef.current?.exportForGeneration() ?? null;
        if (!current) {
          setEditorError("The current paint and mask could not be preserved yet.");
          return;
        }
        const snapshotId = `session-${editorSession}:working-${++editorSnapshotSequence.current}`;
        setEditorVariations((variations) => [
          ...variations,
          workingEditorVariation(
            snapshotId,
            current.initImage,
            current.mask,
            { width: current.width, height: current.height },
            variations,
          ),
        ]);
      }
      loadEditorVariation(variation);
    },
    [activeEditorVariationId, editorDirty, editorSession, loadEditorVariation],
  );
  const selectVariationCandidateIndex = useCallback(
    (variation: EditorVariation, candidateIndex: number) => {
      setEditorVariations((current) =>
        selectVariationCandidate(current, variation.id, candidateIndex),
      );
      const candidates =
        variation.candidates && variation.candidates.length
          ? variation.candidates
          : variation.image
            ? [variation.image]
            : [];
      const chosen = candidates[candidateIndex];
      if (chosen && variation.id === activeEditorVariationId) {
        setEditorSource(chosen);
      }
    },
    [activeEditorVariationId],
  );

  const restoreEditorVariation = useCallback((variation: EditorVariation) => {
    setEditorVariations((current) =>
      restoreVariationFromTrash(current, variation.id, PRIMARY_SESSION_ID),
    );
  }, []);

  const removeEditorVariation = useCallback(
    (variation: EditorVariation) => {
      const index = editorVariations.findIndex(
        (candidate) => candidate.id === variation.id,
      );
      if (index < 0) return;
      const removingActive = variation.id === activeEditorVariationId;
      if (
        removingActive &&
        editorDirty &&
        !window.confirm(
          "Remove this variation to trash and discard its uncommitted paint and mask? The raw generated image will remain on disk.",
        )
      ) {
        return;
      }
      const updated = removeVariationToTrash(editorVariations, variation.id);
      setEditorVariations(updated);
      if (!removingActive) return;
      const activeRemaining = updated.filter(
        (candidate) => candidate.sessionId !== REMOVED_SESSION_ID,
      );
      const adjacent =
        activeRemaining[Math.min(index, activeRemaining.length - 1)] ?? null;
      if (adjacent) {
        loadEditorVariation(adjacent);
      } else {
        setEditorReady(false);
        setEditorHasMask(false);
        setEditorError(null);
        setEditorSource(null);
        setEditorMaskSource(null);
        setEditorDirty(false);
        setActiveEditorVariationId(null);
        setEditorDocumentRevision((current) => current + 1);
      }
    },
    [
      activeEditorVariationId,
      editorDirty,
      editorVariations,
      loadEditorVariation,
    ],
  );
  const handleEditorReady = useCallback((width: number, height: number) => {
    setEditorDimensions({ width, height });
    setEditorReady(true);
  }, []);
  const closeEditor = useCallback(() => {
    if (
      editorDirty &&
      !window.confirm("Close this edit and discard its uncommitted paint and mask?")
    ) {
      return;
    }
    setEditorSession(0);
    setEditorSource(null);
    setEditorMaskSource(null);
    setEditorReady(false);
    setEditorHasMask(false);
    setEditorDirty(false);
    setEditorVariations([]);
    setActiveEditorVariationId(null);
    setActiveEditOperation(null);
    setActiveInpaintScope(null);
    setGenerationSource("prompt");
    setCanvasView("variants");
  }, [editorDirty]);

  const openImageFile = useCallback(
    async (file: File) => {
      if (!isImageFile(file)) {
        setImageImportNotice({
          kind: "error",
          message: `${file.name || "That file"} is not a supported image.`,
        });
        return;
      }
      setImageImportNotice({
        kind: "loading",
        message: `Reading ${file.name || "image"} and its generation record…`,
      });
      try {
        const source = await readFileAsDataUrl(file);
        const dimensions = await readImageDimensions(source);
        try {
          const metadata = await client.imageMetadata(source);
          const imported = importImageMetadata(
            draft,
            catalog,
            metadata,
            savedModelDefaults,
          );
          if (!replaceEditor(source, editorPresentation, {
            dimensions,
          })) {
            setImageImportNotice({
              kind: "warning",
              message: "Kept the current edit; the dropped image was not opened.",
            });
            return;
          }
          setDraft(imported.draft);
          setEditSettings((current) => ({
            ...current,
            ...imported.editSettings,
          }));
          if (imported.regions) {
            setRegionalComposition(imported.regions);
          }

          if (!imported.hasGenerationMetadata) {
            setImageImportNotice({
              kind: "warning",
              message: `Loaded ${file.name}. It has no Forge generation metadata, so the current recipe was kept.`,
            });
          } else {
            const restored = imported.imported.length
              ? ` Restored ${imported.imported.join(", ")}.`
              : " No compatible recipe fields were found.";
            const warnings = imported.warnings.length
              ? ` ${imported.warnings.join(" ")}`
              : "";
            setImageImportNotice({
              kind: imported.warnings.length ? "warning" : "success",
              message: `Loaded ${file.name}.${restored}${warnings}`,
            });
          }
        } catch (error) {
          if (!replaceEditor(source, editorPresentation, { dimensions })) {
            setImageImportNotice({
              kind: "warning",
              message: "Kept the current edit; the dropped image was not opened.",
            });
            return;
          }
          setImageImportNotice({
            kind: "warning",
            message: `Loaded ${file.name}, but Forge could not read its generation metadata: ${
              error instanceof Error ? error.message : "unknown metadata error"
            }`,
          });
        }
      } catch (error) {
        setImageImportNotice({
          kind: "error",
          message: error instanceof Error ? error.message : "The image could not be opened.",
        });
      }
    },
    [catalog, client, draft, editorPresentation, replaceEditor, savedModelDefaults],
  );

  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setImageDragActive(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setImageDragActive(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setImageDragActive(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setImageDragActive(false);
      const file = Array.from(event.dataTransfer?.files ?? []).find(isImageFile);
      if (file) {
        void openImageFile(file);
      } else {
        setImageImportNotice({
          kind: "error",
          message: "That drop did not contain a supported image.",
        });
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [openImageFile]);
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
        <div
          className={`instance ${activity.busy ? "is-busy" : ""} ${activity.failed ? "is-failed" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span
            className={`instance__light ${instance ? "is-ready" : ""} ${activity.busy ? "is-busy" : ""}`}
            aria-hidden="true"
          />
          <div>
            <span className="instance__scope">Server</span>
            <strong>{instance ? activity.label : "Connecting…"}</strong>
            <small>
              {instance
                ? `${activity.detail} · ${instance.host}`
                : instanceError ?? "Reading capabilities"}
            </small>
          </div>
        </div>
      </header>

      <main className="workspace">
        <Composer
          projectPicker={
            <ProjectPicker
              projects={projectSession.projects}
              projectId={projectSession.projectId}
              notice={projectSession.notice}
              onChange={projectSession.setProjectId}
              onCreate={projectSession.createProject}
            />
          }
          draft={draft}
          catalog={catalog}
          catalogError={catalogError}
          catalogLoading={catalogLoading}
          modelIssue={modelIssue}
          hasSavedModelDefault={Boolean(
            savedModelDefaults[checkpointPreferenceKey(draft.checkpoint)],
          )}
          generating={generating}
          canGenerate={canGenerate}
          sourceActive={sourceActive}
          hasEditorDocument={editorSession > 0}
          hasMask={editorHasMask}
          editSettings={editSettings}
          editDimensions={editorDimensions}
          onChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
          onCheckpointChange={changeCheckpoint}
          onSaveModelDefault={saveCurrentModelDefault}
          onRestoreModelDefault={restoreCurrentModelDefault}
          onSaveLoraDefaults={saveCurrentLoraDefaults}
          onUpdateLoraDefaults={updateLoraDefaults}
          onUploadLoraPreview={uploadLoraPreview}
          onRefreshLoras={refreshLoras}
          onRefreshCheckpoints={refreshCheckpoints}
          onGenerate={(operation, inpaintOnlyMasked) =>
            void submit(operation, inpaintOnlyMasked)
          }
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
          onNewDrawing={() => replaceEditor(null)}
          onOpenImage={(file) => void openImageFile(file)}
          onShowShortcuts={() => setKeyboardGuideOpen(true)}
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
              frameWidth={activeDimensions.width}
              frameHeight={activeDimensions.height}
              candidateCount={draft.outputs}
              onEdit={(source, presentation) => {
                replaceEditor(source, presentation);
              }}
              onDismissCandidate={(id) =>
                setCandidates((current) => current.filter((candidate) => candidate.id !== id))
              }
              onDismissBatch={(taskId) =>
                setCandidates((current) =>
                  current.filter((candidate) => candidate.taskId !== taskId),
                )
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
          {editorSession > 0 && editorPresentation === "workspace" && (
            <div className="workspace-pane" hidden={canvasView !== "editor"}>
            <section className="stage stage--editor" aria-label="Editing stage">
              <header className="stage__header">
                <div>
                  <p className="eyebrow">Editor</p>
                  <h2>{editorSource ? "Refine this shot" : "Draw the source"}</h2>
                </div>
                <button
                  type="button"
                  className="presentation-toggle-button"
                  onClick={() => setEditorPresentation("focused")}
                  title="Expand to focused full-screen view"
                >
                  ⤢ Focused view
                </button>
                <button
                  type="button"
                  className="return-to-results"
                  onClick={() => setCanvasView("variants")}
                >
                  Hide editor
                </button>
                <button
                  type="button"
                  className="close-editor"
                  onClick={closeEditor}
                >
                  Close editor
                </button>
              </header>
              {editorError && (
                <p className="stage__error" role="alert">{editorError}</p>
              )}
              <div className="stage-editor__canvas-area">
                <div
                  className={`stage-editor__plane ${
                    generating && state.kind === "img2img" && showLivePreview ? "is-obscured" : ""
                  }`}
                  aria-hidden={generating && state.kind === "img2img" && showLivePreview}
                >
                  <ImageEditor
                    key={`${editorSession}:${editorDocumentRevision}`}
                    ref={editorRef}
                    source={editorSource}
                    maskSource={editorMaskSource}
                    width={editorDimensions.width}
                    height={editorDimensions.height}
                    shortcutsActive={canvasView === "editor" && !(generating && state.kind === "img2img" && showLivePreview)}
                    onReady={handleEditorReady}
                    onMaskChange={setEditorHasMask}
                    onContentChange={() => {
                      setEditorDirty(true);
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
                      );
                    }}
                  />
                </div>
                {generating && state.kind === "img2img" && showLivePreview && (
                  <EditorLivePreview
                    generation={state}
                    activeOperation={activeEditOperation}
                    activeInpaintScope={activeInpaintScope}
                    defaultOutputs={draft.outputs}
                    onTogglePreview={handleToggleLivePreview}
                    layout="panel"
                  />
                )}
                {generating && state.kind === "img2img" && !showLivePreview && (
                  <div className="focused-edit__live-status-pill stage-editor__live-status-pill">
                    <span>Generating ({Math.round(state.progress * 100)}%)</span>
                    <button
                      type="button"
                      onClick={handleToggleLivePreview}
                    >
                      Show preview
                    </button>
                  </div>
                )}
              </div>
              <EditorVariationTray
                variations={editorVariations}
                activeId={activeEditorVariationId}
                sessions={editorSessions}
                activeSessionId={activeSessionId}
                onSelect={selectEditorVariation}
                onRemove={removeEditorVariation}
                onSelectCandidate={selectVariationCandidateIndex}
                onAddSession={handleAddSession}
                onToggleSessionCollapse={handleToggleSessionCollapse}
                onMoveToSession={handleMoveVariation}
                onSelectSession={setActiveSessionId}
                onRestore={restoreEditorVariation}
              />
            </section>
            </div>
          )}
        </div>
      </main>

      {editorSession > 0 && editorPresentation === "focused" && (
        <FocusedEditWorkspace
          ref={editorRef}
          documentKey={`${editorSession}:${editorDocumentRevision}`}
          source={editorSource}
          maskSource={editorMaskSource}
          dimensions={editorDimensions}
          dirty={editorDirty}
          editorError={editorError}
          editSettings={editSettings}
          draft={draft}
          catalog={catalog}
          modelIssue={modelIssue}
          hasSavedModelDefault={Boolean(
            savedModelDefaults[checkpointPreferenceKey(draft.checkpoint)],
          )}
          generation={state}
          generating={generating}
          canGenerate={canGenerate}
          hasMask={editorHasMask}
          showLivePreview={showLivePreview}
          onToggleLivePreview={handleToggleLivePreview}
          onTogglePresentation={handleTogglePresentation}
          activeOperation={activeEditOperation}
          activeInpaintScope={activeInpaintScope}
          variations={editorVariations}
          activeVariationId={activeEditorVariationId}
          sessions={editorSessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          promptMode={promptMode}
          expansionSeed={expansionSeed}
          promptExpansion={promptExpansion.response}
          promptExpansionLoading={promptExpansion.loading}
          promptExpansionError={promptExpansion.error}
          promptActionError={promptActionError}
          onReady={handleEditorReady}
          onMaskChange={setEditorHasMask}
          onContentChange={() => {
            setEditorDirty(true);
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
            );
          }}
          onDraftChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
          onCheckpointChange={changeCheckpoint}
          onSaveModelDefault={saveCurrentModelDefault}
          onRestoreModelDefault={restoreCurrentModelDefault}
          onSaveLoraDefaults={saveCurrentLoraDefaults}
          onUpdateLoraDefaults={updateLoraDefaults}
          onUploadLoraPreview={uploadLoraPreview}
          onRefreshLoras={refreshLoras}
          onRefreshCheckpoints={refreshCheckpoints}
          onEditSettingsChange={(patch) =>
            setEditSettings((current) => ({ ...current, ...patch }))
          }
          onPromptModeChange={setPromptMode}
          onExpansionSeedChange={setExpansionSeed}
          onShufflePromptSet={() => setExpansionSeed(newExpansionSeed())}
          onGenerate={(operation, inpaintOnlyMasked) =>
            void submit(operation, inpaintOnlyMasked)
          }
          onSkip={() => void skip()}
          onInterrupt={() => void interrupt()}
          onSelectVariation={selectEditorVariation}
          onRemoveVariation={removeEditorVariation}
          onSelectCandidate={selectVariationCandidateIndex}
          onAddSession={handleAddSession}
          onToggleSessionCollapse={handleToggleSessionCollapse}
          onMoveToSession={handleMoveVariation}
          onRestoreVariation={restoreEditorVariation}
          onClose={closeEditor}
          onShowShortcuts={() => setKeyboardGuideOpen(true)}
        />
      )}

      <KeyboardGuide
        open={keyboardGuideOpen}
        onClose={() => setKeyboardGuideOpen(false)}
      />

      {imageDragActive && (
        <div className="image-drop-overlay" role="status" aria-live="polite">
          <div>
            <strong>Drop image to edit</strong>
            <span>Its embedded Forge recipe will be restored when compatible.</span>
          </div>
        </div>
      )}

      {imageImportNotice && (
        <div
          className={`image-import-notice image-import-notice--${imageImportNotice.kind}`}
          role={imageImportNotice.kind === "error" ? "alert" : "status"}
        >
          <span>{imageImportNotice.message}</span>
          <button
            type="button"
            onClick={() => setImageImportNotice(null)}
            aria-label="Dismiss image import notice"
          >
            ×
          </button>
        </div>
      )}

      <footer className="footer">
        <span>Diffusatory client · existing Forge engine</span>
        <span>Built for the active visual-story workflow</span>
      </footer>
    </div>
  );
}
