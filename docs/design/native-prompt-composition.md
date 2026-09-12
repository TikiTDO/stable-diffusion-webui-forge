# Native prompt composition

Status: design direction, not an implementation contract
Date: 2026-09-12

## Why these are one feature

The copied Regional Prompter and Dynamic Prompts extensions look unrelated in
their current user interfaces. One expands text into candidate prompts; the
other assigns prompts to parts of an image. To the person making an image,
however, both answer one question:

> What exactly will this prompt mean for this render?

The Diffusatory should therefore treat them as stages in one native prompt
composition pipeline, not as two extension accordions bolted onto txt2img.
The useful product is not more syntax. It is a visible, inspectable render
plan that can be edited, previewed, generated, saved, and replayed.

This design deliberately follows restoration of the inherited generation
surface. It must not become a reason to leave txt2img, img2img, VAE, LoRA, or
ControlNet partially working.

## Reference implementations

The source studies are pinned so later implementation can distinguish what we
observed from what we independently designed:

| Reference | Studied commit | License | What it demonstrates |
| --- | --- | --- | --- |
| `hako-mikan/sd-webui-regional-prompter` | `be623452203b396ed87b85583a3cfd56e8157214` | AGPL-3.0 | Matrix, mask, and prompt regions; base/common prompts; attention and latent modes; ratios; per-step schedules; visual masks. |
| `adieyal/sd-dynamic-prompts` | `de056ff8d80e4ad120e13a90cf200f3383f427c6` | MIT | Wildcards, choices, deterministic random and combinatorial expansion, Jinja templates, prompt freezing, high-resolution prompt variants, and generation metadata. |

Those repositories are references, not future runtime extensions. If code is
copied, its provenance and license must remain explicit. The preferred route
is to preserve their demonstrated behaviors while building typed native
interfaces around Forge's own processing and backend seams.

## The user experience

Prompt composition should have three views of the same object.

### 1. Source

The author writes ordinary positive and negative prompts. Choices, wildcard
references, variables, and optional template expressions may appear inline.
Nothing about spatial prompting should require learning a punctuation language
before a first image can be made.

### 2. Resolved

Before generation, the interface can show the exact prompt variants produced
for each image in the batch:

- the selected choice and wildcard values;
- seed and expansion mode;
- resolved positive and negative text;
- warnings for missing or empty wildcard sources;
- the difference between first pass and high-resolution pass.

The preview must use the same compiler and inputs as generation. A decorative
preview that reimplements expansion is worse than no preview because it can
lie about what will render.

### 3. Composition

Regions are first-class objects rather than fragments hidden in a prompt:

- shape or mask;
- prompt source;
- negative prompt source;
- weight and blend/falloff;
- base/common contribution;
- active step or sigma range;
- composition strategy, initially attention or latent;
- stable identifier and display name.

A person should be able to draw or import a mask, select a region, and edit
what belongs there. Matrix/grid helpers can create several region objects at
once, but the resulting objects remain inspectable and editable.

### Preflight is part of composition

The generate action should be preceded by a cheap render-plan inspection,
available automatically in the UI and explicitly through the API. It should
answer:

- How many images and prompt variants will this request create?
- Which exact prompt is assigned to each region and pass?
- Do masks cover, overlap, or leave gaps in surprising ways?
- Does this model/backend support the requested composition strategy?
- Which warnings prevent generation and which merely describe a tradeoff?

Failures such as a missing wildcard, zero-area mask, invalid ratio, or an
unsupported model path should be reported here rather than after model load.

### The output is both image and provenance

Every result should retain two related records:

1. **Recipe** — the editable source program and region objects.
2. **Realization** — the resolved choices, prompts, seeds, masks, schedules,
   model identity, and relevant compiler version used for this image.

The recipe makes variation possible. The realization makes replay and honest
comparison possible. Saving only the final expanded prompt loses the author's
program; saving only the program cannot reproduce a random choice.

## Engine model

The pipeline should be explicit and typed:

```text
PromptProgram
  -> ExpansionSet
  -> SpatialPlan
  -> ConditioningPlan
  -> Render
  -> Recipe + Realization
```

### PromptProgram

An input-neutral representation shared by UI and API. It contains source
prompts, negative prompts, variables, expansion policy, wildcard roots,
regions, pass overrides, and schema version. UI widgets and API JSON compile
to the same type.

### ExpansionSet

The deterministic result of resolving a `PromptProgram` for a requested batch.
It contains every candidate prompt and a trace of each substitution. Expansion
must accept an explicit seed and must not depend on process-global random
state. Random and combinatorial expansion are policies over the same result
type, not separate generation paths.

Jinja-style evaluation, if retained, needs a deliberately bounded environment.
Template text is untrusted input; it must not gain filesystem, network, Python
object traversal, or arbitrary import access.

### SpatialPlan

