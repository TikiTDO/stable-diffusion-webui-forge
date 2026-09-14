"""Forge adapter for Diffusatory's generic residency manager."""

from __future__ import annotations

import gc
import math
import os
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from diffusatory.server.residency import (
    DEFAULT_MODEL_RESIDENCY_BYTES,
    LoadedResource,
    ResidencyLease,
    ResidencyManager,
    ResidencySnapshot,
)


@dataclass(frozen=True)
class FileVersion:
    path: str
    size_bytes: int
    modified_ns: int


@dataclass(frozen=True)
class ForgeModelKey:
    checkpoint: FileVersion
    additional_modules: tuple[FileVersion, ...]
    unet_storage_dtype: str
    runtime_signature: tuple[str, ...]


@dataclass(frozen=True)
class ForgeActivation:
    model: Any
    cache_hit: bool
    logical_bytes: int


def file_version(path: str | os.PathLike[str]) -> FileVersion:
    resolved = Path(path).expanduser().resolve(strict=False)
    try:
        stat = resolved.stat()
    except OSError:
        return FileVersion(str(resolved), -1, -1)
    return FileVersion(str(resolved), stat.st_size, stat.st_mtime_ns)


def forge_model_key(
    checkpoint: str | os.PathLike[str],
    additional_modules: Iterable[str | os.PathLike[str]],
    unet_storage_dtype: object,
    *,
    runtime_signature: Iterable[object] = (),
) -> ForgeModelKey:
    """Describe every load-time input that can alter the assembled model."""

    return ForgeModelKey(
        checkpoint=file_version(checkpoint),
        additional_modules=tuple(file_version(path) for path in additional_modules),
        unet_storage_dtype=str(unet_storage_dtype),
        runtime_signature=tuple(str(value) for value in runtime_signature),
    )


def estimate_model_bytes(key: ForgeModelKey) -> int:
    """Use payload size as the first-load estimate; measured tensors replace it."""

    versions = (key.checkpoint, *key.additional_modules)
    return sum(max(0, version.size_bytes) for version in versions)


def measure_model_bytes(model: Any) -> int:
    """Measure each original Forge component's backing model exactly once."""

    objects = getattr(model, "forge_objects_original", None)
    if objects is None:
        return 0

    patchers = []
    for name in ("unet", "clip", "vae", "clipvision"):
        component = getattr(objects, name, None)
        if component is None:
            continue
        patcher = (
            component
            if hasattr(component, "model_size")
            else getattr(component, "patcher", None)
        )
        if patcher is not None and hasattr(patcher, "model_size"):
            patchers.append(patcher)

    total = 0.0
    seen_models = set()
    for patcher in patchers:
        backing_model = getattr(patcher, "model", None)
        identity = id(backing_model) if backing_model is not None else id(patcher)
        if identity in seen_models:
            continue
        seen_models.add(identity)
        total += float(patcher.model_size())
    return math.ceil(total)


def normalize_model_for_warm_cache(model: Any) -> None:
    """Drop generation-specific patcher clones before a model becomes warm."""

    original = getattr(model, "forge_objects_original", None)
    if original is None:
        return
    model.forge_objects = original.shallow_copy()
    model.forge_objects_after_applying_lora = original.shallow_copy()
    model.current_lora_hash = str([])


def destroy_forge_model(model: Any) -> None:
    """Sever heavyweight engine references after a logical eviction."""

    for name in (
        "forge_objects",
        "forge_objects_original",
        "forge_objects_after_applying_lora",
    ):
        if hasattr(model, name):
            setattr(model, name, None)

    # Text processing engines retain direct references to the encoders also
    # owned by ForgeObjects. Clear them if an extension retains the outer
    # diffusion-engine object after eviction.
    for name in tuple(vars(model)):
        if name.startswith("text_processing_engine"):
            setattr(model, name, None)


class ForgeResidencyController:
    """Own the one active Forge bundle and its warm-cache transitions."""

    def __init__(
        self,
        *,
        capacity_bytes: int = DEFAULT_MODEL_RESIDENCY_BYTES,
        unload_devices: Callable[[], None],
        empty_device_cache: Callable[[], None],
        collect: Callable[[], int] = gc.collect,
    ) -> None:
        self._manager: ResidencyManager[ForgeModelKey, Any] = ResidencyManager(
            capacity_bytes
        )
        self._unload_devices = unload_devices
        self._empty_device_cache = empty_device_cache
        self._collect = collect
        self._lock = threading.RLock()
        self._active_key: ForgeModelKey | None = None
        self._active_lease: ResidencyLease[ForgeModelKey, Any] | None = None

    def switch(
        self,
        key: ForgeModelKey,
        *,
        estimated_bytes: int,
        loader: Callable[[], Any],
        detach_current: Callable[[], None],
    ) -> ForgeActivation:
        """Make ``key`` active and retain the former model as a warm entry."""

        with self._lock:
            if self._active_key == key and self._active_lease is not None:
                model = self._active_lease.value
                return ForgeActivation(
                    model=model,
                    cache_hit=True,
                    logical_bytes=self._entry_size(key),
                )

            self._release_active(detach_current)

            def load_resource() -> LoadedResource[Any]:
                model = loader()
                measured_bytes = measure_model_bytes(model)
                logical_bytes = measured_bytes or estimated_bytes
                return LoadedResource(
                    value=model,
                    size_bytes=logical_bytes,
                    dispose=self._dispose_model,
                )

            lease = self._manager.acquire(
                key,
                estimated_bytes=estimated_bytes,
                loader=load_resource,
            )
            self._active_key = key
            self._active_lease = lease
            return ForgeActivation(
                model=lease.value,
                cache_hit=lease.cache_hit,
                logical_bytes=self._entry_size(key),
            )

    def snapshot(self) -> ResidencySnapshot[ForgeModelKey]:
        return self._manager.snapshot()

    def clear_warm(self) -> tuple[ForgeModelKey, ...]:
        with self._lock:
            return self._manager.clear_warm()

    def resize(self, capacity_bytes: int) -> None:
        with self._lock:
            self._manager.resize(capacity_bytes)

    def _entry_size(self, key: ForgeModelKey) -> int:
        for entry in self._manager.snapshot().entries:
            if entry.key == key:
                return entry.size_bytes
        raise RuntimeError("active Forge model is absent from residency ledger")

    def _release_active(self, detach_current: Callable[[], None]) -> None:
        if self._active_lease is None:
            detach_current()
            return

        lease = self._active_lease
        model = lease.value
        self._active_key = None
        self._active_lease = None

        self._unload_devices()
        detach_current()
        normalize_model_for_warm_cache(model)
        lease.release()
        self._empty_device_cache()
        self._collect()

    def _dispose_model(self, model: Any) -> None:
        destroy_forge_model(model)
        self._collect()
        self._empty_device_cache()
