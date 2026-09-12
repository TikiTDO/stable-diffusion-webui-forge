import torch


class _CLIPTextModelLegacyLayout(torch.nn.Module):
    """Keep Forge's stable ``text_model`` path across Transformers releases."""

    def __init__(self, text_model):
        super().__init__()
        self.text_model = text_model

    def forward(self, *args, **kwargs):
        return self.text_model(*args, **kwargs)


class IntegratedCLIP(torch.nn.Module):
    def __init__(self, cls, config, add_text_projection=False):
        super().__init__()
        self.transformer = cls(config)

        # Transformers 5 flattened CLIPTextModel while Forge's loaders and
        # processing engine intentionally use the earlier text_model layout.
        # Wrap only the flattened variant so checkpoint keys and runtime paths
        # remain stable without imposing a Transformers version ceiling.
        if not hasattr(self.transformer, "text_model"):
            self.transformer = _CLIPTextModelLegacyLayout(self.transformer)

        self.logit_scale = torch.nn.Parameter(torch.tensor(4.6055))

        if add_text_projection:
            embed_dim = config.hidden_size
            self.transformer.text_projection = torch.nn.Linear(embed_dim, embed_dim, bias=False)
