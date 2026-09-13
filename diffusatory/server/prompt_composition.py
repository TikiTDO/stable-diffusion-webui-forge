from __future__ import annotations

import itertools
import re
import secrets
from collections.abc import Iterable
from pathlib import Path
from typing import Literal

import dynamicprompts
from dynamicprompts.generators import (
    CombinatorialPromptGenerator,
    RandomPromptGenerator,
)
from dynamicprompts.generators.promptgenerator import GeneratorException
from dynamicprompts.wildcards import WildcardManager
from pydantic import BaseModel, Field
from pyparsing.exceptions import ParseBaseException


PromptExpansionMode = Literal["off", "random", "exhaustive"]
PromptField = Literal["prompt", "negative_prompt"]

WILDCARD_REFERENCE = re.compile(r"__(.+?)__")
MAX_REALIZATIONS = 8
MAX_EXPANSION_SEED = 2**31 - 1


class PromptExpansionRequest(BaseModel):
    prompt: str = ""
    negative_prompt: str = ""
    mode: PromptExpansionMode = "off"
    candidate_count: int = Field(default=1, ge=1, le=MAX_REALIZATIONS)
    expansion_seed: int | None = Field(
        default=None,
        ge=0,
        le=MAX_EXPANSION_SEED,
    )


class PromptExpansionIssue(BaseModel):
    code: str
    message: str
    field: PromptField
    blocking: bool = True


class PromptRealization(BaseModel):
    index: int
    prompt: str
    negative_prompt: str


class PromptExpansionResponse(BaseModel):
    mode: PromptExpansionMode
    source_prompt: str
    source_negative_prompt: str
    requested_count: int
    resolved_count: int
    expansion_seed: int
    engine: str
    realizations: list[PromptRealization]
    issues: list[PromptExpansionIssue]
    truncated: bool = False


def default_wildcard_root() -> Path:
    # Importing the path selector lazily keeps the compiler independently
    # testable and still binds production requests to Forge's own data root.
    from modules.paths_internal import data_path

    return Path(data_path) / "wildcards"


def _wildcard_references(text: str) -> set[str]:
    return {match.group(1).strip() for match in WILDCARD_REFERENCE.finditer(text)}


def _wildcard_issues(
    manager: WildcardManager,
    source: str,
    field: PromptField,
) -> list[PromptExpansionIssue]:
    """Validate the reachable wildcard graph before realizing a prompt.

    Dynamic Prompts deliberately leaves a missing wildcard unresolved. That is
    useful in a generic templating library, but dangerous in a visual workbench:
    an eight-image run could otherwise spend GPU time drawing ``__missing__``.
    """

    issues: list[PromptExpansionIssue] = []
    pending = list(_wildcard_references(source))
    visited: set[str] = set()

    while pending:
        name = pending.pop()
        if not name or name in visited:
            continue
        visited.add(name)
        if ".." in name:
            issues.append(
                PromptExpansionIssue(
                    code="invalid-wildcard",
                    field=field,
                    message=f"Wildcard __{name}__ cannot leave the wildcard library.",
                )
            )
            continue
        try:
            values = list(manager.get_values(name).string_values)
        except ValueError as error:
            issues.append(
                PromptExpansionIssue(
                    code="invalid-wildcard",
                    field=field,
                    message=f"Wildcard __{name}__ is invalid: {error}",
                )
            )
            continue
        if not values:
            issues.append(
                PromptExpansionIssue(
                    code="missing-wildcard",
                    field=field,
                    message=f"Wildcard __{name}__ has no readable values.",
                )
            )
            continue
        for value in values:
            pending.extend(_wildcard_references(value) - visited)

    return issues


def _library_issue(
    error: Exception,
    field: PromptField,
) -> PromptExpansionIssue:
    message = str(error).strip() or type(error).__name__
    return PromptExpansionIssue(
        code="invalid-template",
        field=field,
        message=f"The {field.replace('_', ' ')} template could not be read: {message}",
    )


def _random_realizations(
    manager: WildcardManager,
    source: str,
    count: int,
    expansion_seed: int,
) -> list[str]:
    if not source:
        return [""] * count
    seeds = [expansion_seed + index for index in range(count)]
    return RandomPromptGenerator(manager).generate(
        source,
        num_images=count,
        seeds=seeds,
    )


