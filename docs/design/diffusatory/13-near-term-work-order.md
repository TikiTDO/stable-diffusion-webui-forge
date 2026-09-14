# Near-term work order

Date: 2026-09-13
State: plan for operator review before the next implementation slice

## The near-term product

The immediate Diffusatory target is deliberately smaller than the reconstructed
3D scene and animation system it may eventually grow into:

> Open or generate a shot, work on it with SDXL or Flux, LoRAs, prompt sets,
> regional composition, ControlNet, drawing, img2img, and inpaint, keep the
> useful results in an ordered project, and export an ordinary image.

The 3D and video direction changes which future extensions must remain possible.
It does not belong on tonight's critical path. No scene graph, mesh dispatch,
rigging, animation timeline, or LTX integration should be introduced merely to
prepare for it.

## Current evidence boundary

The current working tree atop `eff50a3f` has a dense React workbench, current
Forge catalog discovery, prompt-only and image-source request shapes, task-aware
progress, a transient candidate shelf, a pen editor, ControlNet condition cards,
prompt realization sets, a transformable regional stage, and a native regional
conditioning adapter. It also admits local image drops with compatible Forge
metadata recovery, provides architecture-aware and per-model recipes, allows a
browser-local saved default per checkpoint, and keeps an edit-session branch
tray across repeated variation and inpaint runs.

The Flux scheduler compatibility repair has a focused regression test and Flux
has produced real images through Forge. That does not yet prove the complete
Flux journey through Diffusatory. Likewise, pure tests and browser interaction
prove the regional request path and editor mechanics, but not that current GPU
generation visibly obeys each requested composition or editing mode.

The current prompt ingredient drawer inserts LoRA syntax and embeddings. It is
not yet a first-class, inspectable LoRA recipe with strength, enabled state, and
model compatibility. The current session still has no durable project, project
sequence, persistent recent scratch, or explicit flattened-image export journey.

## Core acceptance boundary

The first usable cut should let the operator complete all of these without
opening Gradio:

1. Select the installed SDXL or Flux AIO checkpoint without inheriting an
   incompatible hidden module selection.
2. Generate one or several candidates while prompt editing, preview, skip, and
   cancellation remain responsive.
3. Apply an installed LoRA at an explicit strength and recover what was applied
   from the result.
4. Produce dynamic prompt alternatives whose resolved prompt is visible per
   candidate.
5. Produce a deliberately falsifiable regional composition.
6. Load an existing image at its native dimensions, paint or mask it, and run
   ordinary img2img, whole-image inpaint, and only-masked inpaint.
7. Exercise representative pose, depth or line-art, and IP-Adapter conditions
   through their actual backend routes.
8. Save a selected result as an ordinary image.
9. Add or replace that result in an ordered project and recover the prior frame
   version after reopening the project.

This is a product reading, not a coverage score. A checked box without a useful
image and an inspectable request does not close an item.

## Work order

### 1. Run the exact-head creative loop

Before adding another large subsystem, launch an isolated current-head Forge
instance on an explicitly available GPU and port. Preserve the owner and start
command. Exercise the shortest falsifiable matrix:

| Journey | Deliberate visible result |
| --- | --- |
| SDXL prompt-only | one ordinary 1024 candidate |
| Flux AIO prompt-only | one ordinary candidate with additional modules automatic |
| SDXL plus LoRA | a visibly influential installed LoRA at a recorded strength |
| dynamic prompt set | several candidates with different displayed realizations |
| regional SDXL | a red subject confined left and a blue subject confined right |
| regional Flux | the same relation, or an explicit typed incompatibility |
| imported image edit | visible source, simultaneous paint/mask tools, explicit variation/inpaint actions, and a session tray retaining original plus every returned branch |
| ControlNet | one inspected preprocessor result and one conditioned generation |

During those runs, inspect typing latency, preview cadence, candidate arrival,
viewer behavior, skip, cancel, errors, and the transition from a result back to
the editor. Retain the representative outputs and screenshots. Fix the first
workflow-blocking defect rather than explaining around it.

### 2. Establish projects, recent scratch, and one universal image source

These are one state model, not three later conveniences. Build the first project
slice before adding more transient image controls:

1. create or open a project rooted in an ordinary image directory;
2. scan its current images into stable project/frame identities without
   mutating them merely because they were opened;
3. expose one **Work on this image** action for a generated result, project
   image, prior version, recent image, or newly opened local file;
4. retain a persistent recent-scratch rail of references and let one click make
   any member the current editor source;
5. return every img2img or inpaint result to both recent scratch and the
   unaccepted shelf;
6. Add or Replace from that shelf, with replacement retaining the prior frame
   version;
7. drag one frame or move an arbitrary selected group before or after another
   frame;
8. make the corresponding project directory reflect the same order through
   collision-safe physical renames or moves;
9. reopen and recover the sequence, versions, current source, and recent
   scratch;
10. save a selected candidate or flattened editor composite as an ordinary
    image without requiring the project database to read it.

