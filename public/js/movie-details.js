// CineVerse Movie Details Logic
document.addEventListener('DOMContentLoaded', async () => {
    const currentUser = authService.getCurrentUser();
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const movieId = Number(params.get('id'));
    if (!movieId) {
        window.location.href = 'home.html';
        return;
    }

    const refs = {
        title: document.getElementById('movieTitle'),
        poster: document.getElementById('moviePoster'),
        meta: document.getElementById('movieMeta'),
        description: document.getElementById('movieDescription'),
        director: document.getElementById('movieDirector'),
        cast: document.getElementById('movieCast'),
        watchTrailerBtn: document.getElementById('watchTrailerBtn'),
        watchlistToggleBtn: document.getElementById('watchlistToggleBtn'),
        reviewsContainer: document.getElementById('reviewsContainer'),
        reviewRating: document.getElementById('reviewRating'),
        reviewText: document.getElementById('reviewText'),
        saveReviewBtn: document.getElementById('saveReviewBtn'),
        reviewStatus: document.getElementById('reviewStatus'),
        recommendationsGrid: document.getElementById('recommendationsGrid'),
        trailerModal: document.getElementById('trailerModal'),
        trailerFrame: document.getElementById('trailerFrame'),
        closeTrailerBtn: document.getElementById('closeTrailerBtn')
    };

    try {
        const movies = await MovieService.loadMovies();
        const movie = movies.find(item => item.id === movieId);

        if (!movie) {
            window.location.href = 'home.html';
            return;
        }

        MovieService.pushRecentView(currentUser, movie.id);

        renderMovie(movie, refs);
        ensureAdvancedBlocks();
        wireTrailer(movie, refs);
        wireWatchlist(movie, refs, currentUser);
        wireFeedback(movie, currentUser);
        wireFollow(movie, currentUser);
        wireWatchDiary(movie, currentUser);
        wireReview(movie, refs, currentUser);
        renderReviews(movie, refs, currentUser);
        await renderRecommendations(movie, refs, currentUser);
        renderQueue(movie, movies, currentUser);
    } catch (error) {
        console.error(error);
        refs.title.textContent = 'Failed to load movie';
    }
});

function renderMovie(movie, refs) {
    refs.title.textContent = movie.title;
    refs.poster.src = movie.poster;
    refs.poster.alt = movie.title;

    const runtime = movie.runtime_min ? `${movie.runtime_min} min` : 'Runtime NA';
    const platforms = Array.isArray(movie.platforms) ? movie.platforms.join(', ') : 'NA';
    refs.meta.textContent = `${movie.genre} | ${movie.year} | Rating ${movie.rating} | ${runtime}`;

    refs.description.textContent = movie.description;
    refs.director.textContent = `Director: ${movie.director} | Crew: Writer ${movie.crew?.writer || 'NA'}, Music ${movie.crew?.music || 'NA'}`;
    refs.cast.textContent = `Cast: ${(movie.cast || []).join(', ')} | Platforms: ${platforms}`;

    const extra = document.createElement('p');
    extra.id = 'movieSafety';
    extra.style.marginTop = '8px';
    extra.style.color = '#cbd5e1';
    extra.textContent = `Maturity: ${movie.maturity} | Warnings: ${(movie.content_warnings || []).join(', ')} | Subtitles: ${(movie.subtitles || []).join(', ')} | Dubbing: ${(movie.dubbing || []).join(', ')}`;
    refs.cast.parentElement.appendChild(extra);
}

function ensureAdvancedBlocks() {
    const recommendationsSection = document.getElementById('recommendationsGrid')?.closest('.movies-section');
    if (!recommendationsSection) return;

    const blocks = [
        ['queueSection', 'Watch Next Queue', '<div class="movies-grid" id="queueGrid"></div>'],
        ['followSection', 'Follow Cast/Crew', '<div id="followControls" style="display:flex;gap:8px;flex-wrap:wrap;"></div>'],
        ['feedbackSection', 'Improve Recommendations', '<div id="feedbackControls" style="display:flex;gap:8px;flex-wrap:wrap;"></div>'],
        ['reviewSortSection', 'Review Sorting', '<div id="reviewSortControls" style="display:flex;gap:8px;flex-wrap:wrap;"></div>'],
        ['diarySection', 'Diary & Rewatch', '<div id="diaryControls" style="display:flex;gap:8px;flex-wrap:wrap;"></div>']
    ];

    blocks.forEach(([id, title, body]) => {
        if (document.getElementById(id)) return;
        const section = document.createElement('section');
        section.className = 'movies-section';
        section.id = id;
        section.innerHTML = `<div class="section-header"><h2>${title}</h2></div>${body}`;
        recommendationsSection.before(section);
    });
}

