from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from diffusatory.server.access import (
    UI_COOKIE_NAME,
    install_diffusatory_access,
    read_api_token,
    read_ui_token,
)
from diffusatory.server.mount import mount_diffusatory


class DiffusatoryAccessTests(unittest.TestCase):
    @staticmethod
    def app_with_ping() -> FastAPI:
        app = FastAPI()

        @app.get("/sdapi/v1/ping")
        async def ping() -> dict[str, bool]:
            return {"ok": True}

        return app

    def test_ui_session_opens_the_api_without_exposing_a_bearer_token(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory)
            (dist / "index.html").write_text("Diffusatory", encoding="utf-8")
            app = self.app_with_ping()
            install_diffusatory_access(app, mode="ui", api_token=None)
            mount_diffusatory(app, dist=dist)
            client = TestClient(app)

            denied = client.get("/sdapi/v1/ping")
            self.assertEqual(401, denied.status_code)
            self.assertEqual("Bearer", denied.headers["www-authenticate"])

            opened = client.get("/diffusatory/api/v1/ui-session")
            self.assertEqual(204, opened.status_code)
            self.assertIn(UI_COOKIE_NAME, client.cookies)
            self.assertTrue(opened.headers["set-cookie"].find("HttpOnly") >= 0)
            self.assertTrue(opened.headers["set-cookie"].find("SameSite=strict") >= 0)
            self.assertEqual({"ok": True}, client.get("/sdapi/v1/ping").json())

    def test_loading_the_workbench_also_opens_its_ui_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory)
            (dist / "index.html").write_text("Diffusatory", encoding="utf-8")
            app = self.app_with_ping()
            install_diffusatory_access(app, mode="both", api_token="external")
            mount_diffusatory(app, dist=dist)
            client = TestClient(app)

            page = client.get("/diffusatory/")
            self.assertEqual(200, page.status_code)
            self.assertIn(UI_COOKIE_NAME, client.cookies)
            self.assertEqual(200, client.get("/sdapi/v1/ping").status_code)

    def test_ui_mode_does_not_accept_the_external_bearer_token(self) -> None:
        app = self.app_with_ping()
        install_diffusatory_access(app, mode="ui", api_token="external")
        response = TestClient(app).get(
            "/sdapi/v1/ping",
            headers={"Authorization": "Bearer external"},
        )
        self.assertEqual(401, response.status_code)

    def test_both_mode_accepts_only_the_configured_bearer_token(self) -> None:
        app = self.app_with_ping()
        install_diffusatory_access(app, mode="both", api_token="external")
        client = TestClient(app)

        self.assertEqual(401, client.get("/sdapi/v1/ping").status_code)
        self.assertEqual(
            401,
            client.get(
                "/sdapi/v1/ping",
                headers={"Authorization": "Bearer wrong"},
            ).status_code,
        )
        self.assertEqual(
            200,
            client.get(
                "/sdapi/v1/ping",
                headers={"Authorization": "Bearer external"},
            ).status_code,
        )

    def test_api_mode_requires_a_token_and_does_not_serve_the_ui(self) -> None:
        app = self.app_with_ping()
        with self.assertRaisesRegex(RuntimeError, "requires an API token"):
            install_diffusatory_access(app, mode="api", api_token=None)

        app = self.app_with_ping()
        install_diffusatory_access(app, mode="api", api_token="external")
        mount_diffusatory(app, serve_ui=False)
        client = TestClient(app)
        self.assertEqual(404, client.get("/diffusatory/").status_code)
        self.assertEqual(
            200,
            client.get(
                "/sdapi/v1/ping",
                headers={"Authorization": "Bearer external"},
            ).status_code,
        )

    def test_https_ui_cookie_is_secure(self) -> None:
        app = self.app_with_ping()
        install_diffusatory_access(
            app,
            mode="ui",
            api_token=None,
            secure_cookie=True,
        )
        response = TestClient(app, base_url="https://testserver").get(
            "/diffusatory/api/v1/ui-session"
        )
        self.assertIn("Secure", response.headers["set-cookie"])

    def test_api_token_is_read_from_a_bounded_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "token"
            path.write_text(" secret-token\n", encoding="utf-8")
            self.assertEqual("secret-token", read_api_token(path))
            self.assertIsNone(read_api_token(Path(directory) / "missing"))

    def test_ui_token_is_read_from_a_bounded_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ui-token"
            path.write_text(" persistent-ui-token\n", encoding="utf-8")
            self.assertEqual("persistent-ui-token", read_ui_token(path))
            self.assertIsNone(read_ui_token(Path(directory) / "missing"))

    def test_static_ui_token_persists_configured_session(self) -> None:
        app = self.app_with_ping()
        install_diffusatory_access(
            app,
            mode="ui",
            api_token=None,
            ui_token="persistent-ui-secret",
        )
        client = TestClient(app)
        opened = client.get("/diffusatory/api/v1/ui-session")
        self.assertEqual(204, opened.status_code)
        self.assertEqual("persistent-ui-secret", client.cookies.get(UI_COOKIE_NAME))
        self.assertEqual({"ok": True}, client.get("/sdapi/v1/ping").json())

        # An independent client with that same cookie is already authenticated
        peer_client = TestClient(app, cookies={UI_COOKIE_NAME: "persistent-ui-secret"})
        self.assertEqual({"ok": True}, peer_client.get("/sdapi/v1/ping").json())

        # A client with an invalid cookie is rejected
        bad_client = TestClient(app, cookies={UI_COOKIE_NAME: "wrong-secret"})
        self.assertEqual(401, bad_client.get("/sdapi/v1/ping").status_code)

    def test_static_ui_token_persists_session_across_app_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            token_file = Path(directory) / "ui-token"
            token_file.write_text("restart-secret-token\n", encoding="utf-8")

            # App instance 1: user opens session, cookie is set
            token1 = read_ui_token(token_file)
            app1 = self.app_with_ping()
            install_diffusatory_access(app1, mode="ui", api_token=None, ui_token=token1)
            client1 = TestClient(app1)
            opened = client1.get("/diffusatory/api/v1/ui-session")
            self.assertEqual(204, opened.status_code)
            minted_cookie = client1.cookies.get(UI_COOKIE_NAME)
            self.assertEqual("restart-secret-token", minted_cookie)
            self.assertEqual({"ok": True}, client1.get("/sdapi/v1/ping").json())

            # App instance 2: simulates server restart reading same token file
            token2 = read_ui_token(token_file)
            app2 = self.app_with_ping()
            install_diffusatory_access(app2, mode="ui", api_token=None, ui_token=token2)
            reconnected_client = TestClient(app2, cookies={UI_COOKIE_NAME: minted_cookie})
            self.assertEqual({"ok": True}, reconnected_client.get("/sdapi/v1/ping").json())


if __name__ == "__main__":
    unittest.main()
