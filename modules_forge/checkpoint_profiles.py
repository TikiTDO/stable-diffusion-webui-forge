"""Per-checkpoint loading profile: which Forge preset and which additional modules a checkpoint needs.

An API caller who names a checkpoint but not its modules gets a black plate (a Flux checkpoint with no
VAE/text encoders) or an HTTP 500 (a Flux VAE still loaded under an SDXL checkpoint). The caller should
not have to know that. A profile answers it per checkpoint, from the first of:

  1. a sidecar beside the checkpoint: ``<checkpoint file>.diffusatory.json``
     ``{"forge_preset": "flux", "forge_additional_modules": ["ae-flux.safetensors", ...]}``
  2. the built-in table below
  3. a name heuristic (flux → flux; xl / illustrious / pony → xl; else sd), modules empty except
     for a non-all-in-one Flux, which gets the standard three if they exist on disk

Only keys the caller left unset are filled; an explicit value always wins.
"""
import json
import os

from modules import sd_models, shared

FLUX_MODULES = ["ae-flux.safetensors", "clip_l.safetensors", "t5xxl_fp8_e4m3fn.safetensors"]

BUILTIN = {
    "fluxFusionV24StepsGGUFNF4_V2NF4AIO_full_nf4": {"forge_preset": "flux", "forge_additional_modules": []},
    "ultrarealFineTune_v4_full_fp8": {"forge_preset": "flux", "forge_additional_modules": FLUX_MODULES},
    "waiIllustriousSDXL_v160": {"forge_preset": "xl", "forge_additional_modules": []},
}


def _available_modules():
    from modules_forge import main_entry
    if not main_entry.module_list:
        try:
            main_entry.refresh_models()
        except Exception:
            pass
    return set(main_entry.module_list.keys())


def _heuristic(stem: str):
    s = stem.lower()
    if "flux" in s:
        modules = [] if ("aio" in s or "all-in-one" in s) else [m for m in FLUX_MODULES if m in _available_modules()]
        return {"forge_preset": "flux", "forge_additional_modules": modules}
    if any(k in s for k in ("xl", "illustrious", "pony", "sdxl")):
        return {"forge_preset": "xl", "forge_additional_modules": []}
    return {"forge_preset": "sd", "forge_additional_modules": []}


def profile_for(checkpoint_name: str):
    """Return {'forge_preset', 'forge_additional_modules', 'source'} for a checkpoint alias, or None if unknown."""
    info = sd_models.get_closet_checkpoint_match(checkpoint_name) if checkpoint_name else None
    if info is None:
        return None
    stem = os.path.splitext(os.path.basename(info.filename))[0]
    sidecar = info.filename + ".diffusatory.json"
    if os.path.isfile(sidecar):
        try:
            with open(sidecar, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {"forge_preset": data.get("forge_preset"), "forge_additional_modules": data.get("forge_additional_modules"), "source": "sidecar"}
        except Exception as e:
            print(f"[checkpoint_profiles] sidecar unreadable for {stem}: {e}")
    if stem in BUILTIN:
        return {**BUILTIN[stem], "source": "builtin"}
    return {**_heuristic(stem), "source": "heuristic"}


def fill_override_settings(override: dict) -> dict:
    """Fill forge_preset / forge_additional_modules the caller left unset, from the named checkpoint's profile.

    Returns the (possibly empty) dict of what was filled, for logging."""
    if not override or "sd_model_checkpoint" not in override:
        return {}
    profile = profile_for(override.get("sd_model_checkpoint"))
    if profile is None:
        return {}
    filled = {}
    for key in ("forge_preset", "forge_additional_modules"):
        if key not in override and profile.get(key) is not None:
            override[key] = profile[key]
            filled[key] = profile[key]
    if filled:
        print(f"[checkpoint_profiles] {override['sd_model_checkpoint']}: filled {filled} ({profile['source']})")
    return filled
