# CineVerse AI

CineVerse AI is a Netflix-style movie discovery app with a static frontend and a FastAPI backend for movie loading, search, trailers, discovery rows, recommendations, and watchlist flows.

## Stack

- Python
- FastAPI
- Pandas
- scikit-learn
- Redis with in-memory fallback
- TMDB API or OMDb API for metadata enrichment
- Uvicorn
- Vercel

## Backend layout

```text
backend/
├── main.py
├── recommendation_engine.py
├── movie_service.py
├── dataset/
│   └── movies.csv
├── cache/
│   └── __init__.py
├── utils/
│   ├── data_cleaning.py
│   └── preprocessing.py
└── requirements.txt
```

## Environment variables

- `TMDB_API_KEY` or `TMDB_BEARER_TOKEN`
- `OMDB_API_KEY`
- `REDIS_URL` for persistent cache and user-state storage

If TMDB is not configured, the backend can fall back to OMDb for posters, plot, cast, genres, rating, runtime, and director metadata. If neither provider is configured, it still works with the local dataset and placeholder assets.

## Local run

1. Install Python 3.11+.
2. Install dependencies with `pip install -r requirements.txt`.
3. Run `uvicorn app:app --reload`.
4. Open `http://127.0.0.1:8000/docs`.

## Main endpoints

- `GET /api/movies?page=1&page_size=24`
- `GET /api/movie/{movie_id}`
- `GET /api/search?title=...`
- `GET /api/search/suggestions?query=...`
- `GET /api/recommend/{movie_id}`
- `GET /api/recommend?movie=...`
- `GET /api/trending?window=day|week`
- `GET /api/top-rated`
- `GET /api/new-releases`
- `GET /api/popular`
- `GET /api/genre/{genre_name}`
- `GET /api/discovery`
- `GET /api/random`
- `GET /api/tonight`
- `GET /api/explore/actor/{actor_name}`
- `GET /api/explore/director/{director_name}`
- `GET /api/decade/{decade}`
- `GET /api/watchlist`
- `POST /api/watchlist/add`
- `DELETE /api/watchlist/remove`

## Notes

- Movie metadata is normalized into a common model with poster, backdrop, trailer, runtime, rating, cast, director, and popularity score.
- Missing metadata is enriched from TMDB first, then OMDb when available.
- Recommendation scoring combines TF-IDF similarity, genre overlap, actor overlap, director overlap, clustering, and user taste signals.
- The homepage JS now supports backend-driven discovery rows and paginated browse loading.
