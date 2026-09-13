# Migration and acceptance

## Method

Build vertical slices against the engine that already works. “Fresh UI” and
“fresh backend” are independent decisions. Keep Gradio intact for comparison
while React reproduces one real workflow at a time; add backend machinery only
after the current API fails a named interaction.

The first cutover target is the operator's existing practical image workflow,
not the entire Diffusatory destination. Projects and story sequencing become the
next product layer after ordinary generation is no longer hostage to Gradio.

## Slice 0 — current API map and walking skeleton

Create the React/Vite shell and a typed Forge compatibility adapter.

Acceptance:

- a prompt submitted from React reaches the existing `/sdapi/v1/txt2img` path
  and displays its returned image;
- the client supplies and retains a task ID;
- one read-only instance endpoint reports an operator-configured name, stable
  instance ID, build version, and supported capabilities;
- one development proxy is sufficient; no new generation backend participates;
- Gradio still runs unchanged and can produce a comparison image;
- fake API fixtures exist for frontend tests, but there is no fake project or
  fake engine standing in for the walking skeleton.

## Slice 1 — core SDXL txt2img parity

Build the fast ordinary surface over current routes:

- checkpoint, LoRAs, embeddings, VAE/text encoders;
- positive and negative prompt, styles, and toggleable prompt fragments;
- sampler, scheduler, steps, CFG, width, height, desired outputs mapped to the
  current batch-size contract, and seed;
- Generate, Interrupt, Skip, result gallery, zoom, and fullscreen;
- task-aware polling of `/internal/progress` with live preview.

Acceptance:

- the operator can reproduce the normal SDXL generation loop without opening
  Gradio;
- the full-screen and click-to-view paths remain bounded and usable;
- prompt typing produces no network request or unrelated gallery rerender;
- changing preview frequency is reflected on the next real render;
- during an actual 1024 render, prompt input remains responsive while progress,
  preview, interrupt, and skip remain reachable;
- idle and under-render timings are retained as comparison evidence;
- returned parameters and infotext remain available for replay and diagnosis.

The React application remains a preview route after this slice.

## Slice 2 — ControlNet and Dynamic Prompts parity

Use current ControlNet discovery and preprocessing endpoints and one typed
translation into the existing generation script payload. Do the same for the
vendored Dynamic Prompts capability before replacing either backend contract.

Acceptance:

- ControlNet model, module, and intent lists come from the active instance;
- IP-Adapter, depth, line art, OpenPose, and one ordinary ControlNet route
  generate through React;
- a condition may use the current source or an independent image;
- preprocessor output is inspectable before generation;
- dynamic alternatives can be random or exhaustive across requested outputs;
- every result shows the resolved prompt it actually received;
- one adapter owns extension names and positional argument mapping;
- a current endpoint deficiency is recorded before any replacement endpoint is
  introduced.

## Slice 3 — img2img and inpaint parity

Build one editor with source, paint, and selection-mask layers.

Acceptance:

- a txt2img result moves to img2img without a download/upload round trip;
- the API request contains the source that the interface visibly shows;
- an empty canvas is a valid drawable source;
- brush range is useful across ordinary image sizes and has a colour picker;
- pen pressure follows a calibrated curve and preserves light strokes rather
  than behaving as a binary mouse click;
- tablet bindings can switch or momentarily hold paint, inpaint-mask, pan,
  eyedropper, and eraser actions without relying on vendor-specific button
  numbers;
- pen contact keeps pointer capture for the whole stroke, coalesced samples are
  consumed when available, and lifting outside the canvas cannot leave a stroke
  stuck active;
- touch can pan/zoom while idle but is ignored for drawing while a pen stroke is
  active, preventing ordinary palm contact from painting;
- paint and mask clear independently;
- inpaint whole-image and only-masked behavior both match their visible mode;
- denoise, resize policy, source dimensions, and relevant ControlNet conditions
  survive the transition;
- stale or missing browser state cannot silently produce “no image” after a
  visible transfer;
