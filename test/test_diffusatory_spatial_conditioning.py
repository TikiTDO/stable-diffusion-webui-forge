import math
import unittest
from types import SimpleNamespace

import torch
from pydantic import ValidationError

from diffusatory.server.spatial_conditioning import (
    SpatialConditioningPlan,
    SpatialRuntime,
    _spatial_conditioning_modifier,
    compose_prompt,
    rasterize_masks,
    resolve_conditions,
)


def two_column_plan(*, softness: float = 0) -> SpatialConditioningPlan:
    return SpatialConditioningPlan.model_validate(
        {
            "version": 1,
            "frame": {"width": 100, "height": 100},
            "transform": {
                "centerX": 0.5,
                "centerY": 0.5,
                "width": 1,
                "height": 1,
                "rotation": 0,
            },
            "softnessPixels": softness,
            "cells": [
                {
                    "id": "left",
                    "row": 0,
                    "column": 0,
                    "prompt": "red coat",
                    "polygon": [
                        {"x": 0, "y": 0},
                        {"x": 50, "y": 0},
                        {"x": 50, "y": 100},
                        {"x": 0, "y": 100},
                    ],
                },
                {
                    "id": "right",
                    "row": 0,
                    "column": 1,
                    "prompt": "blue coat",
                    "polygon": [
                        {"x": 50, "y": 0},
                        {"x": 100, "y": 0},
                        {"x": 100, "y": 100},
                        {"x": 50, "y": 100},
                    ],
                },
            ],
            "background": {"enabled": True, "prompt": "train station"},
        }
    )


class SpatialConditioningPlanTests(unittest.TestCase):
    def test_common_prompt_is_composed_with_each_region_and_background(self) -> None:
        conditions = resolve_conditions(
            two_column_plan(),
            ["two friends", "two rivals"],
        )

        self.assertEqual(("two friends, red coat", "two rivals, red coat"), conditions[0].prompts)
        self.assertEqual(("two friends, blue coat", "two rivals, blue coat"), conditions[1].prompts)
        self.assertEqual(
            ("two friends, train station", "two rivals, train station"),
            conditions[2].prompts,
        )
        self.assertIsNone(conditions[2].polygon)

    def test_background_without_fragment_still_covers_the_complement(self) -> None:
        plan = two_column_plan()
        plan.background.enabled = False
        conditions = resolve_conditions(plan, ["a shared scene"])

        self.assertEqual(("a shared scene",), conditions[-1].prompts)

    def test_raster_masks_cover_every_latent_pixel(self) -> None:
        masks = rasterize_masks(two_column_plan(softness=8), 32, 24)

        self.assertEqual(3, len(masks))
        self.assertTrue(all(mask.shape == (1, 24, 32) for mask in masks))
        total = torch.stack(masks).sum(dim=0)
        self.assertTrue(torch.all(total >= 1.0))
        self.assertTrue(torch.all(total <= 2.01))
        self.assertTrue(torch.allclose(masks[-1], torch.zeros_like(masks[-1])))

    def test_partial_grid_leaves_a_background_complement(self) -> None:
        payload = two_column_plan().model_dump(by_alias=True)
        payload["cells"] = [
            {
                **payload["cells"][0],
                "polygon": [
                    {"x": 25, "y": 25},
                    {"x": 75, "y": 25},
                    {"x": 75, "y": 75},
                    {"x": 25, "y": 75},
                ],
            }
        ]
        plan = SpatialConditioningPlan.model_validate(payload)
        foreground, background = rasterize_masks(plan, 20, 20)

        self.assertEqual(0, background[0, 10, 10])
        self.assertEqual(1, background[0, 0, 0])
        self.assertEqual(1, foreground[0, 10, 10])

    def test_invalid_coordinates_and_duplicate_ids_fail_at_the_boundary(self) -> None:
        duplicate = two_column_plan().model_dump(by_alias=True)
        duplicate["cells"][1]["id"] = "left"
        with self.assertRaisesRegex(ValidationError, "cell ids must be unique"):
            SpatialConditioningPlan.model_validate(duplicate)

        non_finite = two_column_plan().model_dump(by_alias=True)
        non_finite["cells"][0]["polygon"][0]["x"] = math.inf
        with self.assertRaisesRegex(ValidationError, "coordinates must be finite"):
            SpatialConditioningPlan.model_validate(non_finite)

        local_lora = two_column_plan().model_dump(by_alias=True)
        local_lora["cells"][0]["prompt"] = "red coat <lora:costume:0.8>"
        with self.assertRaisesRegex(ValidationError, "global model-weight tags"):
            SpatialConditioningPlan.model_validate(local_lora)

    def test_prompt_join_does_not_create_empty_commas(self) -> None:
        self.assertEqual("subject", compose_prompt("subject,", ""))
        self.assertEqual("detail", compose_prompt("", ", detail"))

    def test_sampler_modifier_replaces_global_text_and_preserves_global_controls(self) -> None:
        from modules import prompt_parser

        plan = two_column_plan()
        schedules = []
        for value in (1.0, 2.0, 3.0):
            scheduled = prompt_parser.ScheduledPromptConditioning(
                end_at_step=20,
                cond=torch.full((2, 3), value),
            )
            schedules.append(
                prompt_parser.MulticondLearnedConditioning(
                    shape=(1,),
                    batch=[
                        [
                            prompt_parser.ComposableScheduledPromptConditioning(
                                [scheduled]
                            )
                        ]
                    ],
                )
            )
        runtime = SpatialRuntime(
            plan=plan,
            conditions=resolve_conditions(plan, ["scene"]),
            learned_conditions=tuple(schedules),
        )
        process = SimpleNamespace(
            sampler=SimpleNamespace(model_wrap_cfg=SimpleNamespace(step=0))
        )
        modifier = _spatial_conditioning_modifier(process, runtime)
        base_control = object()
        base_concat = object()
        base = [
            {
                "model_conds": {
                    "c_crossattn": object(),
                    "c_concat": base_concat,
                },
                "control": base_control,
            }
        ]

        result = modifier(
            None,
            torch.zeros((1, 4, 12, 16)),
            torch.tensor([1.0]),
            [],
            base,
            5,
            {},
            1,
        )
        regional = result[4]

        # The full-frame test grid has no background complement, so only the
        # two useful regional conditionings survive.
        self.assertEqual(2, len(regional))
        self.assertTrue(all(item["control"] is base_control for item in regional))
        self.assertTrue(
            all(item["model_conds"]["c_concat"] is base_concat for item in regional)
        )
        self.assertTrue(all(item["mask"].shape == (1, 12, 16) for item in regional))
        self.assertAlmostEqual(1.0, sum(item["strength"] for item in regional))
        self.assertTrue(
            all(item["model_conds"]["c_crossattn"] is not base[0]["model_conds"]["c_crossattn"] for item in regional)
        )


if __name__ == "__main__":
    unittest.main()
