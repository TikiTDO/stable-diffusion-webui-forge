# Workflows and interface

This is the product destination. The replacement UI reaches it incrementally:
first it restores the existing generation workflows over Forge's current API,
then adds the persistent story workspace. Before projects land, the same Stage
and result interactions operate as a transient generation session rather than
pretending a project already exists.

## The ordinary creative loop

Once a project is open, the current story position should remain visible while
generating. The person is rarely making an isolated image; they are asking what
shot belongs beside other shots. Project-aware generation therefore starts from
an anchor even when the new image has no img2img source.

The ordinary workspace has five persistent regions:

1. **Composer** — prompt, negative prompt, styles, dimensions, candidate count,
   seed, and composition inputs.
2. **Stage** — live preview, candidate viewer, and resolved prompt.
3. **Candidate tray** — quick comparison and Add, Replace, or Refine actions.
4. **Recent scratch** — recently opened, imported, generated, and edited images
   that can become the active source again with one action.
5. **Project sequence** — the ordered storyboard and current insertion anchor.

A small recent-scratch rail connects img2img and composition work back to the
project without making the person search the whole sequence again. It is a
persistent working set of image references, not another copy of every image and
not the same thing as the unaccepted-candidate shelf.

### Every image can become the source

A generated result, current project frame, prior frame version, recent scratch
image, or newly opened local image exposes the same **Work on this image**
action. That action makes the selected pixels the visible editor source and
offers ordinary img2img, whole-image regeneration, and masked inpaint without a
download/upload round trip or a separate endpoint-shaped room.

The result returns to the unaccepted shelf and recent scratch. From there it can
remain temporary, be added as another frame, replace the originating frame, or
become the source of another edit. Source kind changes provenance and placement
choices, not which editor the person receives.

### One shot, not endpoint tabs

`txt2img`, `img2img`, and inpaint are backend request shapes, not separate
creative rooms. The workbench keeps one active shot and makes the operation an
explicit generation action:

- no source image means generate new variants from the prompt;
- an active source image exposes **Generate variation** and **Generate inpaint**
  side by side rather than a persistent mode picker;
- paint and mask remain available together; Generate variation ignores the
  mask, while Generate inpaint requires and submits it;
- returning to the candidate shelf resumes prompt-only variants without
  destroying the editor document;
- opening any candidate as a source returns to the same paint/mask surface.

The editor owns a session-local variation tray. It begins with the original,
preserves a flattened working input plus its mask before a render, and appends
every returned variation or inpaint. Selecting any old or new member changes
the source without leaving the editor or erasing the other branches. A branch
may be removed from this transient tray when it is not useful; that operation
does not delete the raw generated file. Removing the active branch selects an
adjacent survivor and does not manufacture a new working snapshot of the thing
the person just rejected.

The interface may change which work surface occupies the Stage—candidate
review, pen editing, spatial blocking, or project sequencing—but does not need
txt2img and img2img tabs. Switching surfaces preserves the candidate shelf,
active project anchor, prompt, and any editor document that has not been
explicitly discarded.

The image editor is pen-first rather than mouse-first with pen support added
later. Its active layer—paint or inpaint mask—is always visible. Tablet buttons
can switch or temporarily hold a layer/tool, while every action remains
reachable from the interface and keyboard.

## What deserves primary attention

Persistent interface copy must earn its space. The workbench assumes a person
knows the instrument or can use a tutorial and contextual tooltip. A permanent
label should therefore identify a control or report something the person needs
now: selected state, intended effect, constraint, consequence, or a decision.
It should not narrate the obvious operation. For example, the prompt surface is
labelled **Prompt** once; “Describe the shot,” another “Prompt,” and a “live”
badge do not each convey distinct information.

This is not minimalism for its own sake. Diffusatory is a dense workbench. Space
removed from explanatory prose is available for the image, the sequence, and
the controls used in the current posture. Rare controls retain explicit names
inside a drawer whose closed summary reports the active values.

Always or almost always visible:

- current project and anchor;
- model family and checkpoint;
- positive prompt;
- negative prompt, compact but immediately reachable;
- style selection and editing;
- width and height with useful aspect presets;
- desired candidate count;
- seed strategy;
- Generate, Stop after active, and Cancel;
- live preview and completed candidates;
- Add, Replace, and Refine;
- project sequence.

Secondary render-character controls:

- sampler;
- scheduler;
- steps;
- CFG;
- VAE/text encoder override;
- hires/refinement policy.

These belong in named render profiles such as **Fast draft** and **Final**, with
an editable drawer. The ordinary UI shows the active profile's short summary.
A model profile supplies valid defaults and automatically selects its normal VAE
and text encoders. A manual override remains available without becoming daily
work.

Advanced engine facilities that are neither frequent nor conceptually part of
composition remain in a Lab surface or API. Their existence does not justify a
long main-page accordion.

## Candidate count is not tensor batch size

The person asks for a number of alternatives, not a GPU batching strategy.
Expose **Candidates**. Let the scheduler decide the microbatch size.

