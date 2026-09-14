import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

from diffusatory.server.forge_residency import (
    ForgeResidencyController,
    estimate_model_bytes,
    forge_model_key,
    measure_model_bytes,
)


class FakePatcher:
    def __init__(self, model: object, size: int) -> None:
        self.model = model
        self._size = size

    def model_size(self) -> int:
        return self._size


@dataclass
class FakeComponent:
    patcher: FakePatcher


class FakeObjects:
    def __init__(self, unet, clip=None, vae=None, clipvision=None) -> None:
        self.unet = unet
        self.clip = clip
        self.vae = vae
        self.clipvision = clipvision

    def shallow_copy(self):
        return FakeObjects(self.unet, self.clip, self.vae, self.clipvision)


class FakeModel:
    def __init__(self, size: int) -> None:
        backing = object()
        patcher = FakePatcher(backing, size)
        self.forge_objects_original = FakeObjects(
            patcher,
            clip=FakeComponent(patcher),
        )
        self.forge_objects = self.forge_objects_original.shallow_copy()
        self.forge_objects_after_applying_lora = (
            self.forge_objects_original.shallow_copy()
        )
        self.current_lora_hash = "patched"
        self.text_processing_engine_test = object()


class ForgeResidencyTests(unittest.TestCase):
    def key(self, directory: str, name: str, size: int):
        path = Path(directory) / name
        path.write_bytes(b"x" * size)
        return forge_model_key(path, (), None)

    def test_file_payloads_form_the_cold_load_estimate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "checkpoint"
            module = Path(directory) / "vae"
            checkpoint.write_bytes(b"x" * 7)
            module.write_bytes(b"x" * 3)

            key = forge_model_key(
                checkpoint,
                (module,),
                "nf4",
                runtime_signature=("classic",),
            )

            self.assertEqual(10, estimate_model_bytes(key))
            self.assertEqual("nf4", key.unet_storage_dtype)
            self.assertEqual(("classic",), key.runtime_signature)

    def test_measurement_counts_shared_backing_model_once(self) -> None:
        self.assertEqual(7, measure_model_bytes(FakeModel(7)))

    def test_switch_back_is_warm_and_normalizes_lora_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            unloaded = []
            emptied = []
            collected = []
            current = [None]
            controller = ForgeResidencyController(
                capacity_bytes=20,
                unload_devices=lambda: unloaded.append(True),
                empty_device_cache=lambda: emptied.append(True),
                collect=lambda: collected.append(True) or 0,
            )
            key_a = self.key(directory, "a", 4)
            key_b = self.key(directory, "b", 5)
            loads = []

            def load(name: str, size: int):
                def perform():
                    loads.append(name)
                    return FakeModel(size)

                return perform

            def detach() -> None:
                current[0] = None

            first = controller.switch(
                key_a,
                estimated_bytes=4,
                loader=load("a", 4),
                detach_current=detach,
            )
            current[0] = first.model
            self.assertFalse(first.cache_hit)

            second = controller.switch(
                key_b,
                estimated_bytes=5,
                loader=load("b", 5),
                detach_current=detach,
            )
            current[0] = second.model
            self.assertEqual(str([]), first.model.current_lora_hash)

            third = controller.switch(
                key_a,
                estimated_bytes=4,
                loader=load("a", 4),
                detach_current=detach,
            )
            current[0] = third.model

            self.assertTrue(third.cache_hit)
            self.assertIs(first.model, third.model)
            self.assertEqual(["a", "b"], loads)
            self.assertEqual(2, len(unloaded))
            self.assertEqual(2, len(emptied))
            self.assertEqual(2, len(collected))

    def test_budget_evicts_oldest_model_and_severs_engine_references(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            controller = ForgeResidencyController(
                capacity_bytes=6,
                unload_devices=lambda: None,
                empty_device_cache=lambda: None,
                collect=lambda: 0,
            )
            key_a = self.key(directory, "a", 4)
            key_b = self.key(directory, "b", 4)
            model_a = FakeModel(4)
            model_b = FakeModel(4)

            first = controller.switch(
                key_a,
                estimated_bytes=4,
                loader=lambda: model_a,
                detach_current=lambda: None,
            )
            self.assertIs(model_a, first.model)
            controller.switch(
                key_b,
                estimated_bytes=4,
                loader=lambda: model_b,
                detach_current=lambda: None,
            )

            self.assertIsNone(model_a.forge_objects_original)
            self.assertIsNone(model_a.text_processing_engine_test)
            snapshot = controller.snapshot()
            self.assertEqual([key_b], [entry.key for entry in snapshot.entries])
            self.assertEqual(1, snapshot.evictions)


if __name__ == "__main__":
    unittest.main()
