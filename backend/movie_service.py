from __future__ import annotations

import asyncio
import hashlib
import os
import random
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
import pandas as pd

from .cache import CacheStore, get_cache
from .utils.data_cleaning import (
    BACKDROP_FALLBACK_URL,
    POSTER_FALLBACK_URL,
    build_feature_text,
    fallback_backdrop_url,
    fallback_poster_url,
    genre_id_for,
    infer_moods,
    infer_popularity_score,
    infer_runtime,
    normalize_lookup,
    primary_genre,
    safe_float,
    safe_int,
    split_pipe_separated,
    to_embed_url,
    unique_list,
)

DATASET_PATH = Path(__file__).resolve().parent / "dataset" / "movies.csv"


@dataclass(slots=True)
class PageResult:
    movies: list[dict[str, Any]]
    page: int
    page_size: int
    total: int

    @property
    def has_more(self) -> bool:
        return self.page * self.page_size < self.total

    @property
    def next_page(self) -> int | None:
        return self.page + 1 if self.has_more else None


class TMDBMovieClient:
    def __init__(self, cache: CacheStore) -> None:
        self.api_key = os.getenv("TMDB_API_KEY", "").strip()
        self.bearer_token = os.getenv("TMDB_BEARER_TOKEN", "").strip()
        self.cache = cache
        self.client = httpx.AsyncClient(
            timeout=10.0,
            headers={
                "Accept": "application/json",
                "User-Agent": "CineVerse-AI/1.0",
            },
        )

    @property
    def enabled(self) -> bool:
        return bool(self.api_key or self.bearer_token)

    async def _request_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        if not self.enabled:
            return None

        params = params or {}
        cache_key = f"tmdb:{path}:{hashlib.sha1(urlencode(sorted(params.items())).encode('utf-8')).hexdigest()}"
        cached = await self.cache.get_json(cache_key)
        if cached is not None:
            return cached

        request_params = dict(params)
        headers: dict[str, str] = {}
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        else:
            request_params["api_key"] = self.api_key

        try:
            response = await self.client.get(f"https://api.themoviedb.org/3{path}", params=request_params, headers=headers)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError:
            return None

        await self.cache.set_json(cache_key, payload, ttl_seconds=60 * 60 * 12)
        return payload

    async def search_movie(self, title: str, release_year: int = 0) -> dict[str, Any] | None:
        params: dict[str, Any] = {"query": title, "include_adult": "false"}
        if release_year:
            params["year"] = release_year
        payload = await self._request_json("/search/movie", params)
        results = payload.get("results", []) if payload else []
        return results[0] if results else None

    async def get_movie_details(self, tmdb_id: int) -> dict[str, Any] | None:
        return await self._request_json(
            f"/movie/{tmdb_id}",
            {"append_to_response": "videos,credits"},
        )

    async def resolve_movie(self, title: str, release_year: int = 0, tmdb_id: int = 0) -> dict[str, Any] | None:
        details = await self.get_movie_details(tmdb_id) if tmdb_id else None
        if details is None:
            search_result = await self.search_movie(title, release_year)
            if not search_result:
                return None
            details = await self.get_movie_details(int(search_result.get("id", 0)))
        if not details:
            return None

        videos = ((details.get("videos") or {}).get("results") or [])
        trailer_key = ""
        for video in videos:
            if video.get("site") == "YouTube" and video.get("type") == "Trailer" and video.get("official"):
                trailer_key = video.get("key", "")
                break
        if not trailer_key:
            for video in videos:
                if video.get("site") == "YouTube" and video.get("type") == "Trailer":
                    trailer_key = video.get("key", "")
                    break

        credits = details.get("credits") or {}
        cast = unique_list(person.get("name", "") for person in (credits.get("cast") or [])[:8])
        director = ""
        for crew_member in credits.get("crew") or []:
            if crew_member.get("job") == "Director":
                director = crew_member.get("name", "")
                break

        return {
            "tmdb_id": safe_int(details.get("id"), 0),
            "overview": details.get("overview", ""),
            "release_year": safe_int(str(details.get("release_date", "0"))[:4], release_year),
            "runtime": safe_int(details.get("runtime"), 0),
            "rating": safe_float(details.get("vote_average"), 0.0),
            "popularity_score": safe_float(details.get("popularity"), 0.0),
            "poster_url": f"https://image.tmdb.org/t/p/w500{details['poster_path']}" if details.get("poster_path") else "",
            "backdrop_url": f"https://image.tmdb.org/t/p/original{details['backdrop_path']}" if details.get("backdrop_path") else "",
            "trailer_url": f"https://www.youtube.com/watch?v={trailer_key}" if trailer_key else "",
            "cast": cast,
            "director": director,
            "genres": unique_list(item.get("name", "") for item in details.get("genres") or []),
        }


