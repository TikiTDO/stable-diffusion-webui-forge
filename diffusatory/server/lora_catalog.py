from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from pydantic import BaseModel, Field


PREVIEW_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
NATIVE_SIDECAR_SUFFIX = ".diffusatory.json"


class LoraKeyword(BaseModel):
    text: str = Field(min_length=1)
    weight: float = Field(default=1.0, ge=-10.0, le=10.0)
    enabled: bool = True


class LoraDefaults(BaseModel):
    description: str = ""
    model_family: str = Field(default="unknown", pattern="^(sdxl|flux|unknown)$")
    preferred_strength: float = Field(default=1.0, ge=-10.0, le=10.0)
    keywords: list[LoraKeyword] = Field(default_factory=list)
    notes: str = ""


class LoraCatalogItem(BaseModel):
    id: str
    name: str
    alias: str
    reference: str
    relative_path: str
    folders: list[str]
    modified_at: float
    size_bytes: int
    model_family: str
    base_model: str | None
    preview_url: str | None
    description: str
    tags: list[str]
    recommended_keywords: list[str]
    defaults: LoraDefaults


def lora_id(filename: str | Path) -> str:
    resolved = str(Path(filename).resolve())
    return hashlib.sha256(resolved.encode("utf-8")).hexdigest()[:24]


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _clean_strings(values: Any, *, limit: int = 250) -> list[str]:
    if not isinstance(values, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        text = " ".join(value.split()).strip(" ,")
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        result.append(text)
        if len(result) >= limit:
            break
    return result


_WEIGHTED_TERM = re.compile(r"^\((.*):(-?\d+(?:\.\d+)?)\)$", re.DOTALL)
_LORA_DIRECTIVE = re.compile(r"<lora:[^>]+>", re.IGNORECASE)


def _split_prompt_terms(value: str) -> list[str]:
    """Split prompt commas while preserving grouped/dynamic-prompt recipes."""
    result: list[str] = []
    start = 0
    depth = {"(": 0, "[": 0, "{": 0}
    closing = {")": "(", "]": "[", "}": "{"}
    for index, character in enumerate(value):
        if character in depth:
            depth[character] += 1
        elif character in closing:
            opener = closing[character]
            depth[opener] = max(0, depth[opener] - 1)
        elif character == "," and not any(depth.values()):
            result.append(value[start:index])
            start = index + 1
    result.append(value[start:])
    return result


def _recommended_terms(values: Any) -> list[str]:
    """Normalize downloader vocabulary into prompt terms, not adapter directives.

    Some Civitai sidecars store one comma-delimited prompt, including the
    ``<lora:...>`` directive, as a single ``trainedWords`` entry. Adapter
    strength belongs to Diffusatory's LoRA control, so it must never leak into
    the independently-toggleable activation vocabulary.
    """
    if not isinstance(values, list):
        return []
    terms: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        without_directives = _LORA_DIRECTIVE.sub("", value)
        terms.extend(_split_prompt_terms(without_directives))
    return _clean_strings(terms)


def _parse_activation_text(value: Any) -> list[LoraKeyword]:
    if not isinstance(value, str):
        return []
    result: list[LoraKeyword] = []
    seen: set[str] = set()
    for part in _split_prompt_terms(value):
        text = _LORA_DIRECTIVE.sub("", part).strip()
        if not text:
            continue
        weight = 1.0
        matched = _WEIGHTED_TERM.match(text)
        if matched:
            text = matched.group(1).strip()
            try:
                weight = float(matched.group(2))
            except ValueError:
                weight = 1.0
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        result.append(LoraKeyword(text=text, weight=max(-10.0, min(10.0, weight))))
    return result


def _training_tags(metadata: dict[str, Any], *, limit: int = 128) -> list[str]:
    frequencies = metadata.get("ss_tag_frequency")
    if not isinstance(frequencies, dict):
        return []
    totals: Counter[str] = Counter()
    for group in frequencies.values():
        if not isinstance(group, dict):
            continue
        for tag, count in group.items():
            if not isinstance(tag, str):
                continue
            try:
                totals[tag.strip()] += int(count)
            except (TypeError, ValueError):
                continue
    return [tag for tag, _ in totals.most_common(limit) if tag]


def _model_family(
    network: Any,
    native: dict[str, Any],
    legacy: dict[str, Any],
    downloaded: dict[str, Any],
) -> str:
    candidates = [
        native.get("model_family"),
        legacy.get("sd version"),
        getattr(getattr(network, "sd_version", None), "name", None),
        downloaded.get("base_model"),
        downloaded.get("baseModel"),
        (downloaded.get("civitai") or {}).get("baseModel")
        if isinstance(downloaded.get("civitai"), dict)
        else None,
    ]
    for candidate in candidates:
        value = str(candidate or "").casefold()
        if "flux" in value:
            return "flux"
        if any(token in value for token in ("sdxl", "sd xl", "pony", "illustrious", "xl")):
            return "sdxl"
    return "unknown"


def _preview_path(model_path: Path) -> Path | None:
    for extension in PREVIEW_EXTENSIONS:
        candidate = model_path.with_suffix(extension)
        if candidate.is_file():
            return candidate
    return None


def _relative_path(model_path: Path, root: Path) -> Path:
    try:
        return model_path.resolve().relative_to(root.resolve())
    except ValueError:
        # A registered model outside the configured directory is still a real
        # Forge asset, but the browser must not receive its absolute location.
        return Path(model_path.name)


def build_lora_item(network: Any, root: str | Path) -> LoraCatalogItem:
    model_path = Path(network.filename)
    native = _read_json(model_path.with_suffix(NATIVE_SIDECAR_SUFFIX))
    legacy = _read_json(model_path.with_suffix(".json"))
    downloaded = _read_json(model_path.with_suffix(".metadata.json"))
    embedded = network.metadata if isinstance(network.metadata, dict) else {}

    civitai = downloaded.get("civitai")
    civitai = civitai if isinstance(civitai, dict) else {}
    recommended = _recommended_terms(civitai.get("trainedWords"))
    downloaded_tags = _clean_strings(downloaded.get("tags"))
    tags = _clean_strings([*downloaded_tags, *_training_tags(embedded)], limit=256)

    native_keywords: list[LoraKeyword] = []
    for value in native.get("default_keywords", []):
        if isinstance(value, str):
            native_keywords.append(LoraKeyword(text=value))
        elif isinstance(value, dict):
            try:
                native_keywords.append(LoraKeyword.model_validate(value))
            except ValueError:
                continue
    legacy_keywords = _parse_activation_text(legacy.get("activation text"))
    default_keywords = native_keywords or legacy_keywords or [
        LoraKeyword(text=text) for text in recommended
    ]

    family = _model_family(network, native, legacy, downloaded)
    preferred_strength = native.get(
        "preferred_strength", legacy.get("preferred weight", 1.0)
    )
    try:
        preferred_strength = float(preferred_strength)
    except (TypeError, ValueError):
        preferred_strength = 1.0
    if preferred_strength == 0:
        # Forge used zero as “use the global default”. Diffusatory stores the
        # actual value because zero is itself a meaningful adapter strength.
        preferred_strength = 1.0
    preferred_strength = max(-10.0, min(10.0, preferred_strength))

    description = next(
        (
            value
            for value in (
                native.get("description"),
                legacy.get("description"),
                downloaded.get("modelDescription"),
                downloaded.get("notes"),
            )
            if isinstance(value, str) and value.strip()
        ),
        "",
    )
    relative = _relative_path(model_path, Path(root))
    preview = _preview_path(model_path)
    identifier = lora_id(model_path)
    stats = model_path.stat()
    get_alias = getattr(network, "get_alias", None)
    reference = get_alias() if callable(get_alias) else getattr(network, "alias", network.name)
    return LoraCatalogItem(
        id=identifier,
        name=str(network.name),
        alias=str(getattr(network, "alias", network.name)),
        reference=str(reference),
        relative_path=relative.as_posix(),
        folders=list(relative.parts[:-1]),
        modified_at=stats.st_mtime,
        size_bytes=stats.st_size,
        model_family=family,
        base_model=str(downloaded.get("base_model") or civitai.get("baseModel") or "")
        or None,
        preview_url=(
            f"/diffusatory/api/v1/loras/{identifier}/preview?v={int(preview.stat().st_mtime)}"
            if preview
            else None
        ),
        description=description,
        tags=tags,
        recommended_keywords=recommended,
        defaults=LoraDefaults(
            description=description,
            model_family=family,
            preferred_strength=preferred_strength,
            keywords=default_keywords,
            notes=str(native.get("notes") or legacy.get("notes") or ""),
        ),
    )


def build_lora_catalog(
    networks: Iterable[Any], root: str | Path
) -> list[LoraCatalogItem]:
    items = [build_lora_item(network, root) for network in networks]
    return sorted(items, key=lambda item: item.relative_path.casefold())


def find_registered_lora(
    networks: Iterable[Any], identifier: str
) -> Any | None:
    return next(
        (network for network in networks if lora_id(network.filename) == identifier),
        None,
    )


def save_lora_defaults(network: Any, defaults: LoraDefaults) -> None:
    model_path = Path(network.filename)
    destination = model_path.with_suffix(NATIVE_SIDECAR_SUFFIX)
    payload = {
        "schema_version": 1,
        "description": defaults.description,
        "model_family": defaults.model_family,
        "preferred_strength": defaults.preferred_strength,
        "default_keywords": [keyword.model_dump() for keyword in defaults.keywords],
        "notes": defaults.notes,
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        dir=destination.parent, prefix=f".{destination.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def registered_lora_preview(network: Any) -> Path | None:
    return _preview_path(Path(network.filename))
