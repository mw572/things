/* Installing the app, saving the trail for no signal, and checking it is still there. */
window.SWT = window.SWT || {};
(function () {
  var MAP_CACHE = "swt-map-v1";
  var O = SWT.offline = { deferredPrompt: null, listeners: [] };
  function emit() { O.listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  O.onChange = function (fn) { O.listeners.push(fn); };

  var ua = navigator.userAgent || "";
  O.isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  O.isAndroid = /Android/i.test(ua);
  O.isIOSNotSafari = O.isIOS && /CriOS|FxiOS|EdgiOS/.test(ua);
  O.standalone = function () { return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; };
  O.platform = function () { return O.isIOS ? "iphone" : O.isAndroid ? "android" : "desktop"; };

  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); O.deferredPrompt = e; emit(); });
  window.addEventListener("appinstalled", function () { O.deferredPrompt = null; emit(); });
  O.promptInstall = function () {
    if (!O.deferredPrompt) return Promise.resolve(false);
    var p = O.deferredPrompt; O.deferredPrompt = null;
    p.prompt(); return p.userChoice.then(function (c) { emit(); return c.outcome === "accepted"; });
  };

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        O.reg = reg; emit();
        reg.addEventListener("updatefound", function () { var w = reg.installing; if (w) w.addEventListener("statechange", emit); });
      }).catch(function () {});
    });
    // When a new release takes over from an old one, reload once so the page never runs a mix of old and new files.
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (hadController && !reloaded) { reloaded = true; location.reload(); } else emit(); });
  }

  // ---- the map files: the detailed trail corridor and a light overview of Spain ----
  function mapNames() { return Object.keys(SWT.MAPS || { "trail.pmtiles": 0, "overview.pmtiles": 0 }); }
  O.mapFiles = null; // { "trail.pmtiles": File, ... } once read from the cache
  O.mapSaved = function () {
    if (!("caches" in window)) return Promise.resolve(false);
    return caches.open(MAP_CACHE).then(function (c) {
      return Promise.all(mapNames().map(function (n) { return c.match("data/" + n); }));
    }).then(function (rs) { return rs.every(Boolean); }).catch(function () { return false; });
  };
  O.loadMapFiles = function () {
    if (O.mapFiles) return Promise.resolve(O.mapFiles);
    if (!("caches" in window)) return Promise.resolve(null);
    return caches.open(MAP_CACHE).then(function (c) {
      return Promise.all(mapNames().map(function (n) { return c.match("data/" + n).then(function (r) { return r ? r.blob().then(function (b) { return new File([b], n); }) : null; }); }));
    }).then(function (files) {
      if (!files.every(Boolean)) return null;
      O.mapFiles = {}; files.forEach(function (f) { O.mapFiles[f.name] = f; }); return O.mapFiles;
    }).catch(function () { return null; });
  };
  O.saving = false;
  function download(name, done, total, onProgress) {
    return fetch("data/" + name, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("The map did not download (" + res.status + ")");
      var chunks = [], got = 0;
      if (!res.body || !res.body.getReader) return res.blob();
      var reader = res.body.getReader();
      function pump() { return reader.read().then(function (r) { if (r.done) return new Blob(chunks); chunks.push(r.value); got += r.value.length; onProgress && onProgress(done + got, total); return pump(); }); }
      return pump();
    }).then(function (blob) {
      if (SWT.MAPS && SWT.MAPS[name] && blob.size !== SWT.MAPS[name]) throw new Error("The map arrived incomplete. Try again on a better connection.");
      return caches.open(MAP_CACHE).then(function (c) { return c.put("data/" + name, new Response(blob, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(blob.size) } })); }).then(function () { return blob.size; });
    });
  }
  O.saveMap = function (onProgress) {
    if (O.saving) return Promise.reject(new Error("Already saving"));
    O.saving = true; emit();
    var total = SWT.MAP_BYTES || 0, done = 0, names = mapNames();
    var persist = navigator.storage && navigator.storage.persist ? navigator.storage.persist().catch(function () { return false; }) : Promise.resolve(false);
    var chain = persist;
    names.forEach(function (n) { chain = chain.then(function () { return download(n, done, total, onProgress).then(function (sz) { done += sz; }); }); });
    return chain.then(function () { O.mapFiles = null; return O.ensureShell(); })
      .then(function () { O.saving = false; emit(); }, function (e) { O.saving = false; emit(); throw e; });
  };
  O.removeMap = function () {
    O.mapFiles = null;
    return caches.delete(MAP_CACHE).then(emit);
  };
  O.ensureShell = function () {
    if (!("caches" in window) || !SWT.SHELL) return Promise.resolve();
    return caches.open("swt-shell-" + SWT.BUILD).then(function (c) {
      return Promise.all(SWT.SHELL.map(function (u) {
        return c.match(u).then(function (hit) { return hit || fetch(u).then(function (r) { if (r.ok) return c.put(u, r); }); }).catch(function () {});
      }));
    });
  };
  // What is actually on this phone right now
  O.check = function () {
    var out = { standalone: O.standalone(), sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), shell: 0, shellTotal: (SWT.SHELL || []).length, map: false, mapBytes: 0, persisted: null, usage: null, quota: null };
    var jobs = [];
    if ("caches" in window) {
      jobs.push(caches.open("swt-shell-" + SWT.BUILD).then(function (c) {
        return Promise.all((SWT.SHELL || []).map(function (u) { return c.match(u).then(function (r) { if (r) out.shell++; }); }));
      }).catch(function () {}));
      jobs.push(caches.open(MAP_CACHE).then(function (c) { return Promise.all(mapNames().map(function (n) { return c.match("data/" + n); })); }).then(function (rs) {
        out.map = rs.every(Boolean); out.mapBytes = rs.reduce(function (s, r) { return s + (r ? (+r.headers.get("Content-Length") || 0) : 0); }, 0);
      }).catch(function () {}));
    }
    if (navigator.storage && navigator.storage.persisted) jobs.push(navigator.storage.persisted().then(function (p) { out.persisted = p; }).catch(function () {}));
    if (navigator.storage && navigator.storage.estimate) jobs.push(navigator.storage.estimate().then(function (e) { out.usage = e.usage; out.quota = e.quota; }).catch(function () {}));
    return Promise.all(jobs).then(function () { return out; });
  };
  O.mb = function (b) { return (b / 1e6).toFixed(b > 1e8 ? 0 : 1) + " MB"; };
  window.addEventListener("online", emit); window.addEventListener("offline", emit);
})();
