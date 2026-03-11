// CineVerse Home Page Logic
// Functional upgrade only: keeps existing UI/CSS and adds dynamic recommendation features.
document.addEventListener('DOMContentLoaded', async () => {
    await ensureMovieService();

    const currentUser = authService.getCurrentUser();
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }

    const ui = {
        userInitial: document.getElementById('userInitial'),
        userName: document.getElementById('userName'),
        userEmail: document.getElementById('userEmail'),
        logoutBtn: document.getElementById('logoutBtn'),
        navbar: document.querySelector('.navbar'),
        searchInput: document.getElementById('searchInput'),
        trendingContainer: document.getElementById('trendingMovies'),
        popularContainer: document.getElementById('popularMovies'),
        genres: document.querySelectorAll('.genre-card')
    };

    const state = {
        allMovies: [],
        selectedGenre: null,
        minRating: null,
        sortBy: 'rating',
        query: '',
        mood: null,
        runtimeBand: null,
        platform: null,
        maturity: null,
        subtitle: null,
        dubbing: null,
        friendUsername: '',
        friendRecommendations: [],
        renderRequestId: 0,
        discoveryRows: {},
        tonightPick: null,
        catalogMovies: [],
        catalogPage: 0,
        catalogHasMore: true,
        catalogLoading: false,
        catalogObserver: null
    };

    initHeader(currentUser, ui);
    wireNavigationLinks();
    wireNavbarScroll(ui.navbar);
    registerPwaAndOfflineSupport();
    registerKeyboardShortcuts();

    injectRuntimeControls();
    injectDynamicSections();

    try {
        state.allMovies = await MovieService.loadMovies();
        wireEvents(state, currentUser, ui);
        setupInfiniteCatalog(state, currentUser);
        void renderAll(state, currentUser, ui);
        startReminderLoop(currentUser, state);
    } catch (error) {
        console.error(error);
        ui.trendingContainer.innerHTML = noMoviesTemplate('No movies found');
        ui.popularContainer.innerHTML = noMoviesTemplate('No movies found');
    }
});

function initHeader(user, refs) {
    if (refs.userInitial && user.username) refs.userInitial.textContent = user.username.charAt(0).toUpperCase();
    if (refs.userName) refs.userName.textContent = user.username;
    if (refs.userEmail) refs.userEmail.textContent = user.email;

    if (refs.logoutBtn) {
        refs.logoutBtn.addEventListener('click', (event) => {
            event.preventDefault();
            authService.logout();
            window.location.href = 'home.html';
        });
    }
}

function wireNavigationLinks() {
    const links = document.querySelectorAll('.nav-menu a');
    links.forEach(link => {
        const label = (link.textContent || '').trim().toLowerCase();

        if (label === 'watchlist') link.setAttribute('href', 'watchlist.html');

        if (label === 'movies') {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                document.querySelector('.movies-section')?.scrollIntoView({ behavior: 'smooth' });
            });
        }

        if (label === 'genres') {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                document.querySelector('.genres-section')?.scrollIntoView({ behavior: 'smooth' });
            });
        }
    });

    document.querySelector('.btn-play')?.addEventListener('click', () => {
        document.querySelector('.movies-section')?.scrollIntoView({ behavior: 'smooth' });
    });
}

function wireNavbarScroll(navbar) {
    window.addEventListener('scroll', () => {
        if (!navbar) return;
        if (window.scrollY > 50) navbar.classList.add('scrolled');
        else navbar.classList.remove('scrolled');
    });
}

