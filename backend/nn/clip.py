import torch


class TextModelShell(torch.nn.Module):
    """
    transformers 5 flattened `CLIPTextModel`: its `embeddings`, `encoder` and `final_layer_norm`
    hang directly off the model, where transformers 4 kept them under `text_model`. Every
    checkpoint on disk, Forge's state-dict mapping, and the text-processing engines all speak the
    `transformer.text_model.*` layout, so the model is held under a `text_model` attribute here
    and the shell forwards as the model would. The parameter names come out identical to the
    transformers 4 layout, which is the point.
    """

    def __init__(self, text_model):
        super().__init__()
        self.text_model = text_model

    def forward(self, *args, **kwargs):
        return self.text_model(*args, **kwargs)


class IntegratedCLIP(torch.nn.Module):
    def __init__(self, cls, config, add_text_projection=False):
        super().__init__()
        model = cls(config)
        self.transformer = model if hasattr(model, 'text_model') else TextModelShell(model)
        self.logit_scale = torch.nn.Parameter(torch.tensor(4.6055))

        if add_text_projection:
            embed_dim = config.hidden_size
            self.transformer.text_projection = torch.nn.Linear(embed_dim, embed_dim, bias=False)
