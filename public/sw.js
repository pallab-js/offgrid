const VERSION = "offgrid-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isExcluded(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isExcluded(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/_next/image")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  event.respondWith(staleWhileRevalidate(request, PAGE_CACHE));
});

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match("/");
    if (shell) return shell;
    return new Response("You are offline", {
      status: 503,
      headers: { "content-type": "text/plain" },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((fresh) => {
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const fresh = await network;
  if (fresh) return fresh;
  return new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
}