function injectRuntimeControls() {
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;

    const controls = document.createElement('div');
    controls.id = 'runtimeControls';
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.flexWrap = 'wrap';
    controls.style.alignItems = 'center';

    controls.innerHTML = [
        selectHtml('sortSelect', [
            ['rating', 'Sort: Rating'],
            ['year', 'Sort: Year'],
            ['alphabetical', 'Sort: A-Z'],
            ['runtime', 'Sort: Runtime']
        ]),
        selectHtml('moodSelect', [
            ['', 'Mood'],
            ['Feel-good', 'Feel-good'],
            ['Mind-bending', 'Mind-bending'],
            ['Dark', 'Dark'],
            ['Family', 'Family'],
            ['Epic', 'Epic'],
            ['Emotional', 'Emotional']
        ]),
        selectHtml('runtimeSelect', [
            ['', 'Runtime'],
            ['short', '< 90'],
            ['medium', '90-120'],
            ['long', '> 120']
        ]),
        selectHtml('platformSelect', [
            ['', 'Platform'],
            ['Netflix', 'Netflix'],
            ['Prime Video', 'Prime Video'],
            ['Disney+ Hotstar', 'Disney+ Hotstar']
        ]),
        selectHtml('maturitySelect', [
            ['', 'Maturity'],
            ['U/A 7+', 'U/A 7+'],
            ['U/A 13+', 'U/A 13+'],
            ['U/A 16+', 'U/A 16+']
        ]),
        selectHtml('subtitleSelect', [
            ['', 'Subtitle'],
            ['en', 'EN'],
            ['hi', 'HI'],
            ['ta', 'TA'],
            ['te', 'TE'],
            ['es', 'ES']
        ]),
        selectHtml('dubbingSelect', [
            ['', 'Dubbing'],
            ['en', 'EN'],
            ['hi', 'HI'],
            ['ta', 'TA'],
            ['te', 'TE']
        ]),
        '<label style="display:flex;align-items:center;gap:6px;color:#cbd5e1;font-size:13px;padding:6px 8px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;"><input type="checkbox" id="ratingFilter"/> 7+</label>'
    ].join('');

    navRight.appendChild(controls);

    const helper = document.createElement('div');
    helper.style.width = '100%';
    helper.style.marginTop = '8px';
    helper.innerHTML = [
        '<input id="friendInput" placeholder="Friend username" style="padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.8);color:#fff;">',
        '<button id="friendBtn" style="margin-left:8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Find overlap</button>',
        '<button id="exportBtn" style="margin-left:8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Export Data</button>',
        '<button id="importBtn" style="margin-left:8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Import Data</button>',
        '<button id="reminderBtn" style="margin-left:8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Reminder</button>'
    ].join('');

    navRight.appendChild(helper);
}

function selectHtml(id, options) {
    const optionHtml = options.map(item => `<option value="${item[0]}">${item[1]}</option>`).join('');
    return `<select id="${id}" style="padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.8);color:#fff;">${optionHtml}</select>`;
}

function injectDynamicSections() {
    let anchor = [...document.querySelectorAll('.movies-section')].at(-1);
    if (!anchor) return;

    const blocks = [
        ['tonightPickPanel', 'Tonight\'s Movie', 'panel'],
        ['trendingWeekMovies', 'Trending This Week'],
        ['topRatedMovies', 'Top Rated Movies'],
        ['newReleaseMovies', 'New Releases'],
        ['hiddenGemsMovies', 'Hidden Gems'],
        ['criticallyAcclaimedMovies', 'Critically Acclaimed'],
        ['actionMovies', 'Action Movies'],
        ['comedyMovies', 'Comedy Movies'],
        ['dramaMovies', 'Drama Movies'],
        ['sciFiMovies', 'Sci-Fi Movies'],
        ['thrillerMovies', 'Thriller Movies'],
        ['mustWatchMovies', 'Must Watch'],
        ['recentMovies', 'Recently Viewed'],
        ['weeklyDigestMovies', 'Weekly Digest'],
        ['friendMovies', 'Friend Overlap Picks'],
        ['followAlertsMovies', 'New from Followed Cast/Crew'],
        ['seasonalMovies', 'Seasonal Collection'],
        ['diaryTimeline', 'Viewing Diary'],
        ['statsPanel', 'Your Stats'],
        ['browseMoreMovies', 'Browse More', 'catalog']
    ];

    blocks.forEach(block => {
        const section = document.createElement('section');
        section.className = 'movies-section';
        let body = `<div class="movies-grid" id="${block[0]}"></div>`;
        if (block[2] === 'panel') {
            body = `<div id="${block[0]}" style="display:grid;gap:12px;"></div>`;
        }
        if (block[2] === 'catalog') {
            body = `
                <div class="movies-grid" id="${block[0]}"></div>
                <div id="catalogStatus" style="padding:12px 0;color:#94a3b8;">Scroll to load more</div>
                <div id="catalogSentinel" style="height:2px;"></div>
            `;
        }
        section.innerHTML = `
            <div class="section-header">
                <h2>${block[1]}</h2>
                <a href="#" class="see-all">See All</a>
            </div>
            ${body}
        `;
        anchor.after(section);
        anchor = section;
    });
}

