"""Compatibility helpers for supported Transformers releases."""

try:
    # Transformers 5 moved initialization helpers out of modeling_utils.
    from transformers.initialization import no_init_weights
except ImportError:  # Transformers 4
    from transformers.modeling_utils import no_init_weights


__all__ = ["no_init_weights"]
