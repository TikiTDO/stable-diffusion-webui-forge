# Code and boundaries

## Preferred repository shape

```text
diffusatory/
  web/
    src/
      app/
      domain/
      features/
        compose/
        candidates/
        project/
        editor/
        conditions/
        prompting/
        viewer/
      input/
        pointer.ts
        bindings.ts
        calibration.ts
      api/
        forge/
          client.ts
          requests.ts
          progress.ts
          scripts.ts
          capabilities.ts
      components/

  server/                    # added by measured need, not up front
    mount.py                 # built frontend and instance metadata
    spatial_conditioning.py  # typed plan, mask compiler, Forge sampler adapter
    projects/                # arrives with the project slice
    prompting/               # native endpoints arrive after parity
    generation/              # native job contract arrives if justified
```

The first production code is the React application and a typed compatibility
adapter over the existing API. Existing Forge directories and generation paths
remain in place. Do not begin the rewrite by moving thousands of engine files
or manufacturing a parallel scheduler. A later backend module or engine package
extraction must be driven by an interaction the current contract cannot express.

## Application runtime

FastAPI already exists in the Forge process. The cut-over application:

- serve the built frontend;
- redirect the product root to the built frontend;
- use the existing launcher's device and model initialization;
- call existing `/sdapi/v1`, `/internal/progress`, and ControlNet routes through
  the compatibility adapter;
- avoid importing Gradio from new frontend, project, or prompt modules.

The operator moved the default route on 2026-09-14. Durable projects remain a
subsequent product feature, not a hostage gate for replacing the settings form.
There is no permanent `/legacy` route or legacy-first launch flag. Git preserves
the old implementation if a later investigation genuinely needs it.

## Frontend state

- TanStack Query owns server projections and mutations.
- Typed local reducers or a small store own draft recipes and interaction modes.
- dnd-kit can carry forward the proven project-reorder interaction.
- A canvas library may own image, mask, and region editing, but it must expose
  explicit serializable layers rather than hiding project state inside a widget.
- No whole-document `MutationObserver` is part of the new application.
- Components subscribe only to the state they render. Prompt input must not
  rerender a project full of image cards.

## Compatibility API contract

The existing API is the initial contract owner. The client gives its loosely
typed and extension-shaped surface one bounded typed facade. That facade owns:

- task IDs and progress polling;
- base64 request/result conversion;
- ordinary generation request construction;
- extension script discovery and positional argument translation;
- capability discovery per backend instance;
- normalization of API errors without hiding their source.

Production uses the same-origin Forge routes. Vite may proxy them in development;
that proxy does not become a second application backend.

## Native API contract

When projects or a measured missing generation capability require native APIs,
their Python models become the contract owner. Generate an OpenAPI TypeScript
client for those routes rather than maintaining parallel handwritten shapes.

API resources use stable IDs. Binary assets are uploaded and fetched separately
from JSON recipes. Long operations return job IDs immediately.

Representative eventual surface:

```text
GET    /api/v1/models
GET    /api/v1/render-profiles
POST   /api/v1/prompt-programs/preflight
POST   /api/v1/generations
GET    /api/v1/generations/{job}
GET    /api/v1/generations/{job}/events
POST   /api/v1/generations/{job}/finish-active
POST   /api/v1/generations/{job}/cancel

POST   /api/v1/projects
POST   /api/v1/projects/open
GET    /api/v1/projects/{project}
POST   /api/v1/projects/{project}/assets
POST   /api/v1/projects/{project}/frames
POST   /api/v1/projects/{project}/frames/{frame}/versions
POST   /api/v1/projects/{project}/moves
POST   /api/v1/projects/{project}/undo
```

Exact path names can change. None of these endpoints should be created merely to
make the architecture diagram symmetrical. Resource boundaries and effect
semantics should not be blurred to mimic an inherited callback.

The first measured exception to the compatibility-only generation surface is
regional conditioning. The existing API could not truthfully express a
transformable set of cell polygons and a complement through extension
positional arguments. Both txt2img and img2img therefore accept one optional,
versioned `diffusatory_spatial_plan`. It is not a second generation endpoint:
the ordinary Forge route still owns queueing, sampling, output, and raw-file
behavior. The added field selects one native conditioning adapter inside that
existing run.

## Local project storage (project slice)

Preferred first implementation of project storage:

```text
project-root/
  .diffusatory/
    project.sqlite
    previews/
  assets/
    imported/
    generated/
    masks/
    conditions/
  exports/
```

SQLite owns identifiers, order, operations, recipes, realizations, and versions.
Normal files own image bytes. All stored paths are relative to the project root
where possible, making project movement and backup unsurprising.

The ordered current-frame directory is a maintained projection, not an opaque
asset bucket. A successful UI move updates both the stable project relation and
the on-disk sortable names or paths. Stage all collision-prone renames first,
commit the intended order with a recovery record, then publish the final names;
startup reconciliation must expose rather than silently choose between a
partially applied database and filesystem order.

Database mutations and corresponding asset writes need a small transaction
protocol: stage bytes, commit the database record, then expose the asset. Clean
or quarantine abandoned staged files at startup. Do not make the database point
at a file that was never durably written.

`image_processor` import should preserve source files, current order, timestamps,
dialog metadata, and hashes. Import creates new Diffusatory IDs and an explicit
receipt rather than silently rewriting the source directory.

## Native Forge adapter

The current narrow adapter translates the validated spatial plan and already
realized common prompts into masked Forge conditioning objects. It reuses the
existing processing object and sampler rather than constructing a parallel
generation scheduler.

The broader future adapter will translate a validated `GenerationRecipe` and
its realizations into Forge processing objects. It owns:

- model/profile resolution;
- prompt and extra-network preparation;
- candidate or microbatch setup;
- progress and preview callbacks;
- interruption mapping;
- output collection and metadata;
- normalization of engine failures.

The adapter does not own project placement or UI state. Forge globals that cannot
immediately be removed stay behind one execution lock and one documented seam.
Every new domain test should be able to replace the adapter with a deterministic
fake.

## Native prompt compiler

The native prompt-composition design remains the owner of semantics:

```text
PromptProgram
  -> ExpansionSet
  -> SpatialPlan
  -> ConditioningPlan
  -> Render
  -> Recipe + Realization
```

UI and API use the same preflight/compiler path. Browser syntax highlighting may
parse for presentation, but it cannot claim a render plan independently of the
server compiler.

Today the common prompt reaches the existing native Dynamic Prompts compiler
first, and the spatial adapter then composes each realized common prompt with
static cell/background fragments. Forge prompt scheduling inside a fragment is
retained. Dynamic alternatives and wildcards inside the fragments themselves
are not yet one program and must not be described as such.

## What must not become permanent product contracts

Some of these shapes are necessarily quarantined inside the compatibility
adapter during parity. “Not permanent” does not mean “rewrite before use.”

- Gradio component IDs as API or domain identifiers;
- hidden DOM controls as state transport;
- settings represented as one enormous positional argument list;
- a second polling loop for previews;
- base64 preview bodies in JSON;
- extension UI callbacks as capability registration;
- process-global prompt-composition state;
- filesystem modification time as project order;
- one mutable image record serving simultaneously as candidate, frame, and
  asset.
