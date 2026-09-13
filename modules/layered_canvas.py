"""Pure image operations for the Diffusatory img2img canvas.

The browser editor owns three distinct things: an immutable source image, a
colour paint layer, and an inpaint-selection layer.  Generation deliberately
does not use Gradio's flattened ``composite`` because that also contains the
visible mask layer.
"""

from __future__ import annotations

from typing import Any

from PIL import Image


PAINT_LAYER = 0
MASK_LAYER = 1
LAYER_COUNT = 2


def _rgba(image: Image.Image) -> Image.Image:
    return image.convert("RGBA")


def _background(editor: Any) -> Image.Image | None:
    if isinstance(editor, Image.Image):
        return _rgba(editor)
    if not isinstance(editor, dict):
        return None
    image = editor.get("background")
    return _rgba(image) if isinstance(image, Image.Image) else None


def _transparent(size: tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", size, (0, 0, 0, 0))


def _layers(editor: Any, size: tuple[int, int]) -> list[Image.Image]:
    supplied = editor.get("layers", []) if isinstance(editor, dict) else []
    layers: list[Image.Image] = []
    for index in range(LAYER_COUNT):
        layer = supplied[index] if index < len(supplied) else None
        if not isinstance(layer, Image.Image):
            layers.append(_transparent(size))
            continue
        layer = _rgba(layer)
        if layer.size != size:
            layer = layer.resize(size, Image.Resampling.LANCZOS)
        layers.append(layer)
    return layers


def _editor_value(background: Image.Image, layers: list[Image.Image]) -> dict[str, Any]:
    composite = background.copy()
    for layer in layers:
        composite = Image.alpha_composite(composite, layer)
    return {"background": background, "layers": layers, "composite": composite}


def source_and_paint(editor: Any) -> Image.Image:
    """Return the img2img source with paint applied, but never the visible mask."""
    background = _background(editor)
    if background is None:
        raise ValueError("Add a source image before generating.")
    paint, _mask = _layers(editor, background.size)
    return Image.alpha_composite(background, paint)


def inpaint_mask(editor: Any) -> Image.Image:
    """Return the selection layer as an RGBA black/white inpaint mask."""
    background = _background(editor)
    if background is None:
        raise ValueError("Add a source image before generating.")
    _paint, selection = _layers(editor, background.size)
    alpha = selection.getchannel("A")
    return Image.merge("RGBA", (alpha, alpha, alpha, Image.new("L", alpha.size, 255)))


def editor_dimensions(editor: Any) -> tuple[int, int]:
    background = _background(editor)
    return background.size if background is not None else (0, 0)


def clear_layer(editor: Any, layer_index: int) -> Any:
    background = _background(editor)
    if background is None:
        return editor
    layers = _layers(editor, background.size)
    layers[layer_index] = _transparent(background.size)
    return _editor_value(background, layers)


def clear_paint(editor: Any) -> Any:
    return clear_layer(editor, PAINT_LAYER)


def clear_mask(editor: Any) -> Any:
    return clear_layer(editor, MASK_LAYER)


def mask_from_paint(editor: Any) -> Any:
    """Copy paint coverage into the selection layer without changing the paint."""
    background = _background(editor)
    if background is None:
        return editor
    layers = _layers(editor, background.size)
    alpha = layers[PAINT_LAYER].getchannel("A")
    layers[MASK_LAYER] = Image.new("RGBA", background.size, "white")
    layers[MASK_LAYER].putalpha(alpha)
    return _editor_value(background, layers)