class OMDbMovieClient:
    def __init__(self, cache: CacheStore) -> None:
        self.api_key = os.getenv("OMDB_API_KEY", "").strip()
        self.cache = cache
        self.client = httpx.AsyncClient(
            timeout=10.0,
            headers={
                "Accept": "application/json",
                "User-Agent": "CineVerse-AI/1.0",
            },
        )

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    async def _request_json(self, params: dict[str, Any]) -> dict[str, Any] | None:
        if not self.enabled:
            return None

        request_params = {"apikey": self.api_key, **params}
        cache_key = f"omdb:{hashlib.sha1(urlencode(sorted(request_params.items())).encode('utf-8')).hexdigest()}"
        cached = await self.cache.get_json(cache_key)
        if cached is not None:
            return cached

        try:
            response = await self.client.get("https://www.omdbapi.com/", params=request_params)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError:
            return None

        if str(payload.get("Response", "")).lower() != "true":
            return None

        await self.cache.set_json(cache_key, payload, ttl_seconds=60 * 60 * 12)
        return payload

    async def search_movie(self, title: str, release_year: int = 0) -> dict[str, Any] | None:
        params: dict[str, Any] = {"s": title, "type": "movie"}
        if release_year:
            params["y"] = release_year
        payload = await self._request_json(params)
        results = payload.get("Search", []) if payload else []
        return results[0] if results else None

    async def get_movie_details(self, imdb_id: str) -> dict[str, Any] | None:
        if not imdb_id:
            return None
        return await self._request_json({"i": imdb_id, "plot": "full"})

    async def resolve_movie(self, title: str, release_year: int = 0) -> dict[str, Any] | None:
        details = await self._request_json({"t": title, "plot": "full", **({"y": release_year} if release_year else {})})
        if details is None:
            search_result = await self.search_movie(title, release_year)
            if not search_result:
                return None
            details = await self.get_movie_details(str(search_result.get("imdbID", "")))
        if not details:
            return None

        poster_url = ""
        poster_value = str(details.get("Poster", "")).strip()
        if poster_value and poster_value.upper() != "N/A":
            poster_url = poster_value

        raw_runtime = str(details.get("Runtime", "")).strip()
        runtime = safe_int(raw_runtime.split(" ", 1)[0], 0)

        raw_rating = str(details.get("imdbRating", "")).strip()
        rating = 0.0 if not raw_rating or raw_rating.upper() == "N/A" else safe_float(raw_rating, 0.0)
        resolved_year = safe_int(str(details.get("Year", "")).split("–", 1)[0].split("-", 1)[0], release_year)
        genres = [item.strip() for item in str(details.get("Genre", "")).split(",") if item.strip()]
        cast = [item.strip() for item in str(details.get("Actors", "")).split(",") if item.strip()]
        director = "" if str(details.get("Director", "")).strip().upper() == "N/A" else str(details.get("Director", "")).strip()
        overview = "" if str(details.get("Plot", "")).strip().upper() == "N/A" else str(details.get("Plot", "")).strip()

        return {
            "overview": overview,
            "release_year": resolved_year,
            "runtime": runtime,
            "rating": rating,
            "popularity_score": infer_popularity_score(rating, resolved_year, "|".join(genres)),
            "poster_url": poster_url,
            "backdrop_url": "",
            "trailer_url": "",
            "cast": unique_list(cast[:8]),
            "director": director,
            "genres": unique_list(genres),
        }


