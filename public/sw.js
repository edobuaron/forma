// Forma service worker.
// Scope is deliberately modest: it makes the app installable and fast by caching static assets.
// It does NOT provide offline workout logging — workout data lives in the database, with a
// local autosave buffer in the page itself. Navigations are network-first with an offline notice.
// Bumping VERSION deletes every older cache on activate. v2 purges any failed response v1 may have kept.
const VERSION = "forma-v2";
const STATIC = `${VERSION}-static`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(["/offline", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase API traffic

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        // Only keep real files. A 404 or 5xx (e.g. mid-deploy) cached under a hashed, immutable URL would be
        // served forever, so that script never loads and every chart on the page stays blank.
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
  }
});
