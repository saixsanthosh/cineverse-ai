// CineVerse Watchlist Page Logic
document.addEventListener('DOMContentLoaded', async () => {
    const currentUser = authService.getCurrentUser();
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }

    const grid = document.getElementById('watchlistGrid');

    try {
        const movies = await MovieService.loadMovies();
        renderWatchlist(movies, currentUser, grid);
    } catch (error) {
        console.error(error);
        grid.innerHTML = '<div style="color:#cbd5e1;grid-column:1/-1;">No movies found</div>';
    }
});

function renderWatchlist(allMovies, user, container) {
    const ids = MovieService.getWatchlistIds(user);
    const watchlistMovies = ids
        .map(id => allMovies.find(movie => movie.id === id))
        .filter(Boolean);

    if (!watchlistMovies.length) {
        container.innerHTML = '<div style="color:#cbd5e1;grid-column:1/-1;">No movies found</div>';
        return;
    }

    container.innerHTML = watchlistMovies.map(movie => {
        return `
            <div class="movie-card" data-movie-id="${movie.id}">
                <img src="${movie.poster}" alt="${movie.title}" class="movie-poster">
                <div class="movie-info" style="opacity:1;transform:none;position:relative;background:rgba(10,14,39,0.9);">
                    <h3 class="movie-title">${movie.title}</h3>
                    <div class="movie-meta">
                        <span>${movie.rating}</span>
                        <span>${movie.year}</span>
                        <span>${movie.genre}</span>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:10px;">
                        <button class="open-btn" data-movie-id="${movie.id}" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(15,23,42,0.8);color:#fff;cursor:pointer;">Open</button>
                        <button class="remove-btn" data-movie-id="${movie.id}" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(127,29,29,0.8);color:#fff;cursor:pointer;">Remove</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.open-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            window.location.href = `movie-details.html?id=${button.dataset.movieId}`;
        });
    });

    container.querySelectorAll('.remove-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            MovieService.removeFromWatchlist(user, Number(button.dataset.movieId));
            renderWatchlist(allMovies, user, container);
        });
    });

    container.querySelectorAll('.movie-card').forEach(card => {
        card.addEventListener('click', () => {
            window.location.href = `movie-details.html?id=${card.dataset.movieId}`;
        });
    });
}
