# Current Forge API bridge

This inventory is the evidence for beginning with a thin replacement client
rather than a generation-backend rewrite. It records callable seams present in
the current tree; it does not claim that their shapes are ideal or permanent.

## Generation and task lifecycle

`modules/api/api.py` currently registers:

- `POST /sdapi/v1/txt2img`;
- `POST /sdapi/v1/img2img`;
- `GET /sdapi/v1/progress`;
- `POST /sdapi/v1/interrupt`;
- `POST /sdapi/v1/skip`.

Both generation request models accept `force_task_id`. The handlers put that ID
in the existing queue, execute under Forge's queue lock, and return images as
base64 when processing completes.

`modules/progress.py` separately registers task-aware:

- `GET /internal/pending-tasks`;
- `POST /internal/progress`.

Given the supplied task ID, `/internal/progress` distinguishes queued, active,
and completed work and returns a revisioned data-URI live preview. This is the
better initial progress seam. It is still polling, keeps only bounded task
history, and observes one shared engine state; the client must preserve those
limits rather than advertise the target native job semantics.

## Models and ordinary controls

The existing API exposes options, samplers, schedulers, checkpoints,
VAE/text-encoder modules, styles, embeddings, scripts, script information,
memory, and refresh/reload operations. Forge's built-in LoRA extension adds
LoRA list and refresh endpoints. The prompt itself remains the invocation path
for LoRAs and embeddings during generation.

The compatibility client should not mirror every exposed option. It maps the
operator's actual product boundary and keeps uncommon but supported settings in
a secondary profile or settings surface.

## ControlNet

`extensions-builtin/sd_forge_controlnet/lib_controlnet/api.py` exposes model,
module, and control-type discovery plus preprocessor execution at
`POST /controlnet/detect`. Generation still enters through the ordinary API's
`alwayson_scripts` payload. That positional extension translation is ugly, but
it can live in one typed adapter while the ControlNet workflow is reproduced.

## What the bridge does not solve

- generation responses are synchronous and base64-heavy;
- preview delivery is polled and encoded as a data URI;
- interrupt and skip address shared active engine state;
- extension generation contracts depend on script names and positional args;
- there is no native project, frame, candidate, recipe, or realization store;
- the current contract does not provide the target SSE journal or independent
  candidate scheduler.

These are known reasons to improve the backend later. They are not evidence that
the existing engine must be replaced before React can generate, preview, edit,
and compare images.

## One justified early native endpoint

The current API does not identify which Diffusatory/Forge instance answered or
describe the product capabilities enabled there. The walking skeleton therefore
adds one read-only endpoint returning an operator-configured display name, a
stable non-secret instance ID, build version, and capability list. This keeps a
personal instance and an agent instance distinguishable without introducing a
distributed scheduler or assuming that exactly one backend exists.

## Rule for adding a backend seam

For each proposed endpoint, name:

1. the exact user interaction the current API cannot represent truthfully;
2. the smallest new contract that makes it representable;
3. the focused parity test against the known Gradio behavior;
4. which compatibility code becomes deletable afterward.

If those four statements cannot be made yet, keep the change in the client.
