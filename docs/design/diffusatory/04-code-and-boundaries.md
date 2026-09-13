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

FastAPI already exists in the Forge process. During parity, the new application
should:

- serve the built frontend;
- mount the inherited Gradio application at `/legacy` while needed;
- use the existing launcher's device and model initialization;
- call existing `/sdapi/v1`, `/internal/progress`, and ControlNet routes through
  the compatibility adapter;
- avoid importing Gradio from new frontend, project, or prompt modules.

The default route moves only after the required existing generation workflows
pass hands-on comparison. Durable projects are a subsequent product feature,
not a hostage gate for replacing the settings form. Before cutover React is an
explicit preview route and Gradio remains the default. A launch flag retains
legacy-first behavior during and briefly after cutover.

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

Database mutations and corresponding asset writes need a small transaction
protocol: stage bytes, commit the database record, then expose the asset. Clean
or quarantine abandoned staged files at startup. Do not make the database point
at a file that was never durably written.

`image_processor` import should preserve source files, current order, timestamps,
dialog metadata, and hashes. Import creates new Diffusatory IDs and an explicit
receipt rather than silently rewriting the source directory.

## Native Forge adapter (later)

The adapter translates a validated `GenerationRecipe` and its realizations into
Forge processing objects. It owns:

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

## Native prompt compiler (later)

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
