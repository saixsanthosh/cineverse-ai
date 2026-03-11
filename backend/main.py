from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .movie_service import get_movie_service
from .recommendation_engine import get_recommendation_engine


class WatchlistMutation(BaseModel):
    user_id: str = Field(default="guest", min_length=1)
    movie_id: int = Field(ge=1)


def create_app() -> FastAPI:
    public_dir = Path(__file__).resolve().parent.parent / "public"
    app = FastAPI(
        title="CineVerse AI API",
        description="Netflix-style movie discovery backend with search, metadata enrichment, recommendations, and discovery sections.",
        version="2.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/", include_in_schema=False)
    async def root() -> RedirectResponse:
        return RedirectResponse(url="/index.html", status_code=307)

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        movie_service = get_movie_service()
        return {
            "status": "ok",
            "movies_indexed": movie_service.movie_count,
            "tmdb_enabled": movie_service.tmdb.enabled,
            "redis_configured": bool(movie_service.cache.redis_url),
        }

    @app.get("/api/movies")
    async def movies(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=24, ge=1, le=100),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        result = await movie_service.list_movies(page=page, page_size=page_size)
        return {
            "page": result.page,
            "page_size": result.page_size,
            "total": result.total,
            "has_more": result.has_more,
            "next_page": result.next_page,
            "count": len(result.movies),
            "movies": result.movies,
        }

    @app.get("/api/movie/{movie_id}")
    async def movie_details(
        movie_id: int,
        user_id: str = Query(default="guest", min_length=1),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        recommendation_engine = get_recommendation_engine()
        movie = await movie_service.get_movie(movie_id, user_id=user_id)
        if not movie:
            raise HTTPException(status_code=404, detail="Movie not found")

        recommendations = await recommendation_engine.recommend_for_movie(movie_id, user_id=user_id, limit=10)
        return {
            **movie,
            "recommendations": recommendations,
        }

    @app.get("/api/movies/{movie_id}")
    async def movie_details_compat(
        movie_id: int,
        user_id: str = Query(default="guest", min_length=1),
    ) -> dict[str, Any]:
        return await movie_details(movie_id, user_id)

    @app.get("/api/search")
    async def search(
        title: str = Query(..., min_length=1),
        limit: int = Query(default=20, ge=1, le=100),
        user_id: str = Query(default="guest", min_length=1),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        result = await movie_service.search(title, limit=limit, user_id=user_id)
        return {
            "query": title,
            "count": len(result["movies"]),
            "movies": result["movies"],
            "suggestions": result["suggestions"],
            "history": result["history"],
        }

    @app.get("/api/search/suggestions")
    async def search_suggestions(
        query: str = Query(..., min_length=1),
        limit: int = Query(default=8, ge=1, le=20),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        suggestions = await movie_service.suggestions(query, limit=limit)
        return {"query": query, "suggestions": suggestions}

    @app.get("/api/recommend/{movie_id}")
    async def recommend_by_id(
        movie_id: int,
        user_id: str = Query(default="guest", min_length=1),
        limit: int = Query(default=10, ge=1, le=20),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        recommendation_engine = get_recommendation_engine()
        movie = await movie_service.get_movie(movie_id)
        if not movie:
            raise HTTPException(status_code=404, detail="Movie not found")

        recommendations = await recommendation_engine.recommend_for_movie(movie_id, user_id=user_id, limit=limit)
        return {
            "movie": movie,
            "count": len(recommendations),
            "movies": [item["movie"] for item in recommendations],
            "recommendations": recommendations,
        }

    @app.get("/api/recommend")
    async def recommend_by_title(
        movie: str = Query(..., min_length=1),
        user_id: str = Query(default="guest", min_length=1),
        limit: int = Query(default=10, ge=1, le=20),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        search_result = await movie_service.search(movie, limit=1)
        if not search_result["movies"]:
            raise HTTPException(status_code=404, detail="Movie not found")
        selected_movie = search_result["movies"][0]
        return await recommend_by_id(selected_movie["movie_id"], user_id=user_id, limit=limit)

    @app.get("/api/trending")
    async def trending(
        window: str = Query(default="day", pattern="^(day|week)$"),
        limit: int = Query(default=20, ge=1, le=50),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.trending(window=window, limit=limit)
        return {"window": window, "count": len(movies), "movies": movies}

    @app.get("/api/top-rated")
    async def top_rated(limit: int = Query(default=20, ge=1, le=50)) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.top_rated(limit=limit)
        return {"count": len(movies), "movies": movies}

    @app.get("/api/new-releases")
    async def new_releases(limit: int = Query(default=20, ge=1, le=50)) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.new_releases(limit=limit)
        return {"count": len(movies), "movies": movies}

    @app.get("/api/popular")
    async def popular(limit: int = Query(default=20, ge=1, le=50)) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.popular(limit=limit)
        return {"count": len(movies), "movies": movies}

    @app.get("/api/genre/{genre_name}")
    async def genre(
        genre_name: str,
        limit: int = Query(default=20, ge=1, le=50),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.by_genre(genre_name, limit=limit)
        if not movies:
            raise HTTPException(status_code=404, detail="Genre not found")
        return {"genre": genre_name, "count": len(movies), "movies": movies}

    @app.get("/api/discovery")
    async def discovery(
        user_id: str = Query(default="guest", min_length=1),
        limit: int = Query(default=12, ge=1, le=30),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        recommendation_engine = get_recommendation_engine()

        because_you_watched = await recommendation_engine.because_you_watched(user_id=user_id, limit=limit)
        recommended_for_you = await recommendation_engine.personalized(user_id=user_id, limit=limit)
        tonight = await recommendation_engine.tonight_pick(user_id=user_id)

        return {
            "tonight_pick": tonight,
            "rows": {
                "trending_today": await movie_service.trending(window="day", limit=limit),
                "trending_this_week": await movie_service.trending(window="week", limit=limit),
                "top_rated_movies": await movie_service.top_rated(limit=limit),
                "new_releases": await movie_service.new_releases(limit=limit),
                "popular_movies": await movie_service.popular(limit=limit),
                "because_you_watched": because_you_watched,
                "recommended_for_you": recommended_for_you,
                "movies_you_may_like": recommended_for_you,
                "hidden_gems": await movie_service.hidden_gems(limit=limit),
                "critically_acclaimed": await movie_service.critically_acclaimed(limit=limit),
                "action_movies": await movie_service.by_genre("Action", limit=limit),
                "comedy_movies": await movie_service.by_genre("Comedy", limit=limit),
                "drama_movies": await movie_service.by_genre("Drama", limit=limit),
                "sci_fi_movies": await movie_service.by_genre("Sci-Fi", limit=limit),
                "thriller_movies": await movie_service.by_genre("Thriller", limit=limit),
                "award_winners": await movie_service.award_winners(limit=limit),
            },
        }

    @app.get("/api/random")
    async def random_movie(
        genre: str | None = Query(default=None),
        mood: str | None = Query(default=None),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        return await movie_service.random_movie(genre=genre, mood=mood)

    @app.get("/api/tonight")
    async def tonight_pick(
        user_id: str = Query(default="guest", min_length=1),
        mood: str | None = Query(default=None),
    ) -> dict[str, Any]:
        recommendation_engine = get_recommendation_engine()
        return await recommendation_engine.tonight_pick(user_id=user_id, mood=mood)

    @app.get("/api/explore/actor/{actor_name}")
    async def actor_explorer(actor_name: str, limit: int = Query(default=20, ge=1, le=50)) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.explore_actor(actor_name, limit=limit)
        return {"actor": actor_name, "count": len(movies), "movies": movies}

    @app.get("/api/explore/director/{director_name}")
    async def director_explorer(director_name: str, limit: int = Query(default=20, ge=1, le=50)) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.explore_director(director_name, limit=limit)
        return {"director": director_name, "count": len(movies), "movies": movies}

    @app.get("/api/decade/{decade}")
    async def decade_browse(decade: int, limit: int = Query(default=20, ge=1, le=50)) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.by_decade(decade, limit=limit)
        return {"decade": decade, "count": len(movies), "movies": movies}

    @app.get("/api/watchlist")
    async def watchlist(user_id: str = Query(default="guest", min_length=1)) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.get_watchlist(user_id)
        return {"user_id": user_id, "count": len(movies), "movies": movies}

    @app.post("/api/watchlist/add")
    async def watchlist_add(payload: WatchlistMutation) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.add_to_watchlist(payload.user_id, payload.movie_id)
        return {"user_id": payload.user_id, "count": len(movies), "movies": movies}

    @app.delete("/api/watchlist/remove")
    async def watchlist_remove(
        user_id: str = Query(default="guest", min_length=1),
        movie_id: int = Query(..., ge=1),
    ) -> dict[str, Any]:
        movie_service = get_movie_service()
        movies = await movie_service.remove_from_watchlist(user_id, movie_id)
        return {"user_id": user_id, "count": len(movies), "movies": movies}

    if public_dir.exists():
        app.mount("/", StaticFiles(directory=public_dir, html=True), name="public")

    return app


app = create_app()
