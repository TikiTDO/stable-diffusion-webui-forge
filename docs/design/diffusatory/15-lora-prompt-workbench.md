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
substring-only filtering. Cards show a thumbnail, model-family compatibility,
folder, and enough metadata to decide whether to pin or inspect the LoRA.

Pinning does not silently enable every training tag. Saved defaults are the
activation terms selected for ordinary use; source-recommended words and
training tags remain suggestions in the editor.

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
4. Versioned default persistence and metadata editor.
5. Groups, drag-and-drop, alternate catalog projections, and docking.
6. Region/refiner application targets and image-metadata reconstruction.

The first slice must already generate truthful LoRA directives and activation
terms. Later library affordances may be added without changing that core prompt
model.
