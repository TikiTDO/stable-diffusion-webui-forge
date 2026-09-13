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
Gradio root remains unchanged during parity work.

Configure a human-readable instance label and, when needed, an externally
managed stable identifier with:

```bash
DIFFUSATORY_INSTANCE_NAME="Aurora studio"
DIFFUSATORY_INSTANCE_ID="aurora-personal"
```

Without an explicit ID, Diffusatory derives a stable non-secret UUID from the
host and repository location.

## Focused checks

```bash
cd diffusatory/web
pnpm test
pnpm typecheck
pnpm build

cd ../..
PYTHONPATH=. venv/bin/python -m unittest test.test_diffusatory_mount
```