function wireTrailer(movie, refs) {
    refs.watchTrailerBtn.addEventListener('click', () => {
        refs.trailerFrame.src = toEmbedUrl(movie.trailer_link);
        refs.trailerModal.style.display = 'flex';
    });

    refs.closeTrailerBtn.addEventListener('click', () => {
        refs.trailerModal.style.display = 'none';
        refs.trailerFrame.src = '';
    });

    refs.trailerModal.addEventListener('click', event => {
        if (event.target === refs.trailerModal) {
            refs.trailerModal.style.display = 'none';
            refs.trailerFrame.src = '';
        }
    });
}

function wireWatchlist(movie, refs, user) {
    const setLabel = () => {
        refs.watchlistToggleBtn.textContent = MovieService.isInWatchlist(user, movie.id) ? 'Remove from Watchlist' : 'Add to Watchlist';
    };

    setLabel();

    refs.watchlistToggleBtn.addEventListener('click', () => {
        if (MovieService.isInWatchlist(user, movie.id)) MovieService.removeFromWatchlist(user, movie.id);
        else MovieService.addToWatchlist(user, movie.id);
        setLabel();
    });
}

function wireFeedback(movie, user) {
    const block = document.getElementById('feedbackControls');
    if (!block) return;

    block.innerHTML = [
        '<button id="moreLikeBtn" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(34,197,94,0.5);color:#fff;cursor:pointer;">More like this</button>',
        '<button id="lessLikeBtn" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(239,68,68,0.5);color:#fff;cursor:pointer;">Less like this</button>'
    ].join('');

    document.getElementById('moreLikeBtn')?.addEventListener('click', () => {
        MovieService.recordFeedback(user, movie, 'more');
        alert('Preference updated');
    });

    document.getElementById('lessLikeBtn')?.addEventListener('click', () => {
        MovieService.recordFeedback(user, movie, 'less');
        alert('Preference updated');
    });
}

function wireFollow(movie, user) {
    const block = document.getElementById('followControls');
    if (!block) return;

    const firstActor = (movie.cast || [])[0];
    const secondActor = (movie.cast || [])[1];

    block.innerHTML = [
        `<button id="followDirectorBtn" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Follow Director: ${escapeHtml(movie.director)}</button>`,
        firstActor ? `<button id="followActor1Btn" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Follow Actor: ${escapeHtml(firstActor)}</button>` : '',
        secondActor ? `<button id="followActor2Btn" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Follow Actor: ${escapeHtml(secondActor)}</button>` : ''
    ].join('');

    document.getElementById('followDirectorBtn')?.addEventListener('click', () => {
        MovieService.toggleFollowDirector(user, movie.director);
        alert('Director follow updated');
    });

    if (firstActor) {
        document.getElementById('followActor1Btn')?.addEventListener('click', () => {
            MovieService.toggleFollowActor(user, firstActor);
            alert('Actor follow updated');
        });
    }

    if (secondActor) {
        document.getElementById('followActor2Btn')?.addEventListener('click', () => {
            MovieService.toggleFollowActor(user, secondActor);
            alert('Actor follow updated');
        });
    }
}

function wireWatchDiary(movie, user) {
    const block = document.getElementById('diaryControls');
    if (!block) return;

    block.innerHTML = [
        '<input id="diaryNoteInput" placeholder="Diary note" style="padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.9);color:#fff;min-width:220px;">',
        '<button id="markWatchedBtn" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(2,132,199,0.6);color:#fff;cursor:pointer;">Mark Watched / Rewatch</button>'
    ].join('');

    document.getElementById('markWatchedBtn')?.addEventListener('click', () => {
        const note = document.getElementById('diaryNoteInput')?.value || '';
        MovieService.markWatched(user, movie.id, note);
        alert('Watch history updated');
    });
}

function wireReview(movie, refs, user) {
    const existingReview = MovieService.getUserReview(user, movie.id);
    if (existingReview) {
        refs.reviewText.value = existingReview.reviewText || '';
        refs.reviewRating.value = existingReview.rating || '';
    }

    const sortBlock = document.getElementById('reviewSortControls');
    if (sortBlock) {
        sortBlock.innerHTML = [
            '<button id="sortNewestBtn" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Newest</button>',
            '<button id="sortHelpfulBtn" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Most Helpful</button>'
        ].join('');

        document.getElementById('sortNewestBtn')?.addEventListener('click', () => renderReviews(movie, refs, user, 'newest'));
        document.getElementById('sortHelpfulBtn')?.addEventListener('click', () => renderReviews(movie, refs, user, 'helpful'));
    }

    refs.saveReviewBtn.addEventListener('click', () => {
        const rating = Number(refs.reviewRating.value);
        const reviewText = refs.reviewText.value.trim();

        if (rating && (rating < 1 || rating > 10)) {
            refs.reviewStatus.textContent = 'Rating should be between 1 and 10';
            return;
        }

        MovieService.saveReview(user, movie.id, reviewText, rating || null);
        refs.reviewStatus.textContent = 'Review saved';
        renderReviews(movie, refs, user, 'newest');
    });
}

