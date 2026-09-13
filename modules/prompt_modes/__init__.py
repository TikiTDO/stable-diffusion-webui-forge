"""
Prompt modes: the variable-prompt model from the 2026-09-12 feature plan.

With nothing set there is one prompt. A mode adds prompt boxes with defined roles, and the server
realizes them into what the sampler sees — the schedule string is derived here and never typed by
a client. The API object:

    prompts:
      base: str            negative: str
      setting?: { text, active_until: 0..1 | None, alone: bool }
      groups?:  [ { name, spans: [ { box, start, end } ], enabled } ]
      regions?: reserved (the attention path lands with it; rejected until then)

`setting` is the location prompt. It conditions the run alone (or with base, when `alone` is off)
from step one until `active_until` of the steps, then the full prompt joins. The default
`active_until` comes from the per-checkpoint calibration (`calibration.py`); measured on
Illustrious / Euler a / 20 steps the layout is decided in the first steps and a subject can still
be introduced up to ~0.35, so 0.30 is the calibrated default there. The setting prompt must own
step one: a combo prompt for even two steps fixes the combo layout (measured 2026-09-12).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from modules.prompt_modes.calibration import active_until_for


@dataclass
class Span:
    box: str  # "base" | "negative" | "setting"
    start: int
    end: int


@dataclass
class Group:
    name: str
    spans: list[Span]
    enabled: bool = True


@dataclass
class Setting:
    text: str
    active_until: float | None = None
    alone: bool = True


@dataclass
class Prompts:
    base: str = ""
    negative: str = ""
    setting: Setting | None = None
    groups: list[Group] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> "Prompts":
        if "regions" in d and d["regions"]:
            raise ValueError("prompts.regions is not realized on this server yet")
        setting = d.get("setting")
        groups = [
            Group(g["name"], [Span(s["box"], int(s["start"]), int(s["end"])) for s in g.get("spans", [])], bool(g.get("enabled", True)))
            for g in d.get("groups") or []
        ]
        return cls(
            base=d.get("base", "") or "",
            negative=d.get("negative", "") or "",
            setting=Setting(setting["text"], setting.get("active_until"), bool(setting.get("alone", True))) if setting and setting.get("text") else None,
            groups=groups,
        )


def _apply_groups(text: str, box: str, groups: list[Group]) -> str:
    """Remove the spans of disabled groups from one box; membership is never written into the text."""
    cut = sorted(
        (span.start, span.end)
        for group in groups
        if not group.enabled
        for span in group.spans
        if span.box == box
    )
    if not cut:
        return text
    out, pos = [], 0
    for start, end in cut:
        start, end = max(start, pos), min(end, len(text))
        if end <= start:
            continue
        out.append(text[pos:start])
        pos = end
    out.append(text[pos:])
    # Re-join what is left as a clean comma list: no dangling separators where a span was cut.
    pieces = [piece.strip() for part in out for piece in part.split(",") if piece.strip()]
    return ", ".join(pieces)


def _join(*parts: str) -> str:
    return ", ".join(part.strip().strip(",").strip() for part in parts if part and part.strip())


@dataclass
class Realized:
    prompt: str
    negative: str
    schedule: dict | None  # what was derived, for the infotext / caller


def realize(prompts: Prompts, checkpoint_hash: str | None, sampler_name: str | None, steps: int) -> Realized:
    """The prompt and negative the sampler sees; the schedule is a fact of the prompt string."""
    base = _apply_groups(prompts.base, "base", prompts.groups)
    negative = _apply_groups(prompts.negative, "negative", prompts.groups)
    if prompts.setting is None:
        return Realized(base, negative, None)

    setting_text = _apply_groups(prompts.setting.text, "setting", prompts.groups)
    until = prompts.setting.active_until
    if until is None:
        until = active_until_for(checkpoint_hash, sampler_name)
    until = min(max(float(until), 0.0), 1.0)
    switch_step = max(1, round(until * steps))

    early = setting_text if prompts.setting.alone else _join(setting_text, base)
    late = _join(setting_text, base)
    if until >= 1.0:
        prompt = early
    elif early == late:
        # `alone` off with no region prompts: the setting phase already carries everything, so
        # there is nothing to switch to. (Regions, when they land, are what join late here.)
        prompt = late
    else:
        # Forge's prompt editing: `[early:late:N]` — `early` through step N, `late` after.
        prompt = f"[{early}:{late}:{switch_step}]"
    return Realized(prompt, negative, {"setting_active_until": until, "setting_switch_step": switch_step, "setting_alone": prompts.setting.alone})
