# Code and boundaries

## Preferred repository shape

```text
diffusatory/
  server/
    app.py
    api/
      generations.py
      projects.py
      assets.py
      models.py
      prompting.py
    generation/
      models.py
      scheduler.py
      jobs.py
      events.py
      forge_adapter.py
    projects/
      models.py
      store.py
      ordering.py
      operations.py
      import_image_processor.py
    prompting/
      schema.py
      parse.py
      expand.py
      spatial.py
      compile.py
      provenance.py
    storage/
      database.py
      assets.py
      migrations/

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
      components/
```

Existing Forge directories remain in place while the adapter is established.
Do not begin the rewrite by moving thousands of engine files. A later engine
package extraction should be driven by actual imports through the adapter.

## Application runtime

FastAPI already exists in the Forge process. The new application should:

- mount versioned Diffusatory APIs;
- serve the built frontend;
- mount the inherited Gradio application at `/legacy` while needed;
- use the existing launcher's device and model initialization;
- avoid importing Gradio from domain, project, prompt, or generation modules.

The default route moves to the new application only after both real generation
and durable project/storyboard operations are usable. Before then it is an
explicit preview route and Gradio remains the default. A launch flag can retain
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

## API contract

The Python API models are the contract owner. Generate an OpenAPI TypeScript
client rather than maintaining parallel handwritten request shapes.

API resources use stable IDs. Binary assets are uploaded and fetched separately
from JSON recipes. Long operations return job IDs immediately.

Representative surface:

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

Exact path names can change. Resource boundaries and effect semantics should not
be blurred to mimic an inherited callback.

## Local project storage

Preferred first implementation:

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

## Forge adapter

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

## Prompt compiler

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

## What not to carry forward

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
