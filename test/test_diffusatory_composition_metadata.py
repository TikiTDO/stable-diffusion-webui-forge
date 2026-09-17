import json
import re
import unittest
from pathlib import Path
from types import SimpleNamespace


class DiffusatoryCompositionMetadataTests(unittest.TestCase):
    def test_api_models_declare_diffusatory_composition(self) -> None:
        models_source = (
            Path(__file__).resolve().parents[1] / "modules" / "api" / "models.py"
        ).read_text(encoding="utf-8")

        self.assertIn('"key": "diffusatory_composition"', models_source)
        # Verify it is declared in both txt2img and img2img definitions
        occurrences = models_source.count('"key": "diffusatory_composition"')
        self.assertGreaterEqual(occurrences, 2)

    def test_composition_dict_serializes_to_extra_generation_params(self) -> None:
        composition = {
            "version": 1,
            "prompt": "blue hour, warm lamps",
            "negativePrompt": "blurry, dark",
            "loras": [
                {
                    "id": "ink-1",
                    "name": "Ink Style",
                    "reference": "ink",
                    "enabled": True,
                    "strength": 0.8,
                    "keywords": [{"text": "ink drawing", "weight": 1.0, "enabled": True}],
                }
            ],
            "regions": {
                "enabled": True,
                "backgroundPrompt": "distant mountains",
            },
        }

        p = SimpleNamespace(
            diffusatory_composition=composition,
            extra_generation_params={},
            sd_model=SimpleNamespace(extra_generation_params={}),
        )

        # Simulate batch process recording in modules.processing
        if getattr(p, "diffusatory_composition", None) is not None:
            comp = getattr(p, "diffusatory_composition")
            if isinstance(comp, (dict, list)):
                p.extra_generation_params["Diffusatory composition"] = json.dumps(comp, ensure_ascii=False)
            elif isinstance(comp, str):
                p.extra_generation_params["Diffusatory composition"] = comp

        self.assertIn("Diffusatory composition", p.extra_generation_params)
        parsed = json.loads(p.extra_generation_params["Diffusatory composition"])
        self.assertEqual(parsed["version"], 1)
        self.assertEqual(parsed["prompt"], "blue hour, warm lamps")
        self.assertEqual(len(parsed["loras"]), 1)
        self.assertEqual(parsed["regions"]["backgroundPrompt"], "distant mountains")

    def test_infotext_regex_recovers_diffusatory_composition(self) -> None:
        re_param_code = r'\s*(\w[\w \-/]+):\s*("(?:\\.|[^\\"])+"|[^,]*)(?:,|$)'
        re_param = re.compile(re_param_code)

        composition = {
            "version": 1,
            "prompt": 'an astronomer with "measured" focus',
            "loras": [],
        }
        comp_json = json.dumps(composition, ensure_ascii=False)
        quoted_comp = json.dumps(comp_json, ensure_ascii=False)

        infotext_line = (
            f"Steps: 20, Sampler: Euler a, CFG scale: 5.0, Seed: 42, "
            f"Diffusatory composition: {quoted_comp}, Size: 1024x1024, Model: test_model"
        )

        extracted = {}
        for k, v in re_param.findall(infotext_line):
            if v.startswith('"') and v.endswith('"'):
                v = json.loads(v)
            extracted[k] = v

        self.assertIn("Diffusatory composition", extracted)
        self.assertEqual(extracted["Steps"], "20")
        self.assertEqual(extracted["Model"], "test_model")

        restored_composition = json.loads(extracted["Diffusatory composition"])
        self.assertEqual(restored_composition["prompt"], 'an astronomer with "measured" focus')


if __name__ == "__main__":
    unittest.main()
