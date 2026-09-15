# LoRA prompt workbench

Status: active implementation design  
Date: 2026-09-14

## Why LoRAs are prompt-critical

Checkpoint models provide broad visual competence, but their ordinary prompt
vocabulary is often too weak or ambiguous for a particular character, pose,
material, composition, or stylistic distinction. A LoRA is therefore not just
another downloadable model asset. It is a **working vocabulary and behaviour
adapter** used while composing a shot.

Embeddings occupy a smaller role in the present workflow. The useful set is
small enough to remember: common negative prompts and occasional character or
high-level controls. They need a searchable reference with previews and notes,
but they do not deserve equal persistent space with LoRAs. Styles are mainly a
brainstorming aid and are less important still.

## Four values that must not share one field

An active LoRA has four independently editable concerns:

1. **adapter identity** — which weights are loaded;
2. **adapter strength** — the multiplier in `<lora:name:strength>`;
3. **activation terms** — words that help the checkpoint invoke the learned
   concept;
4. **term attention** — an independent prompt weight for every activation
   term.

Changing term attention is not the same operation as changing adapter
strength. The interface must never merge the two just because both happen to
be represented by numbers.

## Authorship and compilation

The visible human prompt remains authored text. LoRA activation terms are
structured contributions owned by Diffusatory and compiled with that text for
each realized prompt.

For every enabled term:

- if its normalized phrase is already present in the realized human prompt,
  compile no duplicate;
- otherwise append the enabled term with its current attention weight;
- disabling or clearing terms removes only the structured contribution;
- user-authored matching text is never removed or rewritten;
- the `<lora:…>` adapter directive remains independent of activation terms.

This ownership rule is what makes quick Clear and Defaults actions safe. A
string-replacement implementation cannot satisfy it.

Dynamic prompt branches are resolved before the LoRA contribution is compiled,
so duplicate detection is accurate for each candidate rather than for the
unresolved source expression.

## Active shelf

The persistent prompt workbench shows the things that can change the next
render:

- pinned LoRAs grouped for the current task;
- enabled state and adapter strength;
- activation terms, their enabled states, and term weights;
- quick **Clear terms** and **Defaults** actions;
- an explicit, slower **Save defaults** action;
- a compact account of what the LoRA will add to the next prompt.

Groups are organizational and reorderable. Initially every enabled LoRA applies
to the whole render. The domain model retains an application target so later
groups may apply to an inpaint region, regional refinement pass, character, or
object without replacing the shelf.

The compact card is an instrument, not a metadata dump. It has a ten-slot
budget for activation terms. Enabled terms always remain visible; unselected
suggestions fill whatever places remain. If ten or more terms are enabled, the
compact view shows all selected terms—even when that exceeds ten—rather than
displacing authored state or offering more suggestions. **Show more**
temporarily expands the card, and any term enabled there remains present after
it collapses. The title, strength, remove, terms, and footer must wrap inside a
narrow prompt rail without horizontal overflow.

## Library

Discovery is a dockable lower panel or floating modal over the same library
state. It must scale to thousands of files and search across:

- display name and filename;
- relative directory path;
- alias;
- user tags and downloaded source tags;
- saved activation terms;
- source-recommended/trained words.

The same catalog can be projected as a flat list, directory tree, modified-date
order, or randomized brainstorming order. Search uses fuzzy ranking rather than
substring-only filtering. Results are grouped by the surface that matched,
rather than flattening every metadata field into one unexplained score:

1. display names, aliases, and relative filenames;
2. tags;
3. activation terms;
4. descriptions and notes.

The exact or fuzzy character match is highlighted in the field that produced
the result. This makes a weak filename match visibly different from a strong
tag or activation-term match and lets the user judge the search rather than
trust an opaque relevance order. Tiny one- and two-character searches stay
literal so a large metadata corpus does not turn into accidental fuzzy noise.
Model-container extensions such as `.safetensors` are excluded from fuzzy
filename matching; their letters describe storage, not the LoRA.

Cards show a thumbnail, model-family compatibility, folder, and enough
metadata to decide whether to pin or inspect the LoRA.

The same asset also has a large, full-screen studio. That is where a person can
inspect and edit the description, aliases, compatibility, source evidence,
tags, recommended terms, saved defaults, and notes without turning every
ordinary render into asset administration. The studio can generate and save
sample images using:

1. this LoRA enabled at the currently chosen strength;
2. the selected LoRA activation terms;
3. a separate sample-image prompt.

Sample runs form their own labelled result lane. They must not enter the active
story's candidate shelf or replace its prompt, source image, or generation
plan. A useful sample can later be explicitly copied or saved like any other
image.

The library has an explicit **Refresh library** action. It asks Forge to rescan
the configured LoRA directories before replacing the client catalog, so adding
a file does not require a server restart or ambiguous browser reload. The model
rack provides the equivalent **Refresh checkpoints** action through Forge's
existing serialized checkpoint refresh route; its refreshed model profiles are
returned with the list so model-family defaults remain coherent.

Pinning does not silently enable every training tag. Saved defaults are the
activation terms selected for ordinary use; source-recommended words and
training tags remain suggestions in the editor.

## Embeddings in a structured prompt

An embedding is a small named prompt contribution, not a command to mutate the
first textarea the implementation happens to find. Selecting one opens a small
destination picker containing every prompt box in the current generation
plan—each variation/region prompt plus the shared negative prompt. The chosen
box receives the embedding at its caret. The picker may remember the last
destination for repeated insertions, but it remains visible and changeable;
memory is a speed aid, not an inference about intent.

This deliberately replaces the current behaviour where selecting `lazyneg`
can append it to the positive prompt. Once the generation plan exists, prompt
box identity is stable data and the embedding action targets that identity.
Until then, the minimal targets are positive and negative prompt.

## Metadata ownership

Downloader metadata and embedded safetensors metadata are evidence and must not
be overwritten. Diffusatory writes its own versioned sidecar beside the LoRA.
Existing Forge user metadata may be imported as an initial preference, but a
new save writes the Diffusatory schema.

The native catalog API returns a stable opaque ID, relative path, preview URL,
model family, timestamps, description, tags, recommended words, and saved
defaults. It never exposes an arbitrary filesystem fetch endpoint. Preview and
metadata mutation resolve the opaque ID back through the currently registered
LoRA inventory and remain within the configured LoRA root.

## Prompt editing gesture

`Ctrl+ArrowUp` and `Ctrl+ArrowDown` adjust prompt attention by `0.1`:

- selected text is the target when a selection exists;
- otherwise an enclosing `(phrase:weight)` block is the target;
- otherwise the word at the caret is wrapped and adjusted;
- reaching `1.0` removes the redundant attention wrapper.

The operation edits the prompt directly and preserves the resulting selection.
It applies in both the ordinary and focused-edit prompt fields. LoRA-term chips
provide their own small weight control because those terms are structured
contributions rather than authored prompt text.

## Delivery order

1. Native rich catalog and safe preview contract.
2. Prompt compiler with explicit ownership and focused tests.
3. Active shelf, fuzzy library, strength and term controls.
4. Compact-density rules and a full-screen LoRA studio with isolated sample
   runs.
5. Versioned default persistence and metadata editor.
6. Groups, drag-and-drop, alternate catalog projections, and docking.
7. Region/refiner application targets and image-metadata reconstruction.

The first slice must already generate truthful LoRA directives and activation
terms. Later library affordances may be added without changing that core prompt
model.
