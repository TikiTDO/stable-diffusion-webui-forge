from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class SpatialFrame(BaseModel):
    width: int = Field(ge=64, le=8192)
    height: int = Field(ge=64, le=8192)


class SpatialPoint(BaseModel):
    x: float
    y: float

    @field_validator("x", "y")
    @classmethod
    def finite_coordinate(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("coordinates must be finite")
        return value


class SpatialTransform(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    center_x: float = Field(alias="centerX")
    center_y: float = Field(alias="centerY")
    width: float = Field(gt=0, le=4)
    height: float = Field(gt=0, le=4)
    rotation: float = Field(ge=-360, le=360)

    @field_validator("center_x", "center_y")
    @classmethod
    def finite_center(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("transform coordinates must be finite")
        return value


class SpatialCell(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    row: int = Field(default=0, ge=0, le=64)
    column: int = Field(default=0, ge=0, le=64)
    prompt: str = Field(default="", max_length=8000)
    polygon: list[SpatialPoint] = Field(min_length=4, max_length=4)
    start: float = Field(default=0.0, ge=0.0, le=1.0)
    end: float = Field(default=1.0, ge=0.0, le=1.0)

    @field_validator("prompt")
    @classmethod
    def no_local_extra_networks(cls, value: str) -> str:
        if re.search(r"<\w+:[^>]+>", value):
            raise ValueError(
                "region prompts cannot contain LoRA or other extra-network tags; "
                "put global model-weight tags in the common prompt"
            )
        return value


class SpatialBackground(BaseModel):
    enabled: bool = False
    prompt: str = Field(default="", max_length=8000)
    start: float = Field(default=0.0, ge=0.0, le=1.0)
    end: float = Field(default=1.0, ge=0.0, le=1.0)

    @field_validator("prompt")
    @classmethod
    def no_local_extra_networks(cls, value: str) -> str:
        return SpatialCell.no_local_extra_networks(value)


class SpatialConditioningPlan(BaseModel):
    """A resolved, image-space conditioning plan supplied by Diffusatory.

    Coordinates are expressed in pixels in ``frame``. The sampler adapter
    scales them to the model's actual latent dimensions, so the same plan is
    stable across SDXL and Flux latent downsampling details.
    """

    model_config = ConfigDict(populate_by_name=True)

    version: Literal[1] = 1
    frame: SpatialFrame
    transform: SpatialTransform
    softness_pixels: float = Field(alias="softnessPixels", ge=0, le=4096)
    cells: list[SpatialCell] = Field(min_length=1, max_length=16)
    background: SpatialBackground = Field(default_factory=SpatialBackground)

    @model_validator(mode="after")
    def validate_plan(self) -> "SpatialConditioningPlan":
        ids = [cell.id for cell in self.cells]
        if len(ids) != len(set(ids)):
            raise ValueError("cell ids must be unique")

        # Rotated or translated grids may cross the frame edge, but absurdly
        # distant coordinates are almost certainly a corrupt request and can
        # make rasterization unexpectedly expensive in some Pillow versions.
        x_limit = self.frame.width * 4
        y_limit = self.frame.height * 4
        for cell in self.cells:
            for point in cell.polygon:
                if not -x_limit <= point.x <= x_limit * 2:
                    raise ValueError(f"cell {cell.id} has an out-of-range x coordinate")
                if not -y_limit <= point.y <= y_limit * 2:
                    raise ValueError(f"cell {cell.id} has an out-of-range y coordinate")
        return self


def compose_prompt(common_prompt: str, fragment: str) -> str:
    common = common_prompt.strip().strip(",").strip()
    local = fragment.strip().strip(",").strip()
    if common and local:
        return f"{common}, {local}"
    return common or local


@dataclass(frozen=True)
class SpatialCondition:
    id: str
    prompts: tuple[str, ...]
    polygon: tuple[tuple[float, float], ...] | None
    start: float = 0.0
    end: float = 1.0


@dataclass
class SpatialRuntime:
    plan: SpatialConditioningPlan
    conditions: tuple[SpatialCondition, ...]
    learned_conditions: tuple[object, ...]
    _mask_cache: dict[tuple[int, int], tuple[torch.Tensor, ...]] = field(default_factory=dict)

    def masks(self, latent_width: int, latent_height: int) -> tuple[torch.Tensor, ...]:
        key = (latent_width, latent_height)
        cached = self._mask_cache.get(key)
        if cached is None:
            cached = rasterize_masks(self.plan, latent_width, latent_height)
            self._mask_cache[key] = cached
        return cached


def resolve_conditions(
    plan: SpatialConditioningPlan,
    common_prompts: list[str],
) -> tuple[SpatialCondition, ...]:
    cells = [
        SpatialCondition(
            id=cell.id,
            prompts=tuple(compose_prompt(prompt, cell.prompt) for prompt in common_prompts),
            polygon=tuple((point.x, point.y) for point in cell.polygon),
            start=cell.start,
            end=cell.end,
        )
        for cell in plan.cells
    ]
    background_fragment = plan.background.prompt if plan.background.enabled else ""
    cells.append(
        SpatialCondition(
            id="background",
            prompts=tuple(compose_prompt(prompt, background_fragment) for prompt in common_prompts),
            polygon=None,
            start=plan.background.start,
            end=plan.background.end,
        )
    )
    return tuple(cells)


def _polygon_mask(
    plan: SpatialConditioningPlan,
    polygon: tuple[tuple[float, float], ...],
    latent_width: int,
    latent_height: int,
) -> np.ndarray:
    scale_x = latent_width / plan.frame.width
    scale_y = latent_height / plan.frame.height
    points = [(x * scale_x, y * scale_y) for x, y in polygon]
    mask = Image.new("L", (latent_width, latent_height), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    blur = plan.softness_pixels * min(scale_x, scale_y)
    if blur > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=blur))
    return np.asarray(mask, dtype=np.float32) / 255.0


def rasterize_masks(
    plan: SpatialConditioningPlan,
    latent_width: int,
    latent_height: int,
) -> tuple[torch.Tensor, ...]:
    if latent_width < 1 or latent_height < 1:
        raise ValueError("latent dimensions must be positive")

    foreground = [
        _polygon_mask(
            plan,
            tuple((point.x, point.y) for point in cell.polygon),
            latent_width,
            latent_height,
        )
        for cell in plan.cells
    ]
    occupied = np.clip(np.sum(foreground, axis=0), 0.0, 1.0)
    background = 1.0 - occupied
    return tuple(
        torch.from_numpy(np.ascontiguousarray(mask)).unsqueeze(0)
        for mask in (*foreground, background)
    )


def prepare_spatial_runtime(process) -> SpatialRuntime | None:
    """Compile prompt conditionings once per generation batch.

    This deliberately runs after Forge has parsed and activated the common
    prompt's extra networks. Region-local LoRA tags are not a meaningful
    spatial operation: model weights are global, so LoRAs belong in the common
    prompt instead.
    """

    plan = getattr(process, "diffusatory_spatial_plan", None)
    if plan is None:
        return None
    if not isinstance(plan, SpatialConditioningPlan):
        plan = SpatialConditioningPlan.model_validate(plan)

    if getattr(process, "enable_hr", False):
        raise ValueError("Diffusatory spatial conditioning does not yet support Hires.fix")

    from modules import devices, extra_networks, prompt_parser, shared

    conditions = resolve_conditions(plan, list(process.prompts))
    for condition in conditions:
        for prompt in condition.prompts:
            _, extra_data = extra_networks.parse_prompt(prompt)
            if extra_data:
                raise ValueError(
                    "Region prompts cannot contain LoRA or other extra-network tags; "
                    "put them in the common prompt so their global model effect is explicit"
                )

    sampler_steps = getattr(process, "firstpass_steps", process.steps)
    sd_conditions = [
        prompt_parser.SdConditioning(
            list(condition.prompts),
            width=process.width,
            height=process.height,
            distilled_cfg_scale=process.distilled_cfg_scale,
        )
        for condition in conditions
    ]
    with devices.autocast():
        learned = tuple(
            prompt_parser.get_multicond_learned_conditioning(
                process.sd_model,
                prompts,
                sampler_steps,
                None,
                shared.opts.use_old_scheduling,
            )
            for prompts in sd_conditions
        )

    runtime = SpatialRuntime(plan=plan, conditions=conditions, learned_conditions=learned)
    process._diffusatory_spatial_runtime = runtime
    process.extra_generation_params["Diffusatory spatial plan"] = (
        f"v{plan.version}; {len(plan.cells)} regions; softness {plan.softness_pixels:g}px"
    )
    return runtime


def _copy_runtime_conditioning(base: list[dict], regional: list[dict]) -> list[dict]:
    """Carry model-global conditioning added before this modifier.

    Forge attaches image conditioning and ControlNet after compiling the main
    text prompt. Regional text replaces that text prompt, but those model-global
    additions must remain on every masked condition.
    """

    if not base:
        return regional
    exemplar = base[0]
    text_keys = {"c_crossattn", "y", "guidance"}
    inherited_model_conds = {
        key: value
        for key, value in exemplar.get("model_conds", {}).items()
        if key not in text_keys
    }
    inherited_outer = {
        key: value
        for key, value in exemplar.items()
        if key not in {"cross_attn", "pooled_output", "model_conds", "strength", "mask", "mask_strength", "area"}
    }
    for item in regional:
        item.update(inherited_outer)
        item["model_conds"].update(inherited_model_conds)
    return regional


def _spatial_conditioning_modifier(process, runtime: SpatialRuntime):
    from backend.sampling.condition import compile_weighted_conditions
    from modules import prompt_parser

    def modifier(model, x, timestep, uncond, cond, cond_scale, model_options, seed):
        step = getattr(getattr(process.sampler, "model_wrap_cfg", None), "step", 0)
        total_steps = getattr(process, "steps", 20) or 20
        step_fraction = step / max(1, total_steps)
        masks = runtime.masks(x.shape[3], x.shape[2])

        foreground_conditions = runtime.conditions[:-1]
        foreground_learned = runtime.learned_conditions[:-1]
        foreground_masks = masks[:-1]
        bg_condition = runtime.conditions[-1]
        bg_learned = runtime.learned_conditions[-1]
        bg_mask = masks[-1]

        active_fg_masks = []
        regional_conditions: list[dict] = []

        for condition, learned, mask in zip(foreground_conditions, foreground_learned, foreground_masks):
            if not (condition.start <= step_fraction <= condition.end):
                continue
            if not torch.any(mask):
                continue
            active_fg_masks.append(mask)
            composition, reconstructed = prompt_parser.reconstruct_multicond_batch(learned, step)
            compiled = compile_weighted_conditions(reconstructed, composition)
            compiled = _copy_runtime_conditioning(cond, compiled)
            device_mask = mask.to(device=x.device, dtype=x.dtype)
            for item in compiled:
                item["mask"] = device_mask
            regional_conditions.extend(compiled)

        if bg_condition.start <= step_fraction <= bg_condition.end:
            if active_fg_masks:
                occupied = torch.clamp(torch.sum(torch.stack(active_fg_masks), dim=0), 0.0, 1.0)
                step_bg_mask = 1.0 - occupied
            else:
                step_bg_mask = torch.ones_like(bg_mask)

            if torch.any(step_bg_mask > 0):
                composition, reconstructed = prompt_parser.reconstruct_multicond_batch(bg_learned, step)
                compiled = compile_weighted_conditions(reconstructed, composition)
                compiled = _copy_runtime_conditioning(cond, compiled)
                device_bg_mask = step_bg_mask.to(device=x.device, dtype=x.dtype)
                for item in compiled:
                    item["mask"] = device_bg_mask
                regional_conditions.extend(compiled)

        if not regional_conditions:
            return model, x, timestep, uncond, cond, cond_scale, model_options, seed

        # Forge interprets the sum of every conditional entry's strength as an
        # additional global CFG multiplier. Spatial entries are alternatives
        # over pixels, not additional whole-image prompt weight, so normalize
        # their global sum while preserving all within-pixel blend ratios.
        total_strength = sum(item.get("strength", 1.0) for item in regional_conditions)
        if total_strength > 0:
            for item in regional_conditions:
                item["strength"] = item.get("strength", 1.0) / total_strength
        return model, x, timestep, uncond, regional_conditions, cond_scale, model_options, seed

    return modifier


def install_spatial_runtime(process) -> None:
    runtime = getattr(process, "_diffusatory_spatial_runtime", None)
    if runtime is None:
        return
    unet = process.sd_model.forge_objects.unet.clone()
    unet.add_conditioning_modifier(_spatial_conditioning_modifier(process, runtime))
    process.sd_model.forge_objects.unet = unet
