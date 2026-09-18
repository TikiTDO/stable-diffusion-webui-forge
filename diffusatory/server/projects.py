"""Projects: a directory each, holding ordered copies of chosen images.

A project is nothing but a folder under the projects root. Every image in it is
named ``<order>-<hash>.<ext>``: a twelve-digit order key and the first twelve
hex digits of the file's SHA-256. The key is spaced so that placing an image
between two neighbours is a rename of one file; only when two neighbours become
adjacent does the run between them get renumbered, and only that run.
"""

from __future__ import annotations

import base64
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field

ORDER_DIGITS = 12
ORDER_STEP = 1 << 20  # Room for twenty halvings between any two neighbours.
ORDER_LIMIT = 10**ORDER_DIGITS
HASH_DIGITS = 12
IMAGE_NAME = re.compile(
    rf"^(?P<order>\d{{{ORDER_DIGITS}}})-(?P<digest>[0-9a-f]{{{HASH_DIGITS}}})\.(?P<ext>[a-z0-9]+)$"
)
PROJECT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}


class ProjectDescriptor(BaseModel):
    id: str
    name: str
    image_count: int


class ProjectImage(BaseModel):
    name: str
    order: int
    digest: str
    bytes: int


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ProjectImageAdd(BaseModel):
    """An image to copy in, as the API hands it out (base64, optional data URL)."""

    image: str = Field(min_length=1)
    extension: str = Field(default="png", pattern="^(png|jpe?g|webp)$")
    after: str | None = None
    before: str | None = None


class ProjectImageMove(BaseModel):
    after: str | None = None
    before: str | None = None


@dataclass(frozen=True)
class _Entry:
    path: Path
    order: int
    digest: str
    ext: str

    @property
    def name(self) -> str:
        return self.path.name


def project_id_for(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64]
    if not slug:
        raise ValueError("a project needs at least one letter or digit in its name")
    return slug


def default_projects_root() -> Path:
    # Lazy, like the wildcard root: the compiler stays independently testable
    # and production binds to Forge's data root.
    from modules.paths_internal import data_path

    return Path(data_path) / "projects"


