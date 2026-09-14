# Model residency: the first scheduler rehearsal

Diffusatory is the first small proving ground for the Observatory ML manager.
The immediate problem is checkpoint switching, but the object being built is a
general residency manager: it decides which expensive, reconstructable
resources remain live, which work currently protects them, and what must leave
before another resource arrives.

This is not a process memory limit. Killing Forge at an RSS threshold would
turn a recoverable cache-policy mistake into a failed render. Python and Torch
allocators may also retain address space or pages after a logical eviction, so
the manager must report logical residency and measured process memory as
different facts.

## Working budget

The default host-residency budget is **64 GiB**. It includes the active resource
bundle and every warm heavyweight resource retained for reuse. It does not
pretend that transient loader copies, sampler workspace, browser assets, or the
Python runtime are model residency.

The four numbers must remain visible separately:

1. **logical residency** — byte weights of active and warm managed resources;
2. **process RSS** — pages the operating system currently attributes to Forge;
3. **transient headroom** — temporary loader and inference allocations;
4. **VRAM residency** — device-local weights and working memory.

An active resource is pinned by a lease. Warm resources have no lease and are
evicted in weighted least-recently-used order when an admission would exceed
the budget. An active lease is never broken to satisfy the budget. If pinned
resources alone exceed 64 GiB, the manager reports the exact overage; it does
not claim compliance or terminate the process.

The budget is configurable because a host may deliberately dedicate a
different amount, but it is a byte budget rather than a checkpoint-count
setting. `sd_checkpoints_limit` is not the new authority.

## Resource identity

The first Forge adapter may cache one assembled model bundle at a time, but its
key must describe what was actually assembled:

- checkpoint path plus content identity;
- additional module identities;
- storage and load dtype;
- architecture-affecting loader choices.

Display names are not identities. LoRA application is generation state, not a
new base-checkpoint cache key. A model may enter the warm set only after the
adapter has restored the reusable base state; retaining a silently patched
model would make a cache hit change image semantics.

Longer term, a bundle may reference independently managed components such as
text encoders, VAEs, ControlNets, IP-Adapter models, and preprocessors. The
policy therefore stores opaque resource keys and values rather than teaching
the core about Forge checkpoints.

## Core contract

The reusable core owns:

- a byte capacity and deterministic weighted LRU order;
- `loading`, `active`, and `warm` lifecycle states;
- leases that pin resources while work can observe them;
- single-flight loading for the same key;
- explicit disposal on eviction;
- hits, misses, evictions, load failures, byte totals, and over-budget state;
- runtime resizing of the logical budget.

The Forge adapter owns:

- deriving a complete resource key;
- estimating the admission weight before a cold load;
- measuring unique resident tensor storage after load;
- moving a warm bundle to CPU and restoring it to its requested device;
- normalizing transient patches before release;
- proving that disposal actually releases its references;
- comparing logical eviction with RSS and allocator behavior.

The inference scheduler owns admission order. A lease says “this work still
uses this resource”; it is not a priority system and must not become a second
job queue.

## First integration seam

`modules.sd_models.forge_model_reload()` is the current checkpoint-replacement
seam. Today it clears `model_data.sd_model`, unloads the current device models,
empties caches, runs collection, and reconstructs the requested checkpoint.
The first adapter will replace that destructive switch with:

1. release and normalize the prior active bundle, making it warm;
2. acquire the requested resource key;
3. on a warm hit, restore its device residency through existing Forge patchers;
4. on a miss, evict warm victims, then run `forge_loader` once;
5. retain the new active lease until the next switch or shutdown.

There will not be a legacy/new toggle. Git preserves the old behavior. If the
adapter cannot prove semantic equivalence and bounded residency, it is not
ready to replace the seam.

## Evidence sequence

The first live evaluation uses an otherwise clean Forge process:

1. record idle RSS and VRAM;
2. load Flux and render one fixed recipe;
3. switch to SDXL and render a fixed recipe;
4. switch back to the same Flux identity;
5. prove the second Flux acquisition is a cache hit and does not reread the
   checkpoint payload;
6. compare switch latency and output metadata with the cold path;
7. admit enough synthetic or real resources to force eviction and prove the
   oldest warm entry leaves first;
8. prove an actively leased entry is never selected;
9. compare logical bytes, process RSS, and VRAM after each transition;
10. if RSS fails to fall after logical eviction, record an allocator or
    retained-reference defect rather than increasing the budget to hide it.

Policy unit tests precede this live sequence. A live service restart is a
separate operator-visible effect and is not implied by landing the policy.