class MovieService:
    def __init__(self, dataset_path: Path | str = DATASET_PATH, cache: CacheStore | None = None) -> None:
        self.dataset_path = Path(dataset_path)
        self.cache = cache or get_cache()
        self.tmdb = TMDBMovieClient(self.cache)
        self.omdb = OMDbMovieClient(self.cache)
        self._lock = asyncio.Lock()
        self._data_version = 1
        self._frame = self._load_dataset()
        self._id_to_index = {int(row.movie_id): int(index) for index, row in self._frame.iterrows()}

    def _load_dataset(self) -> pd.DataFrame:
        frame = pd.read_csv(self.dataset_path)

        if "poster" in frame.columns and "poster_url" not in frame.columns:
            frame["poster_url"] = frame["poster"]
        if "trailer_link" in frame.columns and "trailer_url" not in frame.columns:
            frame["trailer_url"] = frame["trailer_link"]
        if "runtime_min" in frame.columns and "runtime" not in frame.columns:
            frame["runtime"] = frame["runtime_min"]

        for column in [
            "movie_id",
            "title",
            "genres",
            "overview",
            "cast",
            "director",
            "rating",
            "runtime",
            "release_year",
            "poster_url",
            "backdrop_url",
            "trailer_url",
            "popularity_score",
            "keywords",
            "language",
            "tags",
            "tmdb_id",
        ]:
            if column not in frame.columns:
                frame[column] = ""

        frame = frame.fillna("")
        frame["movie_id"] = frame["movie_id"].apply(lambda value: safe_int(value, 0))
        frame["release_year"] = frame["release_year"].apply(lambda value: safe_int(value, 0))
        frame["rating"] = frame["rating"].apply(lambda value: safe_float(value, 0.0))
        frame["runtime"] = frame.apply(lambda row: infer_runtime(safe_int(row.get("movie_id"), 0), row.get("runtime")), axis=1)
        frame["popularity_score"] = frame.apply(
            lambda row: safe_float(row.get("popularity_score"), 0.0)
            or infer_popularity_score(row.get("rating"), row.get("release_year"), row.get("tags")),
            axis=1,
        )
        frame["tmdb_id"] = frame["tmdb_id"].apply(lambda value: safe_int(value, 0))
        frame["normalized_title"] = frame["title"].apply(normalize_lookup)
        frame["primary_genre"] = frame["genres"].apply(primary_genre)
        frame["genre_id"] = frame["primary_genre"].apply(genre_id_for)
        frame["moods"] = frame["genres"].apply(infer_moods)
        frame["feature_text"] = frame.apply(lambda row: build_feature_text(row.to_dict()), axis=1)
        frame["poster_url"] = frame.apply(
            lambda row: row.get("poster_url") or fallback_poster_url(str(row.get("title", ""))),
            axis=1,
        )
        frame["backdrop_url"] = frame.apply(
            lambda row: row.get("backdrop_url") or fallback_backdrop_url(str(row.get("title", ""))),
            axis=1,
        )
        frame["metadata_status"] = frame.apply(
            lambda row: "complete"
            if row.get("overview")
            and row.get("cast")
            and row.get("director")
            and safe_int(row.get("runtime"), 0) > 0
            and row.get("poster_url")
            and (row.get("trailer_url") or not self.tmdb.enabled)
            else "needs_enrichment",
            axis=1,
        )
        return frame.sort_values(
            ["popularity_score", "rating", "release_year"],
            ascending=[False, False, False],
        ).reset_index(drop=True)

    @property
    def data_version(self) -> int:
        return self._data_version

    @property
    def movie_count(self) -> int:
        return int(self._frame.shape[0])

    def get_frame(self) -> pd.DataFrame:
        return self._frame.copy()

    def _row_for_movie(self, movie_id: int) -> pd.Series | None:
        matches = self._frame[self._frame["movie_id"] == int(movie_id)]
        if matches.empty:
            return None
        return matches.iloc[0]

    def _update_movie(self, movie_id: int, updates: dict[str, Any]) -> None:
        index = self._frame.index[self._frame["movie_id"] == int(movie_id)]
        if index.empty:
            return
        row_index = int(index[0])
        for key, value in updates.items():
            self._frame.at[row_index, key] = value
        self._frame.at[row_index, "normalized_title"] = normalize_lookup(self._frame.at[row_index, "title"])
        self._frame.at[row_index, "primary_genre"] = primary_genre(self._frame.at[row_index, "genres"])
        self._frame.at[row_index, "genre_id"] = genre_id_for(self._frame.at[row_index, "primary_genre"])
        self._frame.at[row_index, "moods"] = infer_moods(self._frame.at[row_index, "genres"])
        self._frame.at[row_index, "feature_text"] = build_feature_text(self._frame.loc[row_index].to_dict())
        self._data_version += 1

    def _serialize_movie(self, row: pd.Series) -> dict[str, Any]:
        genres = split_pipe_separated(row.get("genres"))
        cast = split_pipe_separated(row.get("cast"))
        tags = split_pipe_separated(row.get("tags"))
        payload = {
            "movie_id": safe_int(row.get("movie_id"), 0),
            "id": safe_int(row.get("movie_id"), 0),
            "title": str(row.get("title", "")),
            "genres": genres,
            "genre": primary_genre(row.get("genres")),
            "genre_id": safe_int(row.get("genre_id"), 0),
            "overview": str(row.get("overview", "")),
            "description": str(row.get("overview", "")),
            "cast": cast,
            "director": str(row.get("director", "")),
            "rating": round(safe_float(row.get("rating"), 0.0), 1),
            "runtime": safe_int(row.get("runtime"), 0),
            "runtime_min": safe_int(row.get("runtime"), 0),
            "release_year": safe_int(row.get("release_year"), 0),
            "year": safe_int(row.get("release_year"), 0),
            "poster_url": str(row.get("poster_url") or POSTER_FALLBACK_URL),
            "poster": str(row.get("poster_url") or POSTER_FALLBACK_URL),
            "backdrop_url": str(row.get("backdrop_url") or BACKDROP_FALLBACK_URL),
            "backdrop": str(row.get("backdrop_url") or BACKDROP_FALLBACK_URL),
            "trailer_url": str(row.get("trailer_url", "")),
            "trailer_link": str(row.get("trailer_url", "")),
            "trailer_embed_url": to_embed_url(str(row.get("trailer_url", ""))),
            "popularity_score": round(safe_float(row.get("popularity_score"), 0.0), 2),
            "keywords": split_pipe_separated(row.get("keywords")),
            "language": str(row.get("language", "")),
            "tags": tags,
            "moods": row.get("moods") if isinstance(row.get("moods"), list) else infer_moods(row.get("genres")),
            "backdrop_missing": not bool(str(row.get("backdrop_url", "")).strip()),
            "poster_missing": not bool(str(row.get("poster_url", "")).strip()),
            "trailer_missing": not bool(str(row.get("trailer_url", "")).strip()),
        }
        return payload

    async def _ensure_movie_metadata(self, movie_id: int) -> dict[str, Any] | None:
        async with self._lock:
            row = self._row_for_movie(movie_id)
            if row is None:
                return None

            if row.get("metadata_status") == "complete" or not (self.tmdb.enabled or self.omdb.enabled):
                return self._serialize_movie(row)

            provider_payload: dict[str, Any] | None = None
            if self.tmdb.enabled:
                provider_payload = await self.tmdb.resolve_movie(
                    str(row.get("title", "")),
                    safe_int(row.get("release_year"), 0),
                    safe_int(row.get("tmdb_id"), 0),
                )
            if provider_payload is None and self.omdb.enabled:
                provider_payload = await self.omdb.resolve_movie(
                    str(row.get("title", "")),
                    safe_int(row.get("release_year"), 0),
                )

            if provider_payload:
                updates = {
                    "tmdb_id": provider_payload.get("tmdb_id", safe_int(row.get("tmdb_id"), 0)),
                    "overview": provider_payload.get("overview") or row.get("overview", ""),
                    "release_year": provider_payload.get("release_year") or safe_int(row.get("release_year"), 0),
                    "runtime": provider_payload.get("runtime") or safe_int(row.get("runtime"), 0),
                    "rating": provider_payload.get("rating") or safe_float(row.get("rating"), 0.0),
                    "popularity_score": provider_payload.get("popularity_score") or safe_float(row.get("popularity_score"), 0.0),
                    "poster_url": provider_payload.get("poster_url") or row.get("poster_url", ""),
                    "backdrop_url": provider_payload.get("backdrop_url") or row.get("backdrop_url", ""),
                    "trailer_url": provider_payload.get("trailer_url") or row.get("trailer_url", ""),
                    "cast": "|".join(provider_payload.get("cast") or split_pipe_separated(row.get("cast"))),
                    "director": provider_payload.get("director") or row.get("director", ""),
                    "genres": "|".join(provider_payload.get("genres") or split_pipe_separated(row.get("genres"))),
                    "metadata_status": "complete",
                }
                self._update_movie(movie_id, updates)
            else:
                self._update_movie(movie_id, {"metadata_status": "complete"})

            refreshed = self._row_for_movie(movie_id)
            return self._serialize_movie(refreshed) if refreshed is not None else None

    async def _serialize_rows(self, frame: pd.DataFrame, limit: int) -> list[dict[str, Any]]:
        movie_ids = [safe_int(item, 0) for item in frame.head(limit)["movie_id"].tolist()]
        movies = await asyncio.gather(*(self._ensure_movie_metadata(movie_id) for movie_id in movie_ids))
        return [movie for movie in movies if movie]

    async def list_movies(self, page: int = 1, page_size: int = 24) -> PageResult:
        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        catalog = self._frame.sort_values(
            ["popularity_score", "rating", "release_year"],
            ascending=[False, False, False],
        )
        start = (page - 1) * page_size
        rows = catalog.iloc[start:start + page_size]
        movies = await self._serialize_rows(rows, page_size)
        return PageResult(movies=movies, page=page, page_size=page_size, total=self.movie_count)

    async def get_movie(self, movie_id: int, user_id: str | None = None) -> dict[str, Any] | None:
        movie = await self._ensure_movie_metadata(movie_id)
        if movie and user_id:
            await self.record_view(user_id, movie_id)
        return movie

    async def search(self, title: str, limit: int = 20, user_id: str | None = None) -> dict[str, Any]:
        normalized_query = normalize_lookup(title)
        if not normalized_query:
            page = await self.list_movies(page=1, page_size=limit)
            return {"movies": page.movies, "suggestions": [], "history": await self.get_search_history(user_id or "guest")}

        scored_rows: list[tuple[float, pd.Series]] = []
        for _, row in self._frame.iterrows():
            candidate = str(row.get("normalized_title", ""))
            ratio = SequenceMatcher(None, normalized_query, candidate).ratio()
            contains_bonus = 0.35 if normalized_query in candidate else 0.0
            starts_bonus = 0.2 if candidate.startswith(normalized_query) else 0.0
            token_bonus = 0.1 if all(token in candidate for token in normalized_query.split()) else 0.0
            score = ratio + contains_bonus + starts_bonus + token_bonus
            if score >= 0.38:
                scored_rows.append((score, row))

        scored_rows.sort(
            key=lambda item: (
                item[0],
                safe_float(item[1].get("popularity_score"), 0.0),
                safe_float(item[1].get("rating"), 0.0),
                safe_int(item[1].get("release_year"), 0),
            ),
            reverse=True,
        )
        movies = [self._serialize_movie(row) for _, row in scored_rows[:limit]]
        suggestions = unique_list(movie["title"] for movie in movies[:8])

        if user_id:
            await self.record_search(user_id, title)

        return {
            "movies": movies,
            "suggestions": suggestions,
            "history": await self.get_search_history(user_id or "guest"),
        }

    async def suggestions(self, query: str, limit: int = 8) -> list[str]:
        result = await self.search(query, limit=limit)
        return result["suggestions"]

    async def trending(self, window: str = "day", limit: int = 20) -> list[dict[str, Any]]:
        frame = self._frame.copy()
        frame["trend_score"] = frame["popularity_score"] + frame["rating"] * (1.6 if window == "day" else 1.2)
        if window == "day":
            frame["trend_score"] += frame["tags"].apply(lambda tags: 8 if "trending" in str(tags) else 0)
        else:
            frame["trend_score"] += frame["release_year"].apply(lambda year: max(0, year - 2010) * 0.3)
        frame = frame.sort_values(["trend_score", "release_year"], ascending=[False, False])
        return await self._serialize_rows(frame, limit)

    async def top_rated(self, limit: int = 20) -> list[dict[str, Any]]:
        frame = self._frame.sort_values(["rating", "popularity_score"], ascending=[False, False])
        return await self._serialize_rows(frame, limit)

    async def new_releases(self, limit: int = 20) -> list[dict[str, Any]]:
        frame = self._frame.sort_values(["release_year", "popularity_score", "rating"], ascending=[False, False, False])
        return await self._serialize_rows(frame, limit)

    async def popular(self, limit: int = 20) -> list[dict[str, Any]]:
        frame = self._frame.sort_values(["popularity_score", "rating"], ascending=[False, False])
        return await self._serialize_rows(frame, limit)

    async def hidden_gems(self, limit: int = 20) -> list[dict[str, Any]]:
        popularity_cutoff = self._frame["popularity_score"].median()
        frame = self._frame[
            (self._frame["rating"] >= 8.0) & (self._frame["popularity_score"] <= popularity_cutoff)
        ].sort_values(["rating", "release_year"], ascending=[False, False])
        return await self._serialize_rows(frame, limit)

    async def critically_acclaimed(self, limit: int = 20) -> list[dict[str, Any]]:
        frame = self._frame[self._frame["rating"] >= 8.5].sort_values(
            ["rating", "popularity_score", "release_year"],
            ascending=[False, False, False],
        )
        return await self._serialize_rows(frame, limit)

    async def by_genre(self, genre_name: str, limit: int = 20) -> list[dict[str, Any]]:
        normalized_genre = normalize_lookup(genre_name)
        frame = self._frame[
            self._frame["genres"].apply(
                lambda genres: normalized_genre in [normalize_lookup(item) for item in split_pipe_separated(genres)]
            )
        ].sort_values(["popularity_score", "rating"], ascending=[False, False])
        return await self._serialize_rows(frame, limit)

    async def explore_actor(self, actor_name: str, limit: int = 20) -> list[dict[str, Any]]:
        normalized_actor = normalize_lookup(actor_name)
        frame = self._frame[
            self._frame["cast"].apply(
                lambda cast: any(normalized_actor in normalize_lookup(item) for item in split_pipe_separated(cast))
            )
        ].sort_values(["popularity_score", "rating"], ascending=[False, False])
        return await self._serialize_rows(frame, limit)

    async def explore_director(self, director_name: str, limit: int = 20) -> list[dict[str, Any]]:
        normalized_director = normalize_lookup(director_name)
        frame = self._frame[
            self._frame["director"].apply(lambda director: normalized_director in normalize_lookup(director))
        ].sort_values(["popularity_score", "rating"], ascending=[False, False])
        return await self._serialize_rows(frame, limit)

    async def by_decade(self, decade: int, limit: int = 20) -> list[dict[str, Any]]:
        start = safe_int(decade, 0)
        end = start + 9
        frame = self._frame[
            (self._frame["release_year"] >= start) & (self._frame["release_year"] <= end)
        ].sort_values(["popularity_score", "rating"], ascending=[False, False])
        return await self._serialize_rows(frame, limit)

    async def award_winners(self, limit: int = 20) -> list[dict[str, Any]]:
        frame = self._frame[
            (self._frame["rating"] >= 8.4)
            | (self._frame["tags"].astype(str).str.contains("must-watch", case=False, regex=False))
        ].sort_values(["rating", "release_year"], ascending=[False, False])
        return await self._serialize_rows(frame, limit)

    async def random_movie(self, genre: str | None = None, mood: str | None = None) -> dict[str, Any]:
        frame = self._frame.copy()
        if genre:
            normalized_genre = normalize_lookup(genre)
            frame = frame[
                frame["genres"].apply(
                    lambda genres: normalized_genre in [normalize_lookup(item) for item in split_pipe_separated(genres)]
                )
            ]
        if mood:
            normalized_mood = normalize_lookup(mood)
            frame = frame[
                frame["moods"].apply(
                    lambda moods: any(normalized_mood == normalize_lookup(item) for item in (moods if isinstance(moods, list) else infer_moods("")))
                )
            ]
        if frame.empty:
            frame = self._frame
        row = frame.sample(1, random_state=random.randint(0, 100000)).iloc[0]
        ensured = await self._ensure_movie_metadata(safe_int(row.get("movie_id"), 0))
        return ensured or self._serialize_movie(row)

    def _profile_key(self, prefix: str, user_id: str) -> str:
        return f"cineverse-ai:{prefix}:{user_id or 'guest'}"

    async def get_watchlist_ids(self, user_id: str) -> list[int]:
        return [safe_int(item, 0) for item in (await self.cache.get_json(self._profile_key("watchlist", user_id)) or [])]

    async def get_watchlist(self, user_id: str) -> list[dict[str, Any]]:
        ids = await self.get_watchlist_ids(user_id)
        return [self._serialize_movie(self._row_for_movie(movie_id)) for movie_id in ids if self._row_for_movie(movie_id) is not None]

    async def add_to_watchlist(self, user_id: str, movie_id: int) -> list[dict[str, Any]]:
        ids = await self.get_watchlist_ids(user_id)
        if movie_id not in ids:
            ids.insert(0, movie_id)
        await self.cache.set_json(self._profile_key("watchlist", user_id), ids[:100])
        await self._update_taste_profile(user_id, movie_id)
        return await self.get_watchlist(user_id)

    async def remove_from_watchlist(self, user_id: str, movie_id: int) -> list[dict[str, Any]]:
        ids = [item for item in await self.get_watchlist_ids(user_id) if item != movie_id]
        await self.cache.set_json(self._profile_key("watchlist", user_id), ids)
        return await self.get_watchlist(user_id)

    async def get_recently_viewed_ids(self, user_id: str) -> list[int]:
        return [safe_int(item, 0) for item in (await self.cache.get_json(self._profile_key("recent", user_id)) or [])]

    async def get_recently_viewed(self, user_id: str) -> list[dict[str, Any]]:
        ids = await self.get_recently_viewed_ids(user_id)
        return [self._serialize_movie(self._row_for_movie(movie_id)) for movie_id in ids if self._row_for_movie(movie_id) is not None]

    async def record_view(self, user_id: str, movie_id: int) -> list[int]:
        recent_ids = await self.cache.append_recent(self._profile_key("recent", user_id), movie_id, limit=20)
        await self._update_taste_profile(user_id, movie_id)
        return [safe_int(item, 0) for item in recent_ids]

    async def record_search(self, user_id: str, query: str) -> list[str]:
        return [str(item) for item in await self.cache.append_recent(self._profile_key("searches", user_id), query.strip(), limit=12)]

    async def get_search_history(self, user_id: str) -> list[str]:
        return [str(item) for item in (await self.cache.get_json(self._profile_key("searches", user_id)) or [])]

    async def get_taste_profile(self, user_id: str) -> dict[str, Any]:
        default_profile = {
            "genre_counts": {},
            "director_counts": {},
            "actor_counts": {},
            "mood_counts": {},
            "watched_movie_ids": [],
        }
        return await self.cache.get_json(self._profile_key("taste", user_id)) or default_profile

    async def _update_taste_profile(self, user_id: str, movie_id: int) -> None:
        row = self._row_for_movie(movie_id)
        if row is None:
            return
        profile = await self.get_taste_profile(user_id)

        for genre in split_pipe_separated(row.get("genres")):
            profile["genre_counts"][genre] = safe_int(profile["genre_counts"].get(genre), 0) + 1
        director = str(row.get("director", "")).strip()
        if director:
            profile["director_counts"][director] = safe_int(profile["director_counts"].get(director), 0) + 1
        for actor in split_pipe_separated(row.get("cast"))[:5]:
            profile["actor_counts"][actor] = safe_int(profile["actor_counts"].get(actor), 0) + 1
        for mood in infer_moods(row.get("genres")):
            profile["mood_counts"][mood] = safe_int(profile["mood_counts"].get(mood), 0) + 1

        watched = [safe_int(item, 0) for item in profile.get("watched_movie_ids", [])]
        if movie_id not in watched:
            watched.append(movie_id)
        profile["watched_movie_ids"] = watched[-100:]
        await self.cache.set_json(self._profile_key("taste", user_id), profile)


_movie_service: MovieService | None = None


def get_movie_service() -> MovieService:
    global _movie_service
    if _movie_service is None:
        _movie_service = MovieService()
    return _movie_service