function wireEvents(state, user, ui) {
    ui.searchInput?.addEventListener('input', event => {
        state.query = event.target.value.trim();
        void renderAll(state, user, ui);
    });

    const mapping = [
        ['sortSelect', 'sortBy'],
        ['moodSelect', 'mood'],
        ['runtimeSelect', 'runtimeBand'],
        ['platformSelect', 'platform'],
        ['maturitySelect', 'maturity'],
        ['subtitleSelect', 'subtitle'],
        ['dubbingSelect', 'dubbing']
    ];

    mapping.forEach(([id, key]) => {
        const element = document.getElementById(id);
        element?.addEventListener('change', event => {
            state[key] = event.target.value || null;
            void renderAll(state, user, ui);
        });
    });

    document.getElementById('ratingFilter')?.addEventListener('change', event => {
        state.minRating = event.target.checked ? 7 : null;
        void renderAll(state, user, ui);
    });

    ui.genres.forEach(card => {
        card.addEventListener('click', () => {
            const genreId = Number(card.dataset.genre);
            state.selectedGenre = state.selectedGenre === genreId ? null : genreId;
            void renderAll(state, user, ui);
        });
    });

    document.getElementById('friendBtn')?.addEventListener('click', () => {
        state.friendUsername = (document.getElementById('friendInput')?.value || '').trim();
        void renderAll(state, user, ui);
    });

    document.getElementById('exportBtn')?.addEventListener('click', () => {
        const data = MovieService.exportUserData(user);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'cinematch-backup.json';
        link.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('importBtn')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    MovieService.importUserData(user, String(reader.result || ''));
                    alert('Import successful');
                    void renderAll(state, user, ui);
                } catch (error) {
                    alert('Import failed');
                }
            };
            reader.readAsText(file);
        });
        input.click();
    });

    document.getElementById('reminderBtn')?.addEventListener('click', async () => {
        const current = MovieService.getReminderState(user);
        const enable = !current.enabled;
        if (enable && 'Notification' in window && Notification.permission !== 'granted') {
            await Notification.requestPermission();
        }
        MovieService.setReminderState(user, enable, current.hour || 20);
        alert(enable ? 'Reminder enabled' : 'Reminder disabled');
    });
}

async function resolveMoviePool(state, user) {
    let movies = MovieService.getPersonalizedRecommendations(state.allMovies, user, 60);

    if (state.query) {
        movies = await MovieService.searchMovies(state.query, 60);
    }

    if (state.selectedGenre) {
        if (state.query) {
            const genreName = MovieService.genreIdToName(state.selectedGenre);
            movies = movies.filter(movie => (
                Number(movie.genre_id) === Number(state.selectedGenre)
                || String(movie.genre).toLowerCase() === genreName.toLowerCase()
            ));
        } else {
            movies = await MovieService.getGenreRecommendations(state.selectedGenre, 60);
        }
    }

    return movies;
}

