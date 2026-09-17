from __future__ import annotations

import asyncio
import os
import platform
import uuid
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from modules import launch_utils

from diffusatory.server.prompt_composition import (
    PromptExpansionRequest,
    PromptExpansionResponse,
    compile_prompt_expansion,
)
from diffusatory.server.model_profiles import ModelProfile, model_profiles
from diffusatory.server.lora_catalog import (
    LoraCatalogItem,
    LoraDefaults,
    build_lora_catalog,
    build_lora_item,
    find_registered_lora,
    registered_lora_preview,
    save_lora_defaults,
    save_lora_preview,
)


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


class ServerActivityDescriptor(BaseModel):
    phase: str
    busy: bool
    task_id: str | None
    queue_size: int
    progress: float | None
    sampling_step: int
    sampling_steps: int
    job_index: int
    job_count: int
    operation: str | None
    checkpoint: str | None
    detail: str | None


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
        "server-status",
        "lora-library",
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


# The stream samples Forge's in-process state at this cadence and sends a
# frame only when the descriptor changed; a comment keeps proxies from
# closing an idle connection.
STATUS_STREAM_TICK_SECONDS = 0.15
STATUS_STREAM_HEARTBEAT_SECONDS = 15.0


async def server_activity_events(is_disconnected):
    """Yield one SSE frame per change of the activity descriptor."""
    last: str | None = None
    quiet = 0.0
    while not await is_disconnected():
        payload = server_activity_descriptor().model_dump_json()
        if payload != last:
            last = payload
            quiet = 0.0
            yield f"event: activity\ndata: {payload}\n\n"
        else:
            quiet += STATUS_STREAM_TICK_SECONDS
            if quiet >= STATUS_STREAM_HEARTBEAT_SECONDS:
                quiet = 0.0
                yield ": keep-alive\n\n"
        await asyncio.sleep(STATUS_STREAM_TICK_SECONDS)


def server_activity_descriptor() -> ServerActivityDescriptor:
    from modules import progress as forge_progress
    from modules import shared

    activity = forge_progress.task_activity_snapshot()
    state = shared.state

    if activity.current_task is not None:
        phase = activity.stage or "preparing"
    elif activity.pending_count:
        phase = "queued"
    else:
        phase = "idle"

    job_count = max(0, int(state.job_count))
    job_no = max(0, int(state.job_no))
    sampling_steps = max(0, int(state.sampling_steps))
    sampling_step = max(0, int(state.sampling_step))
    progress_value = None
    if activity.current_task is not None and job_count > 0:
        progress_value = job_no / job_count
        if sampling_steps > 0:
            progress_value += sampling_step / sampling_steps / job_count
        progress_value = min(1.0, max(0.0, progress_value))
    if phase == "saving":
        progress_value = 1.0

    operation = None
    if state.job == "scripts_txt2img":
        operation = "txt2img"
    elif state.job == "scripts_img2img":
        operation = "img2img"

    checkpoint = getattr(shared.opts, "sd_model_checkpoint", None)
    if checkpoint is not None:
        checkpoint = str(checkpoint)

    detail = activity.detail
    if detail is None and activity.current_task is not None and state.textinfo:
        detail = str(state.textinfo)

    return ServerActivityDescriptor(
        phase=phase,
        busy=phase != "idle",
        task_id=activity.current_task,
        queue_size=activity.pending_count,
        progress=progress_value,
        sampling_step=sampling_step,
        sampling_steps=sampling_steps,
        job_index=min(job_count, job_no + 1) if job_count else 0,
        job_count=job_count,
        operation=operation,
        checkpoint=checkpoint,
        detail=detail,
    )


