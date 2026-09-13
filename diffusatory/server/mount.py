from __future__ import annotations

import os
import platform
import uuid
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from modules import launch_utils


DIFFUSATORY_PREFIX = "/diffusatory"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIST = REPOSITORY_ROOT / "diffusatory" / "web" / "dist"


class InstanceDescriptor(BaseModel):
    id: str
    name: str
    host: str
    version: str
    capabilities: list[str]


def _route_paths(app: FastAPI) -> set[str]:
    return {
        path
        for route in app.routes
        if isinstance(path := getattr(route, "path", None), str)
    }


def _capabilities(app: FastAPI) -> list[str]:
    paths = _route_paths(app)
    routes = (
        ("txt2img", "/sdapi/v1/txt2img"),
        ("img2img", "/sdapi/v1/img2img"),
        ("task-progress", "/internal/progress"),
        ("interrupt", "/sdapi/v1/interrupt"),
        ("skip", "/sdapi/v1/skip"),
        ("models", "/sdapi/v1/sd-models"),
        ("model-modules", "/sdapi/v1/sd-modules"),
        ("loras", "/sdapi/v1/loras"),
        ("controlnet", "/controlnet/model_list"),
        ("controlnet-preprocess", "/controlnet/detect"),
    )
    return [name for name, path in routes if path in paths]


def _instance_id(host: str) -> str:
    configured = os.getenv("DIFFUSATORY_INSTANCE_ID")
    if configured:
        return configured

    seed = f"diffusatory:{host}:{REPOSITORY_ROOT}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def instance_descriptor(app: FastAPI) -> InstanceDescriptor:
    host = platform.node() or "local"
    name = os.getenv("DIFFUSATORY_INSTANCE_NAME", f"Diffusatory on {host}")
    return InstanceDescriptor(
        id=_instance_id(host),
        name=name,
        host=host,
        version=launch_utils.commit_hash(),
        capabilities=_capabilities(app),
    )


def mount_diffusatory(app: FastAPI, *, dist: Path | None = None) -> bool:
    """Register the instance contract and mount a built client when present.

    The descriptor route is registered before the static mount so that
    ``/diffusatory/api`` never falls through to the single-page application.
    Returns whether a built client was mounted.
    """

    router = APIRouter(prefix=f"{DIFFUSATORY_PREFIX}/api/v1")

    @router.get("/instance", response_model=InstanceDescriptor)
    async def get_instance() -> InstanceDescriptor:
        return instance_descriptor(app)

    app.include_router(router)

    dist = DEFAULT_DIST if dist is None else dist
    if not (dist / "index.html").is_file():
        return False

    app.mount(
        DIFFUSATORY_PREFIX,
        StaticFiles(directory=dist, html=True),
        name="diffusatory",
    )
    return True