async function renderAll(state, user, ui) {
    const renderRequestId = ++state.renderRequestId;

    let visibleMovies = [];
    try {
        visibleMovies = await resolveMoviePool(state, user);
    } catch (error) {
        console.error(error);
        visibleMovies = [...state.allMovies];
    }

    if (renderRequestId !== state.renderRequestId) return;

    try {
        const discovery = await MovieService.getDiscoverySections(user, 10);
        if (renderRequestId !== state.renderRequestId) return;
        state.discoveryRows = discovery.rows || {};
        state.tonightPick = discovery.tonightPick || null;
    } catch (error) {
        console.error(error);
        state.discoveryRows = {};
        state.tonightPick = null;
    }

    const filtered = MovieService.filterMovies(visibleMovies, {
        query: '',
        genre: null,
        minRating: state.minRating,
        mood: state.mood,
        runtimeBand: state.runtimeBand,
        platform: state.platform,
        maturity: state.maturity,
        subtitle: state.subtitle,
        dubbing: state.dubbing
    });

    const sorted = MovieService.sortMovies(filtered, state.sortBy);

    const trending = sorted.filter(movie => movie.tags.includes('trending')).slice(0, 12);
    const topNetflix = sorted.filter(movie => movie.tags.includes('top-10-netflix') || movie.platforms.includes('Netflix')).slice(0, 10);
    const mustWatch = sorted.filter(movie => movie.tags.includes('must-watch')).slice(0, 12);
    const discoveryRows = state.discoveryRows || {};

    renderGrid(ui.trendingContainer, discoveryRows.trending_today || (trending.length ? trending : sorted.slice(0, 12)), user);
    renderGrid(ui.popularContainer, discoveryRows.popular_movies || (topNetflix.length ? topNetflix : sorted.slice(0, 10)), user);
    renderGrid(document.getElementById('trendingWeekMovies'), discoveryRows.trending_this_week || [], user);
    renderGrid(document.getElementById('topRatedMovies'), discoveryRows.top_rated_movies || [], user);
    renderGrid(document.getElementById('newReleaseMovies'), discoveryRows.new_releases || [], user);
    renderGrid(document.getElementById('hiddenGemsMovies'), discoveryRows.hidden_gems || [], user);
    renderGrid(document.getElementById('criticallyAcclaimedMovies'), discoveryRows.critically_acclaimed || [], user);
    renderGrid(document.getElementById('actionMovies'), discoveryRows.action_movies || [], user);
    renderGrid(document.getElementById('comedyMovies'), discoveryRows.comedy_movies || [], user);
    renderGrid(document.getElementById('dramaMovies'), discoveryRows.drama_movies || [], user);
    renderGrid(document.getElementById('sciFiMovies'), discoveryRows.sci_fi_movies || [], user);
    renderGrid(document.getElementById('thrillerMovies'), discoveryRows.thriller_movies || [], user);
    renderGrid(document.getElementById('mustWatchMovies'), discoveryRows.because_you_watched || mustWatch, user);
    renderTonightPick(state.tonightPick);

    const recent = MovieService.getRecentIds(user)
        .map(id => state.allMovies.find(movie => movie.id === id))
        .filter(Boolean);
    renderGrid(document.getElementById('recentMovies'), recent, user);

    const digest = MovieService.getWeeklyDigest(user, state.allMovies);
    renderDigestSection(digest, user);

    const seasonal = MovieService.getSeasonalCollection(state.allMovies, 10);
    renderGrid(document.getElementById('seasonalMovies'), seasonal.movies, user, `No movies found`);
    setSectionTitle('seasonalMovies', seasonal.title);

    const followAlerts = MovieService.getFollowAlerts(user, state.allMovies, 10);
    renderGrid(document.getElementById('followAlertsMovies'), followAlerts, user);

    const diaryEntries = MovieService.getDiaryEntries(user, state.allMovies);
    renderDiary(diaryEntries);
    renderStats(MovieService.getUserStats(user, state.allMovies));

    if (state.friendUsername) {
        const result = MovieService.getFriendOverlapRecommendations(user, state.friendUsername, state.allMovies, 10);
        if (!result.friend) {
            renderGrid(document.getElementById('friendMovies'), [], user, 'No movies found');
            setSectionTitle('friendMovies', `Friend Overlap Picks (No user: ${state.friendUsername})`);
        } else {
            renderGrid(document.getElementById('friendMovies'), result.movies, user);
            setSectionTitle('friendMovies', `Friend Overlap Picks with ${result.friend.username}`);
        }
    } else {
        renderGrid(document.getElementById('friendMovies'), [], user, 'No movies found');
    }

    if (!sorted.length) {
        renderGrid(ui.trendingContainer, [], user, 'No movies found');
        renderGrid(ui.popularContainer, [], user, 'No movies found');
        renderGrid(document.getElementById('mustWatchMovies'), [], user, 'No movies found');
    }
}

