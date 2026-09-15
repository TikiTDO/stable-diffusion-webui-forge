import { forwardRef, useImperativeHandle } from "react";

import type { EditorExport } from "./document";
import { PenControls } from "./PenControls";
import {
  brushControlFromSize,
  brushSizeFromControl,
  type EditorTool,
} from "./model";
import { useEditorSurface } from "./useEditorSurface";

export type { EditorExport } from "./document";

export interface ImageEditorHandle {
  exportForGeneration: () => EditorExport | null;
  focus: () => void;
}

interface ImageEditorProps {
  source: string | null;
  maskSource?: string | null;
  width: number;
  height: number;
  shortcutsActive?: boolean;
  onReady?: (width: number, height: number) => void;
  onContentChange?: () => void;
  onMaskChange?: (hasMask: boolean) => void;
}

const EDITOR_TOOLS: Array<{
  value: EditorTool;
  label: string;
  shortcut: string;
}> = [
  { value: "brush", label: "Brush", shortcut: "A" },
  { value: "erase", label: "Erase", shortcut: "S" },
  { value: "eyedropper", label: "Dropper", shortcut: "D" },
  { value: "pan", label: "Pan", shortcut: "F" },
];

export const ImageEditor = forwardRef<ImageEditorHandle, ImageEditorProps>(
  function ImageEditor(
    {
      source,
      maskSource = null,
      width,
      height,
      shortcutsActive = true,
      onReady,
      onContentChange,
      onMaskChange,
    },
    forwardedRef,
  ) {
    const editor = useEditorSurface({
      source,
      maskSource,
      width,
      height,
      shortcutsActive,
      onReady,
      onContentChange,
      onMaskChange,
    });

    useImperativeHandle(
      forwardedRef,
      () => ({
        exportForGeneration: editor.exportForGeneration,
        focus: editor.focus,
      }),
      [editor.exportForGeneration, editor.focus],
    );

    return (
      <section
        className="image-editor"
        aria-label="Image editor"
        ref={editor.rootRef}
        tabIndex={0}
        onPointerDownCapture={(event) => {
          editor.focus();
          editor.capturePendingBinding(event);
        }}
      >
        <header className="editor-toolbar">
          <div className="layer-switch" aria-label="Drawing layer">
            <button
              type="button"
              className={editor.activeLayer === "mask" ? "is-selected" : ""}
              aria-keyshortcuts="W"
              onClick={() => editor.setActiveLayer("mask")}
            >
              Inpaint mask <kbd>W</kbd>
            </button>
            <button
              type="button"
              className={editor.activeLayer === "paint" ? "is-selected" : ""}
              aria-keyshortcuts="Q"
              onClick={() => editor.setActiveLayer("paint")}
            >
              Paint <kbd>Q</kbd>
            </button>
          </div>
          <div className="tool-switch" aria-label="Editor tool">
            {EDITOR_TOOLS.map(
              ({ value, label, shortcut }) => (
                <button
                  type="button"
                  key={value}
                  className={editor.tool === value ? "is-selected" : ""}
                  aria-keyshortcuts={shortcut}
                  title={`${label} · ${shortcut}`}
                  onClick={() => {
                    editor.setTool(value);
                    editor.focus();
                  }}
                >
                  {label} <kbd>{shortcut}</kbd>
                </button>
              ),
            )}
          </div>
          <button
            type="button"
            className={`editor-wheel-mode ${
              editor.wheelTarget === "brush-size" ? "is-selected" : ""
            }`}
            aria-keyshortcuts="Shift+B"
            aria-pressed={editor.wheelTarget === "brush-size"}
            title="Choose whether the wheel changes brush size or canvas zoom"
            onClick={() => {
              editor.toggleBrushWheel();
              editor.focus();
            }}
          >
            Wheel: {editor.wheelTarget === "brush-size" ? "brush" : "zoom"}{" "}
            <kbd>Shift+B</kbd>
          </button>
          <button
            type="button"
            className="editor-save"
            disabled={!editor.ready}
            aria-keyshortcuts="Control+S Meta+S"
            title="Save the visible image with local paint applied"
            onClick={() => {
              editor.saveCurrentImage();
              editor.focus();
            }}
          >
            Save image <kbd>Ctrl+S</kbd>
          </button>
        </header>

        <div className={`editor-controls editor-controls--${editor.activeLayer}`}>
          {editor.activeLayer === "paint" && (
            <label className="color-control">
              <span>Colour</span>
              <input
                type="color"
                value={editor.color}
                onChange={(event) => editor.setColor(event.target.value)}
              />
            </label>
          )}
          <label>
            <span>Brush {editor.brushSize}px <kbd>C</kbd>/<kbd>V</kbd></span>
            <input
              type="range"
              min="0"
              max="100"
              step="0.5"
              value={brushControlFromSize(editor.brushSize)}
              onChange={(event) =>
                editor.setBrushSize(
                  brushSizeFromControl(event.target.valueAsNumber),
                )
              }
            />
          </label>
          {editor.activeLayer === "mask" && (
            <div className="mask-size-presets" aria-label="Mask brush size">
              {([
                ["S", 32],
                ["M", 96],
                ["L", 192],
                ["XL", 256],
              ] as const).map(([label, size]) => (
                <button
                  type="button"
                  key={label}
                  className={editor.brushSize === size ? "is-selected" : ""}
                  title={`${label} mask brush · ${size}px`}
                  onClick={() => editor.setBrushSize(size)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="editor-button-row">
            <button type="button" aria-keyshortcuts="Z" onClick={editor.undo}>
              Undo <kbd>Z</kbd>
            </button>
            <button type="button" onClick={() => editor.clearLayer("paint")}>
              Clear paint
            </button>
            <button type="button" onClick={() => editor.clearLayer("mask")}>
              Clear mask
            </button>
          </div>
          <PenControls
            profile={editor.profile}
            setProfile={editor.setProfile}
            recording={editor.recording}
            setRecording={editor.setRecording}
            pendingBinding={editor.pendingBinding}
            setPendingBinding={editor.setPendingBinding}
            commitBinding={editor.commitBinding}
            calibrationTarget={editor.calibrationTarget}
            setCalibrationTarget={editor.setCalibrationTarget}
            updatePressure={editor.updatePressure}
          />
        </div>

        <div className="editor-canvas-wrap">
          <canvas
            ref={editor.displayRef}
            className="editor-canvas"
            aria-label={`${editor.activeLayer} layer, ${editor.tool} tool`}
            onPointerDown={editor.beginInteraction}
            onPointerMove={editor.moveInteraction}
            onPointerUp={(event) => editor.endInteraction(event, false)}
            onPointerCancel={(event) => editor.endInteraction(event, true)}
            onLostPointerCapture={(event) =>
              editor.endInteraction(event, true)
            }
            onPointerLeave={editor.clearCursor}
            onContextMenu={(event) => event.preventDefault()}
          />
          <div className="editor-canvas-status">
            <strong>
              {editor.activeLayer === "mask" ? "INPAINT MASK" : "PAINT"}
            </strong>
            <span>{Math.round(editor.zoom * 100)}%</span>
            {editor.wheelTarget === "brush-size" && (
              <span>WHEEL · BRUSH {editor.brushSize}px</span>
            )}
            {!editor.ready && !editor.sourceError && (
              <span>Loading source…</span>
            )}
            {editor.sourceError && (
              <span className="editor-source-error" role="alert">
                {editor.sourceError}
              </span>
            )}
          </div>
        </div>
      </section>
    );
  },
);
