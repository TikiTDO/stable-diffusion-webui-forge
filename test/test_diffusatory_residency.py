import threading
import time
import unittest

from diffusatory.server.residency import LoadedResource, ResidencyManager


class ResidencyManagerTests(unittest.TestCase):
    def resource(
        self, name: str, size: int, disposed: list[str]
    ) -> LoadedResource[str]:
        return LoadedResource(
            value=name,
            size_bytes=size,
            dispose=lambda value: disposed.append(value),
        )

    def acquire(
        self,
        manager: ResidencyManager[str, str],
        name: str,
        size: int,
        disposed: list[str],
    ):
        return manager.acquire(
            name,
            estimated_bytes=size,
            loader=lambda: self.resource(name, size, disposed),
        )

    def test_weighted_lru_evicts_the_oldest_warm_resource(self) -> None:
        disposed: list[str] = []
        manager: ResidencyManager[str, str] = ResidencyManager(10)

        self.acquire(manager, "a", 4, disposed).release()
        self.acquire(manager, "b", 4, disposed).release()
        self.acquire(manager, "a", 4, disposed).release()
        lease_c = self.acquire(manager, "c", 5, disposed)

        snapshot = manager.snapshot()
        self.assertEqual(["c", "a"], [entry.key for entry in snapshot.entries])
        self.assertEqual(["b"], disposed)
        self.assertEqual(9, snapshot.resident_bytes)
        self.assertEqual(1, snapshot.hits)
        self.assertEqual(3, snapshot.misses)
        self.assertEqual(1, snapshot.evictions)
        lease_c.release()

    def test_active_lease_is_never_evicted_and_overage_is_visible(self) -> None:
        disposed: list[str] = []
        manager: ResidencyManager[str, str] = ResidencyManager(8)
        lease_a = self.acquire(manager, "a", 6, disposed)
        lease_b = self.acquire(manager, "b", 6, disposed)

        snapshot = manager.snapshot()
        self.assertEqual(12, snapshot.resident_bytes)
        self.assertEqual(4, snapshot.over_budget_bytes)
        self.assertEqual({"a", "b"}, {entry.key for entry in snapshot.entries})

        lease_b.release()
        snapshot = manager.snapshot()
        self.assertEqual(["a"], [entry.key for entry in snapshot.entries])
        self.assertEqual(["b"], disposed)
        self.assertEqual(0, snapshot.over_budget_bytes)
        lease_a.release()

    def test_resource_larger_than_budget_is_reported_until_release(self) -> None:
        disposed: list[str] = []
        manager: ResidencyManager[str, str] = ResidencyManager(8)
        lease = self.acquire(manager, "large", 12, disposed)

        snapshot = manager.snapshot()
        self.assertEqual(4, snapshot.over_budget_bytes)
        self.assertEqual("active", snapshot.entries[0].state)

        lease.release()
        self.assertEqual(0, manager.snapshot().resident_bytes)
        self.assertEqual(["large"], disposed)

    def test_measured_load_size_corrects_estimate_before_return(self) -> None:
        disposed: list[str] = []
        manager: ResidencyManager[str, str] = ResidencyManager(10)
        self.acquire(manager, "warm", 4, disposed).release()

        lease = manager.acquire(
            "underestimated",
            estimated_bytes=3,
            loader=lambda: self.resource("underestimated", 8, disposed),
        )

        snapshot = manager.snapshot()
        self.assertEqual(["underestimated"], [entry.key for entry in snapshot.entries])
        self.assertEqual(["warm"], disposed)
        self.assertEqual(8, snapshot.resident_bytes)
        lease.release()

    def test_failed_load_releases_reservation_for_retry(self) -> None:
        manager: ResidencyManager[str, str] = ResidencyManager(10)

        def fail() -> LoadedResource[str]:
            raise RuntimeError("cold load failed")

        with self.assertRaisesRegex(RuntimeError, "cold load failed"):
            manager.acquire("a", estimated_bytes=7, loader=fail)

        self.assertEqual(0, manager.snapshot().resident_bytes)
        self.assertEqual(1, manager.snapshot().load_failures)

        disposed: list[str] = []
        lease = self.acquire(manager, "a", 7, disposed)
        self.assertEqual("a", lease.value)
        lease.release()

    def test_same_key_load_is_single_flight(self) -> None:
        manager: ResidencyManager[str, str] = ResidencyManager(10)
        load_started = threading.Event()
        allow_load = threading.Event()
        loads = []
        leases = []

        def loader() -> LoadedResource[str]:
            loads.append("a")
            load_started.set()
            self.assertTrue(allow_load.wait(timeout=2))
            return LoadedResource("a", 4, lambda value: None)

        def acquire() -> None:
            leases.append(manager.acquire("a", estimated_bytes=4, loader=loader))

        first = threading.Thread(target=acquire)
        second = threading.Thread(target=acquire)
        first.start()
        self.assertTrue(load_started.wait(timeout=2))
        second.start()
        time.sleep(0.02)
        allow_load.set()
        first.join(timeout=2)
        second.join(timeout=2)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(["a"], loads)
        self.assertEqual(2, manager.snapshot().entries[0].leases)
        self.assertEqual(1, manager.snapshot().hits)
        for lease in leases:
            lease.release()

    def test_resize_and_clear_preserve_active_resources(self) -> None:
        disposed: list[str] = []
        manager: ResidencyManager[str, str] = ResidencyManager(20)
        self.acquire(manager, "old", 5, disposed).release()
        active = self.acquire(manager, "active", 7, disposed)

        manager.resize(7)
        self.assertEqual(["old"], disposed)
        self.assertEqual(
            ["active"], [entry.key for entry in manager.snapshot().entries]
        )
        self.assertEqual((), manager.clear_warm())

        active.release()
        self.assertEqual(("active",), manager.clear_warm())
        self.assertEqual(["old", "active"], disposed)


if __name__ == "__main__":
    unittest.main()
