import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from diffusatory.server.mount import mount_diffusatory


def add_forge_routes(app: FastAPI) -> None:
    for path, method in (
        ("/sdapi/v1/txt2img", "POST"),
        ("/internal/progress", "POST"),
        ("/sdapi/v1/interrupt", "POST"),
    ):
        app.add_api_route(path, lambda: {}, methods=[method])


class DiffusatoryMountTests(unittest.TestCase):
    def test_instance_descriptor_reflects_available_routes(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            "os.environ",
            {
                "DIFFUSATORY_INSTANCE_ID": "test-instance",
                "DIFFUSATORY_INSTANCE_NAME": "Test studio",
            },
        ):
            app = FastAPI()
            add_forge_routes(app)

            self.assertFalse(
                mount_diffusatory(app, dist=Path(directory) / "missing")
            )

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


if __name__ == "__main__":
    unittest.main()
