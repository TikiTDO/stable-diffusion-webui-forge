# Unified shot and regional-stage implementation

Status: native spatial request and sampler adapter implemented; real GPU
conditioning acceptance and durable projects remain open

Date: 2026-09-13

## Why this slice changed shape while being built

The first regional prototype placed a large SVG editor inside the Composer
column while the Stage remained empty. It technically exposed all planned
controls, but reproduced the inherited application's underlying mistake:
organizing the screen around feature forms rather than the thing being made.

The operator's correction was broader. This is a dense workbench used in
several immediate postures—drawing with a tablet, assembling scenes, changing
an existing image, or producing more alternatives. Empty display area is not a
visual luxury when useful controls, candidates, and story context could occupy
it. `txt2img` and `img2img` also do not deserve product-level tabs merely because
Forge exposes different routes.

The resulting rule is:

> One active shot determines the generation request; the large Stage holds the
> visual operation being performed on that shot.

## Current source semantics

The compatibility UI now presents a compact source statement instead of
txt2img/img2img tabs. **Generation source and the surface currently visible on
the Stage are separate state.** Looking at candidates does not discard a
mounted editor document or silently decide whether the next request has a
source:

- **Generating new variants** has no active source and dispatches txt2img.
- Choosing a candidate or starting a blank drawing opens the existing layered
  editor and makes its visible composite the img2img source.
- A non-empty editor selection becomes the inpaint mask; an empty mask remains
  ordinary img2img.
- **New variants** explicitly selects prompt-only generation while leaving the
  editor component mounted.
- **Return to results** changes only the visible surface. The active image can
  remain the next generation source while the person compares prior results;
  the source indicator remains visible in the top rack.
- **Active image / Show source** returns to the mounted editor and makes the
  source relation explicit rather than deriving it from which surface happens
  to be visible.
- The Generate control remains one action. The source and mask—not the label on
  a tab—select its request shape.

This is not yet the final active-shot store. Editor state is component-local
and one browser reload still discards the transient session.

## Transient unaccepted shelf

Completed real images append to one browser-owned candidate shelf across
successive generation runs. A candidate carries its task ID, result index,
source kind, image, resolved prompt, negative prompt, seed, and infotext.
Contact sheets and auxiliary outputs are excluded rather than presented as
ordinary shots.

The shelf has two intentionally non-destructive operations and direct
previous/next navigation over the large image:

- dismiss one candidate from the visible shelf;
- clear the entire visible shelf before working on another story beat.

Neither operation calls Forge or removes an output file. The UI says this next
to the action. Raw output remains managed exactly as it was before and requires
an explicit manual filesystem cleanup. Once project storage lands, accepted
means a candidate participates in an Add or Replace frame operation; dismissed
and unaccepted remain relations, not byte-destruction states.

The browser reducer is deliberately transient. It proves interaction semantics
without pretending that a project database already exists.

## Dense workbench layout

The first implementation put every control in a long Composer column and used
the other column almost entirely for an image. That was cleaner than Gradio but
still inherited a form/application split. The current screen instead has four
simultaneously reachable instrument zones:

1. a top rack for generation source, checkpoint/module, frame, candidates,
   seed, sampler, scheduler, steps, CFG, preview cadence, and render controls;
2. a left prompt dock for positive/negative language, prompt realizations, the
   syntax legend, styles, LoRAs, and embeddings;
3. the large central Stage for the current candidate, pen editor, or spatial
   map;
4. a right image-tools dock for regional composition, image edit parameters,
   and ControlNet conditions.

At a 1920 by 1200 viewport, the idle workbench occupies one viewport without a
page scroll. Panels end with their content rather than stretching an empty card
to match the Stage. The central blank area is not decorative dead space: it is
the actual image viewport and becomes occupied by the generated frame. When
candidates exist, their shelf sits immediately below that image—before run
provenance—so review is not hidden behind engine detail.

The arrangement is responsive, but the desktop design does not optimize for
minimal chrome. It optimizes for the operator being able to change posture—from
prompting, to scene assembly, to drawing, to conditioning—without navigating a
feature hierarchy first.

## Transformable regional stage

Enabling spatial composition swaps the Stage's image viewer for a full-size SVG
blocking surface while leaving the Composer populated with the corresponding
language:

- the main prompt is visibly identified as common to every cell;
- each row-major cell has an independently editable prompt;
- an optional background prompt names the complement outside the foreground
  grid;
- Add Row and Add Column split the widest track and preserve the existing
  cell's prompt;
- broad boundary hit targets resize neighbouring tracks with a minimum size;
- the centre handle translates the entire grid;
- the diamond handle rotates and uniformly scales it;
- edge softness has a visible pixel-space representation;
- the inspectable plan reports canvas, cell count, transform, and softness.

Geometry is stored in normalized recipe coordinates and resolved into real
output pixels using the active frame aspect ratio. Rotation occurs in frame
pixel space, avoiding the common bug where a nominal circle or angle distorts
between portrait and landscape formats. The same Pointer Events path handles
pen, mouse, and touch input, and capture begins on the exact manipulation
handle rather than on the whole page.

## Native spatial-conditioning path

