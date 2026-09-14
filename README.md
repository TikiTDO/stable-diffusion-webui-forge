# Diffusatory

Diffusatory is Tiki's local visual-story workbench. It keeps Forge's proven
SDXL/Flux inference machinery and replaces its product interface with a native
React application over FastAPI.

The application owns prompt composition, candidates, image editing, regional
composition, ControlNet inputs, model recipes, and the project workflow now
being built around them. The inherited Gradio UI is not served and has no
legacy route; Git retains it if an implementation detail ever needs study.

## Run

Build the client, then launch the application:

```bash
cd diffusatory/web
pnpm install
pnpm build

cd ../..
venv/bin/python launch.py --api --port 7865
```

Opening `http://127.0.0.1:7865/` enters Diffusatory. The canonical client path
is `/diffusatory/`; Forge-compatible inference routes remain under `/sdapi/v1`,
`/internal`, and `/controlnet` while they are the correct engine seams.

For live frontend work, keep the application on port 7865 and run:

```bash
cd diffusatory/web
pnpm dev
```

Vite serves `/diffusatory/` on port 5173 and proxies the local engine. Set
`VITE_FORGE_TARGET` to point it at another Diffusatory instance.

## Read next

- [`diffusatory/README.md`](diffusatory/README.md) — current application and checks
- [`docs/design/diffusatory/README.md`](docs/design/diffusatory/README.md) — product design index
- [`docs/design/diffusatory/13-near-term-work-order.md`](docs/design/diffusatory/13-near-term-work-order.md) — implementation sequence
- [`docs/design/diffusatory/14-model-residency.md`](docs/design/diffusatory/14-model-residency.md) — warm-model residency policy

## Focused checks

```bash
cd diffusatory/web
pnpm test
pnpm typecheck
pnpm build

cd ../..
venv/bin/python -m unittest discover -s test -p 'test_diffusatory*.py'
```
