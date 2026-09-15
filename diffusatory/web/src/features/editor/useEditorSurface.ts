import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  bindingMatches,
  captureBindingSignature,
  type TabletAction,
  type TabletProfile,
} from "../../input/bindings";
import {
  DEFAULT_PRESSURE_CALIBRATION,
  representativePressure,
  type PressureCalibration,
} from "../../input/calibration";
import { pointerSamples, type PointerSample } from "../../input/pointer";
import { saveImage } from "../../domain/imageDownload";
import { EditorDocument } from "./document";
import type { BindingRecording } from "./PenControls";
import { useCanvasViewport } from "./useCanvasViewport";
import {
  createStrokeOperation,
  type EditorLayer,
  type EditorTool,
  type StrokeOperation,
} from "./model";
import {
  loadTabletProfile,
  saveTabletProfile,
  type PendingBinding,
} from "./tabletProfile";
import { editorShortcutFor } from "./shortcuts";

interface InteractionBase {
  pointerId: number;
  priorLayer: EditorLayer | null;
  priorTool: EditorTool | null;
}

interface StrokeInteraction extends InteractionBase {
  kind: "stroke";
  operation: StrokeOperation;
  renderedSamples: number;
}

interface PanInteraction extends InteractionBase {
  kind: "pan";
  clientX: number;
  clientY: number;
}

interface EyedropperInteraction extends InteractionBase {
  kind: "eyedropper";
}

interface CalibrationInteraction extends InteractionBase {
  kind: "calibration";
  readings: number[];
}

interface HoldInteraction extends InteractionBase {
  kind: "hold";
}

type ActiveInteraction =
  | StrokeInteraction
  | PanInteraction
  | EyedropperInteraction
  | CalibrationInteraction
  | HoldInteraction;

interface TouchPoint {
  clientX: number;
  clientY: number;
}

interface EditorSurfaceOptions {
  source: string | null;
  maskSource?: string | null;
  width: number;
  height: number;
  shortcutsActive?: boolean;
  onReady?: (width: number, height: number) => void;
  onContentChange?: () => void;
  onMaskChange?: (hasMask: boolean) => void;
}

function touchGeometry(points: TouchPoint[]): {
  clientX: number;
  clientY: number;
  distance: number;
} | null {
  if (!points.length) return null;
  if (points.length === 1) return { ...points[0], distance: 0 };
  const [first, second] = points;
  return {
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2,
    distance: Math.hypot(
      second.clientX - first.clientX,
      second.clientY - first.clientY,
    ),
  };
}

