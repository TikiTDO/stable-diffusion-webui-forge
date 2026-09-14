from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, Literal, Protocol

from pydantic import BaseModel
from safetensors import safe_open


ModelFamily = Literal["flux", "sdxl", "unknown"]
ComponentMode = Literal["integrated", "external", "unknown"]
SpeedProfile = Literal["four-step", "standard"]


class CheckpointLike(Protocol):
    title: str
    filename: str


class ModelDefaults(BaseModel):
    steps: int
    sampler: str
    scheduler: str
    cfg_scale: float
    distilled_cfg_scale: float | None = None
    preview_every: int = 5


class ModelProfile(BaseModel):
    checkpoint: str
    family: ModelFamily
    component_mode: ComponentMode
    speed_profile: SpeedProfile
    recommended_modules: list[str]
    defaults: ModelDefaults


FLUX_COMPONENTS = [
    "clip_l.safetensors",
    "t5xxl_fp8_e4m3fn.safetensors",
    "diffusion_pytorch_model.safetensors",
]


def _compact_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def _flux_defaults(name: str, four_step: bool) -> ModelDefaults:
    """Return a coherent starting recipe for the installed Flux checkpoint.

    These are model recipes, not universal quality rankings.  Keep the match
    narrow so an unrelated checkpoint never inherits settings just because it
    happens to be Flux.
    """
    compact = _compact_name(name)
    if "c4pacitorxv1" in compact:
        return ModelDefaults(
            steps=42,
            sampler="DEIS",
            scheduler="Beta",
            cfg_scale=1,
            distilled_cfg_scale=3.5,
            preview_every=5,
        )
    if "redcrafthybridh3krea2dualreveal5sfwultra" in compact:
        return ModelDefaults(
            steps=15,
            sampler="DPM++ 2M",
            scheduler="SGM Uniform",
            cfg_scale=1,
            distilled_cfg_scale=3.5,
            preview_every=3,
        )
    if "ultrarealfinetunev4" in compact:
        return ModelDefaults(
            steps=35,
            sampler="DPM++ 2M",
            scheduler="Beta",
            cfg_scale=1,
            distilled_cfg_scale=3,
            preview_every=5,
        )
    return ModelDefaults(
        steps=4 if four_step else 20,
        sampler="Euler",
        scheduler="Simple",
        cfg_scale=1,
        distilled_cfg_scale=3.5,
        preview_every=1 if four_step else 5,
    )


def _checkpoint_keys(filename: str) -> list[str]:
    path = Path(filename)
    if path.suffix.lower() != ".safetensors" or not path.is_file():
        return []
    # ``safe_open`` reads the small tensor index, not the tensor payload. This
    # lets the catalog describe a 12 GB checkpoint without loading 12 GB.
    with safe_open(str(path), framework="pt", device="cpu") as checkpoint:
        return list(checkpoint.keys())


def _family(keys: Iterable[str], name: str) -> ModelFamily:
    keys = tuple(keys)
    if any(
        key.startswith("double_blocks.")
        or key.startswith("model.diffusion_model.double_blocks.")
        for key in keys
    ):
        return "flux"
    if any(key.startswith("conditioner.embedders.") for key in keys) and any(
        key.startswith("model.diffusion_model.") for key in keys
    ):
        return "sdxl"

    lowered = name.lower()
    if "flux" in lowered or "schnell" in lowered:
        return "flux"
    if "sdxl" in lowered or "illustrious" in lowered or "pony" in lowered:
        return "sdxl"
    return "unknown"


def _is_four_step(name: str) -> bool:
    compact = _compact_name(name)
    return (
        "4steps" in compact
        or "foursteps" in compact
        or "schnell" in compact
    )


def profile_checkpoint(checkpoint: CheckpointLike) -> ModelProfile:
    keys = _checkpoint_keys(checkpoint.filename)
    family = _family(keys, checkpoint.title)
    four_step = _is_four_step(checkpoint.title)

    if family == "flux":
        integrated = any(key.startswith("text_encoders.") for key in keys) and any(
            key.startswith("vae.") for key in keys
        )
        component_mode: ComponentMode = "integrated" if integrated else "external"
        modules = [] if integrated else FLUX_COMPONENTS.copy()
        defaults = _flux_defaults(checkpoint.title, four_step)
    elif family == "sdxl":
        component_mode = "integrated"
        modules = []
        defaults = ModelDefaults(
            steps=20,
            sampler="Euler a",
            scheduler="Karras",
            cfg_scale=5,
            preview_every=5,
        )
    else:
        component_mode = "unknown"
        modules = []
        defaults = ModelDefaults(
            steps=20,
            sampler="Euler a",
            scheduler="Karras",
            cfg_scale=5,
            preview_every=5,
        )

    return ModelProfile(
        checkpoint=checkpoint.title,
        family=family,
        component_mode=component_mode,
        speed_profile="four-step" if four_step else "standard",
        recommended_modules=modules,
        defaults=defaults,
    )


def model_profiles(checkpoints: Iterable[CheckpointLike]) -> list[ModelProfile]:
    return [profile_checkpoint(checkpoint) for checkpoint in checkpoints]