def _exhaustive_realizations(
    manager: WildcardManager,
    source: str,
    count: int,
) -> list[str]:
    if not source:
        return [""]
    return CombinatorialPromptGenerator(manager).generate(
        source,
        max_prompts=count + 1,
    )


def _deduplicate_pairs(
    pairs: Iterable[tuple[str, str]],
) -> list[tuple[str, str]]:
    return list(dict.fromkeys(pairs))


def compile_prompt_expansion(
    request: PromptExpansionRequest,
    *,
    wildcard_root: Path | None = None,
) -> PromptExpansionResponse:
    expansion_seed = (
        request.expansion_seed
        if request.expansion_seed is not None
        else secrets.randbelow(MAX_EXPANSION_SEED + 1)
    )
    response = PromptExpansionResponse(
        mode=request.mode,
        source_prompt=request.prompt,
        source_negative_prompt=request.negative_prompt,
        requested_count=request.candidate_count,
        resolved_count=0,
        expansion_seed=expansion_seed,
        engine=f"dynamicprompts {dynamicprompts.__version__}",
        realizations=[],
        issues=[],
    )

    if request.mode == "off":
        response.realizations = [
            PromptRealization(
                index=index,
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
            )
            for index in range(request.candidate_count)
        ]
        response.resolved_count = len(response.realizations)
        return response

    manager = WildcardManager(wildcard_root or default_wildcard_root())
    response.issues.extend(_wildcard_issues(manager, request.prompt, "prompt"))
    response.issues.extend(
        _wildcard_issues(manager, request.negative_prompt, "negative_prompt")
    )
    if any(issue.blocking for issue in response.issues):
        return response

    try:
        if request.mode == "random":
            prompts = _random_realizations(
                manager,
                request.prompt,
                request.candidate_count,
                expansion_seed,
            )
            negative_prompts = _random_realizations(
                manager,
                request.negative_prompt,
                request.candidate_count,
                expansion_seed,
            )
            pairs = list(zip(prompts, negative_prompts, strict=True))
        else:
            prompts = _exhaustive_realizations(
                manager,
                request.prompt,
                request.candidate_count,
            )
            negative_prompts = _exhaustive_realizations(
                manager,
                request.negative_prompt,
                request.candidate_count,
            )
            pairs = _deduplicate_pairs(
                itertools.product(tuple(prompts), tuple(negative_prompts))
            )
            response.truncated = len(pairs) > request.candidate_count
            pairs = pairs[: request.candidate_count]
    except (GeneratorException, ParseBaseException, ValueError) as error:
        # The parser does not expose which half of a combined expansion failed.
        # Re-run each half cheaply so the UI can put the issue beside its source.
        for source, field in (
            (request.prompt, "prompt"),
            (request.negative_prompt, "negative_prompt"),
        ):
            try:
                if request.mode == "random":
                    _random_realizations(manager, source, 1, expansion_seed)
                else:
                    _exhaustive_realizations(manager, source, 1)
            except (GeneratorException, ParseBaseException, ValueError) as half_error:
                response.issues.append(_library_issue(half_error, field))
        if not response.issues:
            response.issues.append(_library_issue(error, "prompt"))
        return response

    unresolved: list[tuple[PromptField, str]] = []
    for prompt, negative_prompt in pairs:
        unresolved.extend(("prompt", name) for name in _wildcard_references(prompt))
        unresolved.extend(
            ("negative_prompt", name)
            for name in _wildcard_references(negative_prompt)
        )
    for field, name in dict.fromkeys(unresolved):
        response.issues.append(
            PromptExpansionIssue(
                code="unresolved-wildcard",
                field=field,
                message=f"Wildcard __{name}__ remained unresolved.",
            )
        )
    if response.issues:
        return response

    response.realizations = [
        PromptRealization(index=index, prompt=prompt, negative_prompt=negative)
        for index, (prompt, negative) in enumerate(pairs)
    ]
    response.resolved_count = len(response.realizations)
    if not response.realizations:
        response.issues.append(
            PromptExpansionIssue(
                code="no-realizations",
                field="prompt",
                message="This template did not produce any prompts.",
            )
        )
    return response
