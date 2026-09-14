import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ForgeClient } from "./api/forge/client";
import type {
  InstanceDescriptor,
  PromptExpansionInput,
  PromptExpansionMode,
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
import type { EditOperation } from "./features/editor/model";
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
  initialEditorVariation,
  workingEditorVariation,
  type EditorVariation,
} from "./domain/editorVariations";
import { EditorVariationTray } from "./components/EditorVariationTray";
import { workbenchShortcutFor } from "./domain/workbenchShortcuts";

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
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorVariations, setEditorVariations] = useState<EditorVariation[]>([]);
  const [activeEditorVariationId, setActiveEditorVariationId] = useState<string | null>(null);
  const [activeEditOperation, setActiveEditOperation] = useState<EditOperation | null>(null);
  const [activeInpaintScope, setActiveInpaintScope] = useState<
    "masked" | "whole" | null
  >(null);
  const [editorPresentation, setEditorPresentation] = useState<
    "workspace" | "focused"
  >("workspace");
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
  const [editSettings, setEditSettings] = useState({
    denoisingStrength: 0.6,
    maskBlur: 4,
    inpaintOnlyMasked: true,
    inpaintPadding: 32,
  });
  const editorRef = useRef<ImageEditorHandle>(null);
  const editorSessionSequence = useRef(0);
  const editorSnapshotSequence = useRef(0);
  const pendingEditorRun = useRef<{
    session: number;
    operation: EditOperation;
    dimensions: { width: number; height: number };
  } | null>(null);
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
      setEditorVariations((current) =>
        appendGeneratedEditorVariations(
          current,
          state.taskId!,
          pending.operation,
          state.results,
          pending.dimensions,
        ),
      );
    }
    pendingEditorRun.current = null;
    setActiveEditOperation(null);
    setActiveInpaintScope(null);
  }, [editorSession, state.kind, state.phase, state.results, state.taskId]);
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
        ),
      ]);
      setActiveEditorVariationId(snapshotId);
      setEditorDirty(false);
    }
    pendingEditorRun.current = {
      session: editorSession,
      operation,
      dimensions: { width: editor.width, height: editor.height },
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
        width: editor.width,
        height: editor.height,
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
        if (!keyboardGuideOpen) return;
        event.preventDefault();
        setKeyboardGuideOpen(false);
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
      setEditorError(null);
      setActiveEditOperation(null);
      setActiveInpaintScope(null);
      setEditorSource(source);
      setEditorMaskSource(null);
      setEditorDirty(false);
      setEditorDimensions(dimensions);
      setEditorSession(session);
      setEditorDocumentRevision(0);
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
      setEditorReady(false);
      setEditorError(null);
      setEditorSource(variation.image);
      setEditorMaskSource(variation.mask);
      setEditorDimensions({ width: variation.width, height: variation.height });
      setEditorDirty(false);
      setActiveEditorVariationId(variation.id);
      setEditorDocumentRevision((current) => current + 1);
      setGenerationSource("editor");
      setCanvasView("editor");
    },
    [activeEditorVariationId, editorDirty, editorSession],
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
          if (!replaceEditor(source, "focused", {
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
          if (!replaceEditor(source, "focused", { dimensions })) {
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
    [catalog, client, draft, replaceEditor, savedModelDefaults],
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
        <div className="instance">
          <span
            className={`instance__light ${instance ? "is-ready" : ""}`}
            aria-hidden="true"
          />
          <div>
            <strong>
              {generating && state.job
                ? `${state.job.kind === "img2img" ? "Editing" : "Generating"} ${
                    state.job.outputs
                  } ${state.job.outputs === 1 ? "image" : "images"}`
                : instance?.name ?? "Finding the local instrument…"}
            </strong>
            <small>
              {generating && state.job
                ? `${state.job.width} × ${state.job.height} · ${state.job.steps} steps · ${
                    state.job.checkpoint.split(/[\\/]/).at(-1) ?? state.job.checkpoint
                  }`
                : instance
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
          modelIssue={modelIssue}
          hasSavedModelDefault={Boolean(
            savedModelDefaults[checkpointPreferenceKey(draft.checkpoint)],
          )}
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
          onCheckpointChange={changeCheckpoint}
          onSaveModelDefault={saveCurrentModelDefault}
          onRestoreModelDefault={restoreCurrentModelDefault}
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
              <ImageEditor
                key={`${editorSession}:${editorDocumentRevision}`}
                ref={editorRef}
                source={editorSource}
                maskSource={editorMaskSource}
                width={editorDimensions.width}
                height={editorDimensions.height}
                shortcutsActive={canvasView === "editor"}
                onReady={handleEditorReady}
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
              <EditorVariationTray
                variations={editorVariations}
                activeId={activeEditorVariationId}
                onSelect={selectEditorVariation}
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
          activeOperation={activeEditOperation}
          activeInpaintScope={activeInpaintScope}
          variations={editorVariations}
          activeVariationId={activeEditorVariationId}
          promptMode={promptMode}
          expansionSeed={expansionSeed}
          promptExpansion={promptExpansion.response}
          promptExpansionLoading={promptExpansion.loading}
          promptExpansionError={promptExpansion.error}
          promptActionError={promptActionError}
          onReady={handleEditorReady}
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