class ProjectStore:
    def __init__(self, root: Path):
        self.root = root

    # -- projects -----------------------------------------------------------

    def list_projects(self) -> list[ProjectDescriptor]:
        if not self.root.is_dir():
            return []
        return [
            self._describe(path)
            for path in sorted(self.root.iterdir())
            if path.is_dir() and PROJECT_ID.match(path.name)
        ]

    def create_project(self, name: str) -> ProjectDescriptor:
        identifier = project_id_for(name)
        path = self.root / identifier
        if path.exists():
            raise FileExistsError(identifier)
        path.mkdir(parents=True)
        (path / ".name").write_text(name, encoding="utf-8")
        return self._describe(path)

    def project(self, identifier: str) -> ProjectDescriptor:
        return self._describe(self._project_path(identifier))

    def images(self, identifier: str) -> list[ProjectImage]:
        return [
            ProjectImage(
                name=entry.name,
                order=entry.order,
                digest=entry.digest,
                bytes=entry.path.stat().st_size,
            )
            for entry in self._entries(self._project_path(identifier))
        ]

    # -- images -------------------------------------------------------------

    def add_image(
        self,
        identifier: str,
        encoded: str,
        *,
        extension: str = "png",
        after: str | None = None,
        before: str | None = None,
    ) -> ProjectImage:
        directory = self._project_path(identifier)
        extension = "jpg" if extension == "jpeg" else extension
        if extension not in ALLOWED_EXTENSIONS:
            raise ValueError(f"unsupported image extension: {extension}")
        payload = base64.b64decode(encoded.split(",", 1)[-1], validate=True)
        digest = hashlib.sha256(payload).hexdigest()[:HASH_DIGITS]
        entries = self._entries(directory)
        order = self._order_between(directory, entries, after, before)
        path = directory / self._file_name(order, digest, extension)
        path.write_bytes(payload)
        return ProjectImage(name=path.name, order=order, digest=digest, bytes=len(payload))

    def move_image(
        self,
        identifier: str,
        name: str,
        *,
        after: str | None = None,
        before: str | None = None,
    ) -> ProjectImage:
        directory = self._project_path(identifier)
        entry = self._entry(directory, name)
        others = [item for item in self._entries(directory) if item.name != name]
        order = self._order_between(directory, others, after, before)
        target = directory / self._file_name(order, entry.digest, entry.ext)
        entry.path.rename(target)
        return ProjectImage(
            name=target.name, order=order, digest=entry.digest, bytes=target.stat().st_size
        )

    def remove_image(self, identifier: str, name: str) -> None:
        entry = self._entry(self._project_path(identifier), name)
        entry.path.unlink()

    def image_path(self, identifier: str, name: str) -> Path:
        return self._entry(self._project_path(identifier), name).path

    # -- ordering -----------------------------------------------------------

    def _order_between(
        self,
        directory: Path,
        entries: list[_Entry],
        after: str | None,
        before: str | None,
    ) -> int:
        """Pick an order key strictly between two neighbours, renumbering only if forced.

        ``after``/``before`` name existing images. Neither → append. Only
        ``before`` → in front of it. Only ``after`` → right behind it, ahead
        of whatever followed.
        """
        by_name = {entry.name: entry for entry in entries}
        if after is not None and after not in by_name:
            raise FileNotFoundError(after)
        if before is not None and before not in by_name:
            raise FileNotFoundError(before)

        if after is None and before is None:
            return (entries[-1].order + ORDER_STEP) if entries else ORDER_STEP

        if after is not None:
            index = entries.index(by_name[after])
            low = by_name[after].order
            high = entries[index + 1].order if index + 1 < len(entries) else None
        else:
            index = entries.index(by_name[before])
            high = by_name[before].order
            low = entries[index - 1].order if index > 0 else 0
        if before is not None and after is not None and not (low < high):
            raise ValueError("`after` must come before `before`")

        if high is None:
            return low + ORDER_STEP
        if high - low >= 2:
            return (low + high) // 2

        # The gap closed. Renumber the run to the right of the left neighbour,
        # spacing by two steps, and take the first step for the new image.
        if low == 0:
            # Nothing to the left: shift every image up one slot.
            plan = [(entry, (position + 2) * ORDER_STEP) for position, entry in enumerate(entries)]
            self._apply_renumber(directory, plan)
            return ORDER_STEP
        start = index if after is not None else index - 1
        cursor = low
        plan = []
        for entry in entries[start + 1 :]:
            cursor += 2 * ORDER_STEP
            plan.append((entry, cursor))
        self._apply_renumber(directory, plan)
        return low + ORDER_STEP

    def _apply_renumber(self, directory: Path, plan: list[tuple[_Entry, int]]) -> None:
        # Orders only ever move up, so renaming from the end never collides.
        for entry, order in reversed(plan):
            if order != entry.order:
                entry.path.rename(directory / self._file_name(order, entry.digest, entry.ext))

    # -- helpers ------------------------------------------------------------

    def _project_path(self, identifier: str) -> Path:
        if not PROJECT_ID.match(identifier):
            raise FileNotFoundError(identifier)
        path = self.root / identifier
        if not path.is_dir():
            raise FileNotFoundError(identifier)
        return path

    def _describe(self, path: Path) -> ProjectDescriptor:
        name_file = path / ".name"
        name = name_file.read_text(encoding="utf-8").strip() if name_file.is_file() else path.name
        return ProjectDescriptor(
            id=path.name, name=name or path.name, image_count=len(self._entries(path))
        )

    def _entries(self, directory: Path) -> list[_Entry]:
        entries = []
        for path in directory.iterdir():
            match = IMAGE_NAME.match(path.name)
            if match and path.is_file():
                entries.append(
                    _Entry(
                        path=path,
                        order=int(match["order"]),
                        digest=match["digest"],
                        ext=match["ext"],
                    )
                )
        entries.sort(key=lambda entry: (entry.order, entry.digest))
        return entries

    def _entry(self, directory: Path, name: str) -> _Entry:
        for entry in self._entries(directory):
            if entry.name == name:
                return entry
        raise FileNotFoundError(name)

    @staticmethod
    def _file_name(order: int, digest: str, ext: str) -> str:
        if not 0 < order < ORDER_LIMIT:
            raise ValueError(f"order key out of range: {order}")
        return f"{order:0{ORDER_DIGITS}d}-{digest}.{ext}"


__all__ = [
    "ProjectCreate",
    "ProjectDescriptor",
    "ProjectImage",
    "ProjectImageAdd",
    "ProjectImageMove",
    "ProjectStore",
    "default_projects_root",
    "project_id_for",
]
