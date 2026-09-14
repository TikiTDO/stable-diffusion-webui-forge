import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import modules
from fastapi import FastAPI
from fastapi.testclient import TestClient

from diffusatory.server.forge_residency import forge_model_key
from diffusatory.server.mount import mount_diffusatory
from diffusatory.server.residency import ResidencyEntrySnapshot, ResidencySnapshot


def empty_response() -> dict:
    return {}


def add_forge_routes(app: FastAPI) -> None:
    for path, method in (
        ("/sdapi/v1/txt2img", "POST"),
        ("/internal/progress", "POST"),
        ("/sdapi/v1/interrupt", "POST"),
    ):
        app.add_api_route(path, empty_response, methods=[method])


class DiffusatoryMountTests(unittest.TestCase):
    def test_instance_descriptor_reflects_available_routes(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(
                "os.environ",
                {
                    "DIFFUSATORY_INSTANCE_ID": "test-instance",
                    "DIFFUSATORY_INSTANCE_NAME": "Test studio",
                },
            ),
        ):
            app = FastAPI()
            add_forge_routes(app)

            self.assertFalse(mount_diffusatory(app, dist=Path(directory) / "missing"))

            response = TestClient(app).get("/diffusatory/api/v1/instance")
            self.assertEqual(200, response.status_code)
            body = response.json()
            self.assertEqual("test-instance", body["id"])
            self.assertEqual("Test studio", body["name"])
            self.assertTrue(body["host"])
            self.assertTrue(body["version"])
            self.assertEqual(
                [
                    "txt2img",
                    "task-progress",
                    "interrupt",
                    "prompt-expansion",
                    "spatial-conditioning",
                    "model-residency",
                ],
                body["capabilities"],
            )

            expanded = TestClient(app).post(
                "/diffusatory/api/v1/prompts/expand",
                json={
                    "prompt": "{dawn|dusk}",
                    "mode": "random",
                    "candidate_count": 2,
                    "expansion_seed": 12,
                },
            )
            self.assertEqual(200, expanded.status_code)
            self.assertEqual(2, expanded.json()["resolved_count"])

    def test_built_client_is_mounted_after_api_routes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory) / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<h1>Diffusatory</h1>")
            app = FastAPI()

            self.assertTrue(mount_diffusatory(app, dist=dist))

            client = TestClient(app)
            self.assertEqual(
                200,
                client.get("/diffusatory/api/v1/instance").status_code,
            )
            page = client.get("/diffusatory/")
            self.assertEqual(200, page.status_code)
            self.assertIn("Diffusatory", page.text)

    def test_residency_route_separates_logical_bytes_from_process_rss(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "model.safetensors"
            checkpoint.write_bytes(b"model")
            key = forge_model_key(checkpoint, (), None)
            snapshot = ResidencySnapshot(
                capacity_bytes=64,
                resident_bytes=5,
                active_bytes=5,
                warm_bytes=0,
                loading_bytes=0,
                over_budget_bytes=0,
                hits=2,
                misses=1,
                evictions=0,
                load_failures=0,
                disposal_failures=0,
                entries=(
                    ResidencyEntrySnapshot(
                        key=key,
                        state="active",
                        size_bytes=5,
                        leases=1,
                        last_used_order=3,
                        load_seconds=1.25,
                    ),
                ),
            )
            fake_sd_models = SimpleNamespace(
                model_data=SimpleNamespace(
                    model_residency=SimpleNamespace(snapshot=lambda: snapshot)
                )
            )
            app = FastAPI()
            mount_diffusatory(app, dist=Path(directory) / "missing")

            with patch.object(modules, "sd_models", fake_sd_models, create=True):
                body = TestClient(app).get("/diffusatory/api/v1/residency").json()

            self.assertEqual(64, body["capacity_bytes"])
            self.assertEqual(5, body["resident_bytes"])
            self.assertIsInstance(body["process_rss_bytes"], int)
            self.assertEqual(str(checkpoint), body["entries"][0]["checkpoint"])
            self.assertEqual("active", body["entries"][0]["state"])


if __name__ == "__main__":
    unittest.main()
