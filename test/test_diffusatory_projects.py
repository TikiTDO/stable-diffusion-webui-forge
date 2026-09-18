import base64
import tempfile
import unittest
from pathlib import Path

from diffusatory.server.projects import ORDER_STEP, ProjectStore, project_id_for


def encoded(seed: bytes) -> str:
    return base64.b64encode(b"\x89PNG" + seed).decode("ascii")


class DiffusatoryProjectTests(unittest.TestCase):
    def setUp(self) -> None:
        self._directory = tempfile.TemporaryDirectory()
        self.store = ProjectStore(Path(self._directory.name))
        self.project = self.store.create_project("Green Hill, act one").id

    def tearDown(self) -> None:
        self._directory.cleanup()

    def names(self) -> list[str]:
        return [image.name for image in self.store.images(self.project)]

    def test_project_id_is_a_slug_of_the_name(self) -> None:
        self.assertEqual("green-hill-act-one", project_id_for("Green Hill, act one"))
        self.assertEqual("green-hill-act-one", self.project)
        self.assertEqual("Green Hill, act one", self.store.project(self.project).name)

    def test_images_append_with_a_spaced_order_and_a_content_hash(self) -> None:
        first = self.store.add_image(self.project, encoded(b"a"))
        second = self.store.add_image(self.project, encoded(b"b"))

        self.assertEqual(ORDER_STEP, first.order)
        self.assertEqual(2 * ORDER_STEP, second.order)
        self.assertRegex(first.name, r"^\d{12}-[0-9a-f]{12}\.png$")
        self.assertEqual([first.name, second.name], self.names())

    def test_data_url_prefix_is_accepted(self) -> None:
        image = self.store.add_image(self.project, "data:image/png;base64," + encoded(b"z"))
        self.assertEqual(4 + 1, image.bytes)

    def test_insert_between_two_images_is_a_midpoint_and_renames_nothing(self) -> None:
        first = self.store.add_image(self.project, encoded(b"a"))
        second = self.store.add_image(self.project, encoded(b"b"))

        middle = self.store.add_image(
            self.project, encoded(b"m"), after=first.name, before=second.name
        )

        self.assertEqual((first.order + second.order) // 2, middle.order)
        self.assertEqual([first.name, middle.name, second.name], self.names())

    def test_insert_before_the_first_image_takes_half_its_key(self) -> None:
        first = self.store.add_image(self.project, encoded(b"a"))
        front = self.store.add_image(self.project, encoded(b"f"), before=first.name)
        self.assertEqual(first.order // 2, front.order)
        self.assertEqual([front.name, first.name], self.names())

    def test_a_closed_gap_renumbers_only_the_run_to_the_right(self) -> None:
        a = self.store.add_image(self.project, encoded(b"a"))
        b = self.store.add_image(self.project, encoded(b"b"))
        c = self.store.add_image(self.project, encoded(b"c"))
        # Exhaust the gap between a and b by halving until it is 1 wide.
        left = a.name
        right = b.name
        inserted = []
        while True:
            images = {image.name: image for image in self.store.images(self.project)}
            if images[right].order - images[left].order < 2:
                break
            item = self.store.add_image(self.project, encoded(str(len(inserted)).encode()), after=left, before=right)
            inserted.append(item.digest)
            left = item.name

        before = self.store.images(self.project)
        order_of_a = before[0].order
        forced = self.store.add_image(self.project, encoded(b"forced"), after=left, before=right)

        after = self.store.images(self.project)
        # a keeps its key; everything from the left neighbour rightwards is respaced.
        self.assertEqual(order_of_a, after[0].order)
        digests = [image.digest for image in after]
        self.assertEqual(digests.index(forced.digest), len(inserted) + 1)
        self.assertEqual(digests[-1], c.digest)
        orders = [image.order for image in after]
        self.assertEqual(orders, sorted(orders))
        self.assertTrue(all(y - x >= ORDER_STEP for x, y in zip(orders[len(inserted):], orders[len(inserted) + 1:])))
        # Every file on disk is still exactly one image.
        self.assertEqual(len(after), len(list(Path(self._directory.name, self.project).glob("*.png"))))

    def test_move_renames_one_file(self) -> None:
        a = self.store.add_image(self.project, encoded(b"a"))
        b = self.store.add_image(self.project, encoded(b"b"))
        c = self.store.add_image(self.project, encoded(b"c"))

        moved = self.store.move_image(self.project, c.name, before=a.name)

        self.assertEqual(c.digest, moved.digest)
        self.assertEqual([moved.name, a.name, b.name], self.names())

    def test_unknown_neighbour_and_unknown_project_are_not_found(self) -> None:
        with self.assertRaises(FileNotFoundError):
            self.store.add_image(self.project, encoded(b"a"), after="000000000001-000000000000.png")
        with self.assertRaises(FileNotFoundError):
            self.store.images("no-such-project")
        with self.assertRaises(FileNotFoundError):
            self.store.images("../escape")


if __name__ == "__main__":
    unittest.main()
