from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .utils.preprocessing import build_feature_text, normalize_lookup, split_pipe_separated

DATASET_PATH = Path(__file__).resolve().parent / "dataset" / "movies.csv"
POSTER_BASE_URL = "https://image.tmdb.org/t/p/w500"
POSTER_FALLBACK_URL = "https://placehold.co/500x750/111827/e5e7eb?text=No+Poster"

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


class TMDBPosterService:
    def __init__(self) -> None:
        self.api_key = os.getenv("TMDB_API_KEY", "").strip()
        self.bearer_token = os.getenv("TMDB_BEARER_TOKEN", "").strip()
        self.session = requests.Session()

    @property
    def enabled(self) -> bool:
        return bool(self.api_key or self.bearer_token)

    @lru_cache(maxsize=512)
    def get_poster(self, title: str, release_year: int, fallback_url: str = "") -> str:
        fallback = fallback_url or POSTER_FALLBACK_URL
        if not self.enabled:
            return fallback

        headers = {"Accept": "application/json"}
        params: dict[str, Any] = {"query": title, "include_adult": "false"}

        if release_year:
            params["year"] = int(release_year)

        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        else:
            params["api_key"] = self.api_key

        try:
            response = self.session.get(
                "https://api.themoviedb.org/3/search/movie",
                headers=headers,
                params=params,
                timeout=5,
            )
            response.raise_for_status()
            results = response.json().get("results") or []
            for candidate in results:
                poster_path = candidate.get("poster_path")
                if poster_path:
                    return f"{POSTER_BASE_URL}{poster_path}"
        except requests.RequestException:
            return fallback

        return fallback


