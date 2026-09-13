"""
Calibrate the Setting phase for the loaded checkpoint: the `prompt-switch-sweep` of 2026-09-12,
automated. Against a running server, renders a setting-only prompt, the full prompt, and
`[setting:full:k]` for k in the sweep, on two seeds, and measures each render's mean absolute
pixel distance to the setting-only one. Proposes the smallest k whose layout is close to the
setting's (distance under `--layout-fraction` of the full prompt's) — the point past which the
location holds and before which a subject still arrives. `--apply` records it in
`models/prompt-modes-calibration.json` for this checkpoint and sampler family; without it the
numbers are printed and nothing is written.

    venv/bin/python tools/calibrate_prompt_modes.py --base http://127.0.0.1:7870 [--apply]

The choice remains a judgement — look at the sheet it writes before applying. The default
`--layout-fraction` 0.35 is set so the proposal matches the operator's by-eye pick on Illustrious
(0.30 on 2026-09-12: at 0.20 the layout already mostly holds but the render is noisier and the
subject less settled); the distance measures the location holding, not the subject arriving.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

SETTING = ("masterpiece, best quality, a small city park at golden hour, wooden bench, gravel path, "
           "old lamp post, autumn trees, no humans, scenery")
SUBJECT = "1girl, long dark hair, black dress, sitting on the bench reading a book"
NEGATIVE = "lowres, worst quality, text, watermark"


def post(base, body):
    req = urllib.request.Request(f"{base}/sdapi/v1/txt2img", json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())


def render(base, prompt, seed, steps, sampler):
    d = post(base, {"prompt": prompt, "negative_prompt": NEGATIVE, "steps": steps, "width": 1024, "height": 1024,
                    "cfg_scale": 5, "sampler_name": sampler, "seed": seed})
    im = Image.open(io.BytesIO(base64.b64decode(d["images"][0]))).convert("RGB")
    info = json.loads(d["info"])
    return im, info


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:7870")
    ap.add_argument("--sampler", default="Euler a")
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--seeds", default="7,11")
    ap.add_argument("--ks", default="0.2,0.3,0.4")
    ap.add_argument("--layout-fraction", type=float, default=0.35, help="k counts as holding the layout when d(setting) < this × d(full)")
    ap.add_argument("--out", default="calibration-sweep")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    seeds = [int(s) for s in a.seeds.split(",")]
    ks = [float(k) for k in a.ks.split(",")]
    full = f"{SETTING.replace('no humans, ', '')}, {SUBJECT}"
    setting = SETTING.replace("no humans, ", "")
    os.makedirs(a.out, exist_ok=True)

    rows = {}
    checkpoint = None
    W = 256
    sheet = Image.new("RGB", (W * (len(ks) + 2), (W + 20) * len(seeds)), "white")
    draw = ImageDraw.Draw(sheet)
    for r, seed in enumerate(seeds):
        bg, info = render(a.base, setting, seed, a.steps, a.sampler)
        checkpoint = checkpoint or info.get("sd_model_hash")
        fl, _ = render(a.base, full, seed, a.steps, a.sampler)
        ref = np.asarray(bg.resize((W, W))).astype(np.float32) / 255
        d_full = float(np.abs(np.asarray(fl.resize((W, W))).astype(np.float32) / 255 - ref).mean())
        cells = [("setting", bg, 0.0), ("full", fl, d_full)]
        for k in ks:
            switch = max(1, round(k * a.steps))
            im, _ = render(a.base, f"[{setting}:{full}:{switch}]", seed, a.steps, a.sampler)
            d = float(np.abs(np.asarray(im.resize((W, W))).astype(np.float32) / 255 - ref).mean())
            rows.setdefault(k, []).append(d / d_full if d_full else 1.0)
            cells.append((f"k{k:.2f}", im, d))
        for c, (name, im, d) in enumerate(cells):
            sheet.paste(im.resize((W, W)), (c * W, r * (W + 20) + 20))
            draw.text((c * W + 4, r * (W + 20) + 4), f"{name} s{seed} d={d:.3f}", fill="black")
            im.save(os.path.join(a.out, f"{name}-s{seed}.png"))
    sheet.save(os.path.join(a.out, "sheet.png"))

    print(f"checkpoint {checkpoint} · {a.sampler} · {a.steps} steps · d relative to the full prompt's disturbance (1.0 = as far from the setting as `full` is)")
    chosen = None
    for k in ks:
        rel = sum(rows[k]) / len(rows[k])
        print(f"  k={k:.2f}  mean relative distance {rel:.2f}")
        if chosen is None and rel < a.layout_fraction:
            chosen = k
    if chosen is None:
        print("no k in the sweep held the layout; widen --ks")
        return 1
    print(f"proposed active_until = {chosen:.2f}  (sheet: {os.path.join(a.out, 'sheet.png')})")
    if a.apply:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from modules.prompt_modes.calibration import record
        record(checkpoint, a.sampler, chosen, f"calibrate_prompt_modes.py: seeds {a.seeds}, ks {a.ks}, layout-fraction {a.layout_fraction}")
        print("recorded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
