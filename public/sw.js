// MONGOLZ Security — minimal PWA offline shell.
//
// Strategy:
//   * Pre-cache the public landing + login + offline fallback on install.
//   * Navigation requests fall back to the offline page when the network
//     is unavailable.
//   * Same-origin GETs for assets use a stale-while-revalidate pattern so
//     the second visit is fast even online.
//   * Auth-gated routes are NEVER cached — they always go to the network so
//     RLS / role checks fire. The offline page tells the user to reconnect.

const CACHE = "mongolz-v1";
const PRECACHE = ["/", "/login", "/offline.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Skip cross-origin completely — never proxy 3rd-party requests.
  if (url.origin !== self.location.origin) return;

  // Auth-gated paths: never cache, never offline-fallback to admin content.
  // List mirrors lib/supabase/middleware.ts allow-list "inverted".
  const isAdminPath =
    !PRECACHE.includes(url.pathname) &&
    (url.pathname.startsWith("/api/") ||
      url.pathname === "/dashboard" ||
      url.pathname.startsWith("/playback") ||
      url.pathname.startsWith("/live") ||
      url.pathname.startsWith("/alerts") ||
      url.pathname.startsWith("/users") ||
      url.pathname.startsWith("/audit") ||
      url.pathname.startsWith("/settings") ||
      url.pathname.startsWith("/cameras") ||
      url.pathname.startsWith("/suspects"));

  if (isAdminPath) {
    // Network-only. Failures bubble up to the browser's default offline UI.
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache fresh public pages opportunistically.
          if (res.ok && PRECACHE.includes(url.pathname)) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          caches
            .match("/offline.html")
            .then((r) => r ?? caches.match("/") ?? new Response("offline")),
        ),
    );
    return;
  }

  // Stale-while-revalidate for static assets (same origin, GET).
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
