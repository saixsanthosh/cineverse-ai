from __future__ import annotations

from typing import Any

from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .movie_service import MovieService, get_movie_service
from .utils.data_cleaning import normalize_lookup, split_pipe_separated


class RecommendationEngine:
    def __init__(self, movie_service: MovieService | None = None) -> None:
        self.movie_service = movie_service or get_movie_service()
        self._model_version = -1
        self._frame = None
        self._similarity_matrix = None
        self._cluster_labels: list[int] = []
        self._vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2))

    def _ensure_models(self) -> None:
        if self._model_version == self.movie_service.data_version and self._frame is not None:
            return

        frame = self.movie_service.get_frame().reset_index(drop=True)
        feature_matrix = self._vectorizer.fit_transform(frame["feature_text"])
        similarity_matrix = cosine_similarity(feature_matrix)

        cluster_count = max(2, min(8, frame.shape[0] // 3 or 2))
        if frame.shape[0] < cluster_count:
            cluster_labels = [0] * frame.shape[0]
        else:
            cluster_labels = KMeans(n_clusters=cluster_count, random_state=42, n_init=10).fit_predict(feature_matrix).tolist()

        self._frame = frame
        self._similarity_matrix = similarity_matrix
        self._cluster_labels = cluster_labels
        self._movie_index = {int(row.movie_id): int(index) for index, row in frame.iterrows()}
        self._model_version = self.movie_service.data_version

    def _overlap_score(self, left: list[str], right: list[str]) -> float:
        left_set = {normalize_lookup(item) for item in left if item}
        right_set = {normalize_lookup(item) for item in right if item}
        if not left_set or not right_set:
            return 0.0
        intersection = len(left_set & right_set)
        union = len(left_set | right_set)
        return intersection / union if union else 0.0

    async def recommend_for_movie(self, movie_id: int, user_id: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
        self._ensure_models()
        index = self._movie_index.get(int(movie_id))
        if index is None:
            return []

        base_row = self._frame.iloc[index]
        base_genres = split_pipe_separated(base_row.get("genres"))
        base_cast = split_pipe_separated(base_row.get("cast"))
        base_director = normalize_lookup(base_row.get("director"))
        base_cluster = self._cluster_labels[index]
        taste_profile = await self.movie_service.get_taste_profile(user_id or "guest")
        watched_ids = {int(item) for item in taste_profile.get("watched_movie_ids", [])}

        scored: list[tuple[float, int, dict[str, Any]]] = []
        for candidate_index, similarity_score in enumerate(self._similarity_matrix[index]):
            if candidate_index == index:
                continue

            candidate = self._frame.iloc[candidate_index]
            candidate_movie_id = int(candidate.movie_id)
            candidate_genres = split_pipe_separated(candidate.get("genres"))
            candidate_cast = split_pipe_separated(candidate.get("cast"))
            candidate_director = normalize_lookup(candidate.get("director"))

            content_score = float(similarity_score)
            genre_score = self._overlap_score(base_genres, candidate_genres)
            actor_score = self._overlap_score(base_cast, candidate_cast)
            director_score = 1.0 if base_director and base_director == candidate_director else 0.0
            cluster_score = 1.0 if self._cluster_labels[candidate_index] == base_cluster else 0.0
            popularity_score = min(float(candidate.get("popularity_score", 0.0)) / 100.0, 1.0)

            preference_bonus = 0.0
            for genre in candidate_genres:
                preference_bonus += taste_profile.get("genre_counts", {}).get(genre, 0) * 0.012
            if candidate_director:
                preference_bonus += taste_profile.get("director_counts", {}).get(str(candidate.get("director", "")), 0) * 0.01
            for actor in candidate_cast[:3]:
                preference_bonus += taste_profile.get("actor_counts", {}).get(actor, 0) * 0.006
            if candidate_movie_id in watched_ids:
                preference_bonus -= 0.08

            total_score = (
                content_score * 0.46
                + genre_score * 0.15
                + actor_score * 0.12
                + director_score * 0.08
                + cluster_score * 0.07
                + popularity_score * 0.07
                + preference_bonus
            )

            reasons: list[str] = []
            if content_score >= 0.2:
                reasons.append("similar story and themes")
            if genre_score >= 0.5:
                reasons.append("same genre blend")
            if actor_score >= 0.2:
                reasons.append("shares cast members")
            if director_score:
                reasons.append("same director")
            if cluster_score:
                reasons.append("fits the same movie cluster")
            if not reasons:
                reasons.append("strong overall match")

            scored.append(
                (
                    total_score,
                    candidate_index,
                    {
                        "movie": self.movie_service._serialize_movie(candidate),
                        "explanation": f"Recommended because it has {reasons[0]}.",
                        "score": round(total_score, 4),
                    },
                )
            )

        scored.sort(key=lambda item: (item[0], float(self._frame.iloc[item[1]].get("rating", 0.0))), reverse=True)
        return [item[2] for item in scored[:limit]]

    async def personalized(self, user_id: str | None = None, limit: int = 20, mood: str | None = None) -> list[dict[str, Any]]:
        self._ensure_models()
        taste_profile = await self.movie_service.get_taste_profile(user_id or "guest")
        watched_ids = {int(item) for item in taste_profile.get("watched_movie_ids", [])}
        normalized_mood = normalize_lookup(mood) if mood else ""

        rows: list[tuple[float, dict[str, Any]]] = []
        for index, row in self._frame.iterrows():
            movie_id = int(row.movie_id)
            if movie_id in watched_ids:
                continue

            genres = split_pipe_separated(row.get("genres"))
            cast = split_pipe_separated(row.get("cast"))
            director = str(row.get("director", ""))
            moods = row.get("moods") if isinstance(row.get("moods"), list) else []

            score = float(row.get("rating", 0.0)) * 0.11 + min(float(row.get("popularity_score", 0.0)) / 110.0, 1.0)

            for genre in genres:
                score += taste_profile.get("genre_counts", {}).get(genre, 0) * 0.08
            score += taste_profile.get("director_counts", {}).get(director, 0) * 0.05
            for actor in cast[:4]:
                score += taste_profile.get("actor_counts", {}).get(actor, 0) * 0.03
            for candidate_mood in moods:
                score += taste_profile.get("mood_counts", {}).get(candidate_mood, 0) * 0.025

            if normalized_mood and not any(normalize_lookup(item) == normalized_mood for item in moods):
                score -= 0.12

            rows.append(
                (
                    score,
                    {
                        "movie": self.movie_service._serialize_movie(row),
                        "score": round(score, 4),
                    },
                )
            )

        rows.sort(key=lambda item: item[0], reverse=True)
        if not rows:
            fallback = await self.movie_service.popular(limit)
            return [{"movie": movie, "score": 0.0} for movie in fallback]
        return [item[1] for item in rows[:limit]]

    async def because_you_watched(self, user_id: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
        recent = await self.movie_service.get_recently_viewed_ids(user_id or "guest")
        if not recent:
            fallback = await self.movie_service.popular(limit)
            return [{"movie": movie, "explanation": "Popular pick while we learn your taste.", "score": 0.0} for movie in fallback]
        return await self.recommend_for_movie(recent[0], user_id=user_id, limit=limit)

    async def tonight_pick(self, user_id: str | None = None, mood: str | None = None) -> dict[str, Any]:
        picks = await self.personalized(user_id=user_id, limit=5, mood=mood)
        if not picks:
            movie = await self.movie_service.random_movie(mood=mood)
            return {"movie": movie, "explanation": "Surprise pick for tonight.", "score": 0.0}
        return {
            "movie": picks[0]["movie"],
            "explanation": "Best match for tonight based on your recent taste profile.",
            "score": picks[0]["score"],
        }


_recommendation_engine: RecommendationEngine | None = None


def get_recommendation_engine() -> RecommendationEngine:
    global _recommendation_engine
    if _recommendation_engine is None:
        _recommendation_engine = RecommendationEngine()
    return _recommendation_engine
