# CineMatch

CineMatch is a movie recommendation app with a static frontend and a FastAPI backend that powers search, genre picks, and content-based recommendations.

## Stack

- FastAPI
- Pandas
- scikit-learn
- TMDB API for poster lookups when `TMDB_API_KEY` or `TMDB_BEARER_TOKEN` is configured
- Vercel for deployment

## Project structure

```text
backend/
├── main.py
├── recommendation.py
├── dataset/
│   └── movies.csv
├── utils/
│   └── preprocessing.py
└── requirements.txt
public/
├── index.html
├── login.html
├── home.html
├── movie-details.html
├── watchlist.html
├── css/
└── js/
app.py
requirements.txt
```

## Local setup

1. Install Python 3.11 or newer.
2. Install dependencies with `pip install -r requirements.txt`.
3. Start the API with `uvicorn app:app --reload`.
4. Open `http://127.0.0.1:8000/docs` for API docs or deploy to Vercel.

## API routes

- `GET /api/movies`
- `GET /api/movies/{movie_id}`
- `GET /api/search?title=Inception`
- `GET /api/recommend?movie=Inception`
- `GET /api/genre/Sci-Fi`
- `GET /api/health`

## Vercel deployment

1. Import the repository into Vercel.
2. Add `TMDB_API_KEY` or `TMDB_BEARER_TOKEN` if you want live poster refresh from TMDB.
3. Deploy. Vercel serves files from `public/` and loads the FastAPI app from `app.py`.