`image_processor` already demonstrates the intended visible reorder behavior:
its reorder endpoint changes timestamps, physically renames the image, and
moves related metadata. Treat that working tree as source evidence rather than
blind copy material; it currently contains unrelated uncommitted work.

The project database owns stable IDs, versions, recipes, and recovery. It does
not get to leave the directory in a different order from the screen.

### 3. Make model ingredients inspectable

Replace one-click LoRA text insertion with a projection that can be understood
and changed without hand-editing prompt syntax:

- selected LoRA identity;
- enabled state;
- explicit strength;
- reorder/remove controls;
- the exact compiled prompt or request contribution;
- recovery from recognized prompt tags and result infotext;
- a visible incompatibility rather than silent omission when a model cannot use
  the selected ingredient.

Plain prompt syntax remains valid. The structured rack and source text must
round-trip rather than becoming two competing truths. Embeddings and styles can
use the same searchable ingredient surface without pretending they have LoRA's
strength semantics.

The first per-checkpoint profile layer now exists. Keep extending it only from
observed model requirements. The installed Flux AIO uses four-step render
defaults and an integrated-component invariant rather than a fabricated VAE
and text-encoder assembly problem; unlisted Flux and SDXL checkpoints fall back
to architecture-level recipes, and a person may save a browser-local override.

The currently exercised component-based Flux fine-tune is a separate real case:
its CLIP-L, T5, and VAE selection should be retained as one checkpoint profile
rather than reconstructed manually each time.

### 4. Earn regional and ControlNet claims on real images

Prove native regional conditioning on SDXL first. The result, resolved polygons,
prompts, softness, model identity, and seed must remain inspectable together.
Then test Flux against its actual conditioning representation. If the SDXL
adapter does not apply, add a model-specific compiler behind the same spatial
plan; do not weaken the visible contract or silently flatten regions into one
prompt.

Exercise installed ControlNet families through real generation rather than
stopping at catalog and preprocessor success. Prioritize the operator's common
paths: OpenPose, depth, line art, and IP-Adapter. A condition should be able to
use either the current shot or an independent image and should retain the exact
source and normalized settings in candidate provenance.

### 5. Finish the pen and image-editing loop

The existing source/paint/mask editor is useful scaffolding. Close its present
contract before replacing it with semantic object layers:

- preserve native source dimensions;
- prove blank-canvas drawing as an img2img source;
- prove ordinary variation, whole-image inpaint, and only-masked inpaint;
- make paint and mask state unmistakable;
- let edited candidates become the next source without a download/upload trip;
- test pressure, tilt, palm behavior, bindings, and stroke capture on the actual
  Wacom or Huion device;
- retain the source, mask, recipe, and selected result as one reversible edit
  relation once projects exist.

Semantic lift, clean-plate reconstruction, movable subjects, and image-to-3D
promotion follow this loop. They should replace or extend the fixed three-canvas
document deliberately, not arrive as another hidden overlay inside it.

### 6. Cut over and remove Gradio

**Product cutover completed 2026-09-14.** `/` now enters Diffusatory and the
Gradio UI-exclusive launch branch was deleted rather than preserved at a legacy
route. The remaining work in this section is engine decoupling: remove inherited
Gradio dependencies only after each still-used API or processing behavior has a
native owner.

Use Diffusatory for a real image-making session. Repair what interrupts the
operator's attention before adding uncommon engine controls. Once every
operator-used Gradio workflow—SDXL, Flux, LoRAs, dynamic and regional prompts,
ControlNet, img2img, and inpaint—has a deliberate new-path result, Gradio has
served its purpose.

In that same bounded workstream:

- make Diffusatory the product entry point;
- remove the replaced Gradio UI and its UI-exclusive launch branches and
  dependencies;
- preserve the Forge inference and API machinery the new application still
  uses;
- search active callers, tests, scripts, and extension registration before
  deleting each surface;
- update the root documentation to describe the application that actually
  remains.

Do not keep a `/legacy` route or require a quiet deprecation interval. Git is the
archive. Projects add something Gradio never supplied and therefore do not gate
its removal.

## Tonight's bounded return

Tonight should end with evidence rather than another speculative subsystem:

1. preserve this work order after operator review;
2. start or identify one isolated current-head runtime without taking over an
   operator-owned process;
3. establish the first project/recent-scratch/universal-source vertical slice;
4. prove SDXL, Flux AIO, one LoRA, and one falsifiable regional composition
   through the replacement application;
5. repair the first blocker uncovered by those journeys;
6. run focused frontend/backend checks, capture screenshots and representative
   outputs, then commit and publish one coherent checkpoint.

Project storage and the real-image proof are now one working loop: the accepted
images must have somewhere visible and durable to go, while storage work cannot
substitute for actually generating and editing them.

## Explicitly later

These directions remain valuable but are outside the near-term delivery path:

- automatic semantic object lifting and clean-plate generation;
- image-to-mesh or image-to-avatar dispatch to Airia;
- persistent 3D scene reconstruction;
- rig retargeting and animation;
- camera and lighting timelines;
- LTX-2.3 video refinement and performance-aware audio.

The near-term model should avoid making those impossible. It should not charge
their complexity to tonight's still-image workbench.
