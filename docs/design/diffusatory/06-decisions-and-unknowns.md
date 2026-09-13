# Decisions and focused unknowns

## Settled for the working design

- The product is a visual story workbench.
- Once a project is open, its sequence remains present during generation.
- Candidate, frame, and asset are different objects.
- Add and Replace are explicit modes with different hover behavior.
- Replacement creates history; it does not overwrite it.
- Candidate count is user intent; microbatch size is engine policy.
- The first React client uses Forge's existing HTTP API and generation paths.
- A fresh interface does not require a fresh generation backend.
- Backend endpoints are added only for measured missing contracts.
- Gradio is transitional and ultimately removed from the product.
- React/TypeScript owns the new interface; FastAPI owns the local application
  API and serves it.
- Projects use stable identifiers and transactional ordering.
- The eventual native Preview/status contract uses one event stream; the parity
  client initially quarantines current polling in one adapter.
- Dynamic and regional prompting share one native prompt compiler.
- Plain prompt text can expose selected terms as named or temporary toggleable
  fragments without creating a parallel prompt representation.
- ControlNet inputs are native condition cards.
- SDXL and Flux are the supported model families.
- The new UI becomes the default after required generation parity and a hands-on
  operator cutover decision; projects follow rather than gate that cutover.
- Blocking Forge inference never runs on the API/event loop.
- Regional composition begins as a transformable split grid with an explicit
  background complement; common prompt and background prompt remain distinct.
- The client discovers an instance name, ID, and capabilities rather than
  assuming exactly one Forge exists.

## Questions answered by a small implementation probe

These do not need speculative architecture debate before Slice 0.

### Canvas implementation

Determine whether direct PixiJS use, another focused canvas library, or a small
custom renderer best supports the img2img/inpaint editor:

- source, paint, and mask layers;
- high-resolution zoom/pan;
- tablet pressure where available;
- deterministic export of masks and transforms;
- no hidden state that cannot be serialized.

Build one throwaway canvas probe and keep only the finding.

### Native preview image transport

Begin parity with the current task-aware polling and data-URI preview. If its
measured encode or delivery cost remains material after Gradio is gone, compare
SSE events plus revisioned HTTP image URLs during a real 1024 render. If binary
streaming materially improves the actual workflow, compare it then; do not add
a WebSocket in anticipation.

### Candidate scheduling

After project-aware candidates exist, trace the smallest Forge seam that can
execute one candidate or controlled microbatch without rebuilding model state.
Begin with the simplest correct scheduler. Add adaptive batching only after
real memory and latency behavior is known.

### Project database placement

Default to `.diffusatory/project.sqlite` inside the project. Confirm backup,
move, and simultaneous-reader behavior on the actual estate filesystem. Move to
a global catalogue plus portable manifest only if the local database creates a
measured problem.

### Existing `image_processor` code

Its current working tree contains uncommitted work and is not available for
blind copying. Before integration, establish custody and exact head, then decide
file by file whether to port, reuse, or merely preserve the behavior. The domain
concepts are useful regardless of code reuse.

## Decisions that should remain revisable

- exact frontend component and state libraries;
- whether the final executable is one Python process or a supervised local pair;
- SQLite schema details and ordering-key representation;
- whether a later Observatory tile embeds this frontend or consumes the same
  APIs independently;
- when the Forge adapter becomes a more independent inference service;
- names and visual treatment of render profiles.

Revisable does not mean vague. Each implementation slice records the chosen
answer and the observation that made it sufficient.
