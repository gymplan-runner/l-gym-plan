// Offline support: cache the app files on first load, serve them from the cache afterwards.
// Bump VERSION whenever any file below changes so phones pick up the update.
//
// Caches are shared by every app on the same web address, so this app only ever touches caches
// named "lgym-…". Another app's service worker may still delete ours; if that happens, the
// fetch handler and the page's "recache" message rebuild it.
const PREFIX = "lgym-";
const VERSION = `${PREFIX}v3`;
const FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/db.js", "js/plan.js", "js/ui.js", "js/beep.js", "js/checks.js",
  "js/session.js", "js/progression.js", "js/settings.js",
  "js/planview.js", "js/progress.js", "js/history.js", "js/charts.js",
  "data/plan.json", "data/pictos.json", "img/guide.jpg",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
];

const cacheAll = () => caches.open(VERSION).then((c) => c.addAll(FILES));

self.addEventListener("install", (e) => {
  e.waitUntil(cacheAll().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (e) => {
  if (e.data === "recache") e.waitUntil(cacheAll().catch(() => {}));
});

// Look only in this app's own cache. On a miss, fetch and keep a copy, so a deleted cache refills itself.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.registration.scope)) return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok) c.put(e.request, res.clone()).catch(() => {});
    return res;
  }));
});
