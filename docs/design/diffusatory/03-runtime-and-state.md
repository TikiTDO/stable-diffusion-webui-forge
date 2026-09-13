# Runtime and state ownership

The rich job and event model below is the target contract, not a walking-skeleton
requirement. The first UI slices use Forge's narrower current task contract and
keep its limitations visible.

## Rule

Each consequential fact has one authority. The browser may optimistically
render a requested change, but it does not declare a generation complete or a
candidate promoted. The server does not own transient hover and selection
language.

## Compatibility state during UI parity

The existing backend already provides a bounded task identity and queue:

- the client supplies `force_task_id` to `/sdapi/v1/txt2img` or
  `/sdapi/v1/img2img`;
- the generation request remains open until its base64 result is returned;
- `/internal/progress` reports queued/active/completed state and revisioned live
  previews for that task;
- `/sdapi/v1/interrupt` and `/sdapi/v1/skip` act on the shared active engine.

The React compatibility adapter may project these facts into a small UI reducer,
but it must not invent persistence, independent candidate scheduling, an SSE
stream, or per-job cancellation that the backend does not yet supply. Results
become visible as they are actually returned. Progress polling belongs to one
adapter and one timer, not to components throughout the page.

An asynchronous browser request does not block prompt editing. During a real
render, the parity gate checks that the server still admits progress and
interrupt calls and that React does not create render-wide rerenders or network
traffic on keystrokes. If the existing contract fails that check, the smallest
backend repair is made there; that observation, not the desire for a cleaner
model, authorizes the repair.

## Target generation job state

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

## Target candidate state

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

## Target generation events

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

## Target transport

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

## Target browser interaction state

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

## Target scheduling and device ownership

One scheduler owns each GPU execution lane. It knows:

- available memory and selected model residency;
- job priority and candidate order;
- safe microbatch size;
- whether a model switch is needed;
- cancellation and finish-active commands.

When the native job contract arrives, Forge remains its executor. The adapter
receives one normalized candidate or microbatch plan and emits callbacks into
the job event model. UI components never call sampler globals directly.

The eventual API/event loop must never execute a blocking Forge operation. The
scheduler hands work to one dedicated inference-worker boundary; its first
implementation may use a worker thread and queue where Forge globals require
the same process, but its interface must also permit a supervised worker process
later. Progress callbacks cross that boundary through a thread-safe, bounded
channel into the server-owned event journal. SSE reads the journal rather than
sampler globals.

“One Python process” is therefore not permission to share one execution lane.
It is acceptable only if prompt editing remains browser-local and enqueue,
cancel, projection reads, and event delivery stay responsive during a real
render. That behavior is a cutover gate for the native job contract, not a
requirement to introduce that contract before UI parity.

A process restart cannot resume an interrupted diffusion step. On recovery,
nonterminal persisted jobs become `failed` with a restart reason; completed
assets and candidates remain available.