A model-independent description of regions and their relations. It validates
geometry, normalizes masks to the target canvas, records overlaps and gaps,
and expands grid/matrix shorthand. It does not touch the UNet.

Masks must retain their source resolution and transformation history so a
later canvas resize or hires pass cannot silently change their meaning.

### ConditioningPlan

The model-aware compiler binds resolved text to regions, passes, and sampling
ranges. It chooses supported conditioning behavior and reports capability
errors before sampling.

The first strategies should preserve the reference behaviors without
preserving its implementation shape:

- **attention composition** supplies region-aware conditioning at Forge's
  existing transformer/model-option seams;
- **latent composition** combines region-specific denoising in latent space;
- **step schedules** are expressed in sampler time and compiled to the
  backend's actual sigma/timestep domain.

Per-request state must travel with the processing/model options. Do not use
module globals or permanently replace model `forward` methods. Installation,
generation, interruption, and failure must all leave the model in a valid
state for the next request.

### Execution and provenance

Forge's existing processing lifecycle remains the owner of batch setup,
extra-network activation, conditioning, sampling, image saving, and infotext.
Prompt composition enters through defined preparation and backend hooks. The
same serialized realization should be available to:

- PNG metadata and sidecars;
- UI history and send-to actions;
- API responses;
- reproducibility tests.

Large masks and verbose traces should use referenced artifacts rather than
inflating the legacy infotext beyond usefulness.

## Native boundaries in Forge

The current code suggests these provisional boundaries:

```text
modules/prompt_composition/
  schema.py          # versioned recipe and realization types
  expand.py          # choices, wildcards, templates, deterministic plans
  spatial.py         # region geometry, masks, grids, validation
  compile.py         # model-aware ConditioningPlan
  provenance.py      # metadata and replay records
  api.py             # request/response schemas

modules/ui_prompt_composition.py
backend/patcher/prompt_composition.py
```

Exact filenames are not a commitment. The important boundaries are:

- parsing and expansion do not depend on Gradio;
- spatial validation does not depend on one diffusion architecture;
- backend integration is request-scoped and capability-driven;
- UI and API call the same plan compiler;
- provenance is generated by the compiler/executor, not reconstructed from UI
  labels after the fact.

Existing leverage points to investigate before adding machinery include
`StableDiffusionProcessing.setup_prompts`, extra-network parsing,
`get_learned_conditioning`, `conditioning_modifiers`, model options,
transformer patches, and `create_infotext`.

## What to carry forward

From Dynamic Prompts:

- wildcard libraries with nested paths;
- choices and weighted choices where semantics are unambiguous;
- deterministic random and combinatorial generation;
- frozen/resolved prompt display;
- batch and hires-pass handling;
- substitution tests and useful error cases.

From Regional Prompter:

- attention and latent composition as distinct strategies;
- base/common prompts;
- grid ratios and explicit masks;
- region visualization;
- prompt and negative-prompt regions;
- sampling schedules and useful regional metadata.

## What to leave behind

- extension-only accordions detached from the main authoring flow;
- prompt punctuation as the only representation of region structure;
- global mutable state shared across requests;
- broad monkeypatches of model internals;
- a second prompt-expansion implementation in the browser;
- silent fallback when a backend cannot honor a composition request;
- settings whose current value cannot be recovered from an output;
- independent UI and API behaviors;
- automatic Magic Prompt/model downloads in the first native slice.

Magic Prompt may later be a separate assistive authoring service. It is not
required to make deterministic composition native, and it should not blur the
boundary between what the author wrote and what a language model proposed.

## Delivery order

1. Finish and evidence the inherited Forge surface: visible normal-step SDXL,
   VAE, LoRA, img2img, ControlNet, settings persistence, and interruption.
2. Land the versioned recipe/realization schema and a headless deterministic
   expansion compiler with tests.
3. Add one shared UI/API resolved-prompt preview and provenance round trip.
4. Add explicit region objects, mask/grid editing, and preflight validation
   without changing sampling.
5. Implement one model family's attention composition through request-scoped
   backend hooks.
6. Add latent composition and broader model capability negotiation.
7. Migrate useful wildcard management, visual tooling, schedules, and batch
   affordances; only then retire the copied extensions as references.

Each stage must leave ordinary prompts behaving exactly as before when prompt
composition is absent.

## First native slice: acceptance boundary

The first end-to-end slice is intentionally small but must be real:

- one recipe containing a wildcard and a choice resolves deterministically;
- two visible region objects can be created and assigned different prompts;
- UI preview and API preflight return the same normalized plan;
- unsupported composition fails before model load with a useful message;
- a generated image retains both recipe and exact realization;
- reopening that record restores the editable regions and the resolved values;
- replay with the same model inputs reproduces the same render request;
- generation without a composition recipe is unchanged.

That slice proves the product shape: the person can see what will happen,
change it intentionally, and understand what did happen afterward. More
syntax, modes, and cleverness should wait until that loop is pleasant.
