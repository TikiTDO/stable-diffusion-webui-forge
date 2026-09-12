#!/usr/bin/env python3
"""Walk the /sdapi/v1 surface of a running Forge and say, per endpoint, works or broken (with the
exact error) — not merely 200. Stdlib only, so it runs from any shell:

    python3 test/api_smoke.py --base http://127.0.0.1:7865 [--generate]

Without --generate it reads only. With it, txt2img (64x64, 4 steps) and img2img (on that output)
run for real, and png-info / interrogate are fed the result. The instance must have been launched
with --api; a 404 on every /sdapi/v1 route means it was not, which the report says in one line.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
import urllib.error
import urllib.request

READ_ENDPOINTS = [
    ("options", dict),
    ("cmd-flags", dict),
    ("sd-models", list),
    ("sd-modules", list),
    ("samplers", list),
    ("schedulers", list),
    ("upscalers", list),
    ("latent-upscale-modes", list),
    ("loras", list),
    ("embeddings", dict),
    ("hypernetworks", list),
    ("prompt-styles", list),
    ("scripts", dict),
    ("script-info", list),
    ("progress", dict),
    ("memory", dict),
    ("extensions", list),
]
CONTROLNET_ENDPOINTS = [
    ("controlnet/model_list", dict),
    ("controlnet/module_list", dict),
    ("controlnet/control_types", dict),
]


def call(base: str, path: str, payload: dict | None = None, timeout: float = 600) -> tuple[int, object, float]:
    url = f"{base.rstrip('/')}/{path.lstrip('/')}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            code = resp.status
    except urllib.error.HTTPError as err:
        body = err.read()
        code = err.code
    except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
        return 0, f"{type(err).__name__}: {err}", time.monotonic() - started
    elapsed = time.monotonic() - started
    try:
        return code, json.loads(body), elapsed
    except json.JSONDecodeError:
        return code, body[:300].decode(errors="replace"), elapsed


def describe(value: object) -> str:
    if isinstance(value, list):
        return f"list[{len(value)}]"
    if isinstance(value, dict):
        keys = ", ".join(list(value)[:5])
        return f"dict[{len(value)}] {keys}{', …' if len(value) > 5 else ''}"
    return repr(value)[:120]


def verdict(code: int, body: object, shape: type) -> tuple[bool, str]:
    if code != 200:
        detail = body.get("detail") if isinstance(body, dict) else body
        return False, f"HTTP {code}: {json.dumps(detail)[:200] if not isinstance(detail, str) else detail[:200]}"
    if not isinstance(body, shape):
        return False, f"200 but body is {type(body).__name__}, expected {shape.__name__}"
    return True, describe(body)


def tiny_png() -> str:
    # 8x8 mid-grey PNG, built without PIL so the script stays stdlib.
    import struct
    import zlib

    width = height = 8
    raw = b"".join(b"\x00" + b"\x80\x80\x80" * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    return base64.b64encode(png).decode()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://127.0.0.1:7860")
    parser.add_argument("--generate", action="store_true", help="also run txt2img/img2img/png-info/interrogate")
    parser.add_argument("--json", action="store_true", help="machine-readable report")
    args = parser.parse_args()

    rows: list[dict] = []

    def record(name: str, ok: bool, note: str, elapsed: float) -> None:
        rows.append({"endpoint": name, "ok": ok, "note": note, "seconds": round(elapsed, 2)})

    for path, shape in READ_ENDPOINTS:
        code, body, elapsed = call(args.base, f"sdapi/v1/{path}", timeout=30)
        ok, note = verdict(code, body, shape)
        record(path, ok, note, elapsed)

    for path, shape in CONTROLNET_ENDPOINTS:
        code, body, elapsed = call(args.base, path, timeout=30)
        ok, note = verdict(code, body, shape)
        record(path, ok, note, elapsed)

    if args.generate:
        prompt = {"prompt": "a red square", "steps": 4, "width": 64, "height": 64, "cfg_scale": 1.0, "seed": 1}
        code, body, elapsed = call(args.base, "sdapi/v1/txt2img", prompt)
        ok, note = verdict(code, body, dict)
        image = None
        if ok:
            images = body.get("images") or []
            info = body.get("info")
            ok = bool(images) and isinstance(info, str)
            note = f"{len(images)} image(s), info {'present' if isinstance(info, str) else 'MISSING'}"
            image = images[0] if images else None
        record("txt2img", ok, note, elapsed)

        source = image or tiny_png()
        code, body, elapsed = call(
            args.base,
            "sdapi/v1/img2img",
            {**prompt, "init_images": [source], "denoising_strength": 0.5},
        )
        ok, note = verdict(code, body, dict)
        if ok:
            ok = bool(body.get("images"))
            note = f"{len(body.get('images') or [])} image(s)"
        record("img2img", ok, note, elapsed)

        code, body, elapsed = call(args.base, "sdapi/v1/png-info", {"image": source})
        ok, note = verdict(code, body, dict)
        if ok:
            note = f"info {len(body.get('info') or '')} chars, items {list((body.get('items') or {}))[:4]}"
        record("png-info", ok, note, elapsed)

        code, body, elapsed = call(args.base, "sdapi/v1/interrogate", {"image": source, "model": "clip"})
        ok, note = verdict(code, body, dict)
        if ok:
            note = f"caption {json.dumps(body.get('caption'))[:80]}"
        record("interrogate", ok, note, elapsed)

    all_404 = all((not r["ok"] and r["note"].startswith("HTTP 404")) for r in rows if "/" not in r["endpoint"])
    if args.json:
        print(json.dumps({"base": args.base, "api_mounted": not all_404, "rows": rows}, indent=2))
    else:
        width = max(len(r["endpoint"]) for r in rows)
        for r in rows:
            mark = "ok    " if r["ok"] else "BROKEN"
            print(f"{mark} {r['endpoint']:<{width}}  {r['seconds']:>6.2f}s  {r['note']}")
        if all_404:
            print("\nevery /sdapi/v1 route is 404: the instance was launched without --api")
    broken = [r for r in rows if not r["ok"]]
    print(f"\n{len(rows) - len(broken)} ok, {len(broken)} broken against {args.base}", file=sys.stderr)
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
