# Diffusatory guest

The Diffusatory's Go image engine and API. It replaces Forge's Python executor; the React client in
`../web` stays.

- **Its own program.** It runs on its own and shares no code with the Observatory. Ideas carry
  over; packages and dev tooling do not.
- **A guest of the Observatory's memory manager, when one is there.** It declares the GPU memory it
  will use, and the manager tries to make that available. The guest still handles running out of
  memory itself, because the manager can't always promise it. With no manager present, it skips that
  step. It takes no part in the Observatory's scheduling or module system.
- **Flux and SDXL are built in parallel**, as two implementation streams.
- **No Forge code.** Forge's single-file Flux implementation is marked non-commercial outside Forge,
  so the engine is written from the published model architectures. Each model file's licence is
  checked before release.

`api/` is the typed generation contract the client speaks. Each engine stage publishes what it can
honour; every other field is refused by name, never silently dropped.

```sh
go vet ./... && go test ./...
```
