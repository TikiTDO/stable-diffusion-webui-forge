import unittest

from PIL import Image

from modules import layered_canvas


def pixel_layer(size, xy, colour):
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    image.putpixel(xy, colour)
    return image


class LayeredCanvasTests(unittest.TestCase):
    def setUp(self):
        self.source = Image.new("RGBA", (2, 2), (200, 0, 0, 255))
        self.paint = pixel_layer((2, 2), (0, 0), (0, 0, 200, 255))
        self.mask = pixel_layer((2, 2), (1, 1), (255, 255, 255, 255))
        self.editor = {
            "background": self.source,
            "layers": [self.paint, self.mask],
            "composite": Image.new("RGBA", (2, 2), "green"),
        }

    def test_generation_uses_source_and_paint_but_not_mask(self):
        image = layered_canvas.source_and_paint(self.editor)
        self.assertEqual((0, 0, 200, 255), image.getpixel((0, 0)))
        self.assertEqual((200, 0, 0, 255), image.getpixel((1, 1)))

    def test_inpaint_mask_uses_only_selection_alpha(self):
        mask = layered_canvas.inpaint_mask(self.editor)
        self.assertEqual((0, 0, 0, 255), mask.getpixel((0, 0)))
        self.assertEqual((255, 255, 255, 255), mask.getpixel((1, 1)))

    def test_drawing_without_an_uploaded_source_becomes_the_image(self):
        visible_mask = pixel_layer(self.paint.size, (1, 1), (40, 220, 40, 255))
        editor = {"background": None, "layers": [self.paint, visible_mask], "composite": None}
        image = layered_canvas.source_and_paint(editor)
        self.assertEqual(self.paint.size, image.size)
        self.assertEqual((0, 0, 200, 255), image.getpixel((0, 0)))
        self.assertEqual((255, 255, 255, 255), image.getpixel((1, 1)))

    def test_empty_canvas_still_needs_a_stroke(self):
        with self.assertRaisesRegex(ValueError, "draw on the empty canvas"):
            layered_canvas.source_and_paint(None)


if __name__ == "__main__":
    unittest.main()
