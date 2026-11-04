// release f6de48e91a
/* Service worker: keeps the whole app (pages, scripts, pictures, fonts) for use with no signal.
   The big map file is saved separately by the page ("Save the trail") into its own cache. */
importScripts("js/build.js");
var SHELL_CACHE = "swt-shell-" + self.SWT.BUILD;
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) { // cache: "reload" skips the browser's own HTTP cache, which GitHub Pages lets keep a file for 10 minutes;
    // without it a new release can be stored with stale copies of some files.
    return c.addAll(self.SWT.SHELL.map(function (u) { return new Request(u, { cache: "reload" }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("swt-shell-") === 0 && k !== SHELL_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // the map file streams from the network with range requests until it is saved; the page reads the saved copy itself
  if (url.pathname.endsWith(".pmtiles")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(function (r) { return r; }).catch(function () { return caches.match("index.html", { cacheName: SHELL_CACHE }); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true, cacheName: SHELL_CACHE }).then(function (hit) {
    return hit || fetch(req).then(function (r) {
      if (r.ok && url.pathname.indexOf("/fonts/glyphs/") >= 0) { var copy = r.clone(); caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); }); }
      return r;
    });
  }));
});
