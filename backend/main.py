from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .recommendation import get_engine


def create_app() -> FastAPI:
    app = FastAPI(
        title="CineMatch API",
        description="FastAPI backend for movie search and content-based recommendations.",
        version="1.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, object]:
        engine = get_engine()
        return {"status": "ok", "movies_indexed": engine.movie_count}

    @app.get("/api/movies")
    def movies(limit: int | None = Query(default=None, ge=1, le=500)) -> dict[str, object]:
        engine = get_engine()
        results = engine.list_movies(limit=limit)
        return {"count": len(results), "movies": results}

    @app.get("/api/movies/{movie_id}")
    def movie_by_id(movie_id: int) -> dict[str, object]:
        engine = get_engine()
        movie = engine.get_movie_by_id(movie_id)
        if not movie:
            raise HTTPException(status_code=404, detail="Movie not found")
        return movie

    @app.get("/api/search")
    def search(
        title: str = Query(..., min_length=1, description="Movie title to search"),
        limit: int = Query(default=20, ge=1, le=100),
    ) -> dict[str, object]:
        engine = get_engine()
        results = engine.search(title, limit=limit)
        return {"query": title, "count": len(results), "movies": results}

    @app.get("/api/recommend")
    def recommend(
        movie: str = Query(..., min_length=1, description="Movie title to recommend from"),
        limit: int = Query(default=10, ge=1, le=20),
    ) -> dict[str, object]:
        engine = get_engine()
        result = engine.recommend(movie, limit=limit)
        if not result:
            raise HTTPException(status_code=404, detail="Movie not found")
        source_movie, recommendations = result
        return {
            "movie": source_movie,
            "count": len(recommendations),
            "movies": recommendations,
        }

    @app.get("/api/genre/{genre_name}")
    def genre_recommendations(
        genre_name: str,
        limit: int = Query(default=10, ge=1, le=100),
    ) -> dict[str, object]:
        engine = get_engine()
        results = engine.by_genre(genre_name, limit=limit)
        if not results:
            raise HTTPException(status_code=404, detail="Genre not found")
        return {"genre": genre_name, "count": len(results), "movies": results}

    return app


app = create_app()
