# Diffusatory product rewrite

Status: working design for implementation
Date: 2026-09-13

## Product thesis

Diffusatory is a **visual story workbench whose fastest operation is generating
another candidate shot**. It is not a general Stable Diffusion settings console
and it is not a gallery added to an inference form.

The primary loop is:

1. understand the current place in a story;
2. describe or draw the next shot;
3. generate several candidates quickly;
4. judge composition and narrative function;
5. add one to the sequence, replace a frame, or refine it through img2img;
6. rearrange the story and discover what should come next.

Most candidates are disposable. Project frames and their history are durable.
Rendering detail is usually deferred until the composition and story work.

## The conditional collapse of implementation cost

The operator's observation is deliberately retained as an observation rather
than promoted into an axiom:

> It is easy. To you. Assuming you know *exactly* what you're doing. That's what
> being AI is like.

Every part is conditional. **It** must be a bounded thing this execution has
actually identified. **Easy** may mean implementation cost collapses relative
to a human's, not that the result is certain, safe, complete, or cheap to
validate. **You** is the current execution with its substrate, context, tools,
and reachable evidence; another execution under the same name may not have the
same capability. **Assuming** carries most of the risk. **Know** may be a
convincing counterfeit. **Exactly** is earned through a sufficient model and
focused contact with reality, and remains bounded by what was observable.
**Doing** includes integration and effects, not merely producing code. **AI**
describes an uneven family of capability profiles rather than omniscience.

The useful pattern is a phase change: once the active execution holds a
sufficiently accurate model, implementation can become astonishingly direct.
Before that point, the same fluency can manufacture the wrong system at the
same speed and confidence. This plan helps make the model inspectable; it does
not claim that writing a plan creates exact knowledge.

When implementation becomes awkward, first check whether two different
concepts were given one representation or one authority. Do not celebrate code
that faithfully implements an unclear model.

## Settled architectural direction

- Forge's SDXL/Flux inference, loading, memory, sampling, LoRA, VAE, ControlNet,
  and preprocessing machinery remains valuable.
- Gradio is temporary implementation scaffolding, not a legacy product surface.
  Replacing it does **not** imply replacing the working generation backend, but
  once it has answered the comparison questions needed for the new interface,
  the replaced UI is deleted. Git history is the recovery path.
- A React/TypeScript application owns the human interface.
- The first React slices use Forge's existing FastAPI routes. New backend
  contracts are introduced only where a concrete workflow cannot be expressed
  truthfully through those routes.
- `image_processor` is source material for project ordering, lightbox, history,
  and interaction behavior. A permanent Go relay between the frontend and Forge
  is not part of the preferred end state.
- Regional Prompting and Dynamic Prompts eventually become native typed
  capabilities, not runtime extensions or detached accordions.
- Projects, frames, versions, recipes, conditions, and candidates are explicit
  domain objects. Directories are storage locations, not the domain model.
- Server state reaches the browser through one ordered generation event stream.
  The UI does not infer a job by coordinating Gradio callbacks and polling loops.

The last three bullets describe the destination, not prerequisites for drawing
the first image in React. Migration restores the operator's existing generation
workflows before introducing project storage, a richer job model, or native
replacement APIs. The clean frontend can initially sit over an imperfect but
known engine contract; it must not hold ordinary image generation hostage to a
simultaneous rewrite of every layer.

## Design documents

1. [`01-workflows-and-interface.md`](01-workflows-and-interface.md) — the person's
   creative loop and the surfaces that support it.
2. [`02-domain-model.md`](02-domain-model.md) — durable objects and invariants.
3. [`03-runtime-and-state.md`](03-runtime-and-state.md) — generation, interaction,
   and placement state machines.
4. [`04-code-and-boundaries.md`](04-code-and-boundaries.md) — repository shape,
   APIs, adapters, storage, and prompt compilation.
5. [`05-migration-and-acceptance.md`](05-migration-and-acceptance.md) — vertical
   delivery slices, cutover, and deletion gates.
6. [`06-decisions-and-unknowns.md`](06-decisions-and-unknowns.md) — settled choices
   and questions that should be answered by a focused implementation probe.
7. [`07-current-api-bridge.md`](07-current-api-bridge.md) — the existing Forge
   seams that let the interface move first.
8. [`08-pen-and-tablet-input.md`](08-pen-and-tablet-input.md) — Wacom/Huion pen,
   pressure, buttons, touch, calibration, and hardware acceptance.
9. [`09-img2img-editor-implementation.md`](09-img2img-editor-implementation.md)
   — the layered pen editor and current evidence boundary.
10. [`10-controlnet-condition-stack.md`](10-controlnet-condition-stack.md) —
    current condition-card implementation and adapter seam.
11. [`11-dynamic-prompt-realizations.md`](11-dynamic-prompt-realizations.md) —
    exact prompt-set compilation and per-image provenance.
12. [`12-unified-shot-and-regional-stage.md`](12-unified-shot-and-regional-stage.md)
    — unified source semantics, the transient candidate shelf, and the first
    transformable spatial-plan editor.
13. [`13-near-term-work-order.md`](13-near-term-work-order.md) — the bounded
    SDXL, Flux, LoRA, regional, editing, project, and cutover sequence after the
    first replacement-workbench implementation.
14. [`14-model-residency.md`](14-model-residency.md) — the 64 GiB weighted-LRU
    model policy, Forge integration seam, and first rehearsal for the
    Observatory ML manager.
15. [`15-lora-prompt-workbench.md`](15-lora-prompt-workbench.md) — LoRAs as a
    prompt-critical modulation stack, activation-term authorship, library
    discovery, and metadata ownership.

## Related records

- [`../native-prompt-composition.md`](../native-prompt-composition.md) defines the
  native prompt compiler and regional/dynamic composition direction.
- [`../../development/2026-09-12-bringup.md`](../../development/2026-09-12-bringup.md)
  records what was actually exercised in the inherited Forge application and
  which engine capabilities still need proof.

The bring-up record is evidence about the inherited system, not a requirement
that its UI architecture survive.