function renderTonightPick(tonightPick) {
    const panel = document.getElementById('tonightPickPanel');
    if (!panel) return;
    if (!tonightPick || !tonightPick.movie) {
        panel.innerHTML = noMoviesTemplate('No tonight pick available');
        return;
    }

    const movie = tonightPick.movie;
    panel.innerHTML = `
        <div style="display:grid;grid-template-columns:minmax(180px,240px) 1fr;gap:18px;padding:16px;border:1px solid rgba(255,255,255,0.15);border-radius:16px;background:rgba(15,23,42,0.72);">
            <img src="${movie.poster}" alt="${movie.title}" style="width:100%;border-radius:14px;object-fit:cover;min-height:280px;">
            <div>
                <div style="font-size:12px;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;">AI Picker</div>
                <h3 style="font-size:30px;margin-top:8px;">${movie.title}</h3>
                <p style="margin-top:8px;color:#cbd5e1;line-height:1.7;">${escapeHtml(tonightPick.explanation || movie.description)}</p>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;color:#e2e8f0;">
                    <span>${movie.genre}</span>
                    <span>${movie.year}</span>
                    <span>${movie.runtime_min} min</span>
                    <span>Rating ${movie.rating}</span>
                </div>
            </div>
        </div>
    `;
}

function setupInfiniteCatalog(state, user) {
    const sentinel = document.getElementById('catalogSentinel');
    if (!sentinel || state.catalogObserver) return;

    const observer = new IntersectionObserver(entries => {
        const hit = entries.some(entry => entry.isIntersecting);
        if (hit) {
            void loadMoreCatalogMovies(state, user);
        }
    }, { rootMargin: '400px 0px' });

    observer.observe(sentinel);
    state.catalogObserver = observer;
    void loadMoreCatalogMovies(state, user);
}

async function loadMoreCatalogMovies(state, user) {
    if (state.catalogLoading || !state.catalogHasMore) return;

    state.catalogLoading = true;
    const status = document.getElementById('catalogStatus');
    if (status) status.textContent = 'Loading more movies...';

    try {
        const nextPage = state.catalogPage + 1;
        const result = await MovieService.loadMoviePage(nextPage, 12);
        const existingIds = new Set(state.catalogMovies.map(movie => movie.id));
        result.movies.forEach(movie => {
            if (!existingIds.has(movie.id)) {
                state.catalogMovies.push(movie);
                existingIds.add(movie.id);
            }
        });
        state.catalogPage = result.page;
        state.catalogHasMore = result.hasMore;
        renderGrid(document.getElementById('browseMoreMovies'), state.catalogMovies, user, 'No movies found');
        if (status) status.textContent = state.catalogHasMore ? 'Scroll to load more' : 'You reached the end';
    } catch (error) {
        console.error(error);
        if (status) status.textContent = 'Failed to load more movies';
    } finally {
        state.catalogLoading = false;
    }
}

