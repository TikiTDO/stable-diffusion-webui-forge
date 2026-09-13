# Migration and acceptance

## Method

Build vertical slices. Each slice must be pleasant enough to use, exercise its
real engine boundary, and leave the prior usable path available until the new
one covers it. The legacy surface is scaffolding, not a second product to polish.

## Slice 0 — boundaries and deterministic fake

Create the new package and application shell with:

- versioned API routing;
- generated TypeScript API client;
- fake generation adapter;
- typed recipe/job/event models;
- one fake project in an isolated temporary directory;
- Compose, Stage, Candidate tray, and Project sequence layout.

Acceptance:

- prompt typing has no unrelated network request or project-grid rerender;
- a fake four-candidate job exercises preview and terminal states;
- Add and Replace visibly enter different placement modes;
- group movement preserves relative order through the API fake;
- refresh reconstructs the current server projection and local draft.

## Slice 1 — real SDXL txt2img

Connect the adapter to the already-proved SDXL path.

Acceptance:

- select checkpoint/profile and generate one or more 1024 candidates;
- live preview appears from the event stream before completion on a long-enough
  render;
- candidates arrive independently in the public model, even if the first engine
  adapter realizes them in one microbatch;
- Cancel and Finish active produce truthful terminal state;
- each candidate retains seed, model hashes, recipe, and realization;
- the new path does not import or inspect Gradio components.

At this point the new application becomes the default local route. Gradio moves
to `/legacy`.

## Slice 2 — projects and promotion

Implement SQLite project storage, asset storage, stable frames, versions,
operations, and `image_processor` import.

Acceptance:

- create/open a directory-backed project;
- promote a candidate before/after an anchor;
- replace a frame and restore its prior version;
- move one frame and an arbitrary selected group;
- a failed operation leaves the prior order intact;
- reopening the project restores the same order, versions, and generation
  provenance;
- importing an `image_processor` project does not mutate its source.

## Slice 3 — img2img and inpaint

Build one editor with source, paint, and selection-mask layers as already defined
in the native prompt-composition design.

Acceptance:

- send candidate or project frame to img2img without upload/download relay;
- draw on an empty canvas or existing source;
- pick a colour from the image;
- clear paint and mask independently;
- use paint alpha as mask without flattening either layer;
- generate img2img and inpaint results with complete parent/provenance relation;
- recent anchors navigate back to their project frames.

## Slice 4 — native conditions

Introduce condition cards and exercise SDXL IP-Adapter, depth, line art, OpenPose,
and another ordinary ControlNet path.

Acceptance:

- current source or independent asset can be selected per condition;
- condition mask is independent of the img2img mask;
- preprocessor output can be inspected before generation;
- unsupported model/condition combinations fail at preflight;
- saved recipe and realization reconstruct the exact condition plan.

## Slice 5 — native dynamic and regional prompts

Implement the typed compiler described in `native-prompt-composition.md`.

Acceptance includes its first-native-slice criteria plus:

- exhaustive alternatives map intentionally across requested candidates;
- each candidate displays its resolved prompt;
- grammar help inserts valid constructs;
- visible regions edit the same stored objects used by conditioning;
- ordinary prompts without composition remain unchanged.

## Slice 6 — Flux and render profiles

Prove the same creative loop with Flux and make model profiles choose valid VAE,
text encoders, default profile, and supported conditions.

Acceptance:

- switching family/checkpoint cannot leave an incompatible invisible component;
- normal Flux generation does not require manual VAE repair;
- model-specific controls appear only where meaningful;
- Fast Draft and at least one refinement profile round-trip through provenance.

## Slice 7 — legacy deletion

Delete rather than indefinitely hide:

- Gradio product UI and its whole-document lifecycle callbacks;
- legacy settings transport;
- extension UI/registration paths for capabilities now native;
- unused universal-A1111 surfaces and SD1/SD2-only branches whose shared SDXL or
  Flux consumers have been excluded by trace and tests.

Deletion gates:

- every workflow in the supported product boundary has a new-path proof;
- project and output migration/export are documented and exercised;
- launch, API, and engine tests no longer require Gradio imports;
- no active runtime route or subprocess calls the removed extension/UI code;
- the legacy route has been unused through one normal work interval and the
  operator accepts cutover.

## Validation layers

Use the cheapest layer that can falsify the current claim:

1. pure domain tests for transitions, ordering, parsing, and invariants;
2. API tests with a deterministic fake engine;
3. adapter tests against focused Forge seams;
4. browser tests for the exact creative journeys;
5. a small number of real GPU runs for inference, previews, interruption,
   conditioning, and provenance;
6. visual review by someone actually composing a story.

Numbers diagnose a mechanism. They do not substitute for reading whether the
workspace helps the person think.
