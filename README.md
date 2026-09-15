# Diffusatory

Diffusatory is Tiki's local visual-story workbench. It keeps Forge's proven
SDXL/Flux inference machinery and replaces its product interface with a native
React application over FastAPI.

The application owns prompt composition, candidates, image editing, regional
composition, ControlNet inputs, model recipes, and the project workflow now
being built around them. The inherited Gradio UI is not served and has no
legacy route; Git retains it if an implementation detail ever needs study.

## Run

Launch the complete application from the repository root:

```bash
./diffusatory.sh
```

The launcher installs missing client dependencies, builds the current client,
creates the private API credential when needed, and starts the existing Python
environment (or lets Forge create it on a first run). Opening
`http://127.0.0.1:7865/` enters Diffusatory. The canonical client path is
`/diffusatory/`; Forge-compatible inference routes remain under `/sdapi/v1`,
`/internal`, and `/controlnet` while they are the correct engine seams.

The default `both` access mode gives the browser an automatic HttpOnly session
cookie and requires an explicit bearer token for other API clients. A request
that has neither receives `401`. The generated token lives in the ignored local
path `.diffusatory/runtime/api-token` and is never printed. This is an admission
boundary against accidental API use, not proof that a determined client did not
load the public workbench first.

Persistent local choices belong in the ignored `.diffusatory/config.env`:

```bash
DIFFUSATORY_ACCESS_MODE=both  # ui, api, or both
DIFFUSATORY_HOST=127.0.0.1
DIFFUSATORY_PORT=7865
DIFFUSATORY_PYTHON=python3.14
DIFFUSATORY_EXTRA_ARGS=(--xformers)
```

Console output is also appended to the ignored local log
`.diffusatory/runtime/server.log`.

Optional HTTPS uses the same one-command launch after adding both certificate
paths to that file:

```bash
DIFFUSATORY_TLS_CERTFILE=/path/to/cert.pem
DIFFUSATORY_TLS_KEYFILE=/path/to/key.pem
```

Run `./diffusatory.sh --help` for the compact launcher reference.

Python 3.11 or newer is required. The launcher uses the system's current
`python3` for a fresh environment and refuses an older existing venv before
dependency installation.

For live frontend work only, keep the application on port 7865 and run Vite in
a second terminal:

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
