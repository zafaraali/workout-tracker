const CACHE_NAME = "irontrack-shell-v1";
const APP_SHELL = [
    "/",
    "/static/app.css",
    "/static/app.js",
    "/static/manifest.json",
    "/static/icon.svg",
];
const TAILWIND_CDN = "https://cdn.tailwindcss.com/";

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_SHELL);
        try {
            const response = await fetch(TAILWIND_CDN, {mode: "no-cors"});
            await cache.put(TAILWIND_CDN, response);
        } catch (error) {
            console.warn("Tailwind could not be cached for offline use.", error);
        }
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name.startsWith("irontrack-shell-") && name !== CACHE_NAME)
            .map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET") return;

    if (request.url === TAILWIND_CDN) {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                const cache = await caches.open(CACHE_NAME);
                await cache.put(request, response.clone());
                return response;
            } catch (error) {
                const cached = await caches.match(request);
                if (cached) return cached;
                throw error;
            }
        })());
        return;
    }

    if (url.origin !== self.location.origin) return;
    if (request.mode === "navigate") {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                const cache = await caches.open(CACHE_NAME);
                await cache.put("/", response.clone());
                return response;
            } catch (error) {
                const cached = await caches.match("/");
                if (cached) return cached;
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
                await cache.put(request, response.clone());
                return response;
            } catch (error) {
                const cached = await caches.match(request);
                if (cached) return cached;
                throw error;
            }
        })());
    }
});
