# Native ControlNet condition stack

Status: implemented on the local `vesper/latest-stack` head; focused client,
browser, and live preprocessor evidence collected. A real conditioned GPU
generation remains open.

## Product reading

ControlNet is not a collection of extension accordions. It is a way to say
what the prompt cannot say reliably: keep this pose, read this depth, follow
these edges, or borrow this visual identity. The primary action is therefore
**Add condition**, followed by three visible choices:

1. what kind of guidance the image provides;
2. which image provides it;
3. what Forge extracts from that image.

Module names, model names, resize policy, weight, start/end range, processor
resolution, thresholds, and control priority remain available. They sit inside
the card or its tuning disclosure rather than becoming the top-level shape of
the workbench.

## Current implementation

### Discovery

`ForgeClient.controlNetCatalog()` reads `/controlnet/control_types` and
normalizes the active instance's intent, module, model, and default mappings.
No checked-in model list decides what the current machine can do.

Common creative intents are ordered first: Depth, Lineart, OpenPose,
IP-Adapter, and Canny. The rest of the instance-provided intents remain
available. A newly added card begins with Depth and the server's current Depth
defaults; this is a useful reversible choice rather than an inert `All/None`
card.

ControlNet discovery is independent of the ordinary model catalog. If the
extension route is unavailable, ordinary txt2img and img2img remain usable and
the condition section explains its own failure.

### Source ownership

A condition has one explicit source choice:

- **Current canvas** resolves the full-resolution visible editor composite at
  preview or generation time. Paint is included. The inpaint selection mask is
  not silently reused as a ControlNet mask.
- **Choose image** retains an independent browser data URL and file name.

Current canvas is disabled until the editor has loaded a real source. Editing
that canvas invalidates derived ControlNet previews so an old depth/pose map
cannot continue to look authoritative after the source changed.

### Preview

`ForgeClient.detectControlNet()` maps a card to `/controlnet/detect` and
normalizes the returned image for display. Negative sentinel values are
omitted from the preview request, allowing the installed endpoint's 512/64/64
defaults to operate; they are still preserved on generation where the
ControlNet unit interprets `-1` as automatic/current-default behavior.

Preview status and failure belong to the individual card. The user can inspect
the actual derived guide before committing to a render.

### Generation boundary

UI source choices never enter the Forge wire contract. At submit time,
`resolveConditions()` validates enabled cards and produces resolved units with
images. `api/forge/controlnet.ts` is the single adapter that owns the installed
extension name (`controlnet`) and snake_case `ControlNetUnit` field mapping.
Both txt2img and img2img attach the resulting units through
`alwayson_scripts.controlnet.args`.

The first stack is capped at three cards because the inspected installed script
currently exposes three unit arguments. A later dynamic count should come from
script metadata rather than an invented client preference.

## Evidence

Focused checks on this slice:

- `pnpm typecheck` passed;
- `pnpm test` passed 43 tests across 10 files before final formatting/build;
- the active Forge instance returned all current intent defaults, including the
  installed Depth, Lineart, OpenPose, and IP-Adapter module/model choices;
- a direct 256x256 Canny `/controlnet/detect` request returned HTTP 200,
  `Success`, and one encoded guide;
- the React condition card accepted a generated PNG, sent the current default
  `depth_midas` preview request to the live endpoint, left `Reading...`, and
  displayed the returned depth map;
- `/agents/vesper/scratch/diffusatory-controlnet-card.png` captures the empty
  source state;
- `/agents/vesper/scratch/diffusatory-controlnet-preview.png` captures the
  source and live derived guide.

The only browser console failures in this run were the known 404s for
`/diffusatory/api/v1/instance`: the running Forge process predates the
Diffusatory mount and was deliberately not restarted during interactive use.
The ControlNet routes themselves were live.

## Open acceptance gates

- Run at least one real conditioned SDXL generation from React for
  IP-Adapter, Depth, Lineart, OpenPose, and one ordinary ControlNet route.
- Exercise both current-canvas and independent-image conditions through the
  mounted build, not only the Vite development proxy.
- Decide whether the source image should support crop/edit directly inside a
  condition card or jump to the main editor with a return anchor.
- Discover unit count from current script metadata before permitting more than
  three cards.
- Verify how independent masks should be represented for ControlNet Inpaint;
  do not infer that the img2img inpaint mask has the same meaning.
- Preserve resolved condition metadata with each result when the first narrow
  provenance record lands.
- Complete Dynamic Prompts separately. This document does not claim all of
  Slice 3.
