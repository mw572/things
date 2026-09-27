// Keeps the planner working with no signal.
//
// The app (page, scripts, lane and places data, posters, Leaflet, fonts' stylesheet) is saved as one complete set per
// release, named by BUILD. The page always opens from that saved set, so it opens the same way with a good signal, a
// weak one or none, and never waits on the network to start. A new release is downloaded in the background as a new
// set; the page offers to switch when it's complete, and an incomplete download leaves the old set in charge.
//
// Road tiles for the phone's router are kept as they're used, and the ones saved for a route are kept until that
// route's saved copy is removed. They're stored per road-data build, because junction numbers differ between builds.
// Map tiles: only OpenTopoMap tiles you've looked at (its terms allow that, never bulk download). Esri tiles are
// left to the browser's ordinary cache, as Esri's free basemaps don't allow offline caching.
// Routing and place search servers are never kept here: the app caches those answers itself.

// deploy.sh rewrites the next two lines with the release's hash and the stamped file list
const BUILD = "69e79f7601";
const SHELL = ["index.html", "about.html", "manifest.webmanifest", "img/icons/apple-touch-icon.png", "img/icons/favicon.png", "img/icons/icon-192.png", "img/icons/icon-512.png", "img/icons/icon-maskable-512.png", "img/regions/argyll.jpg", "img/regions/black-mountains.jpg", "img/regions/borders-galloway.jpg", "img/regions/brecks.jpg", "img/regions/cairngorms.jpg", "img/regions/cotswolds.jpg", "img/regions/dales.jpg", "img/regions/devon.jpg", "img/regions/lakes.jpg", "img/regions/mid-wales.jpg", "img/regions/moors.jpg", "img/regions/northumberland.jpg", "img/regions/peak.jpg", "img/regions/ridgeway.jpg", "img/regions/salisbury-plain.jpg", "img/regions/shropshire.jpg", "img/regions/south-downs.jpg", "img/regions/start-hero-wide.jpg", "img/regions/start-hero.jpg", "img/regions/west-highlands.jpg", "data/regions.js?v=96f2904e", "data/region-stats.js?v=635c4fc6", "data/osm-lanes.js?v=a10797ab", "data/council-flags.js?v=0caaf474", "data/council-boats.js?v=d29ae6d4", "data/closures.js?v=613bc2dd", "data/classics.js?v=06d1a86d", "data/featured.js?v=3747ca0e", "js/plan.js?v=89dd517b", "js/app.js?v=3ca02fb5", "js/offline.js?v=6fe83e21", "js/ride.js?v=f7088694", "js/localroute.js", "js/route-worker.js", "data/stops.js", "data/roads/index.json"];
const REMOTE = ["https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css", "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Zilla+Slab:wght@600;700&display=swap"];

// Every site on mw572.github.io shares one set of caches, so each name carries this app's path, and this worker only
// ever deletes its own (a copy of the planner at another path, or another site, keeps its caches)
const NS = " " + new URL(self.registration.scope).pathname;
const APP = "glp-app-" + BUILD + NS, STATIC = "glp-static-v1" + NS, TILES = "glp-tiles-v2" + NS, MAX_TILES = 4000;
const ROADS = "glp-roads-", ROADS_USED_MAX = 60;   // + road-data build date + NS; tiles only used (not saved) are trimmed to this
const NEVER = /brouter\.de|project-osrm\.org|nominatim\.openstreetmap\.org/;
const TILE = /tile\.opentopomap\.org/, NO_KEEP = /arcgisonline\.com/;
const ROADTILE = /\/data\/roads\/[^/]+\.bin\.gz/;
const IMMUTABLE = /fonts\.gstatic\.com|cdnjs\.cloudflare\.com/;