The visible plan is now part of the actual generation request rather than a
frontend-only diagram. When regional composition is enabled, the client sends
one versioned `diffusatory_spatial_plan` beside the ordinary txt2img or img2img
fields. The normal source/mask rule still selects the route; spatial
conditioning is orthogonal to that decision.

The implementation deliberately does **not** transplant Regional Prompter's
global cross-attention monkeypatches or its positional Gradio argument surface.
Forge already has a lower and more stable leverage point: its sampler accepts
multiple text conditionings carrying image-space masks and blends their model
predictions by per-pixel accumulated weight. The native adapter therefore:

1. validates a bounded typed plan at the API boundary (version, frame,
   transform, at most sixteen four-point cells, finite coordinates, softness,
   and explicit complement prompt);
2. combines each realized common prompt with each cell fragment, and combines
   that same common prompt with the optional background fragment;
3. compiles those prompt schedules once per generation batch using Forge's own
   text-conditioning engine;
4. rasterizes rotated cell polygons at the actual latent dimensions, applies
   the requested edge blur, and derives the complement as
   `1 - clamp(sum(cell masks), 0, 1)`;
5. replaces the whole-frame positive text conditioning with those masked
   conditions while retaining the global negative prompt, img2img concat
   conditioning, and ControlNet link;
6. normalizes the global sum of condition strengths so adding spatial regions
   cannot accidentally multiply CFG, while preserving all local overlap and
   composable-prompt ratios.

Generate is enabled only when the current instance advertises
`spatial-conditioning`. The request fails closed on a malformed plan and on
Hires.fix, which has not been integrated with the second-pass dimensions yet.
LoRA and other extra-network tags remain a common-prompt operation because
they change global model weights; a cell-local tag is rejected instead of
pretending those weights can be spatially scoped.

This closes the former frontend-lie gate in code. It does **not** establish
that the conditioning produces the intended composition on SDXL or Flux: that
requires a real GPU run and visual comparison, which remains explicitly open.

## Evidence obtained

Focused frontend checks on the implementation head established:

- track splitting, boundary clamping, cell prompt preservation, pixel-space
  transform round trips, row-major plan order, complement state, and softness
  conversion through unit tests;
- the existing frontend test corpus plus these tests passes;
- TypeScript and the production Vite build pass;
- a live browser render shows the Composer and spatial Stage together rather
  than leaving the Stage empty;
- browser mouse dispatch moved the transform centre by the requested 70 by -35
  CSS pixels and the visible handle followed exactly;
- adding one row and one column produced four matching SVG cells and four
  prompt inputs;
- a mocked two-run journey appended four candidates to one shelf, after which
  dismiss and clear changed browser state without a deletion request.
- the dense desktop workbench rendered at 1920 by 1200 without page scroll in
  its idle state; the captured result is
  `/agents/vesper/scratch/diffusatory-dense-workbench.png`;
- a three-candidate mocked run selected the newest image, previous navigation
  moved from 3/3 to 2/3, dismissing the selected candidate chose its adjacent
  survivor at 2/2, and Clear removed the shelf without issuing any network
  mutation.
- a typed client test preserved the complete spatial plan on the Forge
  txt2img request;
- a mocked browser journey enabled regions, authored a cell prompt, submitted
  while Generate was live, observed the exact versioned plan on the txt2img
  request, returned automatically to the resulting candidate, exposed its
  `1 region spatial plan · 25.6px edge` provenance, and retained a Show map
  route back to the editor;
- focused Python tests established plan rejection, common/cell/background
  prompt composition, softened polygon and complement masks, latent-size mask
  scaling, full-frame coverage, replacement of global positive text
  conditioning, preservation of img2img/ControlNet additions, and CFG-strength
  normalization;
- the current frontend suite reports 13 files and 60 tests passing, and the
  spatial/mount Python suite reports 9 tests passing.

The browser's ordinary screenshot command continued to hang on its stability
wait. A direct Playwright full-page capture succeeded for the regional surface
at `/agents/vesper/scratch/diffusatory-unified-regions.png`; the screenshot is
evidence of layout, not tablet or inference behavior.

## Still open

- Run an actual SDXL generation with a strongly falsifiable left/right plan,
  then repeat with rotation, softness, img2img, and ControlNet. Static tests do
  not close visual conditioning behavior.
- Prove or repair Flux compatibility against its actual text-conditioning
  dictionaries rather than inferring it from the shared compiler.
- Add Hires.fix second-pass conditioning dimensions before allowing that
  combination.
- Resolve dynamic prompt alternatives across common, cell, and background
  fragments through one server compiler and record each output's spatial plan.
- Replace transient candidate state with the project/asset/candidate database
  without changing dismiss-versus-delete semantics.
- Add project Add and Replace interactions and the ordered story strip around
  this unified shot model.
- Exercise pressure, tilt/angle, eraser reporting, barrel buttons, ExpressKeys,
  palm rejection, and hover alignment on the operator's physical Wacom or Huion
  device. Synthetic Pointer Events are not that acceptance test.
- Let the same mounted editor document, candidate shelf, and future project
  sequence share one stable Stage without relying on visibility as generation
  source state. Source and visible-surface state are already decoupled; the
  remaining work is interaction and persistence rather than another endpoint
  tab removal.
