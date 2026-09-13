import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Img2ImgCallbackTests(unittest.TestCase):
    def test_public_callback_preserves_gradio_request_injection(self):
        tree = ast.parse((ROOT / "modules" / "img2img.py").read_text())
        callback = next(
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "img2img"
        )

        self.assertEqual(["id_task", "request"], [arg.arg for arg in callback.args.args])
        self.assertEqual("gr.Request", ast.unparse(callback.args.args[1].annotation))
        self.assertEqual("args", callback.args.vararg.arg)


if __name__ == "__main__":
    unittest.main()
