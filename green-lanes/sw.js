// Keeps the planner working with no signal: the app itself, its lane and ride data, the places data once it has
// been opened, and the map tiles you've looked at. Pages are network-first (so updates arrive when online) and fall
// back to the copy kept here; data files carry a version stamp in their URL, so a kept copy is always the right one.
// Routing and place search are never kept here: the app caches those answers itself.
const APP = "glp-app-v1", TILES = "glp-tiles-v2", MAX_TILES = 4000;   // v2: Esri tiles no longer kept
const CORE = ["./", "index.html", "about.html", "manifest.webmanifest", "img/icons/icon-192.png"];
const NEVER = /brouter\.de|project-osrm\.org|nominatim\.openstreetmap\.org/;
// Only tiles you've looked at, and only from a service whose terms allow that: OpenTopoMap permits caching viewed
// tiles (never bulk download). Esri's free basemaps don't allow persistent offline caching, so they are left to the
// browser's ordinary cache.
const TILE = /tile\.opentopomap\.org/, NO_KEEP = /arcgisonline\.com/;

self.addEventListener("install", e => { e.waitUntil(caches.open(APP).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![APP, TILES].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles(){   // keep the tile store to a sensible size by dropping the oldest
  const c = await caches.open(TILES), keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}
let trimmed = 0;

self.addEventListener("fetch", e => {
  const req = e.request, url = req.url;
  if (req.method !== "GET" || NEVER.test(url) || NO_KEEP.test(url)) return;
  if (TILE.test(url)) {   // map tiles: the kept copy first, fetched and kept if missing
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { c.put(req, res.clone()); if (++trimmed % 200 === 0) trimTiles(); }   // tiles are fetched with CORS, so they're kept at their real size
        return res;
      } catch { return hit || Response.error(); }
    }));
    return;
  }
  const sameOrigin = new URL(url).origin === self.location.origin;
  const isPage = req.mode === "navigate";
  if (isPage || (sameOrigin && !/\?v=/.test(url))) {   // pages and unversioned files: network first, kept copy offline
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(APP).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (isPage ? caches.match("index.html") : Response.error()))));
    return;
  }
  // versioned data and scripts, fonts, Leaflet: the kept copy first; a new version replaces the old one
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(APP).then(async c => {
      if (sameOrigin) { const path = new URL(url).pathname; for (const k of await c.keys()) if (new URL(k.url).pathname === path && k.url !== url) await c.delete(k); }
      await c.put(req, copy);
    }); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(h => h || Response.error()))));
});
