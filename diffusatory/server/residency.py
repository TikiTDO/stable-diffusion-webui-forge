"""Byte-budgeted residency for reconstructable ML resources.

The policy deliberately knows nothing about checkpoints, Torch, or devices.
Adapters provide an opaque value, its logical byte weight, and an explicit
disposal operation.  This keeps the first Forge integration usable by the
later Observatory ML manager rather than growing a second checkpoint cache.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Hashable
from dataclasses import dataclass
from typing import Callable, Generic, TypeVar


K = TypeVar("K", bound=Hashable)
V = TypeVar("V")

GIB = 1024**3
DEFAULT_MODEL_RESIDENCY_BYTES = 64 * GIB


@dataclass(frozen=True)
class LoadedResource(Generic[V]):
    """The result of one cold load.

    ``size_bytes`` is logical managed residency, not process RSS. ``dispose``
    must sever adapter-owned references and may also perform device/allocator
    cleanup when that is part of the adapter's contract.
    """

    value: V
    size_bytes: int
    dispose: Callable[[V], None]


@dataclass(frozen=True)
class ResidencyEntrySnapshot(Generic[K]):
    key: K
    state: str
    size_bytes: int
    leases: int
    last_used_order: int
    load_seconds: float | None


@dataclass(frozen=True)
class ResidencySnapshot(Generic[K]):
    capacity_bytes: int
    resident_bytes: int
    active_bytes: int
    warm_bytes: int
    loading_bytes: int
    over_budget_bytes: int
    hits: int
    misses: int
    evictions: int
    load_failures: int
    disposal_failures: int
    entries: tuple[ResidencyEntrySnapshot[K], ...]


class ResidencyDisposalError(RuntimeError):
    """Raised after every selected victim was given a chance to dispose."""

    def __init__(self, keys: tuple[Hashable, ...]):
        super().__init__(f"failed to dispose {len(keys)} resident resource(s)")
        self.keys = keys


@dataclass
class _Entry(Generic[K, V]):
    key: K
    generation: int
    size_bytes: int
    leases: int
    last_used_order: int
    loading: bool = True
    value: V | None = None
    dispose: Callable[[V], None] | None = None
    load_seconds: float | None = None


class ResidencyLease(Generic[K, V]):
    """An explicit pin on one resident resource."""

    def __init__(
        self,
        manager: ResidencyManager[K, V],
        key: K,
        generation: int,
        value: V,
        *,
        cache_hit: bool,
    ) -> None:
        self._manager = manager
        self._key = key
        self._generation = generation
        self._value = value
        self._cache_hit = cache_hit
        self._released = False

    @property
    def value(self) -> V:
        if self._released:
            raise RuntimeError("residency lease has been released")
        return self._value

    @property
    def cache_hit(self) -> bool:
        return self._cache_hit

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        self._manager._release(self._key, self._generation)

    def __enter__(self) -> V:
        return self.value

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.release()


class ResidencyManager(Generic[K, V]):
    """Thread-safe weighted LRU with single-flight loads and active leases.

    The manager uses byte weights for admission and strict least-recently-used
    order among warm entries. Active and loading entries may temporarily put
    the ledger over budget; that overage is observable and their leases are
    never revoked. The scheduling layer decides whether concurrent admissions
    are appropriate for the host.
    """

    def __init__(
        self,
        capacity_bytes: int = DEFAULT_MODEL_RESIDENCY_BYTES,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if capacity_bytes < 0:
            raise ValueError("capacity_bytes must be non-negative")
        self._capacity_bytes = capacity_bytes
        self._clock = clock
        self._condition = threading.Condition(threading.RLock())
        self._entries: dict[K, _Entry[K, V]] = {}
        self._order = 0
        self._generation = 0
        self._hits = 0
        self._misses = 0
        self._evictions = 0
        self._load_failures = 0
        self._disposal_failures = 0

    def acquire(
        self,
        key: K,
        *,
        estimated_bytes: int,
        loader: Callable[[], LoadedResource[V]],
    ) -> ResidencyLease[K, V]:
        """Acquire a pinned resource, loading it once on a cold miss."""

        if estimated_bytes < 0:
            raise ValueError("estimated_bytes must be non-negative")

        while True:
            with self._condition:
                entry = self._entries.get(key)
                if entry is not None and entry.loading:
                    self._condition.wait()
                    continue
                if entry is not None:
                    if entry.value is None:
                        raise RuntimeError("resident entry has no value")
                    self._hits += 1
                    entry.leases += 1
                    entry.last_used_order = self._next_order_locked()
                    return ResidencyLease(
                        self,
                        key,
                        entry.generation,
                        entry.value,
                        cache_hit=True,
                    )

                self._misses += 1
                self._generation += 1
                generation = self._generation
                entry = _Entry(
                    key=key,
                    generation=generation,
                    size_bytes=estimated_bytes,
                    leases=1,
                    last_used_order=self._next_order_locked(),
                )
                self._entries[key] = entry
                victims = self._detach_lru_until_within_budget_locked()
                break

        try:
            self._dispose_entries(victims)
        except ResidencyDisposalError:
            with self._condition:
                current = self._entries.get(key)
                if current is entry:
                    del self._entries[key]
                    self._condition.notify_all()
            raise

        started = self._clock()
        try:
            loaded = loader()
            if loaded.size_bytes < 0:
                raise ValueError("loaded resource size_bytes must be non-negative")
        except BaseException:
            with self._condition:
                current = self._entries.get(key)
                if current is entry:
                    del self._entries[key]
                self._load_failures += 1
                self._condition.notify_all()
            raise

        with self._condition:
            current = self._entries.get(key)
            if current is not entry:
                raise RuntimeError("loading reservation disappeared")
            entry.value = loaded.value
            entry.dispose = loaded.dispose
            entry.size_bytes = loaded.size_bytes
            entry.load_seconds = max(0.0, self._clock() - started)
            entry.loading = False
            entry.last_used_order = self._next_order_locked()
            victims = self._detach_lru_until_within_budget_locked()
            self._condition.notify_all()

        try:
            self._dispose_entries(victims)
        except ResidencyDisposalError:
            self._release(key, generation)
            raise
        return ResidencyLease(
            self,
            key,
            generation,
            loaded.value,
            cache_hit=False,
        )

    def evict(self, key: K) -> bool:
        """Evict one warm resource. Return false if absent, active, or loading."""

        with self._condition:
            entry = self._entries.get(key)
            if entry is None or entry.loading or entry.leases:
                return False
            del self._entries[key]
            self._evictions += 1
        self._dispose_entries((entry,))
        return True

    def clear_warm(self) -> tuple[K, ...]:
        """Dispose every warm resource while preserving active leases."""

        with self._condition:
            victims = tuple(
                entry
                for entry in self._entries.values()
                if not entry.loading and not entry.leases
            )
            for entry in victims:
                del self._entries[entry.key]
            self._evictions += len(victims)
        self._dispose_entries(victims)
        return tuple(entry.key for entry in victims)

    def resize(self, capacity_bytes: int) -> None:
        """Change the logical budget and immediately evict eligible victims."""

        if capacity_bytes < 0:
            raise ValueError("capacity_bytes must be non-negative")
        with self._condition:
            self._capacity_bytes = capacity_bytes
            victims = self._detach_lru_until_within_budget_locked()
        self._dispose_entries(victims)

    def snapshot(self) -> ResidencySnapshot[K]:
        with self._condition:
            entries = tuple(
                ResidencyEntrySnapshot(
                    key=entry.key,
                    state=(
                        "loading"
                        if entry.loading
                        else "active"
                        if entry.leases
                        else "warm"
                    ),
                    size_bytes=entry.size_bytes,
                    leases=entry.leases,
                    last_used_order=entry.last_used_order,
                    load_seconds=entry.load_seconds,
                )
                for entry in sorted(
                    self._entries.values(),
                    key=lambda item: item.last_used_order,
                    reverse=True,
                )
            )
            resident_bytes = sum(entry.size_bytes for entry in self._entries.values())
            loading_bytes = sum(
                entry.size_bytes for entry in self._entries.values() if entry.loading
            )
            active_bytes = sum(
                entry.size_bytes
                for entry in self._entries.values()
                if not entry.loading and entry.leases
            )
            warm_bytes = resident_bytes - loading_bytes - active_bytes
            return ResidencySnapshot(
                capacity_bytes=self._capacity_bytes,
                resident_bytes=resident_bytes,
                active_bytes=active_bytes,
                warm_bytes=warm_bytes,
                loading_bytes=loading_bytes,
                over_budget_bytes=max(0, resident_bytes - self._capacity_bytes),
                hits=self._hits,
                misses=self._misses,
                evictions=self._evictions,
                load_failures=self._load_failures,
                disposal_failures=self._disposal_failures,
                entries=entries,
            )

    def _release(self, key: K, generation: int) -> None:
        with self._condition:
            entry = self._entries.get(key)
            if entry is None or entry.generation != generation:
                return
            if entry.leases <= 0:
                return
            entry.leases -= 1
            entry.last_used_order = self._next_order_locked()
            victims = self._detach_lru_until_within_budget_locked()
            self._condition.notify_all()
        self._dispose_entries(victims)

    def _next_order_locked(self) -> int:
        self._order += 1
        return self._order

    def _resident_bytes_locked(self) -> int:
        return sum(entry.size_bytes for entry in self._entries.values())

    def _detach_lru_until_within_budget_locked(
        self,
    ) -> tuple[_Entry[K, V], ...]:
        victims = []
        while self._resident_bytes_locked() > self._capacity_bytes:
            eligible = [
                entry
                for entry in self._entries.values()
                if not entry.loading and not entry.leases
            ]
            if not eligible:
                break
            victim = min(eligible, key=lambda item: item.last_used_order)
            del self._entries[victim.key]
            self._evictions += 1
            victims.append(victim)
        return tuple(victims)

    def _dispose_entries(self, entries: tuple[_Entry[K, V], ...]) -> None:
        failed = []
        for entry in entries:
            value = entry.value
            dispose = entry.dispose
            try:
                if value is not None and dispose is not None:
                    dispose(value)
            # Disposal is best-effort across the complete victim set. One bad
            # adapter must not keep later victims resident too.
            except Exception:  # noqa: BLE001
                failed.append(entry.key)
            finally:
                entry.value = None
                entry.dispose = None
        if failed:
            with self._condition:
                self._disposal_failures += len(failed)
            raise ResidencyDisposalError(tuple(failed))