function renderDigestSection(digest, user) {
    const grid = document.getElementById('weeklyDigestMovies');
    if (!grid) return;

    const message = `<div style="grid-column:1/-1;color:#cbd5e1;padding:12px 0;">${digest.message}</div>`;
    if (!digest.movies.length) {
        grid.innerHTML = `${message}${noMoviesTemplate('No movies found')}`;
        return;
    }

    grid.innerHTML = message + digest.movies.map(movie => movieCardTemplate(movie, user)).join('');
    wireGridInteractions(grid, user);
}

function renderDiary(entries) {
    const grid = document.getElementById('diaryTimeline');
    if (!grid) return;

    if (!entries.length) {
        grid.innerHTML = noMoviesTemplate('No movies found');
        return;
    }

    grid.innerHTML = entries.slice(0, 10).map(entry => {
        const date = new Date(entry.lastWatchedAt).toLocaleDateString();
        const note = entry.diaryNote ? ` - ${escapeHtml(entry.diaryNote)}` : '';
        return `
            <div style="grid-column:1/-1;padding:12px;border:1px solid rgba(255,255,255,0.15);border-radius:10px;background:rgba(15,23,42,0.6);">
                <strong>${entry.movie.title}</strong>
                <span style="color:#94a3b8;"> watched ${entry.rewatchCount} time(s), last on ${date}${note}</span>
            </div>
        `;
    }).join('');
}

function renderStats(stats) {
    const grid = document.getElementById('statsPanel');
    if (!grid) return;

    grid.innerHTML = [
        statCard('Watched', stats.watchedCount),
        statCard('Watchlist', stats.watchlistCount),
        statCard('Reviews', stats.reviewsCount),
        statCard('Rewatches', stats.rewatchCount),
        statCard('Runtime (min)', stats.totalRuntime)
    ].join('');
}

function statCard(label, value) {
    return `<div style="padding:14px;border:1px solid rgba(255,255,255,0.15);border-radius:10px;background:rgba(15,23,42,0.6);"><div style="color:#94a3b8;font-size:12px;">${label}</div><div style="font-size:22px;font-weight:700;">${value}</div></div>`;
}

function setSectionTitle(gridId, title) {
    const grid = document.getElementById(gridId);
    const section = grid?.closest('.movies-section');
    const heading = section?.querySelector('.section-header h2');
    if (heading) heading.textContent = title;
}

function renderGrid(container, movies, user, emptyText = 'No movies found') {
    if (!container) return;

    if (!movies || !movies.length) {
        container.innerHTML = noMoviesTemplate(emptyText);
        return;
    }

    container.innerHTML = movies.map(movie => movieCardTemplate(movie, user)).join('');
    wireGridInteractions(container, user);
}

function wireGridInteractions(container, user) {
    container.querySelectorAll('.movie-card').forEach(card => {
        card.addEventListener('click', () => {
            const movieId = Number(card.dataset.movieId);
            MovieService.pushRecentView(user, movieId);
            window.location.href = `movie-details.html?id=${movieId}`;
        });
    });

    container.querySelectorAll('.add-watchlist-btn').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const movieId = Number(button.dataset.movieId);
            if (MovieService.isInWatchlist(user, movieId)) {
                MovieService.removeFromWatchlist(user, movieId);
                button.textContent = 'Add to Watchlist';
            } else {
                MovieService.addToWatchlist(user, movieId);
                button.textContent = 'Added';
            }
        });
    });

    container.querySelectorAll('.feedback-btn').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const movieData = JSON.parse(button.dataset.movie);
            const type = button.dataset.type;
            MovieService.recordFeedback(user, movieData, type);
            button.textContent = type === 'more' ? 'Liked' : 'Muted';
        });
    });

    container.querySelectorAll('.mark-watched-btn').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const movieId = Number(button.dataset.movieId);
            const note = prompt('Optional diary note:', '') || '';
            MovieService.markWatched(user, movieId, note);
            button.textContent = 'Watched';
        });
    });
}

