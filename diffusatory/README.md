# Diffusatory application

Diffusatory is a React replacement client over Forge's existing inference API.
The current walking skeleton lives in `web/`; the Python in `server/` only
reports instance identity/capabilities and mounts a production build. It does
not replace Forge's generation path.

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

On its next start, Forge mounts the build at `/diffusatory/`. The existing
Gradio root remains unchanged only while it is still useful for hands-on
comparison. Diffusatory is intended to replace it, not preserve it at a legacy
route; once cutover is accepted, the replaced UI and its exclusive launch paths
are removed and Git retains the prior implementation.

Configure a human-readable instance label and, when needed, an externally
managed stable identifier with:

```bash
DIFFUSATORY_INSTANCE_NAME="Aurora studio"
DIFFUSATORY_INSTANCE_ID="aurora-personal"
```

Without an explicit ID, Diffusatory derives a stable non-secret UUID from the
host and repository location.

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
PYTHONPATH=. venv/bin/python -m unittest test.test_diffusatory_mount
```
