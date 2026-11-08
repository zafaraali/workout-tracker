const CACHE_NAME = "irontrack-shell-v5";
const APP_SHELL = [
    "/",
    "/static/app.css",
    "/static/tailwind.css",
    "/static/offline.js",
    "/static/progress.js",
    "/static/routines.js",
    "/static/training.js",
    "/static/app.js",
    "/static/manifest.json",
    "/static/icon.svg",
    "/static/offline.html",
];
self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_SHELL);
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name.startsWith("irontrack-shell-") && name !== CACHE_NAME)
            .map((name) => caches.delete(name)));
        if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET") return;
    if (["/login", "/logout", "/healthz"].includes(url.pathname)) return;

    if (url.origin !== self.location.origin) return;
    if (request.mode === "navigate") {
        event.respondWith((async () => {
            try {
                const preload = await event.preloadResponse;
                const response = preload || await fetch(request);
                const cache = await caches.open(CACHE_NAME);
                if (response.ok && response.headers.get("X-IronTrack-Shell") === "1") {
                    await cache.put("/", response.clone());
                } else if (response.redirected || url.pathname === "/logout") {
                    await cache.delete("/");
                }
                return response;
            } catch (error) {
                const cached = await caches.match("/");
                if (cached) return cached;
                const offline = await caches.match("/static/offline.html");
                if (offline) return offline;
                throw error;
            }
        })());
        return;
    }

    if (url.pathname.startsWith("/static/")) {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                const cache = await caches.open(CACHE_NAME);
                if (response.ok) await cache.put(request, response.clone());
                return response;
            } catch (error) {
                const cached = await caches.match(request);
                if (cached) return cached;
                throw error;
            }
        })());
    }
});

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
