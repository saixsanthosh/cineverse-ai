from __future__ import annotations

import math
import re
from typing import Iterable

_NON_ALNUM_RE = re.compile(r"[^a-z0-9\s]+")
_MULTISPACE_RE = re.compile(r"\s+")


def split_pipe_separated(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, float) and math.isnan(value):
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [part.strip() for part in str(value).split("|") if part.strip()]


def normalize_text(value: object) -> str:
    text = str(value or "").lower().replace("&", " and ")
    text = _NON_ALNUM_RE.sub(" ", text)
    return _MULTISPACE_RE.sub(" ", text).strip()


def normalize_lookup(value: object) -> str:
    return normalize_text(value)


def join_tokens(values: Iterable[object]) -> str:
    return " ".join(token for token in (normalize_text(value) for value in values) if token)


def build_feature_text(row: dict[str, object]) -> str:
    genres = join_tokens(split_pipe_separated(row.get("genres")))
    keywords = join_tokens(split_pipe_separated(row.get("keywords")))
    cast = join_tokens(split_pipe_separated(row.get("cast")))
    overview = normalize_text(row.get("overview", ""))
    director = normalize_text(row.get("director", ""))
    return " ".join(part for part in [genres, keywords, overview, cast, director] if part)