function movieCardTemplate(movie, user) {
    const inWatchlist = MovieService.isInWatchlist(user, movie.id);
    const explanation = MovieService.explainRecommendation(movie, user);
    const moviePayload = escapeAttribute(JSON.stringify({ id: movie.id, genre_id: movie.genre_id }));

    return `
        <div class="movie-card" data-movie-id="${movie.id}">
            <img src="${movie.poster}" alt="${movie.title}" class="movie-poster" onerror="this.src='https://placehold.co/500x750/111827/e5e7eb?text=No+Poster'">
            <div class="movie-info">
                <h3 class="movie-title">${movie.title}</h3>
                <div class="movie-meta">
                    <span class="movie-rating">${movie.rating}</span>
                    <span>${movie.year}</span>
                    <span>${movie.genre}</span>
                </div>
                <div style="font-size:11px;color:#cbd5e1;margin-top:6px;">${escapeHtml(explanation)}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
                    <button class="add-watchlist-btn" data-movie-id="${movie.id}" style="padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(15,23,42,0.7);color:#fff;cursor:pointer;">${inWatchlist ? 'Added' : 'Add to Watchlist'}</button>
                    <button class="mark-watched-btn" data-movie-id="${movie.id}" style="padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(2,132,199,0.6);color:#fff;cursor:pointer;">Mark Watched</button>
                    <button class="feedback-btn" data-type="more" data-movie="${moviePayload}" style="padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(34,197,94,0.5);color:#fff;cursor:pointer;">More like this</button>
                    <button class="feedback-btn" data-type="less" data-movie="${moviePayload}" style="padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(239,68,68,0.5);color:#fff;cursor:pointer;">Less like this</button>
                </div>
            </div>
        </div>
    `;
}

function noMoviesTemplate(message) {
    return `<div style="padding:24px;color:#cbd5e1;grid-column:1/-1;">${message}</div>`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

async function ensureMovieService() {
    if (window.MovieService) return;

    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'js/movie-service.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load movie service'));
        document.head.appendChild(script);
    });
}

function registerPwaAndOfflineSupport() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(registration => registration.update().catch(() => {}))
            .catch(() => {});
    }

    if ('caches' in window) {
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith('cineverse-') && key !== 'cineverse-v3')
                    .map(key => caches.delete(key))
            ))
            .catch(() => {});
    }

    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = 'manifest.webmanifest';
    document.head.appendChild(manifest);

    window.addEventListener('online', () => notifyToast('Back online'));
    window.addEventListener('offline', () => notifyToast('Offline mode'));
}

function registerKeyboardShortcuts() {
    document.addEventListener('keydown', event => {
        if (event.key === '/' && document.activeElement?.id !== 'searchInput') {
            event.preventDefault();
            document.getElementById('searchInput')?.focus();
        }
        if (event.key.toLowerCase() === 'w' && event.altKey) {
            window.location.href = 'watchlist.html';
        }
    });
}

function notifyToast(message) {
    const box = document.createElement('div');
    box.textContent = message;
    box.style.position = 'fixed';
    box.style.bottom = '20px';
    box.style.left = '20px';
    box.style.padding = '10px 14px';
    box.style.background = 'rgba(15,23,42,0.9)';
    box.style.color = '#fff';
    box.style.border = '1px solid rgba(255,255,255,0.2)';
    box.style.borderRadius = '8px';
    box.style.zIndex = '3000';
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 2000);
}

function startReminderLoop(user, state) {
    const tick = () => {
        const reminder = MovieService.getReminderState(user);
        if (!reminder.enabled) return;

        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();

        if (hour === Number(reminder.hour) && minute === 0) {
            const picks = MovieService.getPersonalizedRecommendations(state.allMovies, user, 3);
            const title = picks.length ? `Tonight pick: ${picks[0].title}` : 'Open CineMatch for picks';
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('CineMatch Reminder', { body: title });
            } else {
                notifyToast(title);
            }
        }
    };

    tick();
    setInterval(tick, 60000);
}
