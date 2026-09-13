"""
Per-checkpoint calibration of the setting phase: how far into the run the location prompt should
own the conditioning before the rest joins. A property of the checkpoint and sampler family, not
a user knob — the UI slider is an override of this value.

Stored as JSON beside the models (`models/prompt-modes-calibration.json`), keyed by checkpoint
short hash, then sampler family. Measured values are recorded with their date and procedure;
the procedure is the `prompt-switch-sweep` (bg / full / k∈{0.2,0.3,0.4} on two seeds, pixel
distance of each to the bg-only render, choose the smallest k whose subject still arrives).
"""

from __future__ import annotations

import json
import os

from modules.paths_internal import models_path

DEFAULT_ACTIVE_UNTIL = 0.30  # Illustrious / Euler a / 20 steps, measured 2026-09-12; the fallback everywhere

_PATH = os.path.join(models_path, "prompt-modes-calibration.json")


def _family(sampler_name: str | None) -> str:
    name = (sampler_name or "").lower()
    if "dpm" in name:
        return "dpm"
    if "euler" in name:
        return "euler"
    return "other"


def _load() -> dict:
    try:
        with open(_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def active_until_for(checkpoint_hash: str | None, sampler_name: str | None) -> float:
    data = _load()
    entry = data.get(checkpoint_hash or "", {}) if isinstance(data, dict) else {}
    by_family = entry.get("active_until", {}) if isinstance(entry, dict) else {}
    value = by_family.get(_family(sampler_name), by_family.get("euler"))
    try:
        return float(value)
    except (TypeError, ValueError):
        return DEFAULT_ACTIVE_UNTIL


def record(checkpoint_hash: str, sampler_name: str | None, value: float, note: str) -> None:
    data = _load()
    entry = data.setdefault(checkpoint_hash, {})
    entry.setdefault("active_until", {})[_family(sampler_name)] = float(value)
    entry.setdefault("notes", []).append(note)
    os.makedirs(os.path.dirname(_PATH), exist_ok=True)
    with open(_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