- the complete path is exercised on the operator's actual Wacom or Huion
  tablet; synthetic pointer tests and mouse use do not close this acceptance.

## Slice 4 — transformable region grid

Integrate Regional Prompting through a deliberately small first editor rather
than waiting for arbitrary painted regions.

Acceptance:

- disabled composition is exactly one whole-canvas prompt with no regional
  request machinery;
- horizontal and vertical splits produce draggable cell ratios;
- the foreground grid translates, rotates, and scales as one object;
- moving boundaries resizes adjacent cells and optional softness is visible;
- the area outside the transformed grid becomes an explicit background region;
- common prompt and background prompt remain separate concepts;
- the SVG editor compiles cells and complement into the masks consumed by the
  existing regional engine;
- the resolved prompt and region plan are inspectable for every output.

If positional script arguments cannot carry this contract reliably, this slice
may add the smallest typed backend endpoint that can. It does not authorize a
new scheduler, project store, or unrelated API redesign.

## Slice 5 — hands-on UI cutover

The operator uses the replacement UI for the ordinary workflow and decides
whether it becomes the default. Cutover is a product reading, not a coverage
percentage.

Required evidence:

- the normal txt2img, ControlNet, dynamic prompt, img2img, inpaint, and regional
  paths work on real images;
- model/settings discovery reflects the active backend instance;
- failures explain which request or capability failed without exposing a raw
  positional-script puzzle to the person;
- the interface remains responsive through real generation;
- Gradio remains reachable at `/legacy` for comparison and missing uncommon
  operations.

## Slice 6 — Flux and render profiles

Prove the same creative loop with Flux and group secondary rendering controls
into named profiles.

Acceptance:

- switching family/checkpoint cannot leave an incompatible invisible component;
- normal Flux generation does not require manual VAE/text-encoder repair;
- model-specific controls appear only where meaningful;
- Fast Draft and at least one refinement profile round-trip through infotext or
  the first narrow provenance record;
- client routing does not assume that only one Forge instance can exist.

## Slice 7 — projects and the story workbench

Introduce the native Project, Candidate, Asset, Frame, FrameVersion, Recipe,
Realization, and operation model, using SQLite plus ordinary image files. Import
from `image_processor` only after its custody and exact source state are known.

Acceptance:

- create/open a directory-backed project;
- generated candidates belong to that workspace without automatically becoming
  storyboard frames;
- add a candidate before/after an anchor;
- replace a frame and restore its prior version;
- move one frame and an arbitrary selected group atomically;
- a failed operation leaves the prior order intact;
- reopening restores order, versions, and provenance;
- source import does not mutate `image_processor` data;
- the current story remains visible while generating and recent anchors return
  the person to the relevant frame.

## Slice 8 — native contracts and legacy deletion

Replace compatibility seams only where accumulated use justifies it:

- native typed condition and prompt-composition contracts;
- native job/candidate scheduling and one ordered event stream;
- URL-addressed preview and result assets instead of base64 payloads;
- native project-aware img2img and provenance;
- deletion of extension registration paths whose capabilities are now native.

Gradio deletion gates:

- every supported workflow has a new-path proof;
- project and output migration/export are documented and exercised;
- launch, API, and engine tests no longer require Gradio imports for the new
  product;
- no active route or subprocess calls removed UI/extension code;
- `/legacy` has been unused through one normal work interval;
- the operator accepts deletion.

## Validation layers

Use the cheapest layer that can falsify the current claim:

1. pure frontend/domain tests for transitions, request mapping, and invariants;
2. compatibility API tests with recorded deterministic responses;
3. browser tests for exact creative journeys;
4. focused adapter/backend tests only where a backend seam changes;
5. a small number of real GPU runs for inference, preview, interruption,
   conditioning, and provenance;
6. visual review by someone actually composing images and stories.

Numbers diagnose a mechanism. They do not substitute for reading whether the
workspace helps the person think.
