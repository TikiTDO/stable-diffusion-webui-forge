# Native dynamic-prompt realizations

Status: implemented on `vesper/latest-stack`; backend and client tests pass.
Mounted Forge, real generation, and saved-record acceptance remain open.

## Product reading

Dynamic Prompts is useful here because one source prompt can describe a small
sequence or a field of alternatives. The product action is not “enable an
extension.” It is:

> Show me the exact prompts these candidate images will receive, then make
> those images without changing the answer between preview and Generate.

The composer therefore has three policies beside the prompt:

- **As written** repeats the literal source for the requested candidates;
- **Variations** chooses one deterministic realization per candidate;
- **Every branch** walks unique combinations up to the visible candidate cap.

The existing Candidates control remains the number of images in the first two
modes and becomes an honestly labelled Candidate cap in exhaustive mode.
Exhaustive preview states when more combinations exist. It may return fewer
images when the source has fewer unique combinations.

## One compiler boundary

`POST /diffusatory/api/v1/prompts/expand` is the only expansion path. The React
client does not parse braces, wildcards, variables, weights, or comments. It
debounces a preview request while the person writes; Generate makes the same
typed request again and submits the returned positive/negative arrays to
Forge. A stale browser preview is therefore never treated as generation input.

The first compiler wraps `dynamicprompts==0.31.0`, the MIT-licensed core library
studied through `adieyal/sd-dynamic-prompts` at
`de056ff8d80e4ad120e13a90cf200f3383f427c6`. Only its local choice, wildcard,
variable, comment, random, and combinatorial machinery is enabled. Jinja,
Feeling Lucky, Attention Grabber, and Magic Prompt are not part of this slice;
there are no implicit model downloads or external calls.

An explicit prompt-set seed determines random choices. Candidate `n` uses that
seed plus `n`, and positive and negative sources use the same per-candidate
seed. The image seed remains a separate Forge setting. Changing image noise
does not silently choose another prompt, and choosing another prompt set does
not silently claim to reproduce the image noise.

## Wildcard ownership and preflight

The server owns one wildcard root: `data/wildcards` below Forge's configured
data directory. Request text cannot select a filesystem root. The upstream
library already rejects parent traversal; Diffusatory additionally walks the
reachable wildcard graph before expansion and blocks missing or empty files,
including a missing wildcard referenced by another wildcard.

The core library normally leaves missing markers such as `__lighting__`
inside the output and logs a warning. That behavior is reasonable for a
templating library but not for a GPU workbench. Diffusatory returns a
field-specific blocking issue instead. It also scans realizations for markers
that remain unresolved after expansion.

Syntax/parser failures are returned as prompt or negative-prompt issues rather
than surfacing after model load. During implementation, a measured library
edge case showed that random expansion of an empty string raises
`StopIteration`; the native boundary now represents an empty positive or
negative source as the requested number of empty realizations.

The current syntax legend deliberately documents only exercised core forms:

- `{dawn|dusk}` choices;
- `{0.7::warm|0.3::cold}` weighted random choices;
- `{2$$ and $$red|blue|gold}` multiple selections;
- `__lighting__` wildcard files;
- `${tone={warm|cool}} ${tone}` variables;
- Python-style comment lines.

## Forge execution seam

Forge processing already accepts `prompt` and `negative_prompt` lists and
checks that their lengths match. Its generated API model previously narrowed
those fields to strings, so the public request schema now accepts
`str | list[str]` for both txt2img and img2img. A scalar remains valid and
ordinary clients are unchanged.

Diffusatory sends one resolved positive and negative prompt per image with one
batch and sets `batch_size` to the realization count. Styles remain owned by
Forge and are applied in `StableDiffusionProcessing.setup_prompts`, after the
native expansion.

## Result truth

The generation response contains Forge's `Processed.js()` JSON. The client now
reads:

- `all_prompts` and `all_negative_prompts`;
- `all_seeds`;
- `index_of_first_image`;
- `infotexts`.

Each individual result is associated with the prompt and seed Forge reports,
not merely with the array the browser expected to send. A returned grid is
labelled **Sheet** because it combines several realizations and cannot honestly
claim one prompt. Extra images beyond Forge's per-image prompt inventory are
labelled as auxiliary rather than borrowing another result's provenance. When
an older server returns unusable metadata, the image remains usable and the UI
states that per-image provenance was not returned.

This is a narrow realization record, not the complete Recipe/Realization
schema from `native-prompt-composition.md`. Source prompt, compiler mode,
prompt-set seed, and compiler version are present in the preview response, but
they are not yet stored in a durable project record or PNG sidecar.

## Focused evidence

- backend tests cover literal repetition, deterministic random expansion,
  positive/negative exhaustive cross-products, cap truncation, nested missing
  wildcards, invalid syntax, and the mounted API route;
- client tests cover compiler request mapping and prompt-array txt2img mapping;
- reducer tests cover grid offsets, actual per-image prompt/negative/seed
  association, missing metadata, and returned auxiliary images;
- the TypeScript suite and production build are part of the slice gate.

## Open acceptance gates

- Restart or separately launch Forge from this head and confirm its OpenAPI
  schema admits prompt arrays without disrupting an operator-owned generation.
- In the mounted client, preview `{morning|afternoon|night|midnight}` as Every
  branch and run four real SDXL images; confirm each result shows the prompt
  and image seed that actually rendered.
- Repeat with a dynamic negative prompt and with a nested wildcard file below
  the configured data root.
- Confirm grid-on and grid-off response mapping on the active Forge settings.
- Persist the source recipe, exact expansion response, compiler version, and
  realized per-image request in the future project record/sidecar.
- Add a native wildcard library editor and refresh contract; editing files by
  hand is not the intended final experience.
- Add substitution traces only when they can come from this same compiler;
  do not reconstruct them by diffing output text in the browser.
- Integrate region objects with the same expansion response. This slice does
  not implement Regional Prompting or claim the larger prompt-composition
  acceptance boundary is closed.
