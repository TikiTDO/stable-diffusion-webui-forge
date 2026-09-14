# First model-residency live run

Date: 2026-09-14  
Host: Aurora  
Code head: `4fd7d5535bf2`  
Budget: 64 GiB logical model residency

This is the first live evidence for the residency policy described in
[`../design/diffusatory/14-model-residency.md`](../design/diffusatory/14-model-residency.md).
The service was restarted cleanly before the sequence. The former process had
grown to about 123.1 GiB RSS; this run does not by itself identify which prior
allocation or retained reference caused that accumulation.

## Sequence

| Phase | Managed active | Managed warm | Process RSS | Acquisition | Request wall |
| --- | ---: | ---: | ---: | --- | ---: |
| ready, no model | 0 | 0 | 1,357,725,696 B | — | — |
| Flux fixed render | 12,116,120,115 B | 0 | 8,109,264,896 B | cold, 2.21 s loader | 12.52 s |
| SDXL fixed render | 6,937,675,738 B | 12,116,120,115 B | 15,553,662,976 B | cold, 4.74 s loader | 13.35 s |
| same Flux fixed render | 12,116,120,115 B | 6,937,675,738 B | 21,993,091,072 B | warm hit | 8.78 s |

The two managed models total 19,053,795,853 bytes (17.74 GiB), below the
64 GiB budget, so this sequence correctly caused no eviction. The API reported
two misses, one hit, zero evictions, zero load failures, and zero disposal
failures.

Both Flux requests used the same prompt, dimensions, sampler recipe, and seed.
Their decoded 512×512 RGB pixel buffers had the same SHA-256 digest:

```text
5fc10468e9833c9515113860208d31cc3e4d6636fc4fdef457b43ec0e1fe01ed
```

This proves semantic equivalence for that fixed recipe and establishes a real
warm checkpoint hit. It does not prove every LoRA, ControlNet, VAE override,
refiner, or high-resolution path yet.

## Findings

- The clean idle baseline is small; the prior 123.1 GiB was accumulated state,
  not Forge's unavoidable startup footprint.
- The warm hit avoids checkpoint reconstruction and reduced end-to-end request
  time by 3.74 seconds in this sample.
- Warm activation still took about 3.3 seconds in Forge's timer because the
  outgoing model must be offloaded and the requested components restored to
  the GPU. “Warm” means no disk reconstruction, not zero movement.
- Process RSS rose by about 6.0 GiB on the return to Flux even though logical
  residency was unchanged. This is allocator, pinned-memory, or device-movement
  behavior to measure over repeated cycles; the logical ledger must not hide
  it.
- A real eviction remains unexercised. Unit tests cover weighted LRU order and
  active-lease protection, but a later live run must prove RSS response after a
  real model victim is destroyed.