class RecommendationEngine:
    def __init__(self, dataset_path: Path | str = DATASET_PATH) -> None:
        self.dataset_path = Path(dataset_path)
        self.poster_service = TMDBPosterService()
        self.movies = self._load_movies()
        self.vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2))
        self.feature_matrix = self.vectorizer.fit_transform(self.movies["feature_text"])
        self.similarity_matrix = cosine_similarity(self.feature_matrix)
        self.title_to_index = {
            row.normalized_title: int(index)
            for index, row in self.movies.reset_index(drop=True).iterrows()
        }

    def _load_movies(self) -> pd.DataFrame:
        frame = pd.read_csv(self.dataset_path)
        required_columns = {
            "movie_id",
            "title",
            "genres",
            "overview",
            "keywords",
            "cast",
            "rating",
            "release_year",
        }
        missing = required_columns.difference(frame.columns)
        if missing:
            missing_text = ", ".join(sorted(missing))
            raise ValueError(f"Dataset is missing required columns: {missing_text}")

        for column in ["director", "language", "poster", "trailer_link", "tags"]:
            if column not in frame.columns:
                frame[column] = ""

        frame = frame.fillna("")
        frame["movie_id"] = pd.to_numeric(frame["movie_id"], errors="coerce").fillna(0).astype(int)
        frame["rating"] = pd.to_numeric(frame["rating"], errors="coerce").fillna(0.0).astype(float)
        frame["release_year"] = pd.to_numeric(frame["release_year"], errors="coerce").fillna(0).astype(int)
        frame["feature_text"] = frame.apply(lambda row: build_feature_text(row.to_dict()), axis=1)
        frame["normalized_title"] = frame["title"].apply(normalize_lookup)
        frame["primary_genre"] = frame["genres"].apply(self._primary_genre)
        frame["genre_id"] = frame["primary_genre"].apply(self._genre_id_for)
        return frame.sort_values(["rating", "release_year", "title"], ascending=[False, False, True]).reset_index(drop=True)

    @staticmethod
    def _primary_genre(raw_genres: object) -> str:
        genres = split_pipe_separated(raw_genres)
        return genres[0] if genres else "Unknown"

    @staticmethod
    def _genre_id_for(genre_name: str) -> int:
        return GENRE_ID_MAP.get(normalize_lookup(genre_name), 0)

    def _serialize_movie(self, row: pd.Series, similarity_score: float | None = None) -> dict[str, Any]:
        genres = split_pipe_separated(row.get("genres"))
        payload: dict[str, Any] = {
            "movie_id": int(row["movie_id"]),
            "id": int(row["movie_id"]),
            "title": row["title"],
            "genres": genres,
            "genre": row["primary_genre"],
            "genre_id": int(row["genre_id"]),
            "overview": row["overview"],
            "description": row["overview"],
            "keywords": split_pipe_separated(row.get("keywords")),
            "cast": split_pipe_separated(row.get("cast")),
            "rating": round(float(row["rating"]), 1),
            "release_year": int(row["release_year"]),
            "year": int(row["release_year"]),
            "director": row.get("director", ""),
            "language": row.get("language", ""),
            "poster": self.poster_service.get_poster(
                row["title"],
                int(row["release_year"]),
                str(row.get("poster", "")),
            ),
            "trailer_link": row.get("trailer_link", ""),
            "tags": split_pipe_separated(row.get("tags")),
        }

        if similarity_score is not None:
            payload["similarity"] = round(float(similarity_score), 4)

        return payload

    def list_movies(self, limit: int | None = None) -> list[dict[str, Any]]:
        records = self.movies if limit is None else self.movies.head(limit)
        return [self._serialize_movie(row) for _, row in records.iterrows()]

    def get_movie_by_id(self, movie_id: int) -> dict[str, Any] | None:
        matches = self.movies[self.movies["movie_id"] == int(movie_id)]
        if matches.empty:
            return None
        return self._serialize_movie(matches.iloc[0])

    @lru_cache(maxsize=256)
    def search(self, title: str, limit: int = 20) -> list[dict[str, Any]]:
        normalized_query = normalize_lookup(title)
        if not normalized_query:
            return self.list_movies(limit)

        contains_matches = self.movies[
            self.movies["normalized_title"].str.contains(normalized_query, regex=False)
        ].copy()

        if contains_matches.empty:
            fallback = self.movies.copy()
            fallback["match_score"] = fallback["normalized_title"].apply(
                lambda candidate: self._match_score(candidate, normalized_query)
            )
            contains_matches = fallback[fallback["match_score"] > 0].copy()
        else:
            contains_matches["match_score"] = contains_matches["normalized_title"].apply(
                lambda candidate: self._match_score(candidate, normalized_query)
            )

        contains_matches = contains_matches.sort_values(
            ["match_score", "rating", "release_year"],
            ascending=[False, False, False],
        )
        return [self._serialize_movie(row) for _, row in contains_matches.head(limit).iterrows()]

    @staticmethod
    def _match_score(candidate: str, query: str) -> int:
        if candidate == query:
            return 300
        if candidate.startswith(query):
            return 200
        if query in candidate:
            return 150
        query_tokens = query.split()
        if query_tokens and all(token in candidate for token in query_tokens):
            return 100
        return 0

    def resolve_movie(self, movie_title: str) -> dict[str, Any] | None:
        normalized_title = normalize_lookup(movie_title)
        index = self.title_to_index.get(normalized_title)
        if index is not None:
            return self._serialize_movie(self.movies.iloc[index])

        matches = self.search(movie_title, limit=1)
        return matches[0] if matches else None

    @lru_cache(maxsize=256)
    def recommend(self, movie_title: str, limit: int = 10) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
        normalized_title = normalize_lookup(movie_title)
        if not normalized_title:
            return None

        index = self.title_to_index.get(normalized_title)
        if index is None:
            matches = self.search(movie_title, limit=1)
            if not matches:
                return None
            normalized_title = normalize_lookup(matches[0]["title"])
            index = self.title_to_index.get(normalized_title)
            if index is None:
                return None

        similarity_scores = list(enumerate(self.similarity_matrix[index]))
        similarity_scores.sort(key=lambda item: item[1], reverse=True)

        source_movie = self._serialize_movie(self.movies.iloc[index])
        recommendations: list[dict[str, Any]] = []

        for similar_index, score in similarity_scores:
            if similar_index == index:
                continue
            recommendations.append(
                self._serialize_movie(self.movies.iloc[similar_index], similarity_score=score)
            )
            if len(recommendations) >= limit:
                break

        return source_movie, recommendations

    @lru_cache(maxsize=128)
    def by_genre(self, genre_name: str, limit: int = 10) -> list[dict[str, Any]]:
        normalized_genre = normalize_lookup(genre_name)
        matches = self.movies[
            self.movies["genres"].apply(
                lambda genres: normalized_genre in [normalize_lookup(item) for item in split_pipe_separated(genres)]
            )
        ].copy()
        matches = matches.sort_values(["rating", "release_year", "title"], ascending=[False, False, True])
        return [self._serialize_movie(row) for _, row in matches.head(limit).iterrows()]

    @property
    def movie_count(self) -> int:
        return int(self.movies.shape[0])


@lru_cache(maxsize=1)
def get_engine() -> RecommendationEngine:
    return RecommendationEngine()