// fetch with a time limit, so a weak signal fails over to the saved copy instead of hanging
function fetchSoon(req, ms, opts){
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  return fetch(req, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    try {
    // every file must arrive whole, or this release isn't installed and the old one stays in charge
    await Promise.all(SHELL.map(async p => {
      const res = await fetch(p, { cache: "reload" });
      if (!res.ok) throw new Error(p + " " + res.status);
      await c.put(p.replace(/\?.*$/, ""), res);
    }));
    await Promise.all(REMOTE.map(async u => {
      const res = await fetch(u, { mode: "cors", cache: "reload" });
      if (!res.ok) throw new Error(u + " " + res.status);
      await c.put(u, res);
    }));
    // a CDN can briefly serve the previous page after a release: make sure the page is this release's
    if (!BUILD.startsWith("dev")) {
      const page = await (await c.match("index.html")).text();
      if (!page.includes(BUILD)) throw new Error("stale page");
    }
    } catch (err) { await caches.delete(APP); throw err; }   // a half-downloaded release is thrown away whole
    await c.put("__complete", new Response(BUILD));
    // the first install takes charge straight away; later ones wait for the page to agree (see "skip" below)
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("glp-app-") && k.endsWith(NS) && k !== APP).map(k => caches.delete(k)));
    // road tiles from an older road-data build can't be mixed with this one's: drop them
    try {
      const built = (await (await (await caches.open(APP)).match("data/roads/index.json")).json()).built;
      await Promise.all(keys.filter(k => k.startsWith(ROADS) && k.endsWith(NS) && !k.startsWith(ROADS + built)).map(k => caches.delete(k)));
    } catch {}
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data === "skip") self.skipWaiting();
  if (e.data?.type === "status") e.waitUntil((async () => {
    const c = await caches.open(APP), done = await c.match("__complete");
    e.source.postMessage({ type: "status", build: BUILD, complete: !!done });
  })());
});

async function trim(name, max){   // drop the oldest entries beyond max
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
let trimmed = 0;

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || NEVER.test(req.url) || NO_KEEP.test(req.url)) return;

  if (TILE.test(req.url)) {   // map tiles: the kept copy first, fetched and kept if missing
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try {
        const res = await fetchSoon(req, 15000);
        if (res.ok) { c.put(req, res.clone()); if (++trimmed % 200 === 0) trim(TILES, MAX_TILES); }
        return res;
      } catch { return Response.error(); }
    }));
    return;
  }

  if (url.origin === self.location.origin && ROADTILE.test(url.pathname)) {   // road tiles: saved first, then used, then network
    const build = url.searchParams.get("b") || "x", key = url.pathname;
    e.respondWith((async () => {
      const saved = await caches.open(ROADS + build + "-saved" + NS), used = await caches.open(ROADS + build + NS);
      const hit = (await saved.match(key)) || (await used.match(key)); if (hit) return hit;
      const res = await fetchSoon(req, 20000);
      if (res.ok) { await used.put(key, res.clone()); trim(ROADS + build + NS, ROADS_USED_MAX); }
      return res;
    })().catch(() => Response.error()));
    return;
  }

  const scopePath = new URL(self.registration.scope).pathname, rel = url.pathname.slice(scopePath.length);
  if (req.mode === "navigate" && url.origin === self.location.origin && ["", "index.html", "about.html"].includes(rel)) {   // the page: always this release's saved copy
    e.respondWith((async () => {
      const c = await caches.open(APP);
      const hit = (await c.match("__complete")) && (url.pathname.endsWith("/about.html") ? await c.match("about.html") : await c.match("index.html"));
      if (hit) return hit;
      try { return await fetch(req); } catch { return Response.error(); }
    })());
    return;
  }

  if (url.origin === self.location.origin) {   // the app's own files: this release's copy, ignoring the version stamp
    e.respondWith((async () => {
      const c = await caches.open(APP);
      const hit = await c.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      try { return await fetchSoon(req, 20000); } catch { return Response.error(); }
    })());
    return;
  }

  // Leaflet and fonts: this release's copy, or the long-lived store for font files (they never change at a URL)
  e.respondWith((async () => {
    const hit = (await (await caches.open(APP)).match(req, { ignoreVary: true })) || (await (await caches.open(STATIC)).match(req, { ignoreVary: true }));
    if (hit) return hit;
    try {
      const res = await fetchSoon(req, 20000);
      if (IMMUTABLE.test(req.url) && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(STATIC).then(c => c.put(req, copy)); }
      return res;
    } catch { return Response.error(); }
  })());
});
