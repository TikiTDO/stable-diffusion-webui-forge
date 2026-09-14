import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from diffusatory.server.lora_catalog import (
    LoraDefaults,
    LoraKeyword,
    build_lora_item,
    find_registered_lora,
    lora_id,
    save_lora_defaults,
)


class DiffusatoryLoraCatalogTests(unittest.TestCase):
    def network(self, path: Path, **overrides):
        values = {
            "name": "poses/quiet-turn",
            "alias": "quiet-turn",
            "filename": str(path),
            "metadata": {
                "ss_base_model_version": "sdxl_base_v1-0",
                "ss_tag_frequency": {
                    "set": {"quiet turn": 12, "profile": 5},
                },
            },
            "sd_version": SimpleNamespace(name="SDXL"),
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_builds_compact_catalog_from_download_and_forge_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "poses" / "quiet-turn.safetensors"
            model.parent.mkdir()
            model.write_bytes(b"weights")
            model.with_suffix(".png").write_bytes(b"preview")
            model.with_suffix(".metadata.json").write_text(
                json.dumps(
                    {
                        "base_model": "Pony",
                        "modelDescription": "A useful pose adapter.",
                        "tags": ["pose", "subtle"],
                        "civitai": {"trainedWords": ["quiet turn", "profile"]},
                    }
                )
            )
            model.with_suffix(".json").write_text(
                json.dumps(
                    {
                        "activation text": "<lora:quiet-turn:0.8>, quiet turn, (profile:1.2)",
                        "preferred weight": 0.8,
                    }
                )
            )

            item = build_lora_item(self.network(model), root)

            self.assertEqual(item.model_family, "sdxl")
            self.assertEqual(item.relative_path, "poses/quiet-turn.safetensors")
            self.assertEqual(item.folders, ["poses"])
            self.assertEqual(item.defaults.preferred_strength, 0.8)
            self.assertEqual(
                [keyword.model_dump() for keyword in item.defaults.keywords],
                [
                    {"text": "quiet turn", "weight": 1.0, "enabled": True},
                    {"text": "profile", "weight": 1.2, "enabled": True},
                ],
            )
            self.assertIn("subtle", item.tags)
            self.assertIn("profile", item.tags)
            self.assertIn(item.id, item.preview_url)
            self.assertNotIn(str(root), item.model_dump_json())

    def test_native_defaults_override_sources_and_write_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "light.safetensors"
            model.write_bytes(b"weights")
            network = self.network(model)
            defaults = LoraDefaults(
                description="Soft rim light",
                model_family="flux",
                preferred_strength=0.65,
                keywords=[LoraKeyword(text="rim light", weight=1.15)],
                notes="Keep subtle.",
            )

            save_lora_defaults(network, defaults)
            item = build_lora_item(network, root)

            self.assertEqual(item.defaults, defaults)
            sidecar = model.with_suffix(".diffusatory.json")
            self.assertEqual(json.loads(sidecar.read_text())["schema_version"], 1)
            self.assertEqual(list(root.glob(".*.tmp")), [])

    def test_downloader_prompt_is_split_without_conflating_adapter_strength(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "dead-lift.safetensors"
            model.write_bytes(b"weights")
            model.with_suffix(".metadata.json").write_text(
                json.dumps(
                    {
                        "civitai": {
                            "trainedWords": [
                                "<lora:dead-lift:0.7>, dead lift, holding, barbell,",
                                "BREATH, {FIRE, FROM ABOVE | WATER, FROM BELOW}",
                            ]
                        }
                    }
                )
            )

            item = build_lora_item(self.network(model), root)

            self.assertEqual(
                item.recommended_keywords,
                [
                    "dead lift",
                    "holding",
                    "barbell",
                    "BREATH",
                    "{FIRE, FROM ABOVE | WATER, FROM BELOW}",
                ],
            )
            self.assertEqual(
                [keyword.text for keyword in item.defaults.keywords],
                [
                    "dead lift",
                    "holding",
                    "barbell",
                    "BREATH",
                    "{FIRE, FROM ABOVE | WATER, FROM BELOW}",
                ],
            )
            self.assertEqual(item.defaults.preferred_strength, 1.0)

    def test_opaque_id_resolves_only_a_registered_model(self):
        one = self.network(Path("/tmp/one.safetensors"))
        two = self.network(Path("/tmp/two.safetensors"), name="two")
        self.assertIs(find_registered_lora([one, two], lora_id(two.filename)), two)
        self.assertIsNone(find_registered_lora([one], "not-an-id"))


if __name__ == "__main__":
    unittest.main()
