# Structured generation plan

Status: operator-shaped successor design; implementation follows the current
image-editor and LoRA-density checkpoint

Date: 2026-09-14

## The thing being represented

The person is not authoring one magic string and asking an extension to split
it after the fact. They are deciding which distinct shots to attempt, which
parts of each shot need different language, and how many candidates to spend
on those attempts.

Diffusatory therefore owns one structured **generation plan**:

- one or more variations;
- one spatial prompt layout per variation;
- one prompt box per prompt group in that layout;
- one shared negative prompt initially;
- a candidate allocation policy and reproducible allocation seed;
- the model recipe, LoRAs, embeddings, conditions, source image, and edit
  settings applied around those prompts.

`As written`, `Variations`, `Every branch`, and regional prompting are not four
product modes. They are earlier projections of this one object. A variation
with a single whole-frame prompt is the simplest generation plan.

The UI does not require `{a|b|c}`, regional separators, or another prompt
mini-language to express the structure. Authored prompt text remains text;
variation and placement are ordinary inspectable data.

## Variation and prompt identity

Each variation owns stable IDs for itself, its layout, and its prompt groups.
A layout with no visible divisions has one cell covering the frame and one
prompt box. Splitting it creates more cells and prompt groups. The prompt dock
projects exactly those boxes rather than keeping one privileged positive
textarea plus hidden regional fragments.

For example, two requested variations can expose:

1. variation one: **sky** and **ground** prompt boxes;
2. variation two: **sea** and **beach** prompt boxes;
3. one shared negative prompt.

That is five visible prompt boxes and no invisible common prompt. Shared words
can be copied deliberately, represented later as a reusable prompt fragment,
or contributed by the global LoRA stack. They are not silently invented by the
compiler.

Per-variation layouts are the data model, not a stretch feature. A **Use this
layout for all variations** action can be a convenient copy/link operation,
but it must not make one shared grid the permanent schema. The operator may be
blocking entirely different shots in the same candidate run.

## Spatial editing is part of the image surface

Regions are edited over the current image, or over the same empty frame shown
before an image exists. There is no detached regional form. **Clear canvas**
returns to that initial empty frame and clears active source/editor state; it
does not create another special generation mode.

A variation begins as a rectangular partition grid. Horizontal and vertical
division handles move in frame space and are constrained between neighbouring
divisions with a five-pixel minimum cell extent at the current output size.
The entire partition can be translated, scaled, and rotated for tilted camera
blocking. Geometry is stored normalized to the frame and resolved in pixels for
interaction and inference.

Every cell references a prompt-group ID:

- cells begin with distinct groups;
- assigning several cells to one group makes them share one prompt box even
  when the cells are not contiguous;
- joining selected groups preserves all non-empty prompt text in deterministic
  row-major order and assigns the resulting group to every selected cell;
- splitting a group leaves the complete prior prompt with the first cell/group
  and creates an empty prompt for the second, so a structural action never
  guesses how prose should be divided;
- deleting a division removes the resulting empty topology only after its
  prompt groups have been reconciled; it cannot silently discard authored
  text.

The current transformable grid and native masked-conditioning adapter remain
useful implementation evidence. Their present one-layout/one-common-prompt
shape is not the final product contract.

## Candidate allocation

Candidate count is the amount of render budget, not the number of prompt
boxes. The first allocator should be simple and reproducible:

- when candidates are at least the number of variations, schedule one candidate
  from every variation in display order, then choose each remaining variation
  with seeded random sampling;
- when candidates are fewer, schedule the currently selected variation first
  and choose the rest without replacement from the other variations;
- record the chosen variation ID and allocation seed on every candidate;
- rerunning with the same plan, render seed policy, and allocation seed produces
  the same variation sequence.

This gives every authored variation a first look when the render budget allows
it while retaining the operator's requested randomness for additional
candidates. Weighted or manually fixed allocations can be added later without
changing prompt or layout identity.

Forge may not accept several unrelated spatial plans in one traditional batch.
That is an executor detail, not a reason to flatten the plan. One Diffusatory
job can compile its candidate schedule into several grouped or single-candidate
Forge subrequests, preserve their visible order, and expose one aggregate
progress/cancel relation.

## Compilation order

For each scheduled candidate, the compiler:

1. selects the recorded variation;
2. resolves that variation's prompt-group text;
3. places an explicitly selected embedding into its target prompt box;
4. adds enabled LoRA terms only where they are not already present;
5. compiles the variation layout into image-space conditioning masks;
6. applies the shared negative prompt, model recipe, source/edit settings, and
   ControlNet conditions;
7. emits one inspectable backend request and records the resolved plan with the
   result.

An embedding click opens a small destination picker listing every current
variation/region prompt plus the negative prompt. It inserts at the selected
box's caret. The picker may remember the last destination for speed, but must
remain changeable. `lazyneg` therefore goes to the negative box because the
person chose it, not because the embedding name triggered a heuristic.

LoRA terms need an application target in this model even while the first UI
supports only **whole generation**. Later, an inpaint/refiner pass can target a
prompt group, character, or region without replacing the generation plan.

## State and recovery

The browser store may carry the first implementation, but plan identity must be
serializable from the start. Candidate provenance retains at least:

- generation-plan schema version and plan ID;
- chosen variation and allocation seed;
- prompt-group IDs and resolved authored text;
- normalized layout geometry and resolved output dimensions;
- shared negative prompt;
- model recipe, LoRA stack, embedding destinations, conditions, source/edit
  relation, render seed, and engine infotext.

PNG metadata may contain a compact copy or reference. Project storage will
eventually own durable plans and revisions, but projects are deliberately
sequenced after the current interaction, prompt, and LoRA work. The plan must
not depend on a project database merely to generate or reopen a standalone
image.

## Implementation sequence

1. Replace the prompt-mode buttons with a plan store containing stable
   variation and prompt-group IDs.
2. Project one prompt box per group plus the shared negative box; add the
   explicit embedding destination picker.
3. Add variation count and the seeded candidate allocator while layouts remain
   whole-frame.
4. Move the existing regional grid under each variation and implement
   cell-to-prompt-group assignment, join, split, and five-pixel constraints.
5. Compile the candidate schedule through one observable job even when it needs
   several Forge requests.
6. Record the resolved plan on every result and reconstruct it from compatible
   metadata.
7. Add shared-layout convenience, weighted allocation, and targeted LoRA
   refinement only after the ordinary loop is comfortable.

## Acceptance examples

- Two whole-frame variations and six candidates visibly produce at least one
  of each, four seeded extra choices, and six results labelled with the
  variation that authored them.
- A sky/ground variation and a rotated sea/beach variation expose exactly four
  positive boxes plus the shared negative, then send each candidate only its
  selected layout.
- Joining two populated groups preserves both pieces of text; splitting the
  result preserves the first copy and creates one empty prompt.
- An embedding inserted into the negative prompt cannot appear in a positive
  region unless the person also selects that target.
- Reloading an image with compatible metadata reconstructs the same boxes,
  group assignments, layout, selected ingredients, and allocation record.
- Cancelling one multi-request job stops unscheduled candidates and labels any
  already completed results truthfully rather than presenting a partial batch
  as complete.
