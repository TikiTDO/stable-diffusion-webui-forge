"""
What Forge needs from transformers that moved between major versions.

transformers 5 moved `no_init_weights` out of `modeling_utils` into `initialization`; every
loader here wants the same context manager, so it is imported once, with the older location as
the fallback.
"""

try:
    from transformers.initialization import no_init_weights
except ImportError:  # transformers < 5
    from transformers.modeling_utils import no_init_weights



def _find_pruneable_heads_and_indices(heads, n_heads, head_size, already_pruned_heads):
    """transformers 4's `find_pruneable_heads_and_indices`, dropped in 5; BERT-family `prune_heads` wants it."""
    import torch

    mask = torch.ones(n_heads, head_size)
    heads = set(heads) - already_pruned_heads
    for head in heads:
        head = head - sum(1 if h < head else 0 for h in already_pruned_heads)
        mask[head] = 0
    mask = mask.view(-1).contiguous().eq(1)
    index = torch.arange(len(mask))[mask].long()
    return heads, index


def install_legacy_modeling_utils_names():
    """
    The vendored BLIP (`repositories/BLIP/models/med.py`, a BERT clone pinned years ago) imports
    `apply_chunking_to_forward`, `find_pruneable_heads_and_indices` and `prune_linear_layer` from
    `transformers.modeling_utils`. transformers 4 moved the first and last to `pytorch_utils` and
    5 dropped the middle one. Put them back where BLIP looks, before it is imported.
    """
    import transformers.modeling_utils as modeling_utils
    import transformers.pytorch_utils as pytorch_utils

    for name in ("apply_chunking_to_forward", "prune_linear_layer"):
        if not hasattr(modeling_utils, name):
            setattr(modeling_utils, name, getattr(pytorch_utils, name))
    if not hasattr(modeling_utils, "find_pruneable_heads_and_indices"):
        modeling_utils.find_pruneable_heads_and_indices = getattr(
            pytorch_utils, "find_pruneable_heads_and_indices", _find_pruneable_heads_and_indices
        )


__all__ = ["install_legacy_modeling_utils_names", "no_init_weights"]
