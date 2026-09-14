from __future__ import annotations

import os
import platform
import uuid
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from modules import launch_utils

from diffusatory.server.prompt_composition import (
    PromptExpansionRequest,
    PromptExpansionResponse,
    compile_prompt_expansion,
)
from diffusatory.server.model_profiles import ModelProfile, model_profiles


DIFFUSATORY_PREFIX = "/diffusatory"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIST = REPOSITORY_ROOT / "diffusatory" / "web" / "dist"


class InstanceDescriptor(BaseModel):
    id: str
    name: str
    host: str
    version: str
    capabilities: list[str]


class ResidencyEntryDescriptor(BaseModel):
    checkpoint: str
    additional_modules: list[str]
    storage_dtype: str
    state: str
    size_bytes: int
    leases: int
    load_seconds: float | None


class ResidencyDescriptor(BaseModel):
    capacity_bytes: int
    resident_bytes: int
    active_bytes: int
    warm_bytes: int
    loading_bytes: int
    over_budget_bytes: int
    process_rss_bytes: int | None
    hits: int
    misses: int
    evictions: int
    load_failures: int
    disposal_failures: int
    entries: list[ResidencyEntryDescriptor]


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
    # The native prompt compiler is installed by this mount itself. FastAPI
    # 0.141 keeps included routers behind a lazy route object, so it is not
    # visible to the shallow Forge-route inventory above until resolution.
    return [name for name, path in routes if path in paths] + [
        "prompt-expansion",
        "spatial-conditioning",
        "model-residency",
    ]


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


def _process_rss_bytes() -> int | None:
    try:
        fields = Path("/proc/self/statm").read_text().split()
        return int(fields[1]) * os.sysconf("SC_PAGE_SIZE")
    except (IndexError, OSError, TypeError, ValueError):
        return None


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

    @router.get("/model-profiles", response_model=list[ModelProfile])
    async def get_model_profiles() -> list[ModelProfile]:
        # Import only in the running Forge process. Importing sd_models while a
        # focused unittest owns argv activates Forge's global CLI parser.
        from modules import sd_models

        return model_profiles(sd_models.checkpoints_list.values())

    @router.get("/residency", response_model=ResidencyDescriptor)
    async def get_residency() -> ResidencyDescriptor:
        from modules import sd_models

        snapshot = sd_models.model_data.model_residency.snapshot()
        return ResidencyDescriptor(
            capacity_bytes=snapshot.capacity_bytes,
            resident_bytes=snapshot.resident_bytes,
            active_bytes=snapshot.active_bytes,
            warm_bytes=snapshot.warm_bytes,
            loading_bytes=snapshot.loading_bytes,
            over_budget_bytes=snapshot.over_budget_bytes,
            process_rss_bytes=_process_rss_bytes(),
            hits=snapshot.hits,
            misses=snapshot.misses,
            evictions=snapshot.evictions,
            load_failures=snapshot.load_failures,
            disposal_failures=snapshot.disposal_failures,
            entries=[
                ResidencyEntryDescriptor(
                    checkpoint=entry.key.checkpoint.path,
                    additional_modules=[
                        module.path for module in entry.key.additional_modules
                    ],
                    storage_dtype=entry.key.unet_storage_dtype,
                    state=entry.state,
                    size_bytes=entry.size_bytes,
                    leases=entry.leases,
                    load_seconds=entry.load_seconds,
                )
                for entry in snapshot.entries
            ],
        )

    @router.post("/prompts/expand", response_model=PromptExpansionResponse)
    async def expand_prompts(
        request: PromptExpansionRequest,
    ) -> PromptExpansionResponse:
        return compile_prompt_expansion(request)

    app.include_router(router)

    dist = DEFAULT_DIST if dist is None else dist
    if not (dist / "index.html").is_file():
        return False

    if "/" not in _route_paths(app):
        @app.get("/", include_in_schema=False)
        async def open_diffusatory(request: Request) -> RedirectResponse:
            root_path = request.scope.get("root_path", "").rstrip("/")
            return RedirectResponse(url=f"{root_path}{DIFFUSATORY_PREFIX}/")

    app.mount(
        DIFFUSATORY_PREFIX,
        StaticFiles(directory=dist, html=True),
        name="diffusatory",
    )
    return True
