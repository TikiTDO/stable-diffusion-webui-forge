# Domain model

## Core distinction

Three things that the inherited application treats as variations of “image” are
separate:

- **Candidate** — a project-scoped, disposable result of a generation job that
  has not thereby become a storyboard frame.
- **Frame** — a stable ordered place in a project's story.
- **Asset** — immutable image content and its technical metadata.

A frame points to one current frame version. A frame version points to an asset.
Replacing a frame creates another version. Adding creates another frame.

Generation happens inside a project workspace, so a ready candidate and its
immutable asset already belong to that project. **Promotion means giving that
asset a place in the storyboard**, not copying it across an imaginary project
boundary. Add links it through a new frame and frame version; Replace links it
through a new version of an existing frame. The candidate remains attributable
to its job and realization until an explicit retention operation removes it.

## Project

```text
Project
  id
  schema_version
  title
  root_directory
  created_at / updated_at
  settings
  sequence<Frame>
```

A project owns ordering, recipes, history, and provenance. The root directory
owns image files and a local project database. It is not safe to infer order or
identity from filenames alone.

## Frame and version

```text
Frame
  id
  project_id
  order_key
  title?
  current_version_id
  created_at

FrameVersion
  id
  frame_id
  asset_id
  generation_id?
  parent_version_id?
  note?
  created_at
```

Invariants:

- frame identity survives replacement;
- assets are immutable;
- every version remains reachable until an explicit destructive retention
  operation;
- one group move is one atomic order update;
- a failed project edit leaves both order and current versions unchanged.

Order keys are an implementation choice. The API speaks in stable frame IDs and
before/after relations so storage can change without changing interaction.

## Asset

```text
Asset
  id                 # content identity, not display order
  project_id
  media_type
  width / height
  relative_path
  content_hash
  origin              # import, generation, edit, mask, condition
  created_at
  metadata
```

Large masks, previews, and condition images are referenced assets rather than
base64 fields embedded in recipes or event streams.

## Candidate

```text
Candidate
  id
  project_id
  generation_id
  candidate_index
  state
  asset_id?
  realization_id?
  created_at / ready_at?
```

A ready candidate owns an asset reference whether or not any frame uses that
asset. Candidate identity explains generation and review; frame identity
explains narrative position. Promotion creates a frame relation and does not
mutate either the candidate or asset.

## Generation recipe

```text
GenerationRecipe
  schema_version
  model: ModelProfileRef
  prompt: PromptProgram
  output:
    width
    height
    candidates
    seed_strategy
  render_profile: RenderProfileRef
  source?:
    asset
    mask?
    denoise
    resize_policy
    inpaint_policy?
  conditions: Condition[]
```

The same type represents txt2img, img2img, and inpaint. Absence or presence of
source and mask changes the execution plan; it does not select an unrelated
form with a different memory of every control.

## Prompt program and toggleable fragments

Plain positive and negative text remain the primary editing surface. A person
may lift selected text into a named or temporary fragment and toggle that
fragment without deleting or manually reconstructing it:

```text
PromptFragment
  id
  label?
  polarity: positive | negative
  text
  enabled
  order
```

The prompt program compiles base text plus enabled fragments before dynamic or
regional expansion. Disabled fragments remain visible editable intent but do
not appear in a realization. This is one stored representation surfaced as
text selection and toggles, not a second prompt language beside the editor.

## Recipe and realization

A **Recipe** is editable intent. A **Realization** records exactly what a
candidate received:

```text
Realization
  recipe_id
  candidate_index
  resolved_positive_prompt
  resolved_negative_prompt
  expansion_trace
  seed
  model_hashes
  VAE/text-encoder hashes
  LoRA/embedding identities
  normalized conditions
  compiler_version
  engine_version
```

The image, recipe, and realization are stored together. Replay uses the
realization; variation begins from the recipe.

## Model and render profiles

A model profile describes a usable model, not only a checkpoint filename:

```text
ModelProfile
  family: sdxl | flux
  checkpoint
  preferred_vae
  preferred_text_encoders
  supported_conditioning
  default_render_profile
```

A render profile collects infrequently adjusted feel/detail controls:

```text
RenderProfile
  sampler
  scheduler
  steps
  cfg
  hires_policy?
  model_specific_options
```

Profiles make deliberate experimentation possible without forcing the person to
reconstruct a working cluster of values each time.

## Condition

Conditions use a discriminated representation:

```text
Condition
  id
  kind: pose | depth | normal | lineart | edge | ip_adapter | ...
  source_asset
  mask_asset?
  preprocessor
  model
  strength
  start
  end
  parameters
```

Capability negotiation happens before model load. Unsupported combinations fail
as preflight findings rather than silently falling back.

## Project operations

Every durable project edit has an attributable operation record:

- add frame;
- replace frame version;
- move frames;
- remove/restore frame;
- rename frame/project;
- promote candidate;
- import asset.

This provides undo and history without reconstructing intention from filesystem
timestamps. It is product history, not an event-sourcing religion: store the
small set of operations needed to explain and reverse actual edits.
