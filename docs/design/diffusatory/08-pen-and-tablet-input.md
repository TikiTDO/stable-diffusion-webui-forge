# Pen and tablet input

## Product rule

The drawing surface is designed around a real pen tablet. Mouse and touch are
fallbacks, not the reference input. “Pointer events fired in a browser test” is
not evidence that the operator can comfortably paint, mask, sample a colour,
and navigate on the actual Wacom or Huion device.

The browser-facing implementation uses standard Pointer Events. It does not
depend on a vendor SDK or assume that two tablet drivers expose barrel buttons,
erasers, pressure, tilt, or touch in the same numeric shape.

## Normalized input sample

One input module converts browser events into image-space samples:

```text
PointerSample
  transient_pointer_id
  kind: pen | touch | mouse
  phase: hover | down | move | up | cancel
  image_x / image_y
  pressure
  tilt_x / tilt_y
  twist?
  tangential_pressure?
  buttons
  timestamp
```

Coordinates are transformed through the current zoom, pan, rotation, canvas
pixel ratio, and source-image dimensions before tools consume them. Strokes
store normalized image-space samples and brush settings, not viewport pixels.

The active pointer is captured from contact through up/cancel. When supported,
coalesced events provide the high-frequency path actually rendered. Predicted
events may improve a transient preview but never enter the committed stroke
unless confirmed by real input.

## Actions and bindings

Browser button numbers are observations, not product commands. A binding
recorder asks the person to press a pen button or use the eraser and stores the
observed signature against an action:

- draw on paint layer;
- draw on inpaint-mask layer;
- erase active layer;
- hold pan/zoom navigation;
- hold eyedropper;
- toggle paint/mask layer;
- change brush size or opacity.

Bindings support both **hold** and **toggle** semantics. The default UI suggests
useful mappings but never silently interprets a right-click-shaped barrel event
as a context menu inside the canvas after that event has been bound. The same
actions remain available as visible buttons and keyboard shortcuts.

The ordinary tablet workflow gets one compact **Pen controls** popover beside
the layer/tool indicator, not a settings expedition. It shows the active named
profile and every current binding, and its recorder says which action it is
waiting for before the person presses the pen control. Paint versus mask is the
primary one-button binding; pan, eyedropper, erase, brush size, and opacity can
be added without displacing it. The recorder can cancel without changing the
old mapping, and conflicting mappings are surfaced rather than silently won by
registration order.

Mappings are browser/profile preferences. The design does not pretend that a
transient `pointerId` is a durable hardware identity. A second physical tablet
can use another saved profile selected by name.

Application-wide Wacom or Huion driver shortcuts remain useful for actions
such as undo, redo, zoom, and brush-size keys. Diffusatory does not intercept
them unless focus is on the canvas and the corresponding action is enabled;
ordinary text editing shortcuts keep working in prompts. Express keys which
arrive as keyboard events therefore share the visible keyboard binding path,
while barrel buttons and eraser ends use the captured Pointer Event path.

## Pressure and brush behavior

Calibration captures a light stroke and a firm stroke, then exposes a simple
pressure curve and minimum/maximum output. Pressure may control size, opacity,
or both independently. Mouse contact does not masquerade as meaningful pressure
merely because a browser reports a constant nonzero value.

The brush preview shows the actual image-space footprint at current zoom.
Minimum and maximum sizes are defined in source-image pixels and have useful
coarse and fine controls; a midpoint must not cover half the canvas.

Tilt, twist, and tangential pressure are retained when available but do not gate
the first brush. A later brush engine can consume them without changing the
input contract.

## Paint, mask, and eraser truth

Paint and inpaint mask are separate serializable layers. The current layer and
tool remain visible near the pointer and in the toolbar. A tablet button changes
that explicit state; it does not route strokes into an invisible mode.

The pen's eraser end or an eraser binding erases the active layer. It never
silently switches which layer is active. Undo groups one contact stroke into one
operation even when that stroke contains hundreds of coalesced samples.

## Pen, touch, and palm arbitration

The canvas alone uses restricted touch behavior; the rest of the page retains
normal scrolling. While a pen is in contact, touch contacts are ignored for
drawing. When no pen stroke is active, configured one- or two-finger gestures
may pan and zoom.

Pointer cancellation, focus loss, device removal, and leaving the canvas all
terminate or safely cancel the stroke. None can leave painting latched on.

## Performance boundary

Raw pointer movement updates a canvas/render loop and a bounded stroke buffer;
it does not set React application state for every sample. React owns tool,
layer, binding, and committed-operation state. The renderer owns the transient
cursor and in-progress stroke.

Large-source drawing is checked at device pixel ratio with zoom and pan active.
The test is whether the line stays under the pen and the interface remains
responsive, not merely whether every event was eventually recorded.

## Hardware acceptance pass

On the operator's actual tablet, record:

1. which browser event signatures each pen end and button produces;
2. usable light-to-firm pressure range and curve;
3. hover availability and cursor alignment;
4. tilt/twist availability without making them required;
5. paint/mask switching in both hold and toggle modes;
6. pan, zoom, eyedropper, eraser, undo, and colour selection;
7. palm/touch behavior during and between pen strokes;
8. a stroke that begins inside, leaves the canvas, and returns or ends outside;
9. high-resolution drawing with no stuck state or visible pen lag.

Keep the hardware/browser/driver versions with the finding. A synthetic pointer
suite protects the normalized state machine; it cannot replace this pass.
