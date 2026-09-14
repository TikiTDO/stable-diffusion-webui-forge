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
  onReady?: (width: number, height: number) => void;
  onContentChange?: () => void;
}

const EDITOR_TOOLS: Array<{
  value: EditorTool;
  label: string;
  shortcut: string;
}> = [
  { value: "brush", label: "Brush", shortcut: "B" },
  { value: "eyedropper", label: "Dropper", shortcut: "I" },
  { value: "pan", label: "Pan", shortcut: "H" },
  { value: "erase", label: "Erase", shortcut: "E" },
];

export const ImageEditor = forwardRef<ImageEditorHandle, ImageEditorProps>(
  function ImageEditor(
    { source, maskSource = null, width, height, onReady, onContentChange },
    forwardedRef,
  ) {
    const editor = useEditorSurface({
      source,
      maskSource,
      width,
      height,
      onReady,
      onContentChange,
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
        onKeyDown={editor.handleKeyDown}
        onKeyUp={editor.handleKeyUp}
        onPointerDownCapture={editor.capturePendingBinding}
      >
        <header className="editor-toolbar">
          <div className="layer-switch" aria-label="Drawing layer">
            <button
              type="button"
              className={editor.activeLayer === "paint" ? "is-selected" : ""}
              onClick={() => editor.setActiveLayer("paint")}
            >
              Paint <kbd>P</kbd>
            </button>
            <button
              type="button"
              className={editor.activeLayer === "mask" ? "is-selected" : ""}
              onClick={() => editor.setActiveLayer("mask")}
            >
              Inpaint mask <kbd>M</kbd>
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

        <div className="editor-controls">
          <label className="color-control">
            <span>Colour</span>
            <input
              type="color"
              value={editor.color}
              onChange={(event) => editor.setColor(event.target.value)}
            />
          </label>
          <label>
            <span>Brush {editor.brushSize}px</span>
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
          <label>
            <span>Opacity {Math.round(editor.opacity * 100)}%</span>
            <input
              type="range"
              min="5"
              max="100"
              value={editor.opacity * 100}
              onChange={(event) =>
                editor.setOpacity(event.target.valueAsNumber / 100)
              }
            />
          </label>
          <div className="editor-button-row">
            <button type="button" onClick={editor.undo}>
              Undo
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
            onWheel={editor.handleWheel}
          />
          <div className="editor-canvas-status">
            <strong>
              {editor.activeLayer === "mask" ? "INPAINT MASK" : "PAINT"}
            </strong>
            <span>{Math.round(editor.zoom * 100)}%</span>
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