function renderReviews(movie, refs, user, sortMode = 'newest') {
    let reviews = MovieService.getAllReviewsForMovie(movie.id);

    if (sortMode === 'helpful') reviews = [...reviews].sort((a, b) => b.helpfulCount - a.helpfulCount);
    else reviews = [...reviews].sort((a, b) => b.updatedAt - a.updatedAt);

    if (!reviews.length) {
        refs.reviewsContainer.innerHTML = '<div style="color:#cbd5e1;">No reviews yet</div>';
        return;
    }

    refs.reviewsContainer.innerHTML = reviews.map(review => {
        const date = new Date(review.updatedAt).toLocaleDateString();
        const ratingText = review.rating ? `Rating: ${review.rating}/10` : 'Rating: Not provided';
        return `
            <div style="background:rgba(15, 23, 42, 0.6);padding:12px;border-radius:10px;">
                <strong>${escapeHtml(review.username)}</strong>
                <div style="color:#94a3b8;font-size:13px;">${date} | ${ratingText} | Helpful: ${review.helpfulCount}</div>
                <p style="margin-top:8px;color:#cbd5e1;">${escapeHtml(review.reviewText || '')}</p>
                <button class="helpful-btn" data-review-id="${review.id}" style="margin-top:8px;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Helpful</button>
            </div>
        `;
    }).join('');

    refs.reviewsContainer.querySelectorAll('.helpful-btn').forEach(button => {
        button.addEventListener('click', () => {
            MovieService.voteReviewHelpful(user, movie.id, button.dataset.reviewId);
            renderReviews(movie, refs, user, sortMode);
        });
    });
}

async function renderRecommendations(movie, refs, user) {
    const recommendations = await MovieService.getSimilarMovies(movie.title, 6);
    if (!recommendations.length) {
        refs.recommendationsGrid.innerHTML = '<div style="color:#cbd5e1;grid-column:1/-1;">No recommendations available</div>';
        return;
    }

    refs.recommendationsGrid.innerHTML = recommendations.map(item => {
        const explanation = MovieService.explainRecommendation(item, user);
        return `
            <div class="movie-card" data-movie-id="${item.id}">
                <img src="${item.poster}" alt="${item.title}" class="movie-poster">
                <div class="movie-info" style="opacity:1;transform:none;position:relative;background:rgba(10,14,39,0.9);">
                    <h3 class="movie-title">${item.title}</h3>
                    <div class="movie-meta"><span>${item.rating}</span><span>${item.year}</span><span>${item.genre}</span></div>
                    <div style="font-size:11px;color:#cbd5e1;margin-top:6px;">${escapeHtml(explanation)}</div>
                </div>
            </div>
        `;
    }).join('');

    refs.recommendationsGrid.querySelectorAll('.movie-card').forEach(card => {
        card.addEventListener('click', () => {
            window.location.href = `movie-details.html?id=${card.dataset.movieId}`;
        });
    });
}

function renderQueue(currentMovie, movies, user) {
    const queueGrid = document.getElementById('queueGrid');
    if (!queueGrid) return;

    const queue = MovieService.buildNextQueue(currentMovie, movies, user, 5);
    if (!queue.length) {
        queueGrid.innerHTML = '<div style="color:#cbd5e1;grid-column:1/-1;">No movies found</div>';
        return;
    }

    queueGrid.innerHTML = queue.map(item => `
        <div class="movie-card" data-movie-id="${item.id}">
            <img src="${item.poster}" alt="${item.title}" class="movie-poster">
            <div class="movie-info" style="opacity:1;transform:none;position:relative;background:rgba(10,14,39,0.9);">
                <h3 class="movie-title">${item.title}</h3>
                <div class="movie-meta"><span>${item.rating}</span><span>${item.year}</span><span>${item.genre}</span></div>
            </div>
        </div>
    `).join('');

    queueGrid.querySelectorAll('.movie-card').forEach(card => {
        card.addEventListener('click', () => {
            window.location.href = `movie-details.html?id=${card.dataset.movieId}`;
        });
    });
}

function toEmbedUrl(url) {
    if (!url) return '';

    const watchPattern = /youtube\.com\/watch\?v=([^&]+)/;
    const shortPattern = /youtu\.be\/([^?]+)/;

    const watchMatch = url.match(watchPattern);
    if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}`;

    const shortMatch = url.match(shortPattern);
    if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}`;

    return url;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
