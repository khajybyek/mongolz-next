// MONGOLZ Security — minimal PWA offline shell.
//
// Strategy (allow-list, not deny-list):
//   * Pre-cache the public landing + login + offline fallback on install.
//   * Navigation requests fall back to the offline page when the network
//     is unavailable.
//   * Only immutable static assets are cached (stale-while-revalidate):
//     /_next/static/*, /models/*, the logo and the manifest. Everything
//     else — every page, every RSC payload / router prefetch, every /api
//     call — is network-only, so nothing auth-gated (face metadata,
//     requester e-mails, camera names) ever lands in Cache Storage where it
//     would survive logout on a shared browser.
//   * On logout the app posts {type: "purge"}; the cache is dropped.

const CACHE = "mongolz-v2";
const PRECACHE = ["/", "/login", "/offline.html", "/manifest.webmanifest"];

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/models/") ||
    url.pathname === "/logo.png" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/offline.html"
  );
}

function isRscOrPrefetch(req, url) {
  return (
    req.headers.get("RSC") === "1" ||
    req.headers.get("Next-Router-Prefetch") === "1" ||
    url.searchParams.has("_rsc")
  );
}

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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "purge") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Skip cross-origin completely — never proxy 3rd-party requests.
  if (url.origin !== self.location.origin) return;
  // App data (RSC payloads, prefetches, APIs) is network-only.
  if (isRscOrPrefetch(req, url) || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache fresh PUBLIC pages opportunistically.
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

  if (!isStaticAsset(url)) return; // network-only

  // Stale-while-revalidate for immutable static assets.
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

// ── Web Push handlers ─────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let payload = { title: "MONGOLZ Security", body: "Шинэ мэдэгдэл" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") payload = parsed;
    }
  } catch {
    try {
      const text = event.data && event.data.text();
      if (text) payload.body = text;
    } catch {}
  }

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/apple-icon.png",
    badge: payload.badge || "/icon.png",
    tag: payload.tag || "mongolz",
    data: { url: payload.url || "/alerts" },
    renotify: true,
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(payload.title || "MONGOLZ Security", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/alerts";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        const url = new URL(c.url);
        if (url.origin === self.location.origin) {
          c.focus();
          c.navigate(target).catch(() => undefined);
          return;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
