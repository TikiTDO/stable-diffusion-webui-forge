# Img2img and pen-editor implementation record

Status: implemented locally; synthetic/browser and live Forge checked; physical
tablet acceptance still open.

## What exists

The replacement client now has one image editor for ordinary img2img, painted
source changes, and inpaint selection masks. A txt2img candidate enters it by
reference inside the browser; there is no save/download/upload ceremony. A new
blank document starts with an ordinary white source so marks made on an empty
canvas are the actual img2img source rather than an invisible overlay with no
image behind it.

The source, paint, and mask are separate image-sized canvases. The display
canvas is only a view. Generation composites source plus paint into the exact
`init_images` value and exports the mask as white selection on black. Paint and
mask stay available together. **Generate variation** deliberately omits the
mask; **Generate inpaint** requires and submits it, so request shape is chosen
at the consequential action rather than through a mode picker.

Each editor opening creates a local branch tray containing the original. Before
a dirty document renders, its flattened paint and serialised mask are retained
as a working variation. Every image returned by each later img2img or inpaint
run is appended rather than replacing prior results. The person can move among
the original, working inputs, and every old or new result without leaving the
editor; a preserved mask is restored with its working input. Returning to the
full result stage does not destroy the current editor document.

## Pen input boundary

The hot input path is independent of React rendering:

- browser Pointer Events are normalized to image coordinates;
- a captured pointer owns a stroke until up or cancellation;
- coalesced samples are consumed when the browser supplies them;
- the in-progress stroke is drawn directly to its layer;
- React receives the completed operation, tool/layer state, and ordinary UI
  changes rather than every pen sample;
- one committed contact stroke is one undo operation;
- focus loss, visibility change, cancellation, and lost capture cannot leave a
  stroke latched on.

Pressure has a named-profile calibration. The person captures one deliberately
light and one firm stroke; the median nonzero reading avoids treating a single
noisy peak as the device range. The profile also owns the response curve and a
light-stroke output floor. Mouse input gets full brush pressure rather than
pretending the browser's constant mouse pressure is a calibrated pen reading.

Barrel buttons and eraser ends are recorded from their actual browser event
signature. No Wacom or Huion button number is compiled into a product action.
Bindings support a persistent paint/mask toggle and temporary erase, pan, or
eyedropper holds. A conflict is shown and requires an explicit replacement.
ExpressKeys may use the same focused-canvas keyboard path for paint, mask,
erase, eyedropper, pan, brush size, and undo without stealing prompt-editing
keys elsewhere on the page.

Touch does not paint. With no pen in contact, one contact pans and two contacts
pan/zoom around their midpoint. Once pen contact begins, touch input is ignored
until the pen stroke ends.

Each stroke snapshots the pressure calibration that shaped it. Adjusting a
tablet curve changes subsequent marks but cannot silently redraw old marks at
a different thickness the next time undo rebuilds the layers.

## Implementation seams

The first functional editor grew into a 1,167-line React component. That was a
working proof, not an acceptable product boundary. It is now split by the
things that change for different reasons:

- `document.ts` owns full-resolution source/paint/mask pixels, replay history,
  sampling, display compositing, and deterministic generation export;
- `renderer.ts` owns pressure-shaped stroke rasterization;
- `useCanvasViewport.ts` owns device-pixel rendering, image-space transforms,
  zoom, pan, pinch anchoring, cursor placement, resize, and animation frames;
- `useEditorSurface.ts` owns the explicit pointer interaction states and their
  cancellation/commit lifecycle;
- `tabletProfile.ts` owns validated, failure-tolerant browser persistence;
- `PenControls.tsx` and `ImageEditor.tsx` are presentation surfaces rather than
  stores for image pixels or transient pen samples.

This separation is specifically for physical-tablet tuning. A Wacom/Huion
finding should change a binding, pressure, or input-state seam without making
generation export or the visible toolbar collateral damage.

## Brush and view choices

The brush-size control is logarithmic in source-image pixels: its endpoints are
1 and 256 pixels, while its midpoint is 16 pixels. This directly repairs the
inherited control where half the slider already covered most of the image. The
cursor preview is transformed with the document, so its footprint describes
the source-image area that will change rather than a fixed screen-sized circle.

Canvas2D is sufficient for this first implementation. PixiJS, Fabric, or a
retained scene graph would not remove the need to implement pressure, stroke
sampling, masking, compositing, deterministic export, and undo. This choice is
revisable if a real large-image/tablet trace identifies a renderer limit.

## Current browser evidence

A mocked Forge browser journey at 1600 by 1000 established:

- txt2img result to editor transfer;
- blank canvas drawing;
- separate paint and inpaint-mask strokes;
- an img2img request containing one PNG source, one PNG mask, the visible 1024
  by 1024 dimensions, denoise 0.6, and only-masked mode;
- edited-candidate return and reuse affordance;
- capture and persistence of an observed pen button 2 signature, followed by a
  paint-to-mask toggle using that binding;
- a captured light-pressure series of 0.12, 0.14, and 0.16 producing a 0.14
  median calibration point;
- a synthetic two-contact gesture changing the visible zoom from 100 to 200
  percent;
- 500 synchronously dispatched synthetic pen moves processed in 63 ms in that
  run, useful as a regression scent rather than a hardware latency benchmark.

The browser test initially left the display canvas at its default buffer size
under React development StrictMode. An effect cleanup cancelled a scheduled
animation frame but retained its non-null identifier, preventing the remounted
effect from scheduling another. Clearing the identifier in cleanup fixed the
actual lifecycle defect. This is why the probe tested the mounted application,
not only pure pointer functions.

The visual browser artifact is `diffusatory-pen-editor-v2.png` in the
Playwright run. It shows the complete composer and blank-source pen editor in
one workspace.

After the component split, a second mocked-browser pass re-established an 802
by 570 device buffer, pressure-shaped paint, a separate mask, an img2img body
with 1024 by 1024 source and mask PNGs, and a persisted pen-button-2
paint/mask toggle. Its full-page artifact is
`/agents/vesper/scratch/diffusatory-tablet-editor-refactor.png`. Synthetic dispatch needed a stubbed
pointer-capture call because a script-created event is not an active browser
pointer; that accommodation belongs only to the probe and is not evidence
about physical pointer capture.

A later live-Forge pass used the installed four-step Flux AIO to submit a real
masked inpaint. The session tray retained **Original**, **Working edit 1**, and
**Inpaint 1**; each could become current without clearing the others. Returning
to the working edit restored its serialized mask well enough for a second
inpaint request to start (that second run was deliberately cancelled). The
representative engine output is
`outputs/img2img-images/2026-09-14/00000-438867557.png`; the inspected browser
artifact is `/agents/vesper/scratch/diffusatory-edit-variation-session.png`.

## What this does not prove

- Synthetic `PointerEvent` input does not establish Wacom or Huion driver
  behavior, hover alignment, pressure feel, eraser reporting, ExpressKey
  delivery, touch arbitration, or pen latency.
- The current editor keeps source dimensions fixed. A resize-policy UI and a
  real non-square source pass remain open.
- The live pass establishes one only-masked Flux path. Whole-image inpaint and
  an ordinary img2img comparison still need deliberate image-semantic checks.
- Canvas rotation is not implemented. Tilt/altitude, azimuth, and twist now
  shape and orient the brush footprint, but the mapping has not been felt or
  tuned on the physical tablet and tangential pressure remains recorded only.
- ControlNet conditions have not yet been attached to this editor surface.

The physical-tablet and real-GPU checks in `08-pen-and-tablet-input.md` remain
the acceptance gate. A green unit suite or attractive screenshot cannot close
them.
