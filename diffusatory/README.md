# Diffusatory application

Diffusatory is a React replacement client over Forge's existing inference API.
The current walking skeleton lives in `web/`; the Python in `server/` mounts a
production build and owns the small native contracts already proven useful,
including prompt expansion and model-residency accounting. Forge remains the
generation executor.

## Development

Run Forge with `--api`, then:

```bash
cd diffusatory/web
pnpm install
pnpm dev
```

The development server opens `/diffusatory/` on port 5173 and proxies Forge
routes to `http://127.0.0.1:7865`. Set `VITE_FORGE_TARGET` to use another local
instance.

## Production mount

```bash
cd diffusatory/web
pnpm build
```

On its next start, Forge mounts the build at `/diffusatory/`, and `/` redirects
there. The operator cut over on 2026-09-14: the Gradio UI and its exclusive
launcher branch are no longer served, and there is no legacy route. The
inherited engine still contains Gradio-coupled internals to unwind only when
their surviving API behavior has a native owner; Git retains the prior UI.

Configure a human-readable instance label and, when needed, an externally
managed stable identifier with:

```bash
DIFFUSATORY_INSTANCE_NAME="Aurora studio"
DIFFUSATORY_INSTANCE_ID="aurora-personal"
```

Without an explicit ID, Diffusatory derives a stable non-secret UUID from the
host and repository location.

`GET /diffusatory/api/v1/residency` reports the 64 GiB logical model budget,
active and warm entries, cache counters, and current process RSS. Logical model
bytes and RSS intentionally remain separate measurements.

## Current image-edit loop

Open or drop a PNG, JPEG, or WebP, or choose **Edit** from any generated result.
Compatible Forge metadata restores the model and render recipe. The focused
editor keeps paint and inpaint-mask layers available at the same time:

- **Generate variation** submits the visible source and paint without a mask.
- **Generate inpaint** submits the same source plus the current mask and refuses
  an empty mask.
- The session variation tray keeps the original, saved working composites, and
  every result from every edit run. Selecting one does not clear the others.
- A saved working composite retains its mask when revisited. Starting another
  editor session or closing dirty work still requires an explicit discard.

Generated images continue through Forge's ordinary output and metadata paths;
the browser tray is navigation state, not a replacement archive.

## Focused checks

```bash
cd diffusatory/web
pnpm test
pnpm typecheck
pnpm build

cd ../..
PYTHONPATH=. venv/bin/python -m unittest \
  test.test_diffusatory_mount \
  test.test_diffusatory_residency \
  test.test_diffusatory_forge_residency
```
