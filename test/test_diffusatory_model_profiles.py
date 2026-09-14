import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

import torch
from safetensors.torch import save_file

from diffusatory.server.model_profiles import profile_checkpoint


@dataclass
class Checkpoint:
    title: str
    filename: str


class ModelProfileTests(unittest.TestCase):
    def checkpoint(self, directory: str, name: str, keys: list[str]) -> Checkpoint:
        path = Path(directory) / name
        save_file({key: torch.zeros(1) for key in keys}, path)
        return Checkpoint(name, str(path))

    def test_component_flux_selects_encoders_vae_and_four_step_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = self.checkpoint(
                directory,
                "fluxFusionV24Steps_fp8.safetensors",
                ["double_blocks.0.img_attn.norm.key_norm.scale"],
            )

            profile = profile_checkpoint(checkpoint)

            self.assertEqual("flux", profile.family)
            self.assertEqual("external", profile.component_mode)
            self.assertEqual("four-step", profile.speed_profile)
            self.assertEqual(4, profile.defaults.steps)
            self.assertEqual("Euler", profile.defaults.sampler)
            self.assertEqual("Simple", profile.defaults.scheduler)
            self.assertEqual(1, profile.defaults.preview_every)
            self.assertEqual(
                [
                    "clip_l.safetensors",
                    "t5xxl_fp8_e4m3fn.safetensors",
                    "diffusion_pytorch_model.safetensors",
                ],
                profile.recommended_modules,
            )

    def test_integrated_flux_does_not_add_external_components(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = self.checkpoint(
                directory,
                "flux-aio.safetensors",
                [
                    "model.diffusion_model.double_blocks.0.img_attn.norm.key_norm.scale",
                    "text_encoders.clip_l.transformer.weight",
                    "vae.decoder.weight",
                ],
            )

            profile = profile_checkpoint(checkpoint)

            self.assertEqual("integrated", profile.component_mode)
            self.assertEqual([], profile.recommended_modules)
            self.assertEqual(20, profile.defaults.steps)
            self.assertEqual(5, profile.defaults.preview_every)

    def test_sdxl_uses_its_own_integrated_components_and_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = self.checkpoint(
                directory,
                "illustration.safetensors",
                [
                    "conditioner.embedders.0.transformer.weight",
                    "model.diffusion_model.input_blocks.0.0.weight",
                    "first_stage_model.decoder.weight",
                ],
            )

            profile = profile_checkpoint(checkpoint)

            self.assertEqual("sdxl", profile.family)
            self.assertEqual("integrated", profile.component_mode)
            self.assertEqual([], profile.recommended_modules)
            self.assertEqual(20, profile.defaults.steps)
            self.assertEqual(5, profile.defaults.cfg_scale)

    def test_installed_flux_finetunes_have_checkpoint_specific_recipes(self) -> None:
        recipes = {
            "c4pacitor_xV1_pruned_fp8.safetensors": (42, "DEIS", "Beta", 3.5),
            "redcraftHybridH3Krea2dual_reveal5SFWULTRA.safetensors": (
                15,
                "DPM++ 2M",
                "SGM Uniform",
                3.5,
            ),
            "ultrarealFineTune_v4_full_fp8.safetensors": (
                35,
                "DPM++ 2M",
                "Beta",
                3,
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            for name, expected in recipes.items():
                with self.subTest(checkpoint=name):
                    checkpoint = self.checkpoint(
                        directory,
                        name,
                        ["double_blocks.0.img_attn.norm.key_norm.scale"],
                    )
                    profile = profile_checkpoint(checkpoint)

                    self.assertEqual("flux", profile.family)
                    self.assertEqual("external", profile.component_mode)
                    self.assertEqual(expected[0], profile.defaults.steps)
                    self.assertEqual(expected[1], profile.defaults.sampler)
                    self.assertEqual(expected[2], profile.defaults.scheduler)
                    self.assertEqual(expected[3], profile.defaults.distilled_cfg_scale)


if __name__ == "__main__":
    unittest.main()
