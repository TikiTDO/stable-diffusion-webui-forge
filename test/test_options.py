import unittest
from unittest.mock import patch

from modules.options import OptionInfo, Options


class OptionsTest(unittest.TestCase):
    def test_setting_missing_option_to_its_default_is_unchanged(self):
        options = Options({"preview_interval": OptionInfo(10)}, restricted_opts=set())
        options.data.clear()

        changed = options.set("preview_interval", 10)

        self.assertFalse(changed)
        self.assertNotIn("preview_interval", options.data)

    def test_failed_callback_restores_missing_option(self):
        def fail():
            raise RuntimeError("callback failed")

        options = Options(
            {"preview_interval": OptionInfo(10, onchange=fail)},
            restricted_opts=set(),
        )
        options.data.clear()

        with patch("modules.options.errors.display"):
            changed = options.set("preview_interval", 5)

        self.assertFalse(changed)
        self.assertEqual(10, options.preview_interval)
        self.assertNotIn("preview_interval", options.data)


if __name__ == "__main__":
    unittest.main()
