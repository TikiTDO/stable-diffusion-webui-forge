# Runtime and state ownership

## Rule

Each consequential fact has one authority. The browser may optimistically
render a requested change, but it does not declare a generation complete or a
candidate promoted. The server does not own transient hover and selection
language.

## Generation job state

Server-authoritative:

```text
created
  -> queued
  -> preparing
  -> running
  -> completed

queued | preparing | running
  -> cancel_requested
  -> cancelled

running
  -> finish_active_requested
  -> completed_partial

preparing | running
  -> failed
```

`finish_active_requested` means do not schedule another candidate or microbatch.
Candidates already executing are allowed to finish. The UI must say how many are
active rather than promise that GPU work can be split more finely than it can.

The terminal states are `completed`, `completed_partial`, `cancelled`, and
`failed`.

## Candidate state

```text
planned -> queued -> sampling -> decoding -> ready
                    |          |          -> failed
                    |          -> cancelled
                    -> cancelled
```

A job owns an ordered candidate set. A ready candidate remains valid when later
candidates fail or are cancelled.

Preview revisions belong to the currently sampling candidate. A preview is not
an asset or a completion claim.

## Generation events

One ordered event stream reports:

- `job.queued`
- `job.preparing`
- `candidate.started`
- `candidate.progress`
- `candidate.preview_ready`
- `candidate.ready`
- `candidate.failed`
- `job.finish_active_acknowledged`
- `job.completed` / `job.completed_partial` / `job.cancelled` / `job.failed`

Events carry stable IDs and monotonic sequence numbers. Reconnection supplies
the last observed event ID. The server retains a bounded event history for
active and recently completed jobs.

Preview events carry a revisioned URL, dimensions, step, and total steps. They
do not carry base64 image bodies. The stage owns one persistent preview image
and changes its source only for a newer revision.

## Transport

- `POST /api/v1/generations` creates a job from a validated recipe.
- `GET /api/v1/generations/{id}` returns its current projection.
- `GET /api/v1/generations/{id}/events` is an SSE stream.
- `POST /api/v1/generations/{id}/finish-active` stops future scheduling.
- `POST /api/v1/generations/{id}/cancel` requests cancellation.
- Preview and final images use normal asset endpoints.

SSE fits the current direction of travel: commands are occasional HTTP writes;
status is an ordered server-to-browser stream. A WebSocket should be introduced
only for a proven bidirectional interaction that HTTP plus SSE cannot express
cleanly.

## Browser interaction state

Use small typed reducers/statecharts rather than one global boolean collection.
A state-machine library is optional; explicit transitions and tests are not.

### Compose session

```text
idle
  -> editing_prompt
  -> editing_composition
  -> generating(job_id)
  -> reviewing(job_id, candidate_id)
  -> refining(asset_id)
```

Draft recipe state is local and recoverable. Server records are created at
preflight/generation, not on every keystroke.

### Promotion and placement

```text
browsing
  -> adding(candidate_id, anchor_id?, side?)
  -> replacing(candidate_id, frame_id?)
  -> selecting(frame_ids)
  -> moving(frame_ids, anchor_id?, side?)
  -> committing(operation_id)
  -> browsing
```

Only valid destinations are interactive in each state. Switching Add/Replace
changes both the state and hover affordance. A confirmed operation updates the
server projection; a rejected operation restores the prior projection and
preserves the candidate.

### Viewer

```text
closed
  -> candidate(job_id, candidate_id)
  -> frame(frame_id, version_id)
  -> condition(asset_id)
```

Zoom, pan, fit, and comparison are viewer state. Opening fullscreen does not ask
a gallery component to resize the application around itself.

## Scheduling and device ownership

One scheduler owns each GPU execution lane. It knows:

- available memory and selected model residency;
- job priority and candidate order;
- safe microbatch size;
- whether a model switch is needed;
- cancellation and finish-active commands.

Forge remains the executor during migration. The adapter receives one normalized
candidate or microbatch plan and emits callbacks into the job event model. UI
components never call sampler globals directly.

A process restart cannot resume an interrupted diffusion step. On recovery,
nonterminal persisted jobs become `failed` with a restart reason; completed
assets and candidates remain available.
