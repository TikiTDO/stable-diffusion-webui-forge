#!/usr/bin/env python3
"""Focused executable check for the Diffusatory model-family boundary."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import modules.paths  # noqa: E402, F401 - installs Forge's repository import paths

from backend.loader import select_model_engine  # noqa: E402
from huggingface_guess import model_list  # noqa: E402


EXPECTED_ENGINES = {
    model_list.SD15: None,
    model_list.SD20: None,
    model_list.SDXL: "StableDiffusionXL",
    model_list.SDXLRefiner: "StableDiffusionXLRefiner",
    model_list.Flux: "Flux",
}

REMOVED_PATHS = (
    "backend/diffusion_engine/sd15.py",
    "backend/diffusion_engine/sd20.py",
    "backend/huggingface/runwayml/stable-diffusion-v1-5",
    "backend/huggingface/runwayml/stable-diffusion-inpainting",
    "backend/huggingface/stabilityai/stable-diffusion-2-1",
    "backend/huggingface/stabilityai/stable-diffusion-2-inpainting",
    "backend/huggingface/lllyasviel/control_v11p_sd15_canny",
    "extensions-builtin/forge_space_iclight",
    "extensions-builtin/forge_space_illusion_diffusion",
    "models/VAE-approx/model.pt",
)


def main() -> int:
    failures = []

    for guess_type, expected_name in EXPECTED_ENGINES.items():
        selected = select_model_engine(guess_type({}))
        actual_name = None if selected is None else selected.__name__
        if actual_name != expected_name:
            failures.append(
                f"{guess_type.__name__}: expected {expected_name!r}, got {actual_name!r}"
            )

    for relative_path in REMOVED_PATHS:
        if (ROOT / relative_path).exists():
            failures.append(f"legacy path still exists: {relative_path}")

    if failures:
        print("model-family scope: FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("model-family scope: SD1/SD2 absent; SDXL/Flux selected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
