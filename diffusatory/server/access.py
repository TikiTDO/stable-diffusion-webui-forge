from __future__ import annotations

import hmac
import secrets
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint


AccessMode = Literal["ui", "api", "both"]

UI_SESSION_PATH = "/diffusatory/api/v1/ui-session"
UI_COOKIE_NAME = "diffusatory_ui"


def read_api_token(path: Path | None) -> str | None:
    """Read a bearer token without ever placing it in the server's CLI."""

    if path is None or not path.exists():
        return None
    if not path.is_file():
        raise RuntimeError(f"Diffusatory API token path is not a file: {path}")
    if path.stat().st_size > 4096:
        raise RuntimeError(f"Diffusatory API token file is unexpectedly large: {path}")

    token = path.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError(f"Diffusatory API token file is empty: {path}")
    return token


def _matches(candidate: str | None, expected: str | None) -> bool:
    return bool(candidate and expected) and hmac.compare_digest(candidate, expected)


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer":
        return None
    return token.strip() or None


def _is_ui_resource(request: Request) -> bool:
    if request.method not in {"GET", "HEAD"}:
        return False
    path = request.url.path
    if path == "/":
        return True
    if path in {"/diffusatory", "/diffusatory/"}:
        return True
    return path.startswith("/diffusatory/") and not path.startswith(
        "/diffusatory/api/"
    )


def _is_ui_document(request: Request) -> bool:
    return request.method in {"GET", "HEAD"} and request.url.path in {
        "/",
        "/diffusatory",
        "/diffusatory/",
    }


def _set_ui_cookie(response: Response, token: str, *, secure: bool) -> None:
    response.set_cookie(
        UI_COOKIE_NAME,
        token,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/",
    )


class DiffusatoryAccessMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        mode: AccessMode,
        ui_token: str | None,
        api_token: str | None,
        secure_cookie: bool,
    ) -> None:
        super().__init__(app)
        self.mode = mode
        self.ui_token = ui_token
        self.api_token = api_token
        self.secure_cookie = secure_cookie

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        path = request.url.path
        ui_enabled = self.mode in {"ui", "both"}
        api_enabled = self.mode in {"api", "both"}

        if path == UI_SESSION_PATH and ui_enabled:
            return await call_next(request)

        if _is_ui_resource(request):
            if not ui_enabled:
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            response = await call_next(request)
            if self.ui_token and _is_ui_document(request) and response.status_code < 400:
                _set_ui_cookie(response, self.ui_token, secure=self.secure_cookie)
            return response

        ui_authorized = ui_enabled and _matches(
            request.cookies.get(UI_COOKIE_NAME), self.ui_token
        )
        api_authorized = api_enabled and _matches(
            _bearer_token(request), self.api_token
        )
        if ui_authorized or api_authorized:
            return await call_next(request)

        return JSONResponse(
            status_code=401,
            content={"detail": "Diffusatory API authorization required"},
            headers={"WWW-Authenticate": "Bearer"},
        )


def read_ui_token(path: Path | None) -> str | None:
    """Read a persistent UI session token from a bounded file."""
    return read_api_token(path)


def install_diffusatory_access(
    app: FastAPI,
    *,
    mode: AccessMode,
    api_token: str | None,
    ui_token: str | None = None,
    secure_cookie: bool = False,
) -> None:
    """Install the UI-session and explicit-client admission boundary."""

    if mode == "api" and api_token is None:
        raise RuntimeError("Diffusatory API mode requires an API token file")

    if mode in {"ui", "both"}:
        if ui_token is None or not ui_token.strip():
            ui_token = secrets.token_urlsafe(32)
        else:
            ui_token = ui_token.strip()
    else:
        ui_token = None

    if ui_token is not None:
        async def open_ui_session() -> Response:
            response = Response(status_code=204)
            _set_ui_cookie(response, ui_token, secure=secure_cookie)
            return response

        app.add_api_route(
            UI_SESSION_PATH,
            open_ui_session,
            methods=["GET"],
            include_in_schema=False,
        )

    app.add_middleware(
        DiffusatoryAccessMiddleware,
        mode=mode,
        ui_token=ui_token,
        api_token=api_token,
        secure_cookie=secure_cookie,
    )
