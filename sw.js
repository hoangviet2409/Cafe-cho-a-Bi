const CACHE_NAME = 'cafe-pos-v10'; // Đổi tên cache để update
const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', event => {
    self.skipWaiting(); // Cập nhật SW ngay lập tức
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Chiếm quyền điều khiển các tab đang mở
    );
});

self.addEventListener('fetch', event => {
    // Bỏ qua các API bên ngoài, đặc biệt là Google Apps Script
    // Trình duyệt sẽ tự xử lý các request này mà không qua Service Worker
    if (event.request.url.includes('script.google.com') || event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request);
            })
    );
});
