import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { ClientToImage, PointerSample } from "../../input/pointer";
import type { EditorLayer, EditorTool } from "./model";
import type { EditorDocument, EditorViewport } from "./document";

interface ViewportDependencies {
  editorDocumentRef: RefObject<EditorDocument | null>;
  activeLayerRef: RefObject<EditorLayer>;
  toolRef: RefObject<EditorTool>;
  brushSizeRef: RefObject<number>;
}

interface GesturePoint {
  clientX: number;
  clientY: number;
  distance: number;
}

export function useCanvasViewport({
  editorDocumentRef,
  activeLayerRef,
  toolRef,
  brushSizeRef,
}: ViewportDependencies) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<EditorViewport>({
    scale: 1,
    x: 0,
    y: 0,
    zoom: 1,
  });
  const cursorRef = useRef<PointerSample | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const [zoom, setZoom] = useState(1);

  const render = useCallback(() => {
    renderFrameRef.current = null;
    const canvas = displayRef.current;
    const editorDocument = editorDocumentRef.current;
    if (!canvas || !editorDocument) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const bufferWidth = Math.max(1, Math.round(bounds.width * pixelRatio));
    const bufferHeight = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const frame = editorDocument.drawDisplay(
      context,
      viewportRef.current,
      bounds.width,
      bounds.height,
    );

    const cursor = cursorRef.current;
    if (cursor && toolRef.current !== "pan" && toolRef.current !== "eyedropper") {
      context.save();
      context.strokeStyle =
        activeLayerRef.current === "mask" ? "#efb7ff" : "#ffffff";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(
        frame.x + cursor.imageX * frame.scale,
        frame.y + cursor.imageY * frame.scale,
        Math.max(1, (brushSizeRef.current * frame.scale) / 2),
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.restore();
    }
  }, [activeLayerRef, brushSizeRef, editorDocumentRef, toolRef]);

  const requestRender = useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = window.requestAnimationFrame(render);
  }, [render]);

  useEffect(() => {
    const canvas = displayRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(requestRender);
    observer.observe(canvas);
    requestRender();
    return () => observer.disconnect();
  }, [requestRender]);

  useEffect(
    () => () => {
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
    },
    [],
  );

  const clientToImage = useCallback<ClientToImage>(
    (clientX, clientY) => {
      const canvas = displayRef.current;
      const editorDocument = editorDocumentRef.current;
      if (!canvas || !editorDocument) return { x: 0, y: 0 };
      const bounds = canvas.getBoundingClientRect();
      const scale = viewportRef.current.scale;
      const drawWidth = editorDocument.width * scale;
      const drawHeight = editorDocument.height * scale;
      const x = (bounds.width - drawWidth) / 2 + viewportRef.current.x;
      const y = (bounds.height - drawHeight) / 2 + viewportRef.current.y;
      return {
        x: (clientX - bounds.left - x) / scale,
        y: (clientY - bounds.top - y) / scale,
      };
    },
    [editorDocumentRef],
  );

  const resetViewport = useCallback(() => {
    viewportRef.current = { scale: 1, x: 0, y: 0, zoom: 1 };
    cursorRef.current = null;
    setZoom(1);
    requestRender();
  }, [requestRender]);

  const panBy = useCallback(
    (x: number, y: number) => {
      viewportRef.current.x += x;
      viewportRef.current.y += y;
      requestRender();
    },
    [requestRender],
  );

  const zoomAt = useCallback(
    (nextZoom: number, clientX?: number, clientY?: number) => {
      const bounded = Math.min(8, Math.max(0.5, nextZoom));
      const canvas = displayRef.current;
      const editorDocument = editorDocumentRef.current;
      if (
        canvas &&
        editorDocument &&
        clientX !== undefined &&
        clientY !== undefined
      ) {
        const before = clientToImage(clientX, clientY);
        const bounds = canvas.getBoundingClientRect();
        viewportRef.current.zoom = bounded;
        const fit = Math.min(
          bounds.width / editorDocument.width,
          bounds.height / editorDocument.height,
        );
        const scale = fit * bounded;
        const centeredX = (bounds.width - editorDocument.width * scale) / 2;
        const centeredY = (bounds.height - editorDocument.height * scale) / 2;
        viewportRef.current.x =
          clientX - bounds.left - centeredX - before.x * scale;
        viewportRef.current.y =
          clientY - bounds.top - centeredY - before.y * scale;
      } else {
        viewportRef.current.zoom = bounded;
      }
      setZoom(bounded);
      requestRender();
    },
    [clientToImage, editorDocumentRef, requestRender],
  );

  const pinch = useCallback(
    (previous: GesturePoint, current: GesturePoint) => {
      if (previous.distance <= 0 || current.distance <= 0) return;
      const canvas = displayRef.current;
      const editorDocument = editorDocumentRef.current;
      if (!canvas || !editorDocument) return;
      const anchor = clientToImage(previous.clientX, previous.clientY);
      const bounds = canvas.getBoundingClientRect();
      const nextZoom = Math.min(
        8,
        Math.max(
          0.5,
          viewportRef.current.zoom * (current.distance / previous.distance),
        ),
      );
      const fit = Math.min(
        bounds.width / editorDocument.width,
        bounds.height / editorDocument.height,
      );
      const scale = fit * nextZoom;
      const centeredX = (bounds.width - editorDocument.width * scale) / 2;
      const centeredY = (bounds.height - editorDocument.height * scale) / 2;
      viewportRef.current.zoom = nextZoom;
      viewportRef.current.x =
        current.clientX - bounds.left - centeredX - anchor.x * scale;
      viewportRef.current.y =
        current.clientY - bounds.top - centeredY - anchor.y * scale;
      setZoom(nextZoom);
      requestRender();
    },
    [clientToImage, editorDocumentRef, requestRender],
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(
        viewportRef.current.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12),
        event.clientX,
        event.clientY,
      );
    },
    [zoomAt],
  );

  const setCursor = useCallback(
    (sample: PointerSample | null) => {
      cursorRef.current = sample;
      requestRender();
    },
    [requestRender],
  );

  return {
    displayRef,
    zoom,
    requestRender,
    resetViewport,
    clientToImage,
    panBy,
    pinch,
    handleWheel,
    setCursor,
  };
}