This distinction enables:

- candidates appearing as they finish;
- stopping after currently active candidates;
- retrying one failed candidate;
- different resolved prompts per candidate;
- future scheduling based on available memory;
- preserving completed work when the remainder is cancelled.

The first implementation may still map all candidates to one Forge batch where
that is the only proven path. The public model must not freeze that engine
detail into the product again.

### Unaccepted is a UI relation, not file deletion

Every completed image candidate joins the current **unaccepted shelf** until it
is added to or used to replace a project frame. New generations append; they do
not replace the shelf, and txt2img and img2img candidates may sit beside each
other. The person can move back and forth through it while refining any member.

Dismiss removes one candidate from that working shelf. **Clear unaccepted**
removes every shelf relation when starting a different part of the story. In
the compatibility client these are browser-state operations only. They never
claim to delete Forge's raw output files. Raw-output deletion remains a
separate, explicit storage operation and is manual until a deliberately scoped
asset-retention design exists.

## Add, Replace, and Refine

A candidate already belongs to the current project workspace and its asset
store. It is **not in the storyboard sequence** until Add or Replace completes.
Those actions create frame relations; they do not copy or reclassify image
bytes.

### Add

- The project enters placement mode.
- Hovering a frame reveals before/after insertion zones and moves neighbouring
  cards enough to show the destination.
- Clicking creates a new stable frame containing the candidate asset.
- The current candidate remains available until the transaction is confirmed.

### Replace

- Hovering a frame shows replacement language, not an insertion gap.
- A card-turn animation may preview the change because the stable frame remains
  while its image changes.
- The previous image becomes a frame version; replacement never destroys it.

### Refine

- The candidate or project image becomes the img2img source.
- The originating frame becomes a recent anchor even if the result has not yet
  been promoted back into the project.
- Returning to an anchor scrolls it into view and gives it a faint search-result
  glow rather than changing selection invisibly.

The mode and its hover behavior must agree. A filed action should never require
remembering whether the interface was secretly in Add or Replace mode.

## Project sequence

The sequence is an ordered set of stable frames, not filenames sorted by write
time.

That does not make the corresponding directory disposable. It is a
human-facing interoperability surface: after a successful reorder, its visible
filenames or paths must sort in the same order as the interface. Stable frame
identity and version history survive those moves through project metadata. The
database may explain the operation; it may not leave the file browser showing a
different story.

Required interactions:

- ordinary drag to move one frame;
- multi-select arbitrary frames;
- Move Selected, then choose one before/after destination;
- atomic group movement preserving the selected frames' relative order;
- add or replace from a generated candidate;
- open a frame in the viewer;
- send its current version to img2img;
- restore an earlier version;
- undo a project operation.

A project can contain chapters or named sections later. The first useful slice
needs one ordered sequence and stable frame identifiers.

## Composition inputs

ControlNet is a stack of conditions, not a single giant accordion. Each card
states its intent and source at a glance:

- pose, depth, normal, line art, edges, IP-Adapter, or another capability;
- current source image or an independent asset;
- optional mask;
- preprocessor and model;
- strength and active sampling range;
- preview of the processed condition.

The common path should be “Add condition → choose intent → choose source.” Model
and preprocessor details can default from intent and remain editable.

Regional composition begins smaller than a freeform mask editor:

- disabled means one implicit region covering the full canvas and no regional
  machinery in the request;
- enabling it creates one transformable orthogonal grid;
- horizontal and vertical splits create cells with draggable ratios;
- the grid can translate, scale, and rotate as a whole;
- cell boundaries may be softened;
- the complement outside the transformed foreground grid becomes an optional
  background region.

Each cell has a prompt fragment. A **common prompt** contributes to every cell;
it is not the same thing as the **background prompt**, which applies only to the
complement. An SVG overlay with handles is sufficient for this grid. It compiles
cells and the complement into ordinary masks, so later freeform regions can use
the same generation contract without being a prerequisite for the first useful
regional editor. The visual editor, resolved-prompt view, and saved recipe
operate on the same objects.

## Dynamic prompts and prompt help

The prompt editor remains plain-text-first. A searchable Prompt Grammar drawer
explains and inserts supported constructs, including:

- random choices;
- exhaustive choices across candidates;
- weighted choices;
- wildcards;
- emphasis;
- scheduling where supported;
- regional composition syntax and its visual equivalent.

The useful output is not merely expanded text. Every candidate shows the exact
resolved positive and negative prompt it received. “Use every prompt” is a
first-class exhaustive expansion policy and is especially useful for generating
a short visual progression in one request.

Selected text can also become a named or temporary prompt fragment. Enabled
fragments compose into the prompt in visible order; disabled fragments remain
near the editor as one-click alternatives. This supports “keep the rain and
lighting, try three different character actions” without making the person
rewrite, comment out, or remember pieces of the prompt. Fragment toggles and
plain text compile through the same server preflight path and every candidate
still shows the exact resolved prompt it received.
