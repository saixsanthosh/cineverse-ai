from __future__ import annotations

import math
import re
from collections.abc import Iterable
from urllib.parse import quote

NON_ALNUM_RE = re.compile(r"[^a-z0-9\s]+")
MULTISPACE_RE = re.compile(r"\s+")

POSTER_FALLBACK_URL = "https://placehold.co/500x750/111827/e5e7eb?text=No+Poster"
BACKDROP_FALLBACK_URL = "https://placehold.co/1280x720/0f172a/e5e7eb?text=No+Backdrop"

GENRE_ID_MAP = {
    "action": 28,
    "adventure": 12,
    "animation": 16,
    "comedy": 35,
    "crime": 80,
    "drama": 18,
    "fantasy": 14,
    "horror": 27,
    "mystery": 9648,
    "romance": 10749,
    "sci fi": 878,
    "science fiction": 878,
    "thriller": 53,
}

MOOD_TO_GENRES = {
    "feel-good": {"Comedy", "Animation", "Romance", "Adventure"},
    "mind-bending": {"Sci-Fi", "Mystery", "Thriller"},
    "dark": {"Thriller", "Horror", "Crime", "Drama"},
    "family": {"Animation", "Adventure", "Comedy"},
    "epic": {"Action", "Sci-Fi", "Adventure"},
    "emotional": {"Drama", "Romance"},
}


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
    text = NON_ALNUM_RE.sub(" ", text)
    return MULTISPACE_RE.sub(" ", text).strip()


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


def safe_int(value: object, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(str(value)))
    except (TypeError, ValueError):
        return default


def safe_float(value: object, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(str(value))
    except (TypeError, ValueError):
        return default


def unique_list(values: Iterable[object]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def primary_genre(genres: object) -> str:
    items = split_pipe_separated(genres)
    return items[0] if items else "Unknown"


def genre_id_for(genre_name: object) -> int:
    return GENRE_ID_MAP.get(normalize_lookup(genre_name), 0)


def infer_runtime(movie_id: int, runtime: object) -> int:
    current = safe_int(runtime, 0)
    if current > 0:
        return current
    return 92 + ((safe_int(movie_id, 1) * 11) % 56)


def infer_popularity_score(rating: object, release_year: object, tags: object) -> float:
    score = safe_float(rating, 0.0) * 8.5
    year = safe_int(release_year, 2000)
    score += max(0, year - 1990) * 0.35
    tag_list = {normalize_lookup(tag) for tag in split_pipe_separated(tags)}
    if "trending" in tag_list:
        score += 12
    if "must watch" in tag_list or "must-watch" in tag_list:
        score += 9
    if "top 10 netflix" in tag_list or "top-10-netflix" in tag_list:
        score += 7
    return round(score, 2)


def infer_moods(genres: object) -> list[str]:
    genre_list = split_pipe_separated(genres)
    moods: list[str] = []
    for mood, mapped_genres in MOOD_TO_GENRES.items():
        if any(item in mapped_genres for item in genre_list):
            moods.append(mood.title())
    return moods or ["Feel-good"]


def fallback_backdrop_url(title: str) -> str:
    return f"https://placehold.co/1280x720/0f172a/e5e7eb?text={quote(title or 'No Backdrop')}"


def fallback_poster_url(title: str) -> str:
    return f"https://placehold.co/500x750/111827/e5e7eb?text={quote(title or 'No Poster')}"


def to_embed_url(url: str) -> str:
    if not url:
        return ""
    watch_match = re.search(r"youtube\.com/watch\?v=([^&]+)", url)
    if watch_match:
        return f"https://www.youtube.com/embed/{watch_match.group(1)}"
    short_match = re.search(r"youtu\.be/([^?]+)", url)
    if short_match:
        return f"https://www.youtube.com/embed/{short_match.group(1)}"
    return url