function boundedBrushSize(size: number): number {
  return Math.min(256, Math.max(1, Math.round(size)));
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

export function useEditorSurface({
  source,
  maskSource = null,
  width,
  height,
  shortcutsActive = true,
  onReady,
  onContentChange,
  onMaskChange,
}: EditorSurfaceOptions) {
  const [profile, setProfile] = useState<TabletProfile>(loadTabletProfile);
  const rootRef = useRef<HTMLDivElement>(null);
  const editorDocumentRef = useRef<EditorDocument | null>(null);
  const interactionRef = useRef<ActiveInteraction | null>(null);
  const penInContactRef = useRef(false);
  const activeLayerRef = useRef<EditorLayer>("mask");
  const toolRef = useRef<EditorTool>("brush");
  const colorRef = useRef("#312338");
  const brushSizeRef = useRef(96);
  const brushSizesRef = useRef<Record<EditorLayer, number>>({
    paint: 16,
    mask: 96,
  });
  const calibrationRef = useRef<PressureCalibration>(
    DEFAULT_PRESSURE_CALIBRATION,
  );
  const profileRef = useRef<TabletProfile>(profile);
  const keyboardPanPriorRef = useRef<EditorTool | null>(null);
  const recordingRef = useRef<BindingRecording | null>(null);
  const calibrationTargetRef = useRef<"light" | "firm" | null>(null);
  const touchesRef = useRef(new Map<number, TouchPoint>());

  const [ready, setReady] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [activeLayer, setActiveLayerState] = useState<EditorLayer>("mask");
  const [tool, setToolState] = useState<EditorTool>("brush");
  const [color, setColorState] = useState("#312338");
  const [brushSize, setBrushSizeState] = useState(96);
  const [wheelTarget, setWheelTarget] = useState<"zoom" | "brush-size">(
    "zoom",
  );
  const [recording, setRecording] = useState<BindingRecording | null>(null);
  const [pendingBinding, setPendingBinding] = useState<PendingBinding | null>(
    null,
  );
  const [calibrationTarget, setCalibrationTargetState] = useState<
    "light" | "firm" | null
  >(null);

  const setTool = useCallback((next: EditorTool) => {
    toolRef.current = next;
    setToolState(next);
  }, []);

  const setColor = useCallback((next: string) => {
    colorRef.current = next;
    setColorState(next);
  }, []);

  const setBrushSize = useCallback((next: number) => {
    const bounded = boundedBrushSize(next);
    brushSizesRef.current[activeLayerRef.current] = bounded;
    brushSizeRef.current = bounded;
    setBrushSizeState(bounded);
  }, []);

  const setActiveLayer = useCallback((next: EditorLayer) => {
    activeLayerRef.current = next;
    const nextSize = brushSizesRef.current[next];
    brushSizeRef.current = nextSize;
    setBrushSizeState(nextSize);
    setActiveLayerState(next);
  }, []);

  const setCalibrationTarget = useCallback(
    (target: "light" | "firm" | null) => {
      calibrationTargetRef.current = target;
      setCalibrationTargetState(target);
    },
    [],
  );

  const updatePressure = useCallback(
    (patch: Partial<PressureCalibration>) => {
      setProfile((current) => ({
        ...current,
        pressure: { ...current.pressure, ...patch },
      }));
    },
    [],
  );

  useEffect(() => {
    profileRef.current = profile;
    calibrationRef.current = profile.pressure;
    saveTabletProfile(profile);
  }, [profile]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  const {
    displayRef,
    zoom,
    clientToImage,
    requestRender,
    resetViewport,
    panBy,
    pinch,
    handleWheel: handleViewportWheel,
    setCursor,
  } = useCanvasViewport({
    editorDocumentRef,
    activeLayerRef,
    toolRef,
    brushSizeRef,
  });

  useEffect(() => requestRender(), [brushSize, requestRender]);

  const toggleBrushWheel = useCallback(() => {
    setWheelTarget((current) =>
      current === "brush-size" ? "zoom" : "brush-size",
    );
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (wheelTarget === "zoom") {
        handleViewportWheel(event);
        return;
      }
      event.preventDefault();
      const factor = activeLayerRef.current === "mask" ? 1.55 : 1.12;
      setBrushSize(
        event.deltaY < 0
          ? brushSizeRef.current * factor
          : brushSizeRef.current / factor,
      );
    },
    [handleViewportWheel, setBrushSize, wheelTarget],
  );

  useEffect(() => {
    const canvas = displayRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [displayRef, handleWheel]);

  useEffect(() => {
    const nextDocument = new EditorDocument(width, height);
    editorDocumentRef.current = nextDocument;
    interactionRef.current = null;
    resetViewport();
    setReady(false);
    setSourceError(null);
    onMaskChange?.(false);
    let disposed = false;

    void nextDocument
      .loadSource(source, maskSource)
      .then(() => {
        if (disposed || editorDocumentRef.current !== nextDocument) return;
        setReady(true);
        onMaskChange?.(nextDocument.hasMask());
        onReady?.(width, height);
        requestRender();
      })
      .catch((error: unknown) => {
        if (disposed || editorDocumentRef.current !== nextDocument) return;
        setReady(false);
        setSourceError(
          error instanceof Error ? error.message : "The source image failed to load.",
        );
        requestRender();
      });

    return () => {
      disposed = true;
    };
  }, [height, maskSource, onMaskChange, onReady, requestRender, resetViewport, source, width]);

  const notifyContentChange = useCallback(() => {
    onMaskChange?.(editorDocumentRef.current?.hasMask() ?? false);
    onContentChange?.();
  }, [onContentChange, onMaskChange]);

  const rebuildDocument = useCallback(() => {
    editorDocumentRef.current?.rebuild();
    requestRender();
  }, [requestRender]);

  const restoreInteractionState = useCallback(
    (interaction: ActiveInteraction) => {
      if (interaction.priorLayer) setActiveLayer(interaction.priorLayer);
      if (interaction.priorTool) setTool(interaction.priorTool);
    },
    [setActiveLayer, setTool],
  );

  useEffect(() => {
    const cancelUnfinishedInteraction = () => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      interactionRef.current = null;
      penInContactRef.current = false;
      if (interaction.kind === "stroke") rebuildDocument();
      restoreInteractionState(interaction);
      requestRender();
    };
    window.addEventListener("blur", cancelUnfinishedInteraction);
    document.addEventListener("visibilitychange", cancelUnfinishedInteraction);
    return () => {
      window.removeEventListener("blur", cancelUnfinishedInteraction);
      document.removeEventListener("visibilitychange", cancelUnfinishedInteraction);
    };
  }, [rebuildDocument, requestRender, restoreInteractionState]);

  const clearLayer = useCallback(
    (layer: EditorLayer) => {
      editorDocumentRef.current?.clear(layer);
      requestRender();
      notifyContentChange();
    },
    [notifyContentChange, requestRender],
  );

  const undo = useCallback(() => {
    editorDocumentRef.current?.undo();
    requestRender();
    notifyContentChange();
  }, [notifyContentChange, requestRender]);

  const saveCurrentImage = useCallback(() => {
    if (!ready) return;
    const exported = editorDocumentRef.current?.exportForGeneration() ?? null;
    if (exported) saveImage(exported.initImage, "working-edit");
  }, [ready]);

  const actionForEvent = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): TabletAction => {
      const matched = profileRef.current.bindings.find((binding) =>
        bindingMatches(binding, event.nativeEvent),
      );
      if (matched) return matched.action;
      if (toolRef.current === "erase") return "erase";
      if (toolRef.current === "pan") return "pan";
      if (toolRef.current === "eyedropper") return "eyedropper";
      return activeLayerRef.current === "paint" ? "draw-paint" : "draw-mask";
    },
    [],
  );

  const sampleColor = useCallback(
    (sample: PointerSample) => {
      const sampled = editorDocumentRef.current?.sampleColor(sample);
      if (sampled) setColor(sampled);
    },
    [setColor],
  );

  const applyStrokeSamples = useCallback(
    (interaction: StrokeInteraction, samples: PointerSample[]) => {
      if (!samples.length) return;
      interaction.operation.samples.push(...samples);
      editorDocumentRef.current?.renderStroke(
        interaction.operation,
        interaction.renderedSamples,
      );
      interaction.renderedSamples = interaction.operation.samples.length;
      requestRender();
    },
    [requestRender],
  );

  const commitBinding = useCallback((pending: PendingBinding) => {
    setProfile((current) => ({
      ...current,
      bindings: [
        ...current.bindings.filter(
          (binding) =>
            binding.action !== pending.action &&
            !(
              binding.signature.kind === pending.signature.kind &&
              binding.signature.button === pending.signature.button
            ),
        ),
        {
          action: pending.action,
          behavior: pending.behavior,
          signature: pending.signature,
        },
      ],
    }));
    setPendingBinding(null);
    setRecording(null);
  }, []);

  const capturePendingBinding = useCallback(
    (event: ReactPointerEvent) => {
      const target = recordingRef.current;
      if (!target || event.pointerType !== "pen") return false;
      event.preventDefault();
      event.stopPropagation();
      const signature = captureBindingSignature(event.nativeEvent);
      const conflict =
        profileRef.current.bindings.find(
          (binding) =>
            binding.action !== target.action &&
            binding.signature.kind === signature.kind &&
            binding.signature.button === signature.button,
        ) ?? null;
      const pending = { ...target, signature, conflict };
      setPendingBinding(pending);
      if (!conflict) commitBinding(pending);
      return true;
    },
    [commitBinding],
  );

  const beginInteraction = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!ready || capturePendingBinding(event)) return;
      event.preventDefault();
      rootRef.current?.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);

      if (event.pointerType === "touch") {
        if (!penInContactRef.current) {
          touchesRef.current.set(event.pointerId, {
            clientX: event.clientX,
            clientY: event.clientY,
          });
        }
        return;
      }
      if (event.pointerType === "pen") touchesRef.current.clear();

      if (calibrationTargetRef.current) {
        if (event.pointerType !== "pen") {
          event.currentTarget.releasePointerCapture(event.pointerId);
          return;
        }
        penInContactRef.current = true;
        interactionRef.current = {
          kind: "calibration",
          pointerId: event.pointerId,
          priorLayer: null,
          priorTool: null,
          readings: [event.pressure],
        };
        return;
      }

      const action = actionForEvent(event);
      const binding = profileRef.current.bindings.find((candidate) =>
        bindingMatches(candidate, event.nativeEvent),
      );
      let priorLayer: EditorLayer | null = null;
      let priorTool: EditorTool | null = null;

      if (action === "toggle-paint-mask") {
        priorLayer = activeLayerRef.current;
        setActiveLayer(activeLayerRef.current === "paint" ? "mask" : "paint");
        if (binding?.behavior === "toggle") {
          event.currentTarget.releasePointerCapture(event.pointerId);
          return;
        }
      } else if (
        action === "erase" ||
        action === "pan" ||
        action === "eyedropper"
      ) {
        priorTool = toolRef.current;
        setTool(action === "erase" ? "erase" : action);
      }

      const samples = pointerSamples(event.nativeEvent, "down", clientToImage);
      const layer: EditorLayer =
        action === "draw-mask"
          ? "mask"
          : action === "draw-paint"
            ? "paint"
            : activeLayerRef.current;
      let interaction: ActiveInteraction;

      if (action === "draw-paint" || action === "draw-mask" || action === "erase") {
        interaction = {
          kind: "stroke",
          pointerId: event.pointerId,
          priorLayer,
          priorTool,
          renderedSamples: 0,
          operation: createStrokeOperation({
            layer,
            erase: action === "erase",
            color: colorRef.current,
            size: brushSizesRef.current[layer],
            opacity: 1,
            pressure: calibrationRef.current,
          }),
        };
      } else if (action === "pan") {
        interaction = {
          kind: "pan",
          pointerId: event.pointerId,
          priorLayer,
          priorTool,
          clientX: event.clientX,
          clientY: event.clientY,
        };
      } else if (action === "eyedropper") {
        interaction = {
          kind: "eyedropper",
          pointerId: event.pointerId,
          priorLayer,
          priorTool,
        };
      } else {
        interaction = {
          kind: "hold",
          pointerId: event.pointerId,
          priorLayer,
          priorTool,
        };
      }

      interactionRef.current = interaction;
      if (event.pointerType === "pen") penInContactRef.current = true;
      if (interaction.kind === "eyedropper" && samples[0]) {
        sampleColor(samples[0]);
      } else if (interaction.kind === "stroke") {
        applyStrokeSamples(interaction, samples);
      }
    },
    [
      actionForEvent,
      applyStrokeSamples,
      capturePendingBinding,
      clientToImage,
      ready,
      sampleColor,
      setActiveLayer,
      setTool,
    ],
  );

  const moveTouch = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (penInContactRef.current) return;
      const touches = touchesRef.current;
      const previous = touchGeometry([...touches.values()]);
      if (!touches.has(event.pointerId)) return;
      touches.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      const current = touchGeometry([...touches.values()]);
      if (!previous || !current) return;
      event.preventDefault();

      if (touches.size === 1) {
        panBy(
          current.clientX - previous.clientX,
          current.clientY - previous.clientY,
        );
      } else {
        pinch(previous, current);
      }
    },
    [panBy, pinch],
  );

  const moveInteraction = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "touch") {
        moveTouch(event);
        return;
      }

      const samples = pointerSamples(event.nativeEvent, "move", clientToImage);
      setCursor(samples.at(-1) ?? null);
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) {
        requestRender();
        return;
      }
      event.preventDefault();

      if (interaction.kind === "calibration") {
        interaction.readings.push(...samples.map((sample) => sample.pressure));
      } else if (interaction.kind === "pan") {
        panBy(
          event.clientX - interaction.clientX,
          event.clientY - interaction.clientY,
        );
        interaction.clientX = event.clientX;
        interaction.clientY = event.clientY;
      } else if (interaction.kind === "eyedropper") {
        const sample = samples.at(-1);
        if (sample) sampleColor(sample);
      } else if (interaction.kind === "stroke") {
        applyStrokeSamples(interaction, samples);
      }
    },
    [applyStrokeSamples, clientToImage, moveTouch, panBy, requestRender, sampleColor, setCursor],
  );

  const endInteraction = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
      if (event.pointerType === "touch") {
        touchesRef.current.delete(event.pointerId);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        requestRender();
        return;
      }
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      event.preventDefault();

      if (!cancelled && interaction.kind === "calibration") {
        interaction.readings.push(event.pressure);
        const captured = representativePressure(interaction.readings);
        const target = calibrationTargetRef.current;
        if (captured !== null && target === "light") {
          updatePressure({
            inputMinimum: Math.min(
              captured,
              profileRef.current.pressure.inputMaximum - 0.01,
            ),
          });
        } else if (captured !== null && target === "firm") {
          updatePressure({
            inputMaximum: Math.max(
              captured,
              profileRef.current.pressure.inputMinimum + 0.01,
            ),
          });
        }
        setCalibrationTarget(null);
      } else if (!cancelled && interaction.kind === "stroke") {
        applyStrokeSamples(
          interaction,
          pointerSamples(event.nativeEvent, "up", clientToImage),
        );
        editorDocumentRef.current?.commit(interaction.operation);
        notifyContentChange();
      } else if (cancelled && interaction.kind === "stroke") {
        rebuildDocument();
      }

      restoreInteractionState(interaction);
      if (event.pointerType === "pen") penInContactRef.current = false;
      interactionRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      requestRender();
    },
    [
      applyStrokeSamples,
      clientToImage,
      rebuildDocument,
      notifyContentChange,
      requestRender,
      restoreInteractionState,
      setCalibrationTarget,
      updatePressure,
    ],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      const shortcut = editorShortcutFor(event);
      if (!shortcut) return;
      if (event.repeat && shortcut.kind !== "brush-size") return;
      event.preventDefault();

      switch (shortcut.kind) {
        case "tool":
          setTool(shortcut.tool);
          break;
        case "layer":
          setActiveLayer(shortcut.layer);
          setTool("brush");
          break;
        case "brush-size":
          {
            const factor = activeLayerRef.current === "mask" ? 1.6 : 1.25;
            setBrushSize(
              shortcut.direction < 0
                ? brushSizeRef.current / factor
                : brushSizeRef.current * factor,
            );
          }
          break;
        case "wheel-target":
          toggleBrushWheel();
          break;
        case "temporary-pan":
          if (keyboardPanPriorRef.current === null) {
            keyboardPanPriorRef.current = toolRef.current;
            setTool("pan");
          }
          break;
        case "save":
          saveCurrentImage();
          break;
        case "undo":
          undo();
          break;
      }
    },
    [
      saveCurrentImage,
      setActiveLayer,
      setBrushSize,
      setTool,
      toggleBrushWheel,
      undo,
    ],
  );

  const handleKeyUp = useCallback(
    (event: KeyboardEvent) => {
      if (
        (event.code === "Space" || event.key === " ") &&
        keyboardPanPriorRef.current !== null
      ) {
        event.preventDefault();
        const prior = keyboardPanPriorRef.current;
        keyboardPanPriorRef.current = null;
        setTool(prior);
      }
    },
    [setTool],
  );

  useEffect(() => {
    if (!shortcutsActive) {
      const prior = keyboardPanPriorRef.current;
      keyboardPanPriorRef.current = null;
      if (prior !== null) setTool(prior);
      return;
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp, setTool, shortcutsActive]);

  const clearCursor = useCallback(() => {
    if (!interactionRef.current) setCursor(null);
  }, [setCursor]);

  return {
    rootRef,
    displayRef,
    ready,
    sourceError,
    activeLayer,
    setActiveLayer,
    tool,
    setTool,
    color,
    setColor,
    brushSize,
    setBrushSize,
    wheelTarget,
    toggleBrushWheel,
    zoom,
    profile,
    setProfile,
    recording,
    setRecording,
    pendingBinding,
    setPendingBinding,
    calibrationTarget,
    setCalibrationTarget,
    updatePressure,
    commitBinding,
    capturePendingBinding,
    beginInteraction,
    moveInteraction,
    endInteraction,
    clearCursor,
    clearLayer,
    undo,
    saveCurrentImage,
    exportForGeneration: () =>
      ready ? editorDocumentRef.current?.exportForGeneration() ?? null : null,
    focus: () => rootRef.current?.focus(),
  };
}
