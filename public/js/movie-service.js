// CineVerse Movie Data and Local Persistence Service
const MovieService = (() => {
    const FALLBACK_MOVIES_URL = 'data/movies.json';
    const MAX_RECENT = 10;
    const PLATFORM_POOL = ['Netflix', 'Prime Video', 'Disney+ Hotstar'];
    const SUBTITLE_POOL = ['en', 'hi', 'ta', 'te', 'es'];
    const DUB_POOL = ['en', 'hi', 'ta', 'te'];
    const GENRE_ID_MAP = {
        12: 'Adventure',
        16: 'Animation',
        18: 'Drama',
        27: 'Horror',
        28: 'Action',
        35: 'Comedy',
        53: 'Thriller',
        80: 'Crime',
        878: 'Sci-Fi',
        9648: 'Mystery',
        10749: 'Romance'
    };

    let cachedMovies = null;
    let cachedDiscoverySections = null;
    const apiCache = {
        search: new Map(),
        genre: new Map(),
        recommend: new Map()
    };

    function getUserId(user) {
        return user && user.id ? user.id : 'guest';
    }

    function getKey(prefix, userId) {
        return `cineverse_${prefix}_${userId}`;
    }

    function readJson(key, fallback) {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
            return parsed === null || parsed === undefined ? fallback : parsed;
        } catch (error) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function getApiBase() {
        const explicitBase = window.localStorage.getItem('cineverse_api_base');
        if (explicitBase) return explicitBase.replace(/\/$/, '');
        if (window.location.protocol === 'file:') return 'http://127.0.0.1:8000/api';
        if (['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port && window.location.port !== '8000') {
            return 'http://127.0.0.1:8000/api';
        }
        return '/api';
    }

    async function fetchApiJson(path) {
        const response = await fetch(`${getApiBase()}${path}`, {
            headers: {
                'Accept': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        return response.json();
    }

    function splitList(value) {
        if (Array.isArray(value)) return value.filter(Boolean);
        if (!value) return [];
        return String(value).split('|').map(item => item.trim()).filter(Boolean);
    }

    function genreIdToName(genreId) {
        return GENRE_ID_MAP[Number(genreId)] || '';
    }

    function getGenreId(genreName) {
        const entry = Object.entries(GENRE_ID_MAP).find(([, value]) => value.toLowerCase() === String(genreName || '').toLowerCase());
        return entry ? Number(entry[0]) : 0;
    }

    function pickById(id, list, count = 1) {
        const picks = [];
        for (let i = 0; i < count; i++) {
            const index = (id + i * 3) % list.length;
            picks.push(list[index]);
        }
        return [...new Set(picks)];
    }

    function inferWarnings(genre) {
        const map = {
            'Horror': ['Violence', 'Scary scenes'],
            'Thriller': ['Intense scenes'],
            'Action': ['Violence'],
            'Drama': ['Strong language'],
            'Mystery': ['Suspense']
        };
        return map[genre] || ['Mild themes'];
    }

    function inferMaturity(rating) {
        if (rating >= 8.7) return 'U/A 16+';
        if (rating >= 8.0) return 'U/A 13+';
        return 'U/A 7+';
    }

    function inferMood(genre) {
        const map = {
            'Action': ['Adrenaline', 'Epic'],
            'Comedy': ['Feel-good', 'Light'],
            'Romance': ['Emotional', 'Feel-good'],
            'Thriller': ['Dark', 'Mind-bending'],
            'Horror': ['Dark', 'Intense'],
            'Sci-Fi': ['Mind-bending', 'Epic'],
            'Mystery': ['Mind-bending', 'Dark'],
            'Drama': ['Emotional', 'Thoughtful'],
            'Animation': ['Family', 'Feel-good']
        };
        return map[genre] || ['Feel-good'];
    }

    function inferSeasonalTags(movie) {
        const tags = [];
        if (movie.genre === 'Horror' || movie.genre === 'Thriller') tags.push('halloween');
        if (movie.genre === 'Romance') tags.push('valentine');
        if (movie.genre === 'Drama' && movie.rating >= 8.5) tags.push('awards');
        if (movie.genre === 'Comedy' || movie.genre === 'Animation') tags.push('holiday');
        return tags;
    }

    function normalizeMovie(raw) {
        const movie = { ...raw };
        const id = Number(raw.id ?? raw.movie_id);
        const genres = splitList(raw.genres);
        const genre = raw.genre || genres[0] || 'Unknown';

        movie.id = id;
        movie.movie_id = id;
        movie.genre = genre;
        movie.genres = genres.length ? genres : [genre];
        movie.genre_id = Number(raw.genre_id || getGenreId(genre));
        movie.year = Number(raw.year || raw.release_year || 0);
        movie.release_year = movie.year;
        movie.description = raw.description || raw.overview || '';
        movie.overview = movie.description;
        movie.cast = splitList(raw.cast);
        movie.keywords = splitList(raw.keywords);
        movie.tags = splitList(raw.tags);
        movie.poster = raw.poster || 'https://placehold.co/500x750/111827/e5e7eb?text=No+Poster';
        movie.runtime_min = Number(raw.runtime_min || (95 + ((id * 11) % 70)));
        movie.moods = Array.isArray(raw.moods) ? raw.moods : inferMood(genre);
        movie.platforms = Array.isArray(raw.platforms) ? raw.platforms : pickById(id, PLATFORM_POOL, 2);
        movie.maturity = raw.maturity || inferMaturity(Number(movie.rating || raw.rating || 0));
        movie.content_warnings = Array.isArray(raw.content_warnings) ? raw.content_warnings : inferWarnings(genre);
        movie.subtitles = Array.isArray(raw.subtitles) ? raw.subtitles : pickById(id + 1, SUBTITLE_POOL, 3);
        movie.dubbing = Array.isArray(raw.dubbing) ? raw.dubbing : pickById(id + 2, DUB_POOL, 2);
        movie.seasonal_tags = Array.isArray(raw.seasonal_tags) ? raw.seasonal_tags : inferSeasonalTags(movie);
        movie.crew = raw.crew || {
            writer: `${raw.director || ''}`,
            music: 'Original Score Team'
        };

        return movie;
    }

    async function loadMoviePage(page = 1, pageSize = 24) {
        const payload = await fetchApiJson(`/movies?page=${page}&page_size=${pageSize}`);
        return {
            page: Number(payload.page || page),
            pageSize: Number(payload.page_size || pageSize),
            hasMore: Boolean(payload.has_more),
            nextPage: payload.next_page ? Number(payload.next_page) : null,
            movies: (Array.isArray(payload.movies) ? payload.movies : []).map(normalizeMovie)
        };
    }

    async function loadMovies(forceRefresh = false) {
        if (Array.isArray(cachedMovies) && !forceRefresh) {
            return cachedMovies;
        }

        try {
            const collected = [];
            let page = 1;
            let hasMore = true;
            while (hasMore && page <= 10) {
                const result = await loadMoviePage(page, 50);
                collected.push(...result.movies);
                hasMore = result.hasMore;
                page = result.nextPage || page + 1;
            }
            cachedMovies = forceRefresh ? collected : collected;
            return cachedMovies;
        } catch (apiError) {
            const response = await fetch(FALLBACK_MOVIES_URL);
            if (!response.ok) throw new Error('Failed to load movies dataset');

            const rows = await response.json();
            cachedMovies = (Array.isArray(rows) ? rows : []).map(normalizeMovie);
            return cachedMovies;
        }
    }

    async function getMovieById(movieId, user = null) {
        try {
            const userId = encodeURIComponent(getUserId(user));
            const payload = await fetchApiJson(`/movie/${movieId}?user_id=${userId}`);
            return normalizeMovie(payload);
        } catch (error) {
            const movies = await loadMovies();
            return movies.find(movie => Number(movie.id) === Number(movieId)) || null;
        }
    }

    async function searchMovies(query, limit = 25, user = null) {
        const term = String(query || '').trim();
        if (!term) return loadMovies();

        const cacheKey = `${term.toLowerCase()}::${limit}`;
        if (apiCache.search.has(cacheKey)) return apiCache.search.get(cacheKey);

        try {
            const payload = await fetchApiJson(`/search?title=${encodeURIComponent(term)}&limit=${limit}&user_id=${encodeURIComponent(getUserId(user))}`);
            const movies = (Array.isArray(payload.movies) ? payload.movies : []).map(normalizeMovie);
            apiCache.search.set(cacheKey, movies);
            return movies;
        } catch (error) {
            const movies = await loadMovies();
            return filterMovies(movies, { query: term }).slice(0, limit);
        }
    }

    async function getGenreRecommendations(genreNameOrId, limit = 25) {
        const genreName = /^\d+$/.test(String(genreNameOrId || ''))
            ? genreIdToName(Number(genreNameOrId))
            : String(genreNameOrId || '').trim();

        if (!genreName) return [];

        const cacheKey = `${genreName.toLowerCase()}::${limit}`;
        if (apiCache.genre.has(cacheKey)) return apiCache.genre.get(cacheKey);

        try {
            const payload = await fetchApiJson(`/genre/${encodeURIComponent(genreName)}?limit=${limit}`);
            const movies = (Array.isArray(payload.movies) ? payload.movies : []).map(normalizeMovie);
            apiCache.genre.set(cacheKey, movies);
            return movies;
        } catch (error) {
            const movies = await loadMovies();
            return movies
                .filter(movie => String(movie.genre).toLowerCase() === genreName.toLowerCase() || Number(movie.genre_id) === Number(genreNameOrId))
                .sort((a, b) => b.rating - a.rating)
                .slice(0, limit);
        }
    }

    async function getSimilarMovies(movieRef, limit = 10, user = null) {
        const cacheKey = `${String(movieRef).toLowerCase()}::${limit}::${getUserId(user)}`;
        if (apiCache.recommend.has(cacheKey)) return apiCache.recommend.get(cacheKey);

        try {
            let path = '';
            if (/^\d+$/.test(String(movieRef || ''))) {
                path = `/recommend/${movieRef}?limit=${limit}&user_id=${encodeURIComponent(getUserId(user))}`;
            } else {
                path = `/recommend?movie=${encodeURIComponent(String(movieRef || '').trim())}&limit=${limit}&user_id=${encodeURIComponent(getUserId(user))}`;
            }

            const payload = await fetchApiJson(path);
            const movies = (Array.isArray(payload.movies) ? payload.movies : []).map(normalizeMovie);
            apiCache.recommend.set(cacheKey, movies);
            return movies;
        } catch (error) {
            const movies = await loadMovies();
            const sourceMovie = /^\d+$/.test(String(movieRef || ''))
                ? movies.find(movie => Number(movie.id) === Number(movieRef))
                : movies.find(movie => movie.title.toLowerCase() === String(movieRef || '').toLowerCase());
            return sourceMovie ? getRecommendationsForMovie(movies, sourceMovie, limit) : [];
        }
    }

    async function getDiscoverySections(user = null, limit = 12, forceRefresh = false) {
        if (cachedDiscoverySections && !forceRefresh) return cachedDiscoverySections;
        const payload = await fetchApiJson(`/discovery?user_id=${encodeURIComponent(getUserId(user))}&limit=${limit}`);
        const rows = payload.rows || {};
        const normalizedRows = {};

        Object.keys(rows).forEach(key => {
            normalizedRows[key] = (Array.isArray(rows[key]) ? rows[key] : []).map(item => normalizeMovie(item.movie || item));
        });

        cachedDiscoverySections = {
            tonightPick: payload.tonight_pick ? {
                ...payload.tonight_pick,
                movie: normalizeMovie(payload.tonight_pick.movie || payload.tonight_pick)
            } : null,
            rows: normalizedRows
        };
        return cachedDiscoverySections;
    }

    async function getTrending(window = 'day', limit = 20) {
        const payload = await fetchApiJson(`/trending?window=${encodeURIComponent(window)}&limit=${limit}`);
        return (Array.isArray(payload.movies) ? payload.movies : []).map(normalizeMovie);
    }

    async function getTopRated(limit = 20) {
        const payload = await fetchApiJson(`/top-rated?limit=${limit}`);
        return (Array.isArray(payload.movies) ? payload.movies : []).map(normalizeMovie);
    }

    async function getNewReleases(limit = 20) {
        const payload = await fetchApiJson(`/new-releases?limit=${limit}`);
        return (Array.isArray(payload.movies) ? payload.movies : []).map(normalizeMovie);
    }

    async function getPopular(limit = 20) {
        const payload = await fetchApiJson(`/popular?limit=${limit}`);
        return (Array.isArray(payload.movies) ? payload.movies : []).map(normalizeMovie);
    }

    async function getRandomMovie(options = {}) {
        const params = new URLSearchParams();
        if (options.genre) params.set('genre', options.genre);
        if (options.mood) params.set('mood', options.mood);
        const payload = await fetchApiJson(`/random?${params.toString()}`);
        return normalizeMovie(payload);
    }

    async function getTonightPick(user = null, mood = '') {
        const params = new URLSearchParams({ user_id: getUserId(user) });
        if (mood) params.set('mood', mood);
        const payload = await fetchApiJson(`/tonight?${params.toString()}`);
        return {
            ...payload,
            movie: normalizeMovie(payload.movie || payload)
        };
    }

    function sortMovies(movies, sortBy) {
        const copy = [...movies];
        if (sortBy === 'rating') return copy.sort((a, b) => b.rating - a.rating);
        if (sortBy === 'year') return copy.sort((a, b) => b.year - a.year);
        if (sortBy === 'alphabetical') return copy.sort((a, b) => a.title.localeCompare(b.title));
        if (sortBy === 'runtime') return copy.sort((a, b) => a.runtime_min - b.runtime_min);
        return copy;
    }

    function runtimeBandMatch(movie, runtimeBand) {
        if (!runtimeBand) return true;
        if (runtimeBand === 'short') return movie.runtime_min < 90;
        if (runtimeBand === 'medium') return movie.runtime_min >= 90 && movie.runtime_min <= 120;
        if (runtimeBand === 'long') return movie.runtime_min > 120;
        return true;
    }

    function listContainsAny(haystack, needle) {
        if (!needle) return true;
        return Array.isArray(haystack) && haystack.some(item => String(item).toLowerCase() === String(needle).toLowerCase());
    }

    function parseAdvancedQuery(query) {
        const result = {
            text: '',
            actor: '',
            director: '',
            year: null
        };

        if (!query) return result;

        const tokens = String(query).split(/\s+/).filter(Boolean);
        const freeTokens = [];

        tokens.forEach(token => {
            const lower = token.toLowerCase();
            if (lower.startsWith('actor:')) {
                result.actor = token.slice(6).trim();
                return;
            }
            if (lower.startsWith('director:')) {
                result.director = token.slice(9).trim();
                return;
            }
            if (lower.startsWith('year:')) {
                const n = Number(token.slice(5));
                result.year = Number.isFinite(n) ? n : null;
                return;
            }
            freeTokens.push(token);
        });

        result.text = freeTokens.join(' ').trim();
        return result;
    }

    function filterMovies(movies, options = {}) {
        const {
            query = '',
            genre = null,
            minRating = null,
            mood = null,
            runtimeBand = null,
            platform = null,
            maturity = null,
            subtitle = null,
            dubbing = null
        } = options;

        const parsed = parseAdvancedQuery(query);

        return movies.filter(movie => {
            const matchFreeText = !parsed.text || movie.title.toLowerCase().includes(parsed.text.toLowerCase());
            const matchActor = !parsed.actor || (Array.isArray(movie.cast) && movie.cast.some(actor => actor.toLowerCase().includes(parsed.actor.toLowerCase())));
            const matchDirector = !parsed.director || String(movie.director || '').toLowerCase().includes(parsed.director.toLowerCase());
            const matchYear = !parsed.year || Number(movie.year) === Number(parsed.year);
            const matchGenre = !genre || movie.genre_id === Number(genre) || String(movie.genre).toLowerCase() === String(genre).toLowerCase();
            const matchRating = minRating === null || Number(movie.rating) >= Number(minRating);
            const matchMood = !mood || listContainsAny(movie.moods, mood);
            const matchRuntime = runtimeBandMatch(movie, runtimeBand);
            const matchPlatform = !platform || listContainsAny(movie.platforms, platform);
            const matchMaturity = !maturity || String(movie.maturity) === String(maturity);
            const matchSubtitle = !subtitle || listContainsAny(movie.subtitles, subtitle);
            const matchDubbing = !dubbing || listContainsAny(movie.dubbing, dubbing);

            return matchFreeText && matchActor && matchDirector && matchYear && matchGenre && matchRating && matchMood && matchRuntime && matchPlatform && matchMaturity && matchSubtitle && matchDubbing;
        });
    }

    function getFeedback(user) {
        const key = getKey('feedback', getUserId(user));
        return readJson(key, {
            likedGenres: {},
            dislikedGenres: {},
            likedMovieIds: [],
            dislikedMovieIds: []
        });
    }

    function saveFeedback(user, payload) {
        const key = getKey('feedback', getUserId(user));
        writeJson(key, payload);
        return payload;
    }

    function recordFeedback(user, movie, type) {
        const feedback = getFeedback(user);
        const genreKey = String(movie.genre_id);

        if (type === 'more') {
            feedback.likedGenres[genreKey] = (feedback.likedGenres[genreKey] || 0) + 1;
            if (!feedback.likedMovieIds.includes(movie.id)) feedback.likedMovieIds.push(movie.id);
            feedback.dislikedMovieIds = feedback.dislikedMovieIds.filter(id => id !== movie.id);
        } else if (type === 'less') {
            feedback.dislikedGenres[genreKey] = (feedback.dislikedGenres[genreKey] || 0) + 1;
            if (!feedback.dislikedMovieIds.includes(movie.id)) feedback.dislikedMovieIds.push(movie.id);
            feedback.likedMovieIds = feedback.likedMovieIds.filter(id => id !== movie.id);
        }

        saveFeedback(user, feedback);
        return feedback;
    }

    function getFollowState(user) {
        const key = getKey('follow', getUserId(user));
        return readJson(key, { directors: [], actors: [] });
    }

    function toggleFollowDirector(user, director) {
        const state = getFollowState(user);
        if (state.directors.includes(director)) {
            state.directors = state.directors.filter(item => item !== director);
        } else {
            state.directors.push(director);
        }
        writeJson(getKey('follow', getUserId(user)), state);
        return state;
    }

    function toggleFollowActor(user, actor) {
        const state = getFollowState(user);
        if (state.actors.includes(actor)) {
            state.actors = state.actors.filter(item => item !== actor);
        } else {
            state.actors.push(actor);
        }
        writeJson(getKey('follow', getUserId(user)), state);
        return state;
    }

    function getWatchlistIds(user) {
        const key = getKey('watchlist', getUserId(user));
        const list = readJson(key, []);
        return Array.isArray(list) ? list.map(Number) : [];
    }

    function addToWatchlist(user, movieId) {
        const key = getKey('watchlist', getUserId(user));
        const list = getWatchlistIds(user);
        if (!list.includes(Number(movieId))) {
            list.push(Number(movieId));
            writeJson(key, list);
        }
        return list;
    }

    function removeFromWatchlist(user, movieId) {
        const key = getKey('watchlist', getUserId(user));
        const list = getWatchlistIds(user).filter(id => id !== Number(movieId));
        writeJson(key, list);
        return list;
    }

    function isInWatchlist(user, movieId) {
        return getWatchlistIds(user).includes(Number(movieId));
    }

    function getRecentIds(user) {
        const key = getKey('recent', getUserId(user));
        const list = readJson(key, []);
        return Array.isArray(list) ? list.map(Number) : [];
    }

    function pushRecentView(user, movieId) {
        const key = getKey('recent', getUserId(user));
        const list = getRecentIds(user).filter(id => id !== Number(movieId));
        list.unshift(Number(movieId));
        const finalList = list.slice(0, MAX_RECENT);
        writeJson(key, finalList);
        return finalList;
    }

    function getHistory(user) {
        return readJson(getKey('history', getUserId(user)), []);
    }

    function markWatched(user, movieId, diaryNote = '') {
        const key = getKey('history', getUserId(user));
        const history = getHistory(user);
        const found = history.find(entry => Number(entry.movieId) === Number(movieId));

        if (found) {
            found.rewatchCount = Number(found.rewatchCount || 1) + 1;
            found.lastWatchedAt = Date.now();
            if (diaryNote) found.diaryNote = diaryNote;
        } else {
            history.push({
                movieId: Number(movieId),
                firstWatchedAt: Date.now(),
                lastWatchedAt: Date.now(),
                rewatchCount: 1,
                diaryNote: diaryNote || ''
            });
        }

        writeJson(key, history);
        return history;
    }

    function getDiaryEntries(user, movies) {
        const map = new Map(movies.map(movie => [movie.id, movie]));
        return getHistory(user)
            .map(entry => ({ ...entry, movie: map.get(Number(entry.movieId)) || null }))
            .filter(entry => entry.movie)
            .sort((a, b) => Number(b.lastWatchedAt) - Number(a.lastWatchedAt));
    }

    function saveReview(user, movieId, reviewText, rating) {
        const reviewKey = `cineverse_reviews_${movieId}`;
        const reviews = readJson(reviewKey, []);
        const userId = getUserId(user);

        const existingIndex = reviews.findIndex(review => review.userId === userId);
        const reviewId = existingIndex >= 0 ? reviews[existingIndex].id : `${movieId}-${userId}`;

        const payload = {
            id: reviewId,
            movieId: Number(movieId),
            userId,
            username: user && user.username ? user.username : 'Anonymous',
            rating: rating ? Number(rating) : null,
            reviewText,
            updatedAt: Date.now()
        };

        if (existingIndex >= 0) reviews[existingIndex] = payload;
        else reviews.push(payload);

        writeJson(reviewKey, reviews);
        return payload;
    }

    function getUserReview(user, movieId) {
        const reviews = readJson(`cineverse_reviews_${movieId}`, []);
        const userId = getUserId(user);
        return reviews.find(review => review.userId === userId) || null;
    }

    function getHelpfulVotes(movieId, reviewId) {
        return readJson(`cineverse_votes_${movieId}_${reviewId}`, {});
    }

    function voteReviewHelpful(user, movieId, reviewId) {
        const userId = getUserId(user);
        const key = `cineverse_votes_${movieId}_${reviewId}`;
        const votes = getHelpfulVotes(movieId, reviewId);
        votes[userId] = !votes[userId];
        writeJson(key, votes);
        return votes;
    }

    function getAllReviewsForMovie(movieId) {
        const reviews = readJson(`cineverse_reviews_${movieId}`, []);

        return reviews.map(review => {
            const votes = getHelpfulVotes(movieId, review.id);
            const helpfulCount = Object.values(votes).filter(Boolean).length;
            return { ...review, helpfulCount };
        });
    }

    function collectAllReviewRatings() {
        const rows = [];

        Object.keys(localStorage).forEach(key => {
            if (!key.startsWith('cineverse_reviews_')) return;

            const reviews = readJson(key, []);
            if (!Array.isArray(reviews)) return;

            reviews.forEach(review => {
                if (!review || !review.userId || !review.movieId || !review.rating) return;
                rows.push({
                    userId: String(review.userId),
                    movieId: Number(review.movieId),
                    rating: Number(review.rating)
                });
            });
        });

        return rows;
    }

    // Adapted collaborative filtering flow inspired by bluehalo/akin (MIT):
    // build user vectors -> compute user similarity -> weight unrated items.
    function buildUserVectors(ratingsRows) {
        const vectors = {};

        ratingsRows.forEach(row => {
            if (!vectors[row.userId]) vectors[row.userId] = {};
            vectors[row.userId][row.movieId] = row.rating;
        });

        return vectors;
    }

    function cosineSimilarity(v1, v2) {
        const shared = Object.keys(v1).filter(movieId => v2[movieId] !== undefined);
        if (!shared.length) return 0;

        let dot = 0;
        let mag1 = 0;
        let mag2 = 0;

        shared.forEach(movieId => {
            dot += v1[movieId] * v2[movieId];
        });

        Object.values(v1).forEach(value => { mag1 += value * value; });
        Object.values(v2).forEach(value => { mag2 += value * value; });

        const denom = Math.sqrt(mag1) * Math.sqrt(mag2);
        if (!denom) return 0;
        return dot / denom;
    }

    function getCollaborativeScores(currentUserId) {
        const rows = collectAllReviewRatings();
        const vectors = buildUserVectors(rows);
        const current = vectors[currentUserId];
        if (!current) return {};

        const similarities = Object.keys(vectors)
            .filter(userId => userId !== currentUserId)
            .map(userId => ({
                userId,
                similarity: cosineSimilarity(current, vectors[userId])
            }))
            .filter(item => item.similarity > 0.05);

        const predicted = {};
        similarities.forEach(item => {
            const otherVector = vectors[item.userId];
            Object.keys(otherVector).forEach(movieId => {
                const numericMovieId = Number(movieId);
                if (current[numericMovieId] !== undefined) return;

                if (!predicted[numericMovieId]) predicted[numericMovieId] = { weighted: 0, total: 0 };
                predicted[numericMovieId].weighted += item.similarity * otherVector[movieId];
                predicted[numericMovieId].total += item.similarity;
            });
        });

        const scores = {};
        Object.keys(predicted).forEach(movieId => {
            const bucket = predicted[movieId];
            if (bucket.total > 0) {
                scores[Number(movieId)] = bucket.weighted / bucket.total;
            }
        });

        return scores;
    }

    function getUserPreferenceRecommended(movies, user) {
        return getPersonalizedRecommendations(movies, user, 40);
    }

    function getPersonalizedRecommendations(movies, user, limit = 24) {
        const pref = (user && user.preferences) || {};
        const preferredGenres = Array.isArray(pref.genres) ? pref.genres.map(Number) : [];
        const preferredLanguages = Array.isArray(pref.languages) ? pref.languages : [];
        const quiz = pref.quiz || {};
        const feedback = getFeedback(user);
        const follow = getFollowState(user);
        const collaborativeScores = getCollaborativeScores(getUserId(user));

        const ranked = movies.map(movie => {
            let score = Number(movie.rating || 0);

            if (preferredGenres.includes(Number(movie.genre_id))) score += 4;
            if (preferredLanguages.includes(movie.language)) score += 3;
            if (quiz.mood && listContainsAny(movie.moods, quiz.mood)) score += 2;
            if (quiz.runtimeBand && runtimeBandMatch(movie, quiz.runtimeBand)) score += 1;
            if (quiz.platform && listContainsAny(movie.platforms, quiz.platform)) score += 2;

            const g = String(movie.genre_id);
            score += (feedback.likedGenres[g] || 0) * 1.5;
            score -= (feedback.dislikedGenres[g] || 0) * 1.5;

            if (feedback.likedMovieIds.includes(movie.id)) score += 3;
            if (feedback.dislikedMovieIds.includes(movie.id)) score -= 3;

            if (follow.directors.includes(movie.director)) score += 2;
            if (Array.isArray(movie.cast) && movie.cast.some(actor => follow.actors.includes(actor))) score += 2;
            if (collaborativeScores[movie.id]) score += collaborativeScores[movie.id] * 0.8;

            return { movie, score };
        });

        ranked.sort((a, b) => b.score - a.score);
        return ranked.slice(0, limit).map(item => item.movie);
    }

    function explainRecommendation(movie, user) {
        const reasons = [];
        const pref = (user && user.preferences) || {};
        const preferredGenres = Array.isArray(pref.genres) ? pref.genres.map(Number) : [];
        const preferredLanguages = Array.isArray(pref.languages) ? pref.languages : [];
        const quiz = pref.quiz || {};
        const feedback = getFeedback(user);
        const follow = getFollowState(user);

        if (preferredGenres.includes(Number(movie.genre_id))) reasons.push('matches your preferred genre');
        if (preferredLanguages.includes(movie.language)) reasons.push('matches your language preference');
        if (quiz.mood && listContainsAny(movie.moods, quiz.mood)) reasons.push(`fits your ${quiz.mood} mood`);
        if (quiz.platform && listContainsAny(movie.platforms, quiz.platform)) reasons.push(`available on ${quiz.platform}`);
        if (follow.directors.includes(movie.director)) reasons.push('from a followed director');
        if (Array.isArray(movie.cast) && movie.cast.some(actor => follow.actors.includes(actor))) reasons.push('features actors you follow');
        if ((feedback.likedGenres[String(movie.genre_id)] || 0) > 0) reasons.push('similar to movies you liked');

        return reasons.length ? `Because it ${reasons[0]}.` : 'Recommended for discovery.';
    }

    function getRecommendationsForMovie(movies, movie, limit = 6) {
        const sameGenre = movies
            .filter(item => item.id !== movie.id && item.genre_id === movie.genre_id)
            .sort((a, b) => b.rating - a.rating)
            .slice(0, limit);

        if (sameGenre.length >= 4) return sameGenre;

        const filler = movies
            .filter(item => item.id !== movie.id && !sameGenre.some(g => g.id === item.id))
            .sort((a, b) => b.rating - a.rating)
            .slice(0, limit - sameGenre.length);

        return [...sameGenre, ...filler];
    }

    function buildNextQueue(currentMovie, movies, user, limit = 5) {
        const primary = getRecommendationsForMovie(movies, currentMovie, limit + 3);
        const personalized = getPersonalizedRecommendations(movies, user, limit + 6);

        const merged = [...primary, ...personalized]
            .filter(movie => movie.id !== currentMovie.id)
            .filter((movie, index, array) => array.findIndex(item => item.id === movie.id) === index)
            .slice(0, limit);

        return merged;
    }

    function getUserByUsername(username) {
        if (!username || !window.storageManager) return null;
        const users = window.storageManager.getAllUsers();
        return Object.values(users).find(user => String(user.username).toLowerCase() === String(username).toLowerCase()) || null;
    }

    function getFriendOverlapRecommendations(user, friendUsername, movies, limit = 10) {
        const friend = getUserByUsername(friendUsername);
        if (!friend) return { friend: null, movies: [] };

        const userPrefs = (user.preferences && user.preferences.genres) || [];
        const friendPrefs = (friend.preferences && friend.preferences.genres) || [];
        const overlapGenres = userPrefs.filter(genre => friendPrefs.includes(genre));

        let picks = movies.filter(movie => overlapGenres.includes(Number(movie.genre_id)));

        if (!picks.length) {
            const friendWatchlistIds = getWatchlistIds(friend);
            picks = movies.filter(movie => friendWatchlistIds.includes(movie.id));
        }

        return {
            friend,
            movies: sortMovies(picks, 'rating').slice(0, limit)
        };
    }

    function getWeeklyDigest(user, movies) {
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const history = getHistory(user).filter(entry => Number(entry.lastWatchedAt || 0) >= oneWeekAgo);
        const digestMovies = history
            .map(entry => movies.find(movie => movie.id === entry.movieId))
            .filter(Boolean);

        const recommended = getPersonalizedRecommendations(movies, user, 5);
        const msg = history.length
            ? `You watched ${history.length} movie(s) this week. Keep the streak going.`
            : 'No watches this week yet. Start with these personalized picks.';

        return { message: msg, movies: recommended, watchedThisWeek: digestMovies };
    }

    function getFollowAlerts(user, movies, limit = 8) {
        const follow = getFollowState(user);
        const alerts = movies.filter(movie => {
            const directorHit = follow.directors.includes(movie.director);
            const actorHit = Array.isArray(movie.cast) && movie.cast.some(actor => follow.actors.includes(actor));
            return directorHit || actorHit;
        });

        return sortMovies(alerts, 'year').slice(0, limit);
    }

    function getUserStats(user, movies) {
        const history = getHistory(user);
        const watchlistIds = getWatchlistIds(user);
        const diary = getDiaryEntries(user, movies);
        const reviewsCount = Object.keys(localStorage)
            .filter(key => key.startsWith('cineverse_reviews_'))
            .reduce((sum, key) => {
                const rows = readJson(key, []);
                return sum + rows.filter(row => row.userId === getUserId(user)).length;
            }, 0);

        const totalRuntime = diary.reduce((sum, entry) => sum + Number(entry.movie.runtime_min || 0), 0);

        return {
            watchedCount: history.length,
            watchlistCount: watchlistIds.length,
            reviewsCount,
            totalRuntime,
            rewatchCount: history.reduce((sum, item) => sum + Math.max(0, Number(item.rewatchCount || 1) - 1), 0)
        };
    }

    function exportUserData(user) {
        const userId = getUserId(user);
        const payload = {
            exportedAt: Date.now(),
            userId,
            watchlist: getWatchlistIds(user),
            recent: getRecentIds(user),
            history: getHistory(user),
            feedback: getFeedback(user),
            follow: getFollowState(user)
        };

        return JSON.stringify(payload, null, 2);
    }

    function importUserData(user, rawText) {
        const parsed = JSON.parse(rawText);
        const userId = getUserId(user);

        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Invalid import payload');
        }

        if (Array.isArray(parsed.watchlist)) writeJson(getKey('watchlist', userId), parsed.watchlist.map(Number));
        if (Array.isArray(parsed.recent)) writeJson(getKey('recent', userId), parsed.recent.map(Number));
        if (Array.isArray(parsed.history)) writeJson(getKey('history', userId), parsed.history);
        if (parsed.feedback && typeof parsed.feedback === 'object') writeJson(getKey('feedback', userId), parsed.feedback);
        if (parsed.follow && typeof parsed.follow === 'object') writeJson(getKey('follow', userId), parsed.follow);

        return true;
    }

    function getReminderState(user) {
        return readJson(getKey('reminder', getUserId(user)), { enabled: false, hour: 20 });
    }

    function setReminderState(user, enabled, hour = 20) {
        const state = { enabled: !!enabled, hour: Number(hour) || 20 };
        writeJson(getKey('reminder', getUserId(user)), state);
        return state;
    }

    function getSeasonalCollection(movies, limit = 10) {
        const month = new Date().getMonth() + 1;
        let tag = 'awards';
        if (month === 10) tag = 'halloween';
        if (month === 2) tag = 'valentine';
        if (month === 12) tag = 'holiday';

        const picks = movies.filter(movie => Array.isArray(movie.seasonal_tags) && movie.seasonal_tags.includes(tag));
        return {
            title: tag === 'halloween' ? 'Halloween Picks' : tag === 'valentine' ? 'Valentine Picks' : tag === 'holiday' ? 'Holiday Picks' : 'Awards Season Picks',
            movies: sortMovies(picks.length ? picks : movies, 'rating').slice(0, limit)
        };
    }

    return {
        loadMovies,
        loadMoviePage,
        getMovieById,
        searchMovies,
        getGenreRecommendations,
        getSimilarMovies,
        getDiscoverySections,
        getTrending,
        getTopRated,
        getNewReleases,
        getPopular,
        getRandomMovie,
        getTonightPick,
        genreIdToName,
        sortMovies,
        filterMovies,
        getUserPreferenceRecommended,
        getPersonalizedRecommendations,
        explainRecommendation,
        addToWatchlist,
        removeFromWatchlist,
        getWatchlistIds,
        isInWatchlist,
        pushRecentView,
        getRecentIds,
        markWatched,
        getHistory,
        getDiaryEntries,
        getRecommendationsForMovie,
        buildNextQueue,
        saveReview,
        getUserReview,
        getAllReviewsForMovie,
        voteReviewHelpful,
        recordFeedback,
        getFeedback,
        toggleFollowDirector,
        toggleFollowActor,
        getFollowState,
        getUserByUsername,
        getFriendOverlapRecommendations,
        getWeeklyDigest,
        getFollowAlerts,
        getSeasonalCollection,
        getUserStats,
        exportUserData,
        importUserData,
        getReminderState,
        setReminderState
    };
})();
