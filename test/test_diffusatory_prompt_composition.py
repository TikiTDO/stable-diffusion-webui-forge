import tempfile
import unittest
from pathlib import Path

from diffusatory.server.prompt_composition import (
    PromptExpansionRequest,
    compile_prompt_expansion,
)


class PromptCompositionTests(unittest.TestCase):
    def compile(
        self,
        root: Path,
        **values,
    ):
        return compile_prompt_expansion(
            PromptExpansionRequest(**values),
            wildcard_root=root,
        )

    def test_off_mode_preserves_the_source_for_every_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = self.compile(
                Path(directory),
                prompt="literal {day|night}",
                negative_prompt="noise",
                mode="off",
                candidate_count=2,
                expansion_seed=9,
            )

        self.assertEqual(2, result.resolved_count)
        self.assertEqual(
            ["literal {day|night}", "literal {day|night}"],
            [item.prompt for item in result.realizations],
        )
        self.assertFalse(result.issues)

    def test_random_mode_is_deterministic_for_an_explicit_seed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "weather.txt").write_text("rain\nsnow\n", encoding="utf-8")
            request = {
                "prompt": "{near|far} under __weather__",
                "negative_prompt": "{blur|noise}",
                "mode": "random",
                "candidate_count": 4,
                "expansion_seed": 77,
            }

            first = self.compile(root, **request)
            second = self.compile(root, **request)

        self.assertEqual(first.realizations, second.realizations)
        self.assertEqual(4, first.resolved_count)
        self.assertFalse(first.issues)

    def test_random_mode_represents_an_empty_negative_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = self.compile(
                Path(directory),
                prompt="{near|far}",
                negative_prompt="",
                mode="random",
                candidate_count=3,
                expansion_seed=12,
            )

        self.assertEqual(3, result.resolved_count)
        self.assertEqual(
            ["", "", ""],
            [item.negative_prompt for item in result.realizations],
        )
        self.assertFalse(result.issues)

    def test_exhaustive_mode_crosses_prompt_and_negative_branches(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = self.compile(
                Path(directory),
                prompt="{red|blue}",
                negative_prompt="{day|night}",
                mode="exhaustive",
                candidate_count=8,
                expansion_seed=1,
            )

        self.assertEqual(
            [
                ("red", "day"),
                ("red", "night"),
                ("blue", "day"),
                ("blue", "night"),
            ],
            [(item.prompt, item.negative_prompt) for item in result.realizations],
        )
        self.assertFalse(result.truncated)

    def test_exhaustive_mode_reports_when_the_candidate_cap_truncates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = self.compile(
                Path(directory),
                prompt="{red|green|blue}",
                mode="exhaustive",
                candidate_count=2,
                expansion_seed=1,
            )

        self.assertEqual(2, result.resolved_count)
        self.assertTrue(result.truncated)

    def test_missing_and_nested_missing_wildcards_block_generation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "outer.txt").write_text("__missing__\n", encoding="utf-8")
            result = self.compile(
                root,
                prompt="portrait of __outer__",
                mode="random",
                candidate_count=2,
                expansion_seed=1,
            )

        self.assertEqual(0, result.resolved_count)
        self.assertEqual(["missing-wildcard"], [issue.code for issue in result.issues])
        self.assertIn("__missing__", result.issues[0].message)

    def test_wildcard_reference_cannot_escape_the_owned_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "wildcards"
            root.mkdir()
            (parent / "outside.txt").write_text("not reachable\n", encoding="utf-8")
            result = self.compile(
                root,
                prompt="__../outside__",
                mode="random",
                candidate_count=1,
                expansion_seed=1,
            )

        self.assertEqual(0, result.resolved_count)
        self.assertEqual("invalid-wildcard", result.issues[0].code)

    def test_invalid_template_becomes_a_field_specific_issue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = self.compile(
                Path(directory),
                prompt="{unfinished",
                negative_prompt="{noise|blur}",
                mode="random",
                candidate_count=2,
                expansion_seed=1,
            )

        self.assertEqual(0, result.resolved_count)
        self.assertEqual("invalid-template", result.issues[0].code)
        self.assertEqual("prompt", result.issues[0].field)


if __name__ == "__main__":
    unittest.main()
