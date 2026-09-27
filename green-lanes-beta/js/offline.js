/* ---------- using the planner with no signal ----------
   1. The app keeps itself on the phone (sw.js). This file registers that, offers new releases when they've
      downloaded completely, and says in Help whether the phone is ready.
   2. "Save for no signal" keeps a route's finished line and the road tiles around it, so the route opens, can be
      changed and can be ridden with no signal. The phone's router (js/localroute.js) works from those tiles.
   3. With no signal the map pictures stop loading (Esri's and OpenTopoMap's terms don't allow saving them in bulk),
      so a plain road map is drawn from the same road tiles instead. */
const Offline = (() => {
  // cache names carry the app's path, as every site on the same host shares one set of caches (see sw.js)
  const NS = " " + new URL(".", location.href).pathname, ROUTES = "glp-routes-v1" + NS, MARGIN_KM = 12;
  const can = "caches" in self && "serviceWorker" in navigator;
  let meta = null;
  const getMeta = async () => meta || (meta = await (await fetch("data/roads/index.json")).json());
  const savedCache = m => "glp-roads-" + m.built + "-saved" + NS;
  const tileUrl = (m, k) => new URL(`data/roads/${k}.bin.gz?b=${m.built}`, location.href).href;
  const sig = t => JSON.stringify([t.start, t.finish, !!t.loop, t.items.map(i => i.via ? i.coords : (i.ids || i.coords[0])), settings.twisty]);
  const routeKey = name => new URL("offline-route/" + encodeURIComponent(name), location.href).href;

  /* --- 1. the app itself --- */
  let reg = null, updating = false;
  if (can && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => {
      reg = r;
      const offer = () => { if (reg.waiting && navigator.serviceWorker.controller) $("#updateBar").hidden = false; };
      offer();
      reg.addEventListener("updatefound", () => { const n = reg.installing; n?.addEventListener("statechange", () => { if (n.state === "installed") offer(); if (n.state === "activated") helpState(); }); });
      // a phone can keep the app open for days: look for a new release whenever it comes back to the front
      document.addEventListener("visibilitychange", () => { if (!document.hidden && navigator.onLine) reg.update().catch(() => {}); });
      helpState();
    }).catch(() => helpState());
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (updating) location.reload(); else helpState(); });
    navigator.serviceWorker.addEventListener("message", e => { if (e.data?.type === "status") helpState(e.data); });
  }
  $("#updateGo").onclick = () => { updating = true; $("#updateBar").hidden = true; reg?.waiting?.postMessage("skip"); };
  $("#updateLater").onclick = () => { $("#updateBar").hidden = true; };

  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  function helpState(st){
    const el = $("#offlineState"); if (!el) return;
    if (!can) { el.textContent = "This browser can't keep the app for use with no signal. Download the GPX before you set off."; return; }
    const ctl = navigator.serviceWorker.controller;
    if (!st && ctl) { ctl.postMessage({ type: "status" }); return; }
    el.textContent = st?.complete ? "This phone has the app saved, so it opens with no signal." : "The app is still saving itself to this phone. Keep this page open for a minute on a good signal.";
    $("#offlineIos").hidden = !(ios && !standalone);
  }

  /* --- 2. saving a route --- */
  // the road tiles a route needs: a band 12 km either side of it (room for a way back, or a change of plan),
  // and the box around each road link, which is what the router loads to re-plan that link
  function tilesFor(m, b){
    const [TL, TO] = m.tile, keys = new Set();
    const box = (s, w, n, e) => { for (let i = Math.floor(s / TL); i <= Math.floor(n / TL); i++) for (let j = Math.floor(w / TO); j <= Math.floor(e / TO); j++) if (m.tiles[i + "_" + j]) keys.add(i + "_" + j); };
    const around = (p, pts) => { const dLat = MARGIN_KM / 111, dLon = dLat / Math.cos(p[0] * Math.PI / 180); return [dLat, dLon]; };
    for (const s of b.segs) {
      const c = s.coords; if (!c?.length) continue;
      for (let i = 0; i < c.length; i += Math.max(1, Math.floor(c.length / 40))) { const [dl, dn] = around(c[i]); box(c[i][0] - dl, c[i][1] - dn, c[i][0] + dl, c[i][1] + dn); }
      const a = c[0], z = c.at(-1), [dl, dn] = around(a);
      box(Math.min(a[0], z[0]) - dl, Math.min(a[1], z[1]) - dn, Math.max(a[0], z[0]) + dl, Math.max(a[1], z[1]) + dn);
    }
    return [...keys];
  }
  async function estimate(b){
    try { const m = await getMeta(); const keys = tilesFor(m, b); return { keys, mb: keys.reduce((s, k) => s + m.tiles[k].kb, 0) / 1024 }; } catch { return null; }
  }
  // Save the route: its plan in Saved, its finished line, and its road tiles. Every tile must arrive, or it says so.
  async function saveRoute(t, b, onStep){
    if (!can) throw new Error("This browser can't save for use with no signal.");
    navigator.storage?.persist?.().catch(() => {});   // ask the browser not to clear it when space runs low
    const m = await getMeta(), keys = tilesFor(m, b), cache = await caches.open(savedCache(m));
    let done = 0, bytes = 0;
    const one = async k => {
      const url = tileUrl(m, k);
      let hit = await cache.match(url);
      if (!hit) {
        const res = await fetch(url);
        if (!res.ok) throw new Error("road tile " + k);
        await cache.put(url, res.clone()); hit = res;
      }
      bytes += m.tiles[k].kb; onStep?.(++done, keys.length, bytes / 1024);
    };
    // four at a time, so a phone on a weak signal isn't swamped
    const queue = keys.slice(); await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) await one(queue.shift()); }));
    const rc = await caches.open(ROUTES);
    await rc.put(routeKey(t.name), new Response(JSON.stringify({ name: t.name, sig: sig(t), trip: t, built: b, keys, build: m.built, when: Date.now() }), { headers: { "Content-Type": "application/json" } }));
    return { tiles: keys.length, mb: bytes / 1024 };
  }
  async function kept(name){
    if (!can) return null;
    try { const r = await (await caches.open(ROUTES)).match(routeKey(name)); return r ? await r.json() : null; } catch { return null; }
  }
  // the saved line for this exact plan, if there is one (so opening a saved route needs no routing at all)
  async function keptBuilt(t){ const k = await kept(t.name); return k && k.sig === sig(t) ? k.built : null; }
  // whether the roads a route needs are all on the phone (saved, or kept from recent use): true, false, or null if unknown
  async function covered(b){
    if (!can) return false;
    try {
      const m = await getMeta(), keys = tilesFor(m, b), a = await caches.open(savedCache(m)), u = await caches.open("glp-roads-" + m.built + NS);
      for (const k of keys) { const url = tileUrl(m, k); if (!(await a.match(url)) && !(await u.match(new URL(url).pathname))) return false; }
      return true;
    } catch { return null; }
  }
  async function keptNames(){
    if (!can) return new Set();
    try { const rc = await caches.open(ROUTES); return new Set(await Promise.all((await rc.keys()).map(async r => (await (await rc.match(r)).json()).name))); } catch { return new Set(); }
  }
  // forget a route: its line, and the road tiles no other saved route uses
  async function forget(name){
    if (!can) return;
    const rc = await caches.open(ROUTES), k = await kept(name); if (!k) return;
    await rc.delete(routeKey(name));
    const still = new Set(); for (const r of await rc.keys()) { const o = await (await rc.match(r)).json(); if (o.build === k.build) o.keys.forEach(x => still.add(x)); }
    const cache = await caches.open("glp-roads-" + k.build + "-saved" + NS);
    for (const x of k.keys) if (!still.has(x)) await cache.delete(new URL(`data/roads/${x}.bin.gz?b=${k.build}`, location.href).href);
  }

  /* --- 3. a plain road map from the road tiles --- */
  map.createPane("offlineRoads"); map.getPane("offlineRoads").style.zIndex = 250;
  const STY = { 0: ["#d35400", 5], 1: ["#d35400", 3], 2: ["#e67e22", 4.5], 3: ["#e67e22", 3], 4: ["#f1c40f", 4], 5: ["#f1c40f", 2.5], 6: ["#f7dc6f", 3.5], 7: ["#f7dc6f", 2.5],
    8: ["#fff", 3], 9: ["#fff", 2], 10: ["#fff", 2.5], 11: ["#fff", 2], 12: ["#fff", 2], 13: ["#fff", 1.5], 14: ["#8d6e63", 1.5] };
  const maxClsAt = z => z >= 14 ? 14 : z >= 13 ? 13 : z >= 12 ? 10 : z >= 10 ? 7 : 3;
  const RoadsLayer = L.GridLayer.extend({
    createTile(c, done){
      const cv = document.createElement("canvas"), sz = this.getTileSize(); cv.width = sz.x * devicePixelRatio; cv.height = sz.y * devicePixelRatio;
      const nw = map.unproject(c.scaleBy(sz), c.z), se = map.unproject(c.add([1, 1]).scaleBy(sz), c.z);
      localRouter.call({ type: "lines", box: [se.lat, nw.lng, nw.lat, se.lng], maxCls: maxClsAt(c.z) }).then(r => {
        const g = cv.getContext("2d"); g.scale(devicePixelRatio, devicePixelRatio); g.lineCap = g.lineJoin = "round";
        if (r) {
          const o = map.project(nw, c.z), px = (la, lo) => { const p = map.project([la, lo], c.z); return [p.x - o.x, p.y - o.y]; };
          // casings first, then fills, in order of importance so main roads sit on top
          const order = [...r.cls.keys()].sort((a, b) => r.cls[b] - r.cls[a]);
          for (const pass of [0, 1]) for (const i of order) {
            const k = r.cls[i], [col, w] = STY[k] || STY[13]; if (k === 14 && pass === 0) continue;
            g.beginPath();
            for (let q = r.off[i]; q < r.off[i + 1]; q++) { const [x, y] = px(r.xy[2 * q], r.xy[2 * q + 1]); q === r.off[i] ? g.moveTo(x, y) : g.lineTo(x, y); }
            if (pass === 0) { g.strokeStyle = "#9e9585"; g.lineWidth = w + 2; } else { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(k === 14 ? [4, 4] : []); }
            g.stroke(); g.setLineDash([]);
          }
        }
        done(null, cv);
      });
      return cv;
    }
  });
  const roads = new RoadsLayer({ pane: "offlineRoads", minZoom: 9, maxZoom: 19, updateWhenIdle: true, keepBuffer: 1 });
  let showing = false, errs = [];
  function useRoads(on){
    if (on === showing) return; showing = on;
    document.documentElement.classList.toggle("noSignalMap", on);
    if (on) roads.addTo(map); else map.removeLayer(roads);
    $("#noSignalNote").hidden = !on;
  }
  // map pictures failing to load (three within ten seconds) means no signal: switch to the plain map
  for (const layer of Object.values(bases)) {
    layer.on("tileerror", () => { const now = Date.now(); errs = errs.filter(t => now - t < 10000); errs.push(now); if (errs.length >= 3) useRoads(true); });
    layer.on("tileload", () => { if (showing && navigator.onLine) { errs = []; useRoads(false); } });
  }
  addEventListener("offline", () => useRoads(true));
  addEventListener("online", () => { errs = []; useRoads(false); bases[baseName].redraw(); });
  if (!navigator.onLine) useRoads(true);

  // the route screen's button: what saving would take, or that it's done
  let btnRun = 0;
  async function refreshButton(){
    const btn = $("#offlineBtn"), run = ++btnRun; if (!btn) return;
    btn.disabled = !can || !built || !!built.provisional;
    if (!can) { btn.textContent = "No-signal saving isn't available in this browser"; return; }
    if (!built || built.provisional) { btn.textContent = "⤓ Save for no signal"; return; }
    const k = await kept(trip.name), m = await getMeta().catch(() => null); if (run !== btnRun) return;
    // saved, and on this release's road data (after a road-data update the saved roads are cleared and need saving again)
    if (k && k.sig === sig(trip) && m && k.build === m.built) { btn.textContent = "✓ Saved for no signal"; btn.classList.add("done"); return; }
    btn.classList.remove("done");
    const e = await estimate(built); if (run !== btnRun) return;
    btn.textContent = e ? `⤓ Save for no signal (${Math.max(1, Math.round(e.mb))} MB)` : "⤓ Save for no signal";
  }
  $("#offlineBtn").onclick = async () => {
    if (!built || built.provisional || $("#offlineBtn").classList.contains("done")) return;
    const note = $("#offlineNote"), t = trip, b = built; note.hidden = false;
    saveItem({ name: t.name, trip: t, summary: `${km(b.total)} km, ${hm(b.hours)}` });
    try {
      const r = await saveRoute(t, b, (d, n, mb) => { note.textContent = `Saving the roads around it: ${d} of ${n} (${mb.toFixed(1)} MB)…`; });
      note.textContent = `Saved for no signal (${r.mb.toFixed(1)} MB). It's in Saved, and it opens, changes and rides without a signal. The map picture needs a signal, so with none you'll see a plain road map.`;
    } catch (err) {
      note.textContent = `Couldn't save all of it (${err.message}). Try again on a better signal. The route itself is in Saved.`;
    }
    refreshButton();
  };

  return { saveRoute, estimate, refreshButton, covered, kept, keptBuilt, keptNames, forget, useRoads, get showingRoads(){ return showing; } };
})();