def mount_diffusatory(
    app: FastAPI, *, dist: Path | None = None, serve_ui: bool = True
) -> bool:
    """Register the instance contract and mount a built client when present.

    The descriptor route is registered before the static mount so that
    ``/diffusatory/api`` never falls through to the single-page application.
    Returns whether a built client was mounted.
    """

    router = APIRouter(prefix=f"{DIFFUSATORY_PREFIX}/api/v1")

    @router.get("/instance", response_model=InstanceDescriptor)
    async def get_instance() -> InstanceDescriptor:
        return instance_descriptor(app)

    @router.get("/status", response_model=ServerActivityDescriptor)
    async def get_status() -> ServerActivityDescriptor:
        return server_activity_descriptor()

    @router.get("/status/stream")
    async def stream_status(request: Request) -> StreamingResponse:
        return StreamingResponse(
            server_activity_events(request.is_disconnected),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @router.get("/model-profiles", response_model=list[ModelProfile])
    async def get_model_profiles() -> list[ModelProfile]:
        # Import only in the running Forge process. Importing sd_models while a
        # focused unittest owns argv activates Forge's global CLI parser.
        from modules import sd_models

        return model_profiles(sd_models.checkpoints_list.values())

    def current_loras():
        # Forge places built-in extension modules on sys.path during startup.
        # Importing here keeps the small server modules independently testable.
        import networks
        from modules import shared

        return list(networks.available_networks.values()), shared.cmd_opts.lora_dir

    @router.get("/loras", response_model=list[LoraCatalogItem])
    async def get_loras() -> list[LoraCatalogItem]:
        networks, root = current_loras()
        return build_lora_catalog(networks, root)

    @router.post("/loras/refresh", response_model=list[LoraCatalogItem])
    async def refresh_loras() -> list[LoraCatalogItem]:
        import networks

        networks.list_available_networks()
        current, root = current_loras()
        return build_lora_catalog(current, root)

    @router.get("/loras/{identifier}/preview", response_class=FileResponse)
    async def get_lora_preview(identifier: str) -> FileResponse:
        networks, _ = current_loras()
        network = find_registered_lora(networks, identifier)
        preview = registered_lora_preview(network) if network else None
        if preview is None:
            raise HTTPException(status_code=404, detail="LoRA preview not found")
        return FileResponse(preview, headers={"Accept-Ranges": "bytes"})

    @router.put("/loras/{identifier}/preview", response_model=LoraCatalogItem)
    async def put_lora_preview(
        identifier: str, request: Request
    ) -> LoraCatalogItem:
        networks, root = current_loras()
        network = find_registered_lora(networks, identifier)
        if network is None:
            raise HTTPException(status_code=404, detail="LoRA not found")
        content_type = request.headers.get("content-type", "").lower()
        extension = ".png"
        if "jpeg" in content_type or "jpg" in content_type:
            extension = ".jpg"
        elif "webp" in content_type:
            extension = ".webp"
        data = await request.body()
        if not data:
            raise HTTPException(status_code=400, detail="Empty preview image")
        if len(data) > 20 * 1024 * 1024:
            raise HTTPException(
                status_code=413, detail="Preview image exceeds 20MB limit"
            )
        save_lora_preview(network, data, extension)
        return build_lora_item(network, root)

    @router.put("/loras/{identifier}/defaults", response_model=LoraCatalogItem)
    async def put_lora_defaults(
        identifier: str, defaults: LoraDefaults
    ) -> LoraCatalogItem:
        networks, root = current_loras()
        network = find_registered_lora(networks, identifier)
        if network is None:
            raise HTTPException(status_code=404, detail="LoRA not found")
        save_lora_defaults(network, defaults)
        return build_lora_item(network, root)

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

    if not serve_ui:
        return False

    dist = DEFAULT_DIST if dist is None else dist
    if not (dist / "index.html").is_file():
        return False

    if "/" not in _route_paths(app):
        @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
        async def open_diffusatory(request: Request) -> RedirectResponse:
            root_path = request.scope.get("root_path", "").rstrip("/")
            return RedirectResponse(url=f"{root_path}{DIFFUSATORY_PREFIX}/")

    app.mount(
        DIFFUSATORY_PREFIX,
        StaticFiles(directory=dist, html=True),
        name="diffusatory",
    )
    return True
