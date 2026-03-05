self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('cineverse-v1').then((cache) => cache.addAll([
      './',
      './home.html',
      './login.html',
      './watchlist.html',
      './movie-details.html',
      './css/home.css',
      './css/login.css',
      './js/home.js',
      './js/login.js',
      './js/movie-details.js',
      './js/watchlist.js',
      './js/movie-service.js',
      './js/auth.js',
      './js/storage.js',
      './data/movies.json'
    ]))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => caches.match('./home.html')))
  );
});
