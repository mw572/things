// Green Lanes Planner app: map, lanes, stops, planning (loops, drawn lines, multi-day tours), route building and GPX.
// Route-finding lives in plan.js. Notes and test results: notes/green-lanes-sources.md.
"use strict";

/* ---------- small helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
function hav(a, b){
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0]-a[0])*r, dLng = (b[1]-a[1])*r;
  const s = Math.sin(dLat/2)**2 + Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
const lineLen = c => c.reduce((s, p, i) => i ? s + hav(c[i-1], p) : 0, 0);
const km = m => { const k = m / 1000; return k < 100 ? k.toFixed(1) : Math.round(k).toString(); };
const mins = h => h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : hm(h);   // "18 min" rather than "0h 18"
const hm = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}`; };
const clone = o => JSON.parse(JSON.stringify(o));
const store = {
  get(k, d){ try { const v = localStorage.getItem("glp:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem("glp:" + k, JSON.stringify(v)); return true; } catch { return false; } }   // false: blocked or full
};
function loadScript(src){ return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.append(s); }); }
let statusTimer;
function status(msg, ms = 5000){ const el = $("#status"); el.textContent = msg; el.hidden = !msg; clearTimeout(statusTimer); if (msg && ms) statusTimer = setTimeout(() => el.hidden = true, ms); }
// Phones held upright get the bottom panel. Anything wider, or short (a phone on its side), gets the side panel.
const phone = () => innerWidth <= 820 && innerHeight > 500;
const sideAuto = () => !phone() && innerHeight <= 500;   // a phone on its side: the side panel folds away when the map needs the room
// the phone's back gesture (see "the phone's back gesture steps back inside the planner" further down)
let navDepth = 0, navBusy = false, welcomeFromHome = false;
function navPush(){ if (navBusy) return; try { history.pushState({ glp: ++navDepth }, ""); } catch (e) {} }

/* ---------- polite requests to the free public servers ----------
   OSRM's demo server, BRouter and Nominatim are free and ask users to keep requests modest
   (Nominatim and OSRM: about one a second). Each server gets its own queue with a gap between
   requests, and every answer is cached. The queue length shows on screen so waiting is never silent. */
const SERVERS = { osrm: { gap: 1000, lanes: 1 }, brouter: { gap: 700, lanes: 2 }, nominatim: { gap: 1100, lanes: 1 } };
for (const k in SERVERS) Object.assign(SERVERS[k], { next: 0, pending: 0, q: Array.from({ length: SERVERS[k].lanes }, () => ({ last: 0, chain: Promise.resolve() })) });
const reqCache = new Map();
function queueChanged(){
  const n = Object.values(SERVERS).reduce((t, s) => t + s.pending, 0);
  $("#busyQueue").textContent = n ? `Waiting on the free routing servers: ${n} request${n > 1 ? "s" : ""} in the queue.` : "";
  $("#queueChip").hidden = !n || !$("#busy").hidden;
  $("#queueChip").textContent = `Waiting for the map servers… ${n} in the queue`;
}
function polite(server, url, opts = {}, { cache = true, timeout = 30000 } = {}){
  const key = server + " " + url;
  if (cache && !opts.body && reqCache.has(key)) return Promise.resolve(reqCache.get(key));
  const srv = SERVERS[server], s = srv.q[srv.next++ % srv.q.length];
  srv.pending++; queueChanged();
  const run = s.chain.then(async () => {
    const wait = s.last + srv.gap - Date.now(); if (wait > 0) await sleep(wait);
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    try { const r = await fetch(url, { ...opts, signal: ctl.signal }); return { ok: r.ok, status: r.status, text: await r.text() }; }
    catch (e) { return { ok: false, status: 0, text: String(e) }; }
    finally { clearTimeout(t); s.last = Date.now(); srv.pending--; queueChanged(); }
  });
  s.chain = run.catch(() => {});
  return run.then(res => { if (cache && res.ok && !opts.body) reqCache.set(key, res); return res; });
}
/* loading screen for long jobs (tours) */
let busyRun = 0;
const busy = {
  show(title, onCancel){ $("#busyTitle").textContent = title; $("#busyText").textContent = ""; $("#busyBar").style.width = "0%"; $("#busy").hidden = false; $("#busyCancel").onclick = () => { busyRun++; busy.hide(); onCancel?.(); }; queueChanged(); },
  set(text, frac){ $("#busyText").textContent = text; if (frac != null) $("#busyBar").style.width = Math.round(Math.min(1, frac) * 100) + "%"; },
  hide(){ $("#busy").hidden = true; queueChanged(); }
};

/* ---------- map ---------- */
// the whole of Britain, Scotland included: a zoom out on a phone's narrow screen
const GB_CENTRE = [54.4, -3.2], gbZoom = () => innerWidth <= 820 ? 5 : 6;
// the whole of Britain as a box, so it can be fitted into the part of the map the panel leaves visible
const GB_BOUNDS = [[50.0, -5.8], [58.7, 1.8]];
// (on a touch screen a lane can be tapped from a little further off the line: a finger isn't a mouse pointer)
const map = L.map("map", { zoomSnap: 0.25, preferCanvas: true, renderer: L.canvas({ tolerance: matchMedia("(pointer: coarse)").matches ? 18 : 10 }), zoomControl: false }).setView(GB_CENTRE, gbZoom());
L.control.zoom({ position: "bottomright" }).addTo(map);
map.attributionControl.setPosition("bottomleft");   // the map's credits: small, in the bottom-left corner
map.createPane("route"); map.getPane("route").style.zIndex = 450; map.getPane("route").style.pointerEvents = "none";
const routeRenderer = L.svg({ pane: "route" });
// Map moves fly unless the rider has asked their phone for less motion
const fly = (c, z) => matchMedia("(prefers-reduced-motion: reduce)").matches ? map.setView(c, z) : map.flyTo(c, z, { duration: 0.8 });
const bases = {
  Map: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, crossOrigin: true, attribution: "Esri, HERE, Garmin, OS, © OpenStreetMap contributors" }),
  Satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, crossOrigin: true, attribution: "Esri, Maxar, Earthstar Geographics" }),
  Topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, crossOrigin: true, attribution: "OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors" })
};
let baseName = store.get("base", "Map"); if (!bases[baseName]) baseName = "Map";
bases[baseName].addTo(map);
let restyleLanes = null;   // set once the lanes exist
function setBase(name){
  map.removeLayer(bases[baseName]); baseName = name; bases[name].addTo(map); bases[name].bringToBack(); store.set("base", name);
  // on the aerial photo the lanes are drawn brighter and the photo is toned down, or green lanes vanish into green fields
  // each base map has its own line colours (the --l-* variables in index.html), so lanes stay readable on all three
  document.documentElement.classList.toggle("sat", name === "Satellite"); document.documentElement.classList.toggle("topo", name === "Topo");
  restyleLanes?.(); restyleZones?.();
  document.querySelectorAll("#baseSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.base === name));
}
document.querySelectorAll("#baseSeg button").forEach(b => b.onclick = () => setBase(b.dataset.base));
setBase(baseName);

/* ---------- lanes: quiet until you pick them ---------- */
const DESIG = { byway_open_to_all_traffic: "BOAT", unclassified_county_road: "UCR", unsealed_unclassified_county_road: "UCR",
  unclassified_highway: "UCR", unmade_road: "Unmade road", restricted_byway: "Restricted byway" };
const CLASSES = {
  boat:   { color: "--boat",   weight: 3,   dash: null,  say: "Open to all traffic. Motorbikes allowed.", ride: true },
  ucr:    { color: "--ucr",    weight: 2.5, dash: null,  say: "Unclassified road. Usually open to motorbikes; check the TRF map.", ride: true },
  tro:    { color: "--ucr",    weight: 2.5, dash: "6 5", say: "OpenStreetMap notes a seasonal or part-time restriction. Check before riding.", ride: true },
  closed: { color: "--closed", weight: 2.5, dash: "2 6", say: "Recorded as closed to motor vehicles.", ride: false },
  rb:     { color: "--rb",     weight: 2,   dash: "2 6", say: "Restricted byway: no motor vehicles.", ride: false }
};
// Time rules in OpenStreetMap, e.g. "no @ (Oct 01-Apr 30)": closed for part of the year. Rules that only stop
// vehicles with more than two wheels don't apply to motorbikes. Returns null when there's no rule it can read.
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function seasonOf(t, today = window.PLAN_DATE ? new Date(window.PLAN_DATE) : new Date()){   // PLAN_DATE: generate ready-made routes as if in winter
  const c = t["motorcycle:conditional"] || t["motor_vehicle:conditional"]; if (!c) return null;
  if (/wheels\s*>\s*2|4x4|width|weight|length/i.test(c)) return { bikesOk: true };
  const m = c.match(/(\d{1,2})?\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})?\s*-\s*(\d{1,2})?\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})?/);
  if (!m || !(m[2].toLowerCase() in MON) || !(m[5].toLowerCase() in MON)) return null;
  const mb = MON[m[5].toLowerCase()], a = [MON[m[2].toLowerCase()], +(m[1] || m[3] || 1)], b = [mb, +(m[4] || m[6] || new Date(2001, mb + 1, 0).getDate())];
  const v = today.getMonth() * 100 + today.getDate(), va = a[0] * 100 + a[1], vb = b[0] * 100 + b[1];
  const openOnly = /^\s*yes\b/i.test(c);   // "yes @ (May-Sep)" means open only in that window
  let inside = va <= vb ? v >= va && v <= vb : v >= va || v <= vb;
  if (openOnly) inside = !inside;
  const ahead = new Date(today); ahead.setDate(ahead.getDate() + 14);
  const soon = !inside && seasonOf({ "motor_vehicle:conditional": c }, ahead)?.closedNow;
  const after = new Date(2001, b[0], b[1] + 1);
  return { closedNow: inside, soon, openOnly, text: `${a[1]} ${MONTH_NAME[a[0]]} to ${b[1]} ${MONTH_NAME[b[0]]}`,
    from: openOnly ? `${after.getDate()} ${MONTH_NAME[after.getMonth()]}` : `${a[1]} ${MONTH_NAME[a[0]]}` };
}
function classify(t){
  const no = v => ["no", "private", "forestry", "agricultural", "delivery", "permit"].includes(v);
  if (t.designation === "restricted_byway") return "rb";
  const openSeason = seasonOf(t);   // "no, but yes from April to October": in season it's open (with a warning), not closed
  if ((no(t.motor_vehicle) || no(t.motorcycle) || (no(t.access) && !t.motor_vehicle && !t.motorcycle)) && !(openSeason?.openOnly && !openSeason.closedNow)) return "closed";
  const txt = [t.note, t.description].join(" ").toLowerCase(), season = seasonOf(t);
  if (season?.closedNow) return "closed";
  const cond = (t["motor_vehicle:conditional"] || t["motorcycle:conditional"]) && !season?.bikesOk;
  if (cond || /\btro\b|traffic regulation|contested|disputed/.test(txt) || t.seasonal) return "tro";   // (a note that its status is disputed: check first)
  return t.designation === "byway_open_to_all_traffic" ? "boat" : "ucr";
}
const laneName = t => t.name || t.prow_ref || t.ref || (t.designation === "byway_open_to_all_traffic" ? "Unnamed byway" : "Unnamed lane");
const osmWays = new Map(), grid = new Map(), CELL = 0.1;
function cells(bb){
  const out = [];
  for (let i = Math.floor(bb[0]/CELL); i <= Math.floor(bb[2]/CELL); i++)
    for (let j = Math.floor(bb[1]/CELL); j <= Math.floor(bb[3]/CELL); j++) out.push(i + "," + j);
  return out;
}
// OpenStreetMap's surface words as a rider would write them: "mud;rocks" is "mud, rocks", "grade3" is "grade 3"
const surfTxt = t => [t.surface && t.surface.replace(/;/g, ", ").replace(/_/g, " "), t.tracktype && t.tracktype.replace(/^grade(\d)/, "grade $1")].filter(Boolean).join(", ");
function putWay(id, tags, coords){
  let a = 90, b = 180, c = -90, d = -180;
  for (const [la, lo] of coords) { if (la < a) a = la; if (lo < b) b = lo; if (la > c) c = la; if (lo > d) d = lo; }
  const council = window.COUNCIL_FLAGS?.ways?.[id] || null;   // the council's own record says it isn't a byway
  let closure = window.CLOSURES?.ways?.[id] || null;            // an authority's list of traffic orders closes it
  if (closure?.season) { tags = { ...tags, "motor_vehicle:conditional": `no @ (${closure.season})` }; closure = null; }   // a winter order: seasonal, not shut
  const w = { id, tags, coords, cls: council || closure ? "closed" : classify(tags), council, closure, season: seasonOf(tags), bbox: [a, b, c, d], len: lineLen(coords) };
  osmWays.set(id, w);
  for (const k of cells(w.bbox)) { if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(id); }
}
for (const [id, tags, f] of (window.OSM_LANES?.ways || [])) {
  const coords = []; let la = f[0], lo = f[1]; coords.push([la/1e5, lo/1e5]);
  for (let i = 2; i < f.length; i += 2) { la += f[i]; lo += f[i+1]; coords.push([la/1e5, lo/1e5]); }
  if (coords.length > 1) putWay(id, tags, coords);
}
// Byways in councils' own rights-of-way records that OpenStreetMap is missing (see checks/). They get negative ids.
let councilAdded = 0;
const councilSeen = new Set();   // some councils list the same byway twice under two numbers: keep one
(window.COUNCIL_BOATS?.ways || []).forEach(([ref, council, coords], i) => {
  if (coords.length < 2) return;
  const g = [coords[0], coords.at(-1)].map(c => c[0].toFixed(4) + "," + c[1].toFixed(4)).sort().join("|") + "|" + Math.round(lineLen(coords) / 20);
  if (councilSeen.has(g)) return; councilSeen.add(g);
  putWay(-(i + 1), { designation: "byway_open_to_all_traffic", name: `${council} byway ${ref.split("|").slice(1).join(" ")}`, source: "council", council }, coords);
  councilAdded++;
});
// OpenStreetMap splits a lane wherever its tags change (surface, a bridge, a new ref), so one lane can arrive as
// a dozen pieces. Join pieces end to end where exactly two of them meet, nothing else touches that point, both are
// the same kind of lane and their names don't disagree. Junctions where lanes fork stay split.
const osmPieces = osmWays.size - councilAdded, laneOf = new Map();
(function joinPieces(){
  const key = c => c[0].toFixed(5) + "," + c[1].toFixed(5), ends = new Map(), inner = new Set(), nb = new Map();
  for (const w of osmWays.values()) {
    for (const c of [w.coords[0], w.coords.at(-1)]) { const k = key(c); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(w.id); }
    for (let i = 1; i < w.coords.length - 1; i++) inner.add(key(w.coords[i]));
  }
  const link = (a, b) => { if (!nb.has(a)) nb.set(a, []); nb.get(a).push(b); };
  for (const [k, ids] of ends) {
    if (ids.length !== 2 || ids[0] === ids[1] || inner.has(k)) continue;
    const a = osmWays.get(ids[0]), b = osmWays.get(ids[1]);
    if (a.cls !== b.cls || (a.tags.name && b.tags.name && a.tags.name !== b.tags.name)) continue;
    link(a.id, b.id); link(b.id, a.id);
  }
  // Ends that nearly meet: council lines are traced from different maps, so they stop a few metres short of the
  // OpenStreetMap lane they continue, often across a road. Join free ends of the same kind within 40 m when a council
  // piece is involved (12 m between two OpenStreetMap pieces), if each is the other's nearest.
  const isCouncil = w => w.tags.source === "council", G = 0.0006, gk = c => Math.floor(c[0] / G) + "," + Math.floor(c[1] / (G * 1.6));
  const free = [], buckets = new Map();
  for (const [k, ids] of ends) {
    if (ids.length !== 1 || inner.has(k)) continue;
    const w = osmWays.get(ids[0]); if (!CLASSES[w.cls].ride) continue;
    const c = key(w.coords[0]) === k ? w.coords[0] : w.coords.at(-1), f = { w, c, i: free.length };
    free.push(f); const g = gk(c); if (!buckets.has(g)) buckets.set(g, []); buckets.get(g).push(f);
  }
  const nearest = f => {
    const [gi, gj] = gk(f.c).split(",").map(Number); let best = null, bd = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const g of buckets.get((gi + a) + "," + (gj + b)) || []) {
      if (g.w === f.w || g.w.cls !== f.w.cls) continue;
      const d = hav(f.c, g.c), tol = isCouncil(f.w) || isCouncil(g.w) ? 40 : 12;
      if (d > tol || d >= bd) continue;
      if (!isCouncil(f.w) && !isCouncil(g.w) && f.w.tags.name && g.w.tags.name && f.w.tags.name !== g.w.tags.name) continue;
      best = g; bd = d;
    }
    return best;
  };
  const nearOf = free.map(nearest);
  for (const f of free) {
    const g = nearOf[f.i]; if (!g || nearOf[g.i] !== f || f.i > g.i) continue;
    if ((nb.get(f.w.id) || []).includes(g.w.id)) continue;
    link(f.w.id, g.w.id); link(g.w.id, f.w.id);
  }
  const done = new Set();
  for (const id0 of [...nb.keys()]) {
    if (done.has(id0)) continue;
    // walk to one end of the chain (or all the way round a closed loop), then collect it from there
    let prev = null, cur = id0;
    for (let n = 0; n < 1000; n++) { const nx = (nb.get(cur) || []).find(x => x !== prev); if (nx == null || nx === id0) break; prev = cur; cur = nx; }
    const seq = [cur]; prev = null;
    for (let n = 0; n < 1000; n++) { const nx = (nb.get(cur) || []).find(x => x !== prev && !seq.includes(x)); if (nx == null) break; prev = cur; cur = nx; seq.push(nx); }
    seq.forEach(id => done.add(id));
    if (seq.length < 2) continue;
    const ws = seq.map(id => osmWays.get(id));
    // join by nearest ends; a gap (from a near-miss join) is bridged with a straight line
    let coords = ws[0].coords.slice();
    const k1 = ws[1].coords, dEnd = p => Math.min(hav(p, k1[0]), hav(p, k1.at(-1)));
    if (dEnd(coords[0]) < dEnd(coords.at(-1))) coords.reverse();
    for (const w of ws.slice(1)) {
      const last = coords.at(-1), c = hav(last, w.coords[0]) <= hav(last, w.coords.at(-1)) ? w.coords : w.coords.slice().reverse();
      coords = coords.concat(key(c[0]) === key(last) ? c.slice(1) : c);
    }
    const osm = ws.filter(w => !isCouncil(w)), pick = osm.length ? osm : ws;
    const longest = pick.reduce((a, b) => b.len > a.len ? b : a), tags = { ...longest.tags };
    tags.name = tags.name || pick.find(w => w.tags.name)?.tags.name;
    if (!tags.name) delete tags.name;
    if (osm.length && osm.length < ws.length) tags.partCouncil = ws.find(isCouncil).tags.council;   // some of it only in the council's record
    const surf = [...new Set(ws.map(w => w.tags.surface).filter(Boolean))];
    if (surf.length) tags.surface = surf.slice(0, 3).join(", ");
    for (const id of seq) { osmWays.delete(id); laneOf.set(id, seq[0]); }
    let a = 90, b = 180, c = -90, d = -180;
    for (const [la, lo] of coords) { if (la < a) a = la; if (lo < b) b = lo; if (la > c) c = la; if (lo > d) d = lo; }
    const search = [...new Set(ws.flatMap(w => [w.tags.name, w.tags.prow_ref, w.tags.ref]).filter(Boolean))].join(" | ").toLowerCase();
    osmWays.set(seq[0], { id: seq[0], members: seq, search, tags, coords, cls: longest.cls, council: ws.find(w => w.council)?.council || null, closure: ws.find(w => w.closure)?.closure || null, season: ws.find(w => w.season && !w.season.bikesOk)?.season || null, bbox: [a, b, c, d], len: lineLen(coords) });
  }
  grid.clear();
  for (const w of osmWays.values()) for (const k of cells(w.bbox)) { if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(w.id); }
})();
// A traffic order lists the pieces of a lane it closes, and the list can miss one: a lane whose two ends both meet
// pieces closed by the same order (Gorbeck Road, the middle 4.4 km) is taken to be closed by it too.
(function closeBetween(){
  const closedNear = p => { const out = new Set(), pad = 0.0005, bb = [p[0] - pad, p[1] - pad * 1.6, p[0] + pad, p[1] + pad * 1.6];
    for (const k of cells(bb)) for (const id of grid.get(k) || []) { const w = osmWays.get(id); if (w?.closure?.order && [w.coords[0], w.coords.at(-1)].some(q => hav(q, p) < 30)) out.add(w.closure.order); }
    return out; };
  const byName = new Map(); for (const w of osmWays.values()) if (w.closure?.order) byName.set(w.closure.order, w.closure);
  for (const w of osmWays.values()) {
    if (w.cls === "closed" || !CLASSES[w.cls]?.ride) continue;
    const a = closedNear(w.coords[0]), b = closedNear(w.coords.at(-1)), both = [...a].find(n => b.has(n));
    if (both) { w.closure = byName.get(both); w.cls = "closed"; }
  }
})();
$("#dataNote").textContent = `Lanes: ${osmPieces.toLocaleString()} pieces from OpenStreetMap (${window.OSM_LANES?.built || "date unknown"})` + (councilAdded ? ` and ${councilAdded.toLocaleString()} from council records` : "") + `, joined into ${osmWays.size.toLocaleString()} lanes.`;
const laneLayer = L.layerGroup().addTo(map);
const shown = new Set();
let fadeLanes = false;
// Lines use the base map's own colours (--l-boat etc.), strong enough to read in sun; closed lanes a little quieter.
// When a route or ideas are on screen the network steps back so they stand out.
function laneStyle(w){
  const c = CLASSES[w.cls], z = map.getZoom(), sat = baseName === "Satellite", shut = !c.ride;
  return { color: css(c.color.replace("--", "--l-")), weight: c.weight + (z >= 13 ? 1 : 0) + (sat ? 1.5 : 0) + (w.tags.source === "council" ? .5 : 0),
    dashArray: w.tags.source === "council" ? "12 6" : c.dash,
    opacity: fadeLanes ? (sat ? .4 : .25) : shut ? .65 : sat ? .95 : .8 };
}
function layerOf(w){
  if (!w.layer) w.layer = L.polyline(w.coords, laneStyle(w)).bindPopup(() => lanePopup(w), { maxWidth: 300 })
    .on("popupopen", () => highlightLane(w)).on("popupclose", () => highlightLane(null));
  return w.layer;
}
// While you look at a lane its whole length lights up, so you can see where it goes before adding it.
const highlightLayer = L.layerGroup().addTo(map);
function highlightMany(ws){   // gold under each lane for a few seconds, for "which line is it talking about?"
  highlightLayer.clearLayers();
  for (const w of ws) { L.polyline(w.coords, { color: "#ffd21f", weight: 12, opacity: .9, interactive: false, renderer: routeRenderer }).addTo(highlightLayer); L.polyline(w.coords, { color: css(CLASSES[w.cls].color.replace("--", "--l-")), weight: 4, interactive: false, renderer: routeRenderer }).addTo(highlightLayer); }
  clearTimeout(highlightMany.t); highlightMany.t = setTimeout(() => highlightLayer.clearLayers(), 6000);
}
function highlightLane(w){
  highlightLayer.clearLayers();
  if (!w) return;
  L.polyline(w.coords, { color: "#ffd21f", weight: 12, opacity: .9, interactive: false, renderer: routeRenderer }).addTo(highlightLayer);
  L.polyline(w.coords, { color: css(CLASSES[w.cls].color), weight: 4, opacity: 1, interactive: false, renderer: routeRenderer }).addTo(highlightLayer);
}
function distFromRoute(w){
  if (!trip.items.length) return null;
  const line = built ? built.segs.flatMap(s => s.coords) : trip.items.flatMap(it => it.coords);
  let best = Infinity;
  for (const p of [w.coords[0], w.coords.at(-1), w.coords[Math.floor(w.coords.length / 2)]])
    for (let i = 0; i < line.length; i += 3) best = Math.min(best, hav(p, line[i]));
  return best;
}
const laneVisible = w => w.cls === "boat" ? $("#tLanes").checked : CLASSES[w.cls].ride ? $("#tUcr").checked : $("#tClosed").checked;
let lastZoomBand = null;
function drawLanes(){
  const want = new Set(), z = map.getZoom();
  if (z >= 9) {
    const vb = map.getBounds().pad(0.2), bb = [vb.getSouth(), vb.getWest(), vb.getNorth(), vb.getEast()];
    for (const k of cells(bb)) for (const id of grid.get(k) || []) {
      const w = osmWays.get(id);
      if (w.bbox[2] < bb[0] || w.bbox[0] > bb[2] || w.bbox[3] < bb[1] || w.bbox[1] > bb[3]) continue;
      if (laneVisible(w)) want.add(id);
    }
  }
  for (const id of [...shown]) if (!want.has(id)) { laneLayer.removeLayer(osmWays.get(id).layer); shown.delete(id); }
  for (const id of want) if (!shown.has(id)) { laneLayer.addLayer(layerOf(osmWays.get(id))); shown.add(id); }
  const band = z >= 13;
  if (band !== lastZoomBand) { lastZoomBand = band; for (const id of shown) osmWays.get(id).layer.setStyle(laneStyle(osmWays.get(id))); }
}
function setFade(on){ if (fadeLanes === on) return; fadeLanes = on; for (const id of shown) osmWays.get(id).layer.setStyle(laneStyle(osmWays.get(id))); }
restyleLanes = () => { for (const id of shown) osmWays.get(id).layer.setStyle(laneStyle(osmWays.get(id))); };
const inRoute = id => trip.items.some(it => it.ids.some(i => i === id || laneOf.get(i) === id));
// Street View links from each end of a lane, facing up it, labelled by compass side so "north end" means something.
function endViews(c){
  const brg = (a, b) => { const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r); return (Math.atan2(y, x) / r + 360) % 360; };
  const into = (end, pts) => { let d = 0, p = pts[1] || end; for (let i = 1; i < pts.length && d < 120; i++) { d += hav(pts[i - 1], pts[i]); p = pts[i]; } return brg(end, p); };
  const a = c[0], b = c.at(-1), rev = c.slice().reverse(), ns = Math.abs(a[0] - b[0]) * 1.6 > Math.abs(a[1] - b[1]);
  const side = (p, q) => ns ? (p[0] > q[0] ? "north" : "south") : (p[1] > q[1] ? "east" : "west");
  const url = (p, h) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p[0].toFixed(6)},${p[1].toFixed(6)}&heading=${Math.round(h)}&pitch=0&fov=80`;
  return [{ side: side(a, b), url: url(a, into(a, c)) }, { side: side(b, a), url: url(b, into(b, rev)) }];
}
function lanePopup(w){
  const t = w.tags, c = CLASSES[w.cls], mid = w.coords[Math.floor(w.coords.length / 2)];
  const div = document.createElement("div");
  const surface = surfTxt(t);
  div.innerHTML = `<h3>${esc(laneName(t))}</h3>
    <div><span class="chip" style="background:${css(c.color)}">${esc(DESIG[t.designation] || "Byway")}</span> ${km(w.len)} km${surface ? " · " + esc(surface) : ""}</div>
    <p style="margin-top:6px">${esc(w.tags.source === "council" ? `From ${w.tags.council} Council's rights-of-way record, where it's a byway open to all traffic. It isn't in OpenStreetMap yet, so the line on the map may be rough.` : w.council ? `OpenStreetMap calls this a byway, but ${w.council.council} Council's rights-of-way record calls it a ${w.council.calls} (${w.council.ref.split("|").slice(1).join(" ")}). Treated as not open to motor vehicles.` : w.closure ? `Closed to ${w.closure.what} by a traffic regulation order${w.closure.since ? " since " + w.closure.since : ""} (${w.closure.order}). OpenStreetMap doesn't show this yet.`
      : w.season && !w.season.bikesOk ? `${w.season.openOnly ? `Open to motor vehicles only from ${w.season.text} each year` : `Closed to motor vehicles from ${w.season.text} each year`}${w.season.closedNow ? ", so it's closed now." : w.season.soon ? `. It closes on ${w.season.from}, within the next fortnight.` : ". Open now."}`
      : (w.cls === "tro" && /contested|disputed/i.test(t.note || "") ? "OpenStreetMap notes that whether it's open to motor vehicles is disputed. Check before riding." : c.say) + (t.partCouncil ? ` Part of it is only in ${t.partCouncil} Council's rights-of-way record, so that stretch of line may be rough.` : "") + (t.note ? ` OpenStreetMap's note on it: “${t.note}”` : ""))}</p>${w.closure ? `<p class="small"><a href="${esc(w.closure.url)}" target="_blank" rel="noopener">Source: ${esc(w.closure.source)}</a></p>` : ""}`;
  const away = view === "route" && !inRoute(w.id) ? distFromRoute(w) : null;
  if (away != null) div.insertAdjacentHTML("beforeend", `<p class="small muted">${away < 150 ? "Right next to your route." : `About ${km(away)} km from your route.`}</p>`);
  if (c.ride && view !== "tour") {
    const acts = document.createElement("div"); acts.className = "pop-actions";
    const b = document.createElement("button"); b.className = "btn " + (inRoute(w.id) ? "" : "primary");
    b.textContent = inRoute(w.id) ? "− Take out of route" : (trip.items.length ? "+ Add to route" : "+ Start a route with this lane");
    b.onclick = () => { map.closePopup(); if (view === "lanes" && !trip.items.length) routeFrom = { kind: "lanes" }; inRoute(w.id) ? removeLane(w.id) : addLane(w); };
    acts.append(b); div.append(acts);
  }
  // Google has no Street View along most lanes, so a link to the middle of one opens a black screen. Instead:
  // Geograph's photos nearest the middle (volunteers photograph tracks), Street View from the road at each end
  // looking up the lane, and the satellite map here.
  const [e1, e2] = endViews(w.coords);
  // how current the answer is, where the decision is made
  const asOf = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  div.insertAdjacentHTML("beforeend", `<p class="small muted">${t.source === "council" ? "From the council's record, checked 26 Sep 2026." : `OpenStreetMap data from ${asOf(window.OSM_LANES?.built || "2026-09-26")}.`}</p>`);
  // (with no signal, only what works without one: photos, aerial pictures and Street View all need it)
  const on = navigator.onLine;
  div.insertAdjacentHTML("beforeend", `<div class="pop-links">${on ? `
    <a href="https://www.geograph.org.uk/near/${mid[0].toFixed(5)},${mid[1].toFixed(5)}" target="_blank" rel="noopener">Photos near here</a>
    <a href="#" class="aerial">${baseName === "Satellite" ? "Normal map" : "Aerial view"}</a>
    <a href="${e1.url}" target="_blank" rel="noopener">Street View, ${e1.side} end</a>
    <a href="${e2.url}" target="_blank" rel="noopener">Street View, ${e2.side} end</a>` : ""}
    <a href="#" class="whole">Show the whole lane</a></div>`);
  const fitLane = () => fitMap(L.latLngBounds(w.coords).pad(0.4), { maxZoom: 16 });
  div.querySelector(".whole").onclick = e => { e.preventDefault(); fitLane(); };
  if (on) div.querySelector(".aerial").onclick = e => { e.preventDefault(); map.closePopup(); setBase(baseName === "Satellite" ? "Map" : "Satellite"); if (baseName === "Satellite") { fitLane(); highlightLane(w); setTimeout(() => highlightLane(null), 4000); } };
  return div;
}

/* ---------- lane areas: soft green shading where the lanes are, when zoomed out ----------
   Each 10 km square with lanes gets a faint circle sized by how much lane it holds; overlapping circles
   build up into darker patches, so the shading reads as areas rather than a grid of tiles. Plan screen only. */
map.createPane("zones"); Object.assign(map.getPane("zones").style, { zIndex: 350, pointerEvents: "none", filter: "blur(7px)" });
const zoneRenderer = L.canvas({ pane: "zones", padding: 0.3 });
const zoneLayer = L.layerGroup(), zoneSum = new Map();
const regionPinLayer = L.layerGroup(), regionRideLayer = L.layerGroup().addTo(map);
(function buildZones(){
  for (const w of osmWays.values()) {
    if (!CLASSES[w.cls].ride) continue;
    const m = w.coords[Math.floor(w.coords.length / 2)], k = Math.floor(m[0]/CELL) + "," + Math.floor(m[1]/CELL);
    zoneSum.set(k, (zoneSum.get(k) || 0) + w.len * (w.cls === "boat" ? 1 : 0.6));
  }
  for (const [k, s] of zoneSum) {
    if (s < 3000) continue;
    const [i, j] = k.split(",").map(Number), rich = Math.min(1, s / 25000);
    L.circle([(i + .5) * CELL, (j + .5) * CELL], { radius: 6000 + 3000 * rich, stroke: false, fillColor: css("--l-zone") || "#236b3a", fillOpacity: .10 + .28 * rich, interactive: false, renderer: zoneRenderer }).addTo(zoneLayer);
  }
})();
// The shading stays on while the lane lines are still too thin to read (to zoom 10), fading as they take over.
var restyleZones = () => { const c = css("--l-zone"); zoneLayer.eachLayer(l => l.setStyle({ fillColor: c })); };   // shading colour follows the base map
let hintDone = false, hintTimer = null, scotDone = false;   // the green-shading hint, and the Scotland one
function drawZones(){
  const z = map.getZoom(), browse = ["plan", "region", "lanes"].includes(view) || (view === "ideas" && lastKind === "draw");
  const on = $("#tZones").checked && z <= 10 && browse;
  on ? zoneLayer.addTo(map) : map.removeLayer(zoneLayer);
  map.getPane("zones").style.opacity = z <= 8 ? 1 : z <= 9 ? .6 : .35;
  if (view === "plan" && map.getZoom() <= 8) { if (typeof drawRegionPins === "function" && REGION_LIST.length) drawRegionPins(); regionPinLayer.addTo(map); } else map.removeLayer(regionPinLayer);
  $("#zoomHint").hidden = hintDone || !(on && z <= 8 && view === "plan" && !drawing && !picking && !(phone() && sheet.dataset.state === "open"));
  if (!$("#zoomHint").hidden && !hintTimer) hintTimer = setTimeout(() => { hintDone = true; $("#zoomHint").hidden = true; }, 6000);   // said once, then out of the way
  // Over Scotland there's no green shading at all, which looks like missing data: say why, and where its rides are
  const c = map.getCenter(), scot = c.lat > 55.8 || (c.lat > 55.05 && c.lng < -2.9);
  if (scot) $("#zoomHint").hidden = true;   // there's no shading to tap there
  $("#scotHint").hidden = scotDone || !(scot && z >= 6.5 && ["plan", "lanes"].includes(view) && !drawing && !picking && !(phone() && sheet.dataset.state === "open"));
}
$("#scotX").onclick = () => { scotDone = true; $("#scotHint").hidden = true; };
$("#scotGo").onclick = () => {
  const c = map.getCenter(), near = REGION_LIST.filter(r => r.country === "Scotland").sort((a, b) => hav([c.lat, c.lng], a.centre) - hav([c.lat, c.lng], b.centre))[0];
  scotDone = true; $("#scotHint").hidden = true; if (near) openRegion(near.slug);
};
// Tapping a green patch when zoomed out takes you in to see its lanes.
map.on("click", e => {
  if (picking || map.getZoom() > 8 || view !== "plan") return;
  const k = Math.floor(e.latlng.lat / CELL) + "," + Math.floor(e.latlng.lng / CELL);
  if ((zoneSum.get(k) || 0) > 3000) map.setView(e.latlng, 11);
});

/* ---------- stops: tea, food, toilets, fuel, beauty spots, places to stay (OpenStreetMap) ---------- */
// Old OS tourist-map style: a coloured disc with a plain white symbol, drawn as SVG so it looks the same everywhere.
const ICON = {
  mug: `<path d="M3 5h8v4.5A3.5 3.5 0 0 1 7.5 13h-1A3.5 3.5 0 0 1 3 9.5z" fill="#fff"/><path d="M11 6.2h1.3a1.8 1.8 0 0 1 0 3.6H11" stroke="#fff" stroke-width="1.5" fill="none"/>`,
  plate: `<circle cx="9.5" cy="8" r="4.3" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="9.5" cy="8" r="1.8" fill="#fff"/><path d="M3 2.5v11M2 2.5v3.5a1 1 0 0 0 2 0V2.5" stroke="#fff" stroke-width="1.1" fill="none"/>`,
  wc: `<text x="8" y="11.3" font-size="8.5" font-weight="800" text-anchor="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif">WC</text>`,
  pump: `<path d="M3 2.5h6.5v11H3z" fill="#fff"/><path d="M4.4 4h3.7v3H4.4z" fill="var(--pc)"/><path d="M9.5 6h1.3l1.4 1.4v4a1 1 0 0 0 2 0V6.3L12.5 4.5" stroke="#fff" stroke-width="1.3" fill="none"/>`,
  eye: `<path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="8" cy="8" r="2.1" fill="#fff"/>`,
  drop: `<path d="M8 2s-4.2 4.8-4.2 7.6a4.2 4.2 0 0 0 8.4 0C12.2 6.8 8 2 8 2z" fill="#fff"/>`,
  castle: `<path d="M2.5 13.5V4.5h2V6h1.5V4.5h2V6h1.5V4.5h2V6h1.5V4.5h2v9z" fill="#fff"/><path d="M7 13.5v-3h2v3z" fill="var(--pc)"/>`,
  tree: `<path d="M8 1.8l4.5 6.7H9.6v5.2H6.4V8.5H3.5z" fill="#fff"/>`,
  bed: `<path d="M2 12.5V4.5M2 9.5h12v3M14 9.5V8a1.5 1.5 0 0 0-1.5-1.5H7v3" stroke="#fff" stroke-width="1.6" fill="none"/><circle cx="4.6" cy="7.8" r="1.3" fill="#fff"/>`,
  tent: `<path d="M8 2.5L1.8 13.5h12.4z" fill="#fff"/><path d="M8 8l-2 5.5h4z" fill="var(--pc)"/>`
};
const GROUPS = {
  tea:    { label: "Tea",           color: "#8a5a2b", icon: "mug",   codes: ["cafe"],                          on: true },
  food:   { label: "Food",          color: "#c2410c", icon: "plate", codes: ["pub", "restaurant"],             on: false },
  wc:     { label: "Toilets",       color: "#1d4ed8", icon: "wc",    codes: ["toilet"],                        on: true },
  fuel:   { label: "Fuel",          color: "#b91c1c", icon: "pump",  codes: ["fuel"],                          on: true },
  beauty: { label: "Beauty spots",  color: "#0f766e", icon: "eye",   codes: ["view", "water", "castle", "picnic"], on: false },
  stay:   { label: "Places to stay", color: "#6d28d9", icon: "bed",  codes: ["hotel", "guest", "hostel", "camp"], on: false }
};
const CODE = {
  cafe: { g: "tea", one: "Café", sym: "Restaurant" }, pub: { g: "food", one: "Pub", sym: "Bar" }, restaurant: { g: "food", one: "Restaurant", sym: "Restaurant" },
  toilet: { g: "wc", one: "Toilets", sym: "Restroom" }, fuel: { g: "fuel", one: "Fuel", sym: "Gas Station" },
  view: { g: "beauty", one: "Viewpoint", sym: "Scenic Area", icon: "eye" }, water: { g: "beauty", one: "Waterfall", sym: "Scenic Area", icon: "drop" },
  castle: { g: "beauty", one: "Castle", sym: "Museum", icon: "castle" }, picnic: { g: "beauty", one: "Picnic spot", sym: "Picnic Area", icon: "tree" },
  hotel: { g: "stay", one: "Hotel", sym: "Lodging" }, guest: { g: "stay", one: "Guest house or B&B", sym: "Lodging" },
  hostel: { g: "stay", one: "Hostel", sym: "Lodging" }, camp: { g: "stay", one: "Campsite", sym: "Campground", icon: "tent" }
};
const savedOn = store.get("poiOn", null); if (savedOn) for (const k in savedOn) if (GROUPS[k]) GROUPS[k].on = savedOn[k];
const poiBadge = code => { const g = GROUPS[CODE[code]?.g || code] || GROUPS.tea, ic = CODE[code]?.icon || g.icon; return `<span class="poi" style="background:${g.color};--pc:${g.color}"><svg viewBox="0 0 16 16" aria-hidden="true">${ICON[ic]}</svg></span>`; };
const groupOn = code => GROUPS[CODE[code].g].on;
let stops = null, stopGrid = null, stopsLoading = null;
const SCELL = 0.05;
function loadStops(){
  if (stops) return Promise.resolve(stops);
  if (!stopsLoading) stopsLoading = loadScript("data/stops.js").then(() => {
    stops = STOPS.stops.map(r => ({ lat: r[0] / 1e4, lng: r[1] / 1e4, code: STOPS.codes[r[2]], name: r[3], extra: r[4] }));
    stopGrid = new Map();
    stops.forEach((s, i) => { const k = Math.floor(s.lat / SCELL) + "," + Math.floor(s.lng / SCELL); if (!stopGrid.has(k)) stopGrid.set(k, []); stopGrid.get(k).push(i); });
    return stops;
  }).catch(() => { stopsLoading = null; status("Couldn't load the stops file"); return null; });
  return stopsLoading;
}
function stopsNear(p, rCells = 1){
  const i0 = Math.floor(p[0] / SCELL), j0 = Math.floor(p[1] / SCELL), out = [];
  for (let i = i0 - rCells; i <= i0 + rCells; i++) for (let j = j0 - rCells; j <= j0 + rCells; j++) for (const k of stopGrid.get(i + "," + j) || []) out.push(k);
  return out;
}
const stopName = s => s.name || CODE[s.code].one;
function stopPopup(s){
  const web = CODE[s.code].g === "stay" && /^https?:\/\//.test(s.extra) ? `<a href="${esc(s.extra)}" target="_blank" rel="noopener">Website</a>` : "";
  const info = CODE[s.code].g === "stay" ? "" : s.extra;
  const div = document.createElement("div");
  div.innerHTML = `<h3 style="display:flex;gap:8px;align-items:center">${poiBadge(s.code)} ${esc(stopName(s))}</h3><div class="muted">${esc(CODE[s.code].one)}${info ? " · " + esc(info) : ""}</div>
    <div class="pop-links">${web}<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((s.name ? s.name + " " : "") )}${s.lat.toFixed(5)},${s.lng.toFixed(5)}" target="_blank" rel="noopener">Google Maps: reviews and hours</a></div>`;
  // a stop can go into the route you're building: the road is sent through it, and it becomes a waypoint in the GPX
  if (trip.items.length && view !== "tour" && view !== "ideas") {
    const here = trip.items.some(it => it.stop && hav(it.coords[0], [s.lat, s.lng]) < 5);
    const b = document.createElement("button"); b.className = "btn " + (here ? "" : "primary"); b.style.marginTop = "8px"; b.style.width = "100%";
    b.textContent = here ? "− Take out of route" : "+ Add to route";
    b.onclick = () => { map.closePopup(); here ? removeItem(trip.items.findIndex(it => it.stop && hav(it.coords[0], [s.lat, s.lng]) < 5)) : addStop(s); if (view !== "route") showView("route", "peek"); };
    div.insertBefore(b, div.querySelector(".pop-links"));
  } else if (!trip.items.length && view !== "tour") {   // no route yet: a café or a campsite is a good place to start one
    const b = document.createElement("button"); b.className = "btn primary"; b.style.marginTop = "8px"; b.style.width = "100%";
    b.textContent = "⟲ Plan a loop from here";
    b.onclick = () => { map.closePopup(); lastKind = "loop"; ideas = []; picked = -1; ideaRun++; openIdeas(); setLoopStart([s.lat, s.lng], stopName(s)); };
    div.insertBefore(b, div.querySelector(".pop-links"));
  }
  return div;
}
const itemStop = s => ({ via: true, stop: { code: s.code }, ids: [], name: stopName(s), kind: CODE[s.code].one, cls: "via", coords: [[s.lat, s.lng]] });
// Put a stop where it adds the least riding: between the two points of the route it sits closest to.
function addStop(s){
  const p = [s.lat, s.lng], n = trip.items.length; let best = n, bc = Infinity;
  for (let pos = 0; pos <= n; pos++) {
    const prev = pos === 0 ? trip.start : trip.items[pos - 1].coords.at(-1);
    const next = pos === n ? (trip.finish || (trip.loop ? trip.start : null)) : trip.items[pos].coords[0];
    const c = prev && next ? hav(prev, p) + hav(p, next) - hav(prev, next) : prev ? hav(prev, p) : next ? hav(p, next) : 0;
    if (c < bc) { bc = c; best = pos; }
  }
  insertAt(best, itemStop(s)); status(`Added ${stopName(s)} to the route`);
}
const pinIcon = (code, small) => L.divIcon({ className: "", html: `<div class="poi-pin${small ? " small" : ""}">${poiBadge(code)}</div>`, iconSize: [0, 0] });
const stopLayer = L.layerGroup().addTo(map), routeStopLayer = L.layerGroup().addTo(map);
let routeStopIdx = new Set();
const groupBadge = g => `<span class="poi" style="background:${g.color};--pc:${g.color}"><svg viewBox="0 0 16 16" aria-hidden="true">${ICON[g.icon]}</svg></span>`;
// Stops are only worth showing where someone riding lanes would use them. At most one of each kind per patch of
// screen (smaller patches as you zoom in, every place from zoom 16), each at a real place you can tap. No counts:
// "38 cafés here" doesn't help anyone choose one.
function drawPicked(layer, idxs, rank){
  const z = map.getZoom(), px = z >= 16 ? 0 : z >= 15 ? 56 : z >= 14 ? 80 : 110, best = new Map();
  for (const i of idxs) {
    const s = stops[i], pt = map.latLngToLayerPoint([s.lat, s.lng]);
    const key = px ? CODE[s.code].g + ":" + Math.floor(pt.x / px) + ":" + Math.floor(pt.y / px) : "i" + i;
    const sc = rank(i), cur = best.get(key); if (!cur || sc < cur.sc) best.set(key, { i, sc });
  }
  for (const { i } of best.values()) {
    const s = stops[i];
    const m = L.marker([s.lat, s.lng], { icon: pinIcon(s.code, z < 13), keyboard: false, title: stopName(s) }).bindPopup(() => stopPopup(s)).addTo(layer);
    // close in, say what each place is, so you don't have to tap every icon to find the café
    if (z >= 15 && s.name) m.bindTooltip(s.name.length > 22 ? s.name.slice(0, 21) + "…" : s.name, { permanent: true, direction: "right", offset: [13, 0], className: "stop-label" });
  }
}
// Squares of about 1 km that have a ridable lane in them or next to them (two squares out for fuel), built once.
let laneNearCells = null, laneNearFuel = null;
const NCELL = 0.01, nkey = (la, lo) => Math.floor(la / NCELL) + "," + Math.floor(lo / NCELL);
function nearLane(s){
  if (!laneNearCells) {
    const base = new Set(); laneNearCells = new Set(); laneNearFuel = new Set();
    for (const w of osmWays.values()) if (CLASSES[w.cls].ride) for (const c of w.coords) base.add(nkey(c[0], c[1]));
    for (const k of base) { const [i, j] = k.split(",").map(Number);
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const kk = (i + a) + "," + (j + b); laneNearFuel.add(kk); if (Math.abs(a) <= 1 && Math.abs(b) <= 1) laneNearCells.add(kk); } }
  }
  return (s.code === "fuel" ? laneNearFuel : laneNearCells).has(nkey(s.lat, s.lng));
}
function drawStops(){
  // a stop whose popup is open stays put (the map slides to show the popup, which would otherwise redraw it away)
  const open = map._popup?.isOpen() && map._popup._source; if (open && stopLayer.hasLayer(open)) return;
  stopLayer.clearLayers();
  // browsing: near lanes, from town level. With a route or tour, its own stops do the work and the rest only
  // show close in (zoom 15), so you can drag the route onto one.
  const minZ = view === "route" || view === "tour" ? 15 : 13;
  if (!Object.values(GROUPS).some(g => g.on) || map.getZoom() < minZ) return;
  if (!stops) { loadStops().then(s => s && drawStops()); return; }
  const b = map.getBounds().pad(0.05), idxs = [];
  for (let i = Math.floor(b.getSouth()/SCELL); i <= Math.floor(b.getNorth()/SCELL); i++)
    for (let j = Math.floor(b.getWest()/SCELL); j <= Math.floor(b.getEast()/SCELL); j++)
      for (const k of stopGrid.get(i + "," + j) || []) { const s = stops[k]; if (!routeStopIdx.has(k) && groupOn(s.code) && b.contains([s.lat, s.lng]) && (map.getZoom() >= 15 || nearLane(s))) idxs.push(k); }   // close in, every one (a café in a village away from the lanes)
  drawPicked(stopLayer, idxs, k => stops[k].name ? 0 : 1);
}
// The Show menu: one compact button showing the symbols that are on; it opens a tick-list.
function renderPoiMenu(){
  const on = Object.values(GROUPS).filter(g => g.on);
  $("#poiIcons").innerHTML = on.length ? on.map(groupBadge).join("") : `<span class="muted">nothing</span>`;
  const menu = $("#poiMenu"); menu.innerHTML = "";
  for (const g of Object.values(GROUPS)) {
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="checkbox" ${g.on ? "checked" : ""}>${groupBadge(g)}<span>${esc(g.label)}</span>`;
    lab.querySelector("input").onchange = e => {
      g.on = e.target.checked; store.set("poiOn", Object.fromEntries(Object.entries(GROUPS).map(([a, x]) => [a, x.on])));
      renderPoiMenu(); $("#poiMenu").hidden = false; drawStops(); drawRouteStops(); renderStops();
      if (g.on && !stops) loadStops().then(() => { drawStops(); if (built) findRouteStops(); });
      else if (g.on && map.getZoom() < 13 && !routeStopIdx.size) status("Zoom in near some lanes to see them", 3500);
    };
    menu.append(lab);
  }
  menu.insertAdjacentHTML("beforeend", `<p class="small muted">Shown near lanes when you zoom in, and along your route. The ones ticked also go into the GPX.</p>`);
}
// One top-corner menu at a time, and on a phone the panel goes down so the menu isn't behind it
$("#poiBtn").onclick = e => {
  e.stopPropagation(); const m = $("#poiMenu"), opening = m.hidden;
  if (opening) { $("#layersPop").hidden = true; closeSearch(); if (phone() && sheet.dataset.state !== "min") setSheet("min"); navPush(); }
  m.hidden = !opening; $("#poiBtn").setAttribute("aria-expanded", opening);
};
document.addEventListener("click", e => { if (!e.target.closest("#poiWrap")) { $("#poiMenu").hidden = true; $("#poiBtn").setAttribute("aria-expanded", "false"); } });
renderPoiMenu();

/* ---------- old lane notes (bywaydatabase.com, frozen 2012) ---------- */
const notesLayer = L.layerGroup();
async function showNotes(on){
  if (!on) { map.removeLayer(notesLayer); return; }
  if (!window.QWERF_LANES) { try { await loadScript("data/qwerf-lanes.js"); } catch { status("Couldn't load the old notes"); return; } }
  if (!notesLayer.getLayers().length) for (const f of QWERF_LANES.features) {
    const p = f.properties, c = f.geometry.coordinates.map(([x, y]) => [y, x]);
    if (hav(c[0], c.at(-1)) > 8000) continue;
    const html = `<h3>${esc(p.name)}</h3><div class="muted">Notes from 2012, bywaydatabase.com</div>
      ${p.hazards?.length ? `<p>Expect: ${p.hazards.map(esc).join(", ")}</p>` : ""}${p.notes ? `<p style="margin-top:4px">${esc(p.notes)}</p>` : ""}
      ${p.recommended ? "<p><b>Recommended by the author.</b></p>" : ""}<div class="pop-links"><a href="${esc(p.url)}" target="_blank" rel="noopener">Full page and video</a></div>
      <p class="small muted" style="margin-top:6px">These notes are 14 years old. Use them for what a lane is like, not whether it's open.</p>`;
    L.polyline(c, { color: "#7b2cbf", weight: 3, dashArray: "4 6" }).bindPopup(html).addTo(notesLayer);
  }
  notesLayer.addTo(map);
}

/* ---------- your own files ---------- */
const FILE_COLORS = ["#0e7490", "#7c3aed", "#b45309", "#0f766e"];
let fileCount = 0;
function addFile(name, text){
  let parsed; try { parsed = parseFile(name, text); } catch { status(`Couldn't read ${name}`); return; }
  if (!parsed.lines.length && !parsed.points.length) { status(`${name} has no tracks or points I can read`); return; }
  const color = FILE_COLORS[fileCount++ % FILE_COLORS.length], grp = L.featureGroup();
  parsed.lines.forEach(ln => L.polyline(ln.coords, { color, weight: 4, opacity: .8 }).bindPopup(() => {
    const d = document.createElement("div");
    d.innerHTML = `<h3>${esc(ln.name)}</h3><div class="muted">${km(lineLen(ln.coords))} km, from ${esc(name)}</div>`;
    const b = document.createElement("button"); b.className = "btn primary"; b.style.marginTop = "10px"; b.textContent = "+ Add this line to route";
    b.onclick = () => { map.closePopup(); addItem({ ids: [], name: ln.name, kind: "Your file", cls: "file", coords: ln.coords.slice() }); };
    d.append(b); return d;
  }).addTo(grp));
  parsed.points.forEach(p => L.circleMarker(p.at, { radius: 5, color, fillOpacity: .9 }).bindTooltip(esc(p.name)).addTo(grp));
  grp.addTo(map); if (phone()) setSheet("min"); fitMap(grp.getBounds());
  status(`Loaded ${name}: ${parsed.lines.length} line${parsed.lines.length === 1 ? "" : "s"}, ${parsed.points.length} point${parsed.points.length === 1 ? "" : "s"}`);
  const li = document.createElement("li");
  li.innerHTML = `<span class="grow"><span class="t" style="color:${color}">${esc(name)}</span><br><span class="s">${parsed.lines.length} lines, ${parsed.points.length} points</span></span>`;
  const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", "Remove " + name);
  x.onclick = () => { map.removeLayer(grp); li.remove(); };
  li.append(x); $("#fileList").append(li);
}
$("#file").onchange = e => { for (const f of e.target.files) f.text().then(t => addFile(f.name, t)); e.target.value = ""; };
document.getElementById("map").addEventListener("dragover", e => e.preventDefault());
document.getElementById("map").addEventListener("drop", e => { e.preventDefault(); for (const f of e.dataTransfer.files) f.text().then(t => addFile(f.name, t)); });

/* ---------- settings ---------- */
const settings = Object.assign({ hours: 4, mix: 25, twisty: 60, width: 5, useUcr: true, dayHours: 6, days: null, sleep: { hotel: true, guest: true, hostel: true, camp: false } }, store.get("settings", {}));
const saveSettings = () => store.set("settings", settings);
function syncSettings(){
  $("#hVal").textContent = settings.hours + " h";
  $("#mix").value = settings.mix; $("#twisty").value = settings.twisty; $("#twisty2").value = settings.twisty;
  $("#width").value = settings.width; $("#widthVal").textContent = settings.width + " km";
  document.querySelectorAll(".laneKind button").forEach(b => b.setAttribute("aria-pressed", (b.dataset.k === "all") === settings.useUcr));
  $("#dhVal").textContent = settings.dayHours + " h"; $("#dVal").textContent = settings.days ? settings.days : "Auto";
}
syncSettings();
const tw = () => settings.twisty / 100;
const LANE_KMH = 15;
const roadKmh = () => 45 - 7 * tw();           // twisty back roads are a bit slower
const twistF = () => 1 + 0.15 * tw();          // and a little longer than the quickest road (measured: 0-70% longer, usually ~0 in the lowlands)
const hoursOf = (laneM, roadM) => laneM / 1000 / LANE_KMH + roadM / 1000 / roadKmh();
const mixToWr = m => 0.3 * Math.pow(8, m / 100);
function stepHours(d){ settings.hours = Math.min(8, Math.max(1, settings.hours + d)); saveSettings(); syncSettings(); replanSoon(); }
$("#hMinus").onclick = () => stepHours(-0.5);
$("#hPlus").onclick = () => stepHours(0.5);
$("#mix").onchange = e => { settings.mix = +e.target.value; saveSettings(); replanSoon(); };
$("#width").oninput = e => { $("#widthVal").textContent = e.target.value + " km"; };
$("#width").onchange = e => { settings.width = +e.target.value; saveSettings(); replanSoon(); };
// Lanes to use: byways and unclassified roads, or byways only. Saved in this browser like every setting.
document.querySelectorAll(".laneKind button").forEach(b => b.onclick = () => {
  settings.useUcr = b.dataset.k === "all"; saveSettings(); syncSettings();
  if (view === "route") {
    renderRoute(); buildSoon(300);
    // on a route, this setting governs lanes you add from now on and the joins between lanes; say so if nothing changes
    const amber = trip.items.filter(it => it.cls === "ucr" || (it.cls === "tro" && it.kind !== "BOAT")).length;   // (a byway with a seasonal order is still a byway)
    if (!settings.useUcr) status(amber ? `This route has ${amber} unclassified road${amber > 1 ? "s" : ""}: use the button below to take ${amber > 1 ? "them" : "it"} out.` : "This route already uses byways only. New lanes and joins will be byways too.", 4000);
  } else replanSoon();
});
for (const id of ["twisty", "twisty2"]) $("#" + id).onchange = e => { settings.twisty = +e.target.value; saveSettings(); syncSettings(); if (view === "route") buildSoon(); else replanSoon(); };

/* ---------- views and the phone sheet ---------- */
let view = "plan";
const sheet = $("#sheet");
const PEEK = { plan: 300, region: 330, ideas: 176, route: 206, tour: 206, lanes: 250 };
// On a phone the panel has three positions: a collapsed bar, a preview, and full height.
// The preview is the short peek on Explore and the area page, and half height on the working screens.
const previewState = () => view === "start" ? "open" : "mid";   // one preview height everywhere, so moving between screens doesn't move the panel; Plan is a menu, all four choices in view
const SHEET_ORDER = () => ["min", previewState(), "open"];
// The panel's heights in pixels, from the screen you can actually see (Safari's toolbar makes vh units too tall).
// Full height always stops below the corner buttons and the panel's own tab, so there is always something to grab.
let safeTop = 0;
{ const pr = document.createElement("div"); pr.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none"; document.body.append(pr); safeTop = pr.getBoundingClientRect().height; pr.remove(); }
function sheetHeights(){
  const tb = document.documentElement.classList.contains("tabs-on") ? $("#tabbar").getBoundingClientRect().height : 0;
  const room = innerHeight - tb - safeTop - 96;   // 10 + 48 (corner buttons) + 10 + 28 (the tab)
  return { min: 54, peek: Math.min(PEEK[view] || 176, room * 0.62), mid: Math.min(innerHeight * 0.5, room * 0.8), open: room, tb };
}
L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(10, 72), autoPanPaddingBottomRight: L.point(10, 10) });
function setSheet(state){
  if (state === "peek" || state === "mid") state = previewState();
  const prevState = sheet.dataset.state;
  if (phone() && state !== "min" && state !== sheet.dataset.state) map.closePopup();   // a popup has no room once the panel comes up
  sheet.dataset.state = state;
  if (phone() && state === "open") $("#layersPop").hidden = true;
  // a phone on its side: "lowered" means the side panel folds away, anything else opens it
  if (sideAuto()) setSide(state !== "min");
  const H = sheetHeights(), px = Math.round(H[state] ?? H.peek);
  if (phone()) { sheet.style.height = px + "px"; sheet.style.bottom = H.tb ? H.tb - 2 + "px" : ""; } else sheet.style.height = sheet.style.bottom = "";   // flush on the tab bar, no strip of map between
  const h = phone() ? `${px + H.tb}px` : "0px";   // everything on the map sits above the panel and the tab bar under it
  L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(10, 72 + safeTop);
  L.Popup.prototype.options.autoPanPaddingBottomRight = L.point(phone() ? 10 : 44, phone() ? px + H.tb + 10 : 10);   // beside a side panel, clear of its fold tab
  // a short screen (Saved with little in it) doesn't need the full height: stop at its content
  // (only Saved: other screens fill in after they open, e.g. ideas, and a panel cut short then would hide them)
  if (phone() && state !== "min" && view === "saved") requestAnimationFrame(() => {
    // (the body stretches to fill the panel, so add up what's showing in it rather than asking its height)
    const body = $("#sheetBody"), cs = getComputedStyle(body), kids = [...body.children].filter(e => e.offsetParent !== null);
    const content = kids.reduce((a, e) => a + e.offsetHeight, 0) + (parseFloat(cs.rowGap) || 0) * Math.max(0, kids.length - 1) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const need = content + $("#sheetHandle").offsetHeight + 12;
    if (need < px - 40) { const hh = Math.max(150, need); sheet.style.height = hh + "px"; document.documentElement.style.setProperty("--sheet-h", hh + H.tb + "px"); if (state !== "open") document.documentElement.style.setProperty("--sheet-ctl", hh + H.tb + "px"); }
  });

  document.documentElement.style.setProperty("--sheet-h", h);
  if (!$("#undoBar").hidden) requestAnimationFrame(() => { const top = phone() ? sheet.getBoundingClientRect().top : 0; $("#undoBar").style.bottom = top > 180 ? `${innerHeight - top + 10}px` : ""; });
  // map credits and the zoom hint tuck behind the panel when it's fully open, instead of floating near the top
  document.documentElement.style.setProperty("--sheet-ctl", state === "open" ? "0px" : h);
  if (typeof drawZones === "function" && view) drawZones();
  $("#handleText").textContent = state === "open" ? "▾ Show the map" : state === "min" ? "▲ " + minLabel() : "▲ Pull up for more";
  $("#sheetHandle").setAttribute("aria-label", $("#handleText").textContent.replace(/^[▲▼]\s*/, ""));
}
// What the collapsed bar says, so it reads as something to open rather than a clipped panel.
function minLabel(){
  if (view === "region") return $("#regionName").textContent || "Area";
  if (view === "ideas") return ideas.length ? `${ideas.length} route idea${ideas.length > 1 ? "s" : ""} ready` : "Route ideas";
  if (view === "lanes") return "Find lanes";
  if (view === "start") return "Plan a ride";
  if (view === "saved") return "Saved";
  if (view === "help") return "Help";
  if (view === "route") return (trip.name || "Your route") + (built ? ` · ${km(built.total)} km` : "");
  if (view === "tour") return tour?.name || "Tour";
  return "Where to ride";
}
// The side panel folds away to give the map the whole width, and comes back with the tab on its edge
function setSide(open){
  const was = !document.documentElement.classList.contains("side-hidden");
  document.documentElement.classList.toggle("side-hidden", !open);
  $("#sideToggle").textContent = open ? "▶" : "◀"; $("#sideToggle").setAttribute("aria-label", open ? "Hide the panel" : "Show the panel"); $("#sideToggle").setAttribute("aria-expanded", open);
  if (was !== open) setTimeout(() => map.invalidateSize(), 0);
}
$("#sideToggle").onclick = () => { const open = document.documentElement.classList.contains("side-hidden"); setSide(open); if (sideAuto()) sheet.dataset.state = open ? previewState() : "min";
  if (lastFit && ["route", "ideas", "tour", "region"].includes(view)) setTimeout(() => fitMap(lastFit.b, lastFit.o), 60); };
// turning the phone, or Safari's toolbar coming and going, changes the room: re-size the panel to fit
let lastPhone = phone();
let refitTimer = null, wasWide = innerWidth > innerHeight;
function relayout(){
  const p = phone(), turned = p !== lastPhone || innerWidth > innerHeight !== wasWide; wasWide = innerWidth > innerHeight;
  if (p) document.documentElement.classList.remove("side-hidden");
  if (p !== lastPhone) { lastPhone = p; setTimeout(() => map.invalidateSize(), 0); }
  setSheet(sheet.dataset.state || "peek");
  // after the phone turns, fit the last route or area again once the new layout has settled
  if (turned && lastFit && !(typeof Ride !== "undefined" && Ride.on)) { clearTimeout(refitTimer); refitTimer = setTimeout(() => { map.invalidateSize(); fitMap(lastFit.b, lastFit.o); }, 250); }
}
addEventListener("resize", relayout);
visualViewport?.addEventListener("resize", relayout);
function stepSheet(dir){ const o = SHEET_ORDER(), i = Math.max(0, o.indexOf(sheet.dataset.state)); setSheet(o[Math.min(o.length - 1, Math.max(0, i + dir))]); }
// Swipe the handle up or down to move between positions; a tap moves up one, or back to the preview from full.
// The panel follows your finger while you drag its tab, then settles at the nearest position; a tap moves it up a step.
let handleY = null, startH = 0;
$("#sheetHandle").addEventListener("pointerdown", e => { handleY = e.clientY; startH = sheet.getBoundingClientRect().height; $("#sheetHandle").setPointerCapture?.(e.pointerId); });
$("#sheetHandle").addEventListener("pointermove", e => {
  if (handleY == null || !phone()) return; const dy = e.clientY - handleY; if (Math.abs(dy) < 6) return;
  sheet.classList.add("dragging"); sheet.style.height = Math.max(54, Math.min(sheetHeights().open, startH - dy)) + "px";
});
$("#sheetHandle").addEventListener("pointerup", e => {
  if (handleY == null) return; const dy = e.clientY - handleY; handleY = null;
  const dragged = sheet.classList.contains("dragging"); sheet.classList.remove("dragging");
  if (dragged) {   // settle on whichever position is nearest to where it was let go, leaning the way it was moving
    const H = sheetHeights(), h = sheet.getBoundingClientRect().height + (dy < 0 ? 40 : -40);   // lean the way it was moving
    const opts = SHEET_ORDER().map(st => [st, H[st]]);
    setSheet(opts.reduce((a, o) => Math.abs(o[1] - h) < Math.abs(a[1] - h) ? o : a)[0]); return;
  }
  if (dy < -25) stepSheet(1); else if (dy > 25) stepSheet(-1);
  else sheet.dataset.state === "open" ? setSheet("min") : stepSheet(1);   // a tap: up a step, or from full height down to the bar
});
$("#sheetHandle").addEventListener("pointercancel", () => { handleY = null; sheet.classList.remove("dragging"); setSheet(sheet.dataset.state); });
// Swiping the panel's content down when it's already scrolled to the top lowers the panel, as in any phone app
// (touch events, because the browser's own scrolling cancels pointer events on a real phone; the mouse for testing)
let bodyY = null, bodyTop = 0;
const swipeStart = (y, target) => { if (!phone() || target.closest("input,select,textarea,.wl-strip,#ideaList")) return; bodyY = y; bodyTop = $("#sheetBody").scrollTop; };
const swipeEnd = y => { if (bodyY == null) return; const dy = y - bodyY; bodyY = null; if (bodyTop <= 0 && $("#sheetBody").scrollTop <= 0 && dy > 70) stepSheet(-1); };
$("#sheetBody").addEventListener("touchstart", e => swipeStart(e.touches[0].clientY, e.target), { passive: true });
$("#sheetBody").addEventListener("touchend", e => swipeEnd(e.changedTouches[0].clientY), { passive: true });
$("#sheetBody").addEventListener("pointerdown", e => { if (e.pointerType === "mouse" && e.button === 0) swipeStart(e.clientY, e.target); });
$("#sheetBody").addEventListener("pointerup", e => { if (e.pointerType === "mouse") swipeEnd(e.clientY); });
// once the panel's content scrolls, the tab casts a shadow, so the content reads as sliding under it
$("#sheetBody").addEventListener("scroll", () => sheet.classList.toggle("scrolled", $("#sheetBody").scrollTop > 2), { passive: true });
// Moving the map on a phone tucks the panel away so the map gets the screen.
map.on("dragstart", () => { lastFit = null; if (phone() && !drawing && !picking && sheet.dataset.state !== "min" && !(typeof Ride !== "undefined" && Ride.on)) setSheet("min"); });   // you've moved the map: nothing is refitted over it
let lastBrowse = "plan";   // the tab screen you were on before a doing screen, where its back arrow returns
function goBack(){ if (lastBrowse === "region" && regionOpen) openRegion(regionOpen); else showView(lastBrowse, lastBrowse === "plan" ? "peek" : "mid"); }
const TAB_OF = { plan: "explore", region: "explore", start: "plan", saved: "saved", help: "help" };
const TAB_VIEW = { explore: "plan", plan: "start", saved: "saved", help: "help" };
document.querySelectorAll("#tabbar button").forEach(b => b.onclick = () => {
  if (b.dataset.tab === "home") { stopModes(); welcomeFromHome = true; navPush(); showWelcome(); return; }   // back to the start screen
  const v = TAB_VIEW[b.dataset.tab]; stopModes();
  if (v === "plan" && view !== "plan") setTimeout(showBritain, 30);
  showView(v, v === "plan" ? "peek" : "mid");
});
function showView(v, sheetState){
  if (v !== view) { navPush(); lastFit = null; }   // a new screen fits its own things
  view = v;
  // browsing screens show the tab bar; doing screens (ideas, route, tour, lanes) have their own back arrow instead
  const tab = TAB_OF[v]; if (tab) lastBrowse = v;
  document.documentElement.classList.toggle("tabs-on", !!tab);
  document.querySelectorAll("#tabbar button").forEach(b => b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  for (const [id, name] of [["vPlan", "plan"], ["vStart", "start"], ["vSaved", "saved"], ["vHelp", "help"], ["vLanes", "lanes"], ["vRegion", "region"], ["vIdeas", "ideas"], ["vRoute", "route"], ["vTour", "tour"]]) $("#" + id).hidden = v !== name;
  if (v !== "region") regionRideLayer.clearLayers();
  $("#newConfirm").hidden = true;
  document.documentElement.style.setProperty("--sheet-peek", PEEK[v] + "px");
  setFade(v === "ideas" || v === "tour");
  if (v !== "ideas") { ideaLayer.clearLayers(); sketchLayer.clearLayers(); }
  if (v !== "tour") tourLayer.clearLayers();
  if (v === "route") { drawRoute(); } else routeLayer.clearLayers();
  setSheet(sheetState || sheet.dataset.state || previewState());
  $("#sheetBody").scrollTop = 0;
  if (v === "plan") renderExplore();
  if (v === "saved") renderSaved();
  drawRouteStops(); drawStops(); drawZones();
}

/* ---------- picking a spot / drawing a route in strokes ---------- */
let picking = null, drawing = false, painting = null, liveLine = null, loopStart = null, lastKind = null, drawWhenZoomed = false;
let strokes = store.get("strokes", []), shapeChoice = null;       // the drawn route is a list of finger strokes; shape is auto unless chosen
const sketchLayer = L.layerGroup().addTo(map);
function setBanner(text, opts = {}){
  $("#banner").hidden = !text; $("#bannerText").textContent = text || "";
  document.body.classList.toggle("banner-on", !!text);   // the instruction gets the top of the map to itself
  $("#bannerMe").hidden = !opts.me; $("#bannerMove").hidden = !opts.draw; $("#bannerUndo").hidden = !opts.draw || !strokes.length; $("#bannerDone").hidden = !opts.draw;
  $("#bannerCancel").hidden = false;   // every mode can be left
  $("#zoomHint").hidden = true;
}
function stopModes(){
  drawWhenZoomed = false;
  picking = null; drawing = false; painting = null; document.body.classList.remove("drawing");
  if (liveLine) { map.removeLayer(liveLine); liveLine = null; }
  map.dragging.enable(); map.getContainer().style.cursor = ""; map.getContainer().style.touchAction = "";
  setBanner(null); drawZones(); $("#bannerSearch").hidden = true;
}
function pickSpot(text, then){
  stopModes(); picking = then; map.getContainer().style.cursor = "crosshair";
  const compact = phone() || innerHeight <= 500;   // search is a corner button here, hidden while the banner shows, so the banner has its own
  setBanner(text + (compact ? ", or search" : ", or search above"), { me: true }); setSheet(phone() || sideAuto() ? "min" : "peek");   // give the map the screen while you choose
  $("#bannerSearch").hidden = !compact;
  if (map.getZoom() < 9) status("Zoom in a little so you can tap the right spot", 6000);
}
$("#bannerCancel").onclick = () => {
  const wasDrawing = drawing || drawWhenZoomed; stopModes(); status("");
  if (view === "ideas" && lastKind === "loop" && !loopStart) { $("#ideasBack").click(); return; }   // no start chosen: back to where you came from
  if (wasDrawing && !strokes.length && view === "ideas") { $("#ideasBack").click(); return; }   // drawing nothing: back to where you came from
  if (phone() && sheet.dataset.state === "min") setSheet(previewState());   // choosing was cancelled: the panel comes back
};
$("#bannerSearch").onclick = openSearch;
$("#bannerMe").onclick = () => { const then = picking; locate(p => { stopModes(); then?.(p); }); };
// Choosing a spot: a tap anywhere sets it, including on a lane or a stop (whose popup would otherwise open).
// Zoomed right out a tap is kilometres out, or in the sea, so it zooms in on that spot first.
function pickAt(ll){
  if (map.getZoom() < 9) { map.setView(ll, 11); status("Now tap the exact spot", 4000); return; }
  const then = picking; stopModes(); highlightLane(null); then([ll.lat, ll.lng]);   // a lane tapped to set the spot isn't picked
}
map.on("click", e => { if (picking) pickAt(e.latlng); });
// A long press on the map: start a loop there, or make it where your route starts
map.on("contextmenu", e => {
  if (drawing || (typeof Ride !== "undefined" && Ride.on)) return;
  if (picking) { pickAt(e.latlng); return; }
  const at = [e.latlng.lat, e.latlng.lng], div = document.createElement("div");
  div.innerHTML = `<h3>This spot</h3>`;
  const btn = (label, go, primary) => { const b = document.createElement("button"); b.className = "btn" + (primary ? " primary" : ""); b.style.cssText = "width:100%;margin-top:8px"; b.textContent = label; b.onclick = () => { map.closePopup(); go(); }; div.append(b); };
  btn("⟲ Plan a loop from here", () => { lastKind = "loop"; ideas = []; picked = -1; ideaRun++; openIdeas(); setLoopStart(at); }, true);
  if (trip.items.length && editingDay == null) btn("⚑ Start my route here", () => { trip.start = at; built = null; saveTrip(); showView("route", "mid"); renderRoute(); tidyNow(); });
  L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent(div).openOn(map);
});
// a double tap to zoom starts with a tap, which opens whatever lane or stop is under the finger: shut it again
let popupAt = 0; map.on("popupopen", () => { popupAt = Date.now(); });
map.on("dblclick", () => { if (Date.now() - popupAt < 600) map.closePopup(); });
map.on("popupopen", e => { if (!picking) return; const ll = e.popup.getLatLng(); map.closePopup(); if (ll) pickAt(ll); });

// Loop from a place: set the start, then the ideas and all the controls stay on one screen.
$("#goLoop").onclick = () => {
  lastKind = "loop"; ideas = []; picked = -1; ideaRun++;
  openIdeas();
  // a place you've just searched for is the obvious start
  if (searchPin && map.getBounds().contains(searchPin.getLatLng())) { const at = searchPin.getLatLng(); setLoopStart([at.lat, at.lng], searchPin.options.title); }
  else if (loopStart) runIdeas(); else pickSpot("Tap the map where you'll start", setLoopStart);
};
$("#changeStart").onclick = () => pickSpot("Tap the map where you'll start", setLoopStart);
let loopStartName = "";
// The start is named so you can see where it is without finding the flag: from the search if you used it, or looked up.
function setLoopStart(p, name){
  if (searchPin) { map.removeLayer(searchPin); searchPin = null; }   // the start flag replaces the search pin
  if (sideAuto()) setSheet("mid");
  loopStart = p; loopStartName = name || ""; drawSketch(); setIdeasUi(); runIdeas();
  if (!name) placeName(p).then(n => { if (loopStart === p && n) { loopStartName = n; setIdeasUi(); } });
}

// Draw a route: as many strokes as you like; lift your finger, move the map, carry on.
$("#goDraw").onclick = () => { lastKind = "draw"; ideas = []; picked = -1; ideaRun++; openIdeas(); if (!strokes.length) startDrawing(); else runIdeas(); };
$("#drawMore").onclick = () => startDrawing();
// Drawing needs the lanes on screen, so it waits until you've zoomed in far enough to see them.
function startDrawing(){
  stopModes();
  setSheet(phone() || sideAuto() ? "min" : "peek");
  if (map.getZoom() < 10) {
    drawWhenZoomed = true; drawZones();
    setBanner("Zoom in to where you want to ride, or search. Drawing starts when the lanes show.", { wait: true });
    $("#bannerSearch").hidden = false; return;
  }
  drawWhenZoomed = false; drawing = true; map.dragging.disable(); document.body.classList.add("drawing");
  map.getContainer().style.cursor = "crosshair"; map.getContainer().style.touchAction = "none";
  setBanner(strokes.length ? "Keep drawing, or press Done." : "Draw roughly where you want to go. Lift and draw again to add more.", { draw: true });
}
map.on("zoomend", () => { if (drawWhenZoomed && map.getZoom() >= 10) startDrawing(); });
$("#bannerMove").onclick = () => {   // pause drawing so the map can be moved, then carry on
  if (drawing) { drawing = false; map.dragging.enable(); map.getContainer().style.cursor = ""; map.getContainer().style.touchAction = ""; $("#bannerMove").textContent = "✎ Draw again"; $("#bannerText").textContent = "Move the map, then press Draw again."; }
  else { $("#bannerMove").textContent = "✋ Move map"; startDrawing(); }
};
$("#bannerUndo").onclick = () => { strokes.pop(); drawSketch(); setBanner($("#bannerText").textContent, { draw: true }); };
$("#bannerDone").onclick = () => {
  if (!strokes.length) { status("Nothing drawn yet: draw a line on the map with your finger", 4000); return; }
  $("#bannerMove").textContent = "✋ Move map"; stopModes(); setIdeasUi(); if (sideAuto()) setSheet("mid"); runIdeas();
};
$("#undoStroke").onclick = () => { strokes.pop(); drawSketch(); setIdeasUi(); strokes.length ? replanSoon() : clearIdeas(); };
$("#clearStrokes").onclick = () => { strokes = []; shapeChoice = null; drawSketch(); setIdeasUi(); clearIdeas(); };
document.querySelectorAll("#shapeSeg button").forEach(b => b.onclick = () => { shapeChoice = b.dataset.shape; drawSketch(); setIdeasUi(); replanSoon(); });
const mapEl = map.getContainer();
const fingers = new Set();   // two fingers on the map while drawing are a pinch to zoom, not a line
mapEl.addEventListener("pointerdown", ev => { fingers.add(ev.pointerId); if (fingers.size > 1 && painting) { painting = null; if (liveLine) { map.removeLayer(liveLine); liveLine = null; } } }, true);
["pointerup", "pointercancel"].forEach(t => mapEl.addEventListener(t, ev => fingers.delete(ev.pointerId), true));
mapEl.addEventListener("pointerdown", ev => {
  if (!drawing || ev.button > 0 || fingers.size > 1) return;
  if (ev.target.closest?.(".leaflet-control, .mapui, button, #sheet")) return;   // the zoom buttons and the banner still work
  ev.preventDefault(); ev.stopPropagation(); mapEl.setPointerCapture?.(ev.pointerId);
  painting = [map.mouseEventToLatLng(ev)];
  liveLine = L.polyline(painting, { color: "#c2185b", weight: 10, opacity: .45, lineCap: "round", interactive: false, renderer: routeRenderer }).addTo(map);
}, true);
mapEl.addEventListener("pointermove", ev => {
  if (!painting) return; ev.preventDefault();
  const ll = map.mouseEventToLatLng(ev);
  if (map.latLngToContainerPoint(painting.at(-1)).distanceTo(map.latLngToContainerPoint(ll)) > 4) { painting.push(ll); liveLine.setLatLngs(painting); }
}, true);
mapEl.addEventListener("pointerup", () => {
  if (!painting) return;
  const pts = painting.map(p => [p.lat, p.lng]); painting = null;
  if (liveLine) { map.removeLayer(liveLine); liveLine = null; }
  if (lineLen(pts) < 200) { status("That was too short to use: draw a longer line", 3000); return; }
  strokes.push(thin(pts, 60)); drawSketch(); setIdeasUi(); status("");
  setBanner("Keep drawing, or press Done.", { draw: true });
}, true);
// The strokes joined up, in order. A route that ends near where it began is a loop unless you say otherwise.
function drawnLine(){ return strokes.flat(); }
function drawnShape(){
  const l = drawnLine(); if (l.length < 2) return "line";
  if (shapeChoice) return shapeChoice;
  return hav(l[0], l.at(-1)) < Math.max(3000, lineLen(l) * 0.2) ? "loop" : "line";
}
function drawnSketch(){ const l = drawnLine(); if (l.length < 2) return null; return drawnShape() === "loop" ? thin([...l, l[0]], 60) : thin(l, 60); }
const flagShift = p => { const c = map.latLngToContainerPoint(p), w = map.getSize().x; return c.x < 70 ? "translate(8px,-50%)" : c.x > w - 70 ? "translate(calc(-100% - 8px),-50%)" : ""; };
const flag = (p, t, bg) => L.marker(p, { interactive: false, zIndexOffset: 2000, icon: L.divIcon({ className: "", html: `<span class="flag" style="background:${bg || "#1f1d18"};${flagShift(p) ? "transform:" + flagShift(p) : ""}">${t}</span>`, iconSize: [0, 0] }) });
function drawSketch(){
  sketchLayer.clearLayers(); store.set("strokes", strokes);   // a drawing survives the app being closed
  if (lastKind === "draw" && strokes.length) {
    const l = drawnLine(), loop = drawnShape() === "loop";
    for (const st of strokes) L.polyline(st, { color: "#c2185b", weight: 12, opacity: .2, lineCap: "round", interactive: false, renderer: routeRenderer }).addTo(sketchLayer);
    for (let i = 1; i < strokes.length; i++) L.polyline([strokes[i - 1].at(-1), strokes[i][0]], { color: "#c2185b", weight: 3, opacity: .45, dashArray: "4 6", interactive: false, renderer: routeRenderer }).addTo(sketchLayer);
    if (loop) L.polyline([l.at(-1), l[0]], { color: "#c2185b", weight: 3, opacity: .45, dashArray: "4 6", interactive: false, renderer: routeRenderer }).addTo(sketchLayer);
    flag(l[0], loop ? "START / FINISH" : "START").addTo(sketchLayer); if (!loop) flag(l.at(-1), "FINISH").addTo(sketchLayer);
  }
  if (lastKind === "loop" && loopStart) flag(loopStart, "START").addTo(sketchLayer);
}
const meLayer = L.layerGroup().addTo(map);
function locate(then){
  if (!navigator.geolocation) { status("This browser can't share your location"); return; }
  status("Finding you…", 0);
  navigator.geolocation.getCurrentPosition(p => {
    const at = [p.coords.latitude, p.coords.longitude];
    meLayer.clearLayers();
    if (p.coords.accuracy < 3000) L.circle(at, { radius: p.coords.accuracy, color: "#1a73e8", weight: 1, fillOpacity: .1, interactive: false }).addTo(meLayer);
    L.marker(at, { interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [0, 0], html: '<div class="me-dot"></div>' }) }).addTo(meLayer);
    map.setView(at, Math.max(map.getZoom(), 12)); status(""); then?.(at);
  },
    () => status("Couldn't get your location. Search for a place instead."), { enableHighAccuracy: false, timeout: 10000 });
}
$("#btnLocate").onclick = () => locate();

/* ---------- checking plans against real roads ---------- */
// Real road distances between lanes from one OSRM request: A, lane1 start, lane1 end, lane2 start … B.
async function osrmLegs(sk, chain){
  const pts = [sk[0]]; for (const n of chain) pts.push(n.a, n.b); pts.push(isLoop(sk) ? sk[0] : sk.at(-1));
  const url = "https://router.project-osrm.org/route/v1/driving/" + pts.map(p => p[1].toFixed(5) + "," + p[0].toFixed(5)).join(";") + "?overview=false&steps=true&geometries=geojson";
  const r = await polite("osrm", url);
  if (!r.ok) return null;
  try {
    const d = JSON.parse(r.text); if (d.code !== "Ok") return null;
    const legs = d.routes[0].legs.filter((_, i) => i % 2 === 0);
    return { pts, dist: legs.map(l => l.distance), snap: d.waypoints.map(w => w.distance),
      geom: legs.map(l => { const g = []; for (const st of l.steps) for (const [x, y] of st.geometry.coordinates) g.push([y, x]); return g; }) };
  } catch { return null; }
}
// Plan along one sketch and fit it to the ride time. The detour weight is found by bisection (planAlong is
// fast), so the plan uses the time available rather than overshooting. Each real-road check (at most
// `passes` requests) corrects the estimate, drops lanes whose ends are more than 100 m from a road or only
// join the long way round, and plans again.
async function fitPlan(sk, widthM, wr0, targetH, alive, passes = 3){
  const exclude = new Set(), tf = twistF(), limit = targetH * 1.05;
  let scale = 1, best = null, plan = null;
  const est = wr => { const p = planAlong(sk, widthM, wr, settings.useUcr, exclude); return { p, h: hoursOf(p.laneM, p.roadM * tf) * scale }; };
  const fit = () => {
    const lo = wr0 * 0.6;                       // may use spare time for a few more lanes than the slider asks
    let r = est(lo); if (r.h <= limit) return r;
    let a = lo, b = lo * 2, rb = est(b);
    while (rb.h > limit && b < 80) { a = b; b *= 2; rb = est(b); }
    for (let i = 0; i < 8; i++) { const m = Math.sqrt(a * b), rm = est(m); if (rm.h <= limit) { b = m; rb = rm; } else a = m; }
    return rb;
  };
  for (let pass = 0; pass < passes; pass++) {
    const r = fit(); plan = r.p;
    if (!plan.chain.length || !alive()) break;
    const rl = (await localLegs(sk, plan.chain)) || (await osrmLegs(sk, plan.chain));
    if (!alive()) return null;
    if (!rl) break;
    const estH = hoursOf(plan.laneM, plan.roadM * tf);
    plan.roadM = rl.dist.reduce((x, y) => x + y, 0); plan.roadGeom = rl.geom; plan.checked = true;
    const realH = hoursOf(plan.laneM, plan.roadM);   // measured on the twisty roads themselves now, so no allowance
    scale = Math.max(0.6, Math.min(2.5, realH / (estH || 1)));
    const ends = rl.pts, last = plan.chain.length, bad = new Set();
    rl.dist.forEach((m, k) => {
      const h = hav(ends[2*k], ends[2*k+1]);
      if (h > 25) { if (k > 0 && rl.snap[2*k] > 100) bad.add(k - 1); if (k < last && rl.snap[2*k+1] > 100) bad.add(k); }
      if (m > 3000 && m / (h + 1000) > 2.5) bad.add(Math.min(k, last - 1));
    });
    // a lane only reached by ferry (the mainland, seen from the Isle of Wight) is across the water: the lanes after
    // an odd number of ferry crossings are on the far side
    // (not for a drawing: a line drawn across the water means it)
    if (rl.ferry && lastKind !== "draw") { let across = false; rl.ferry.forEach((f, k) => { if (f) across = !across; if (across && k < last) bad.add(k); }); }
    const fits = realH <= targetH * 1.15;
    if (bad.size) {   // keep this plan minus the lanes that don't connect, then try again without them
      const keep = plan.chain.filter((_, k) => !bad.has(k)), lost = plan.chain.filter((_, k) => bad.has(k)).reduce((t, n) => t + n.len, 0);
      const trimmed = { ...plan, chain: keep, laneM: plan.laneM - lost, roadGeom: null };
      if (fits && (!best || trimmed.laneM > best.laneM)) best = trimmed;
      for (const k of bad) exclude.add(plan.chain[k].w.id);
      continue;
    }
    if (fits && (!best || plan.laneM > best.laneM)) best = { ...plan };
    if (fits && realH >= targetH * 0.8) break;
  }
  const out = best || (plan && plan.chain.length ? { ...plan } : { chain: [], laneM: 0, roadM: 0 });
  return { ...out, sketch: sk };
}

/* ---------- route ideas: one screen with the controls and the ideas, re-planned as you change things ---------- */
const ideaLayer = L.layerGroup().addTo(map);
const IDEA_COLORS = ["#c2185b", "#1d4ed8", "#9a3412"];   // pink, blue, rust: clear of the lane greens, amber and red, and of each other
let ideas = [], picked = -1, ideaRun = 0, replanTimer;
function replanSoon(){ if (view !== "ideas" || !lastKind) return; clearTimeout(replanTimer); replanTimer = setTimeout(() => { if (lastKind === "loop" ? loopStart : strokes.length) runIdeas(); }, 600); }
function placeSettings(where){
  if (where === "tour") { $("#tourSettingsSlot").append($("#settings")); $("#timeRow").hidden = true; $("#widthSetting").hidden = true; }
  else { $("#settingsSlot").append($("#settings")); $("#timeRow").hidden = false; $("#widthSetting").hidden = lastKind !== "draw"; }
}
function setIdeasUi(){
  const loop = lastKind === "loop";
  $("#ideasTitle").textContent = loop ? "Loop from a place" : "Draw a route";
  $("#loopCtl").hidden = !loop; $("#drawCtl").hidden = loop;
  $("#startText").textContent = loopStart ? `✓ Start: ${loopStartName || "set"}` : "No start yet";
  $("#changeStart").textContent = loopStart ? "Change start" : "Set start";
  const shape = drawnShape();
  document.querySelectorAll("#shapeSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.shape === shape));
  $("#undoStroke").disabled = !strokes.length; $("#clearStrokes").disabled = !strokes.length;
  $("#drawMore").textContent = strokes.length ? "✎ Draw more" : "✎ Draw";
  if (lastKind === "draw" && strokes.length && !ideas.length) $("#ideasNote").textContent = drawing ? "Press Done when you've finished drawing." : "";
  placeSettings("ideas");
}
// what a back link says: the screen it returns to
function backLabel(){ return lastBrowse === "region" && regionOpen && regionBySlug(regionOpen) ? `← ${regionBySlug(regionOpen).name}` : `← ${{ plan: "Explore", start: "Plan", saved: "Saved", help: "Help" }[lastBrowse] || "Back"}`; }
function openIdeas(){ showView("ideas", "mid"); $("#ideasBack").textContent = backLabel(); setIdeasUi(); drawSketch(); renderIdeas(lastKind === "loop" && !loopStart ? "Tap the map to set your start." : lastKind === "draw" && !strokes.length ? "Draw on the map to start." : ""); }
function clearIdeas(){ ideaRun++; ideas = []; picked = -1; renderIdeas(lastKind === "draw" ? "Draw on the map to start." : ""); }
let ideasUpdating = false;   // new ideas are being worked out: the old cards stay, dimmed, until the first new one arrives
async function runIdeas(){
  const run = ++ideaRun, alive = () => run === ideaRun;
  ideasUpdating = ideas.length > 0 || ideasUpdating; ideas = []; picked = -1;
  if (view !== "ideas") showView("ideas", "mid");
  setIdeasUi();
  const wr = mixToWr(settings.mix), target = settings.hours;
  if (lastKind === "draw") {
    const sk = drawnSketch(); if (!sk) { renderIdeas("Draw on the map to start."); return; }
    renderIdeas("Finding lanes along your route…");
    // keeping to the line, lanes come from close to it (2 km at most), so the shape isn't pulled out of true
    const r = await fitPlan(sk, (settings.followLine !== false ? Math.min(settings.width, 2) : settings.width) * 1000, wr, target, alive);
    if (!alive()) return;
    ideasUpdating = false;
    // no lanes along it: keeping to the line, it's still a ride on the roads you drew (Scotland, a lap of a lake)
    const roadOnly = r && !r.chain.length && settings.followLine !== false;
    if (r && (r.chain.length || roadOnly)) ideas.push({ ...r, ...(roadOnly ? { roadM: lineLen(sk) * 1.2, laneM: 0, roadGeom: null, checked: false } : {}), name: drawnShape() === "loop" ? "Your loop" : "Your route", color: IDEA_COLORS[0] });
    picked = ideas.length ? 0 : -1;
    renderIdeas(ideas.length ? "" : `No lanes within ${settings.width} km of what you drew. Look for lanes further out, or draw somewhere else.`);
    if (!ideas.length && phone()) setSheet("mid");   // the message is in the panel: bring it up so it's seen
    if (ideas.length) fitTo(ideas[0]);
    return;
  }
  if (!loopStart) { renderIdeas("Tap the map to set your start."); return; }
  renderIdeas("Finding lanes near your start…");
  const share = 0.45 - 0.35 * settings.mix / 100;
  const distM = target * 1000 / (share / LANE_KMH + (1 - share) / roadKmh());
  const perim = distM / (1.25 * twistF()), radius = Math.max(2500, perim / (2 * Math.PI));
  const width = Math.min(5000, Math.max(1500, radius * 0.4));
  await sleep(20);
  const chosen = pickLoops(loopStart, perim, radius, width, wr, settings.useUcr);
  for (const [k, e] of chosen.entries()) {
    renderIdeas(`Checking roads for idea ${k + 1} of ${chosen.length}…`);
    let r = null, sk = e.sk;
    for (let tries = 0; tries < 2; tries++) {
      r = await fitPlan(sk, width, wr, target, alive);
      if (!r || !alive()) return;
      if (!r.chain.length || hoursOf(r.laneM, r.roadM * (r.checked ? 1 : twistF())) <= target * 1.2) break;
      sk = e.sk.map(p => [loopStart[0] + (p[0] - loopStart[0]) * 0.7, loopStart[1] + (p[1] - loopStart[1]) * 0.7]);
    }
    if (r.chain.length) { ideasUpdating = false; ideas.push({ ...r, name: `Loop heading ${e.name}`, color: IDEA_COLORS[ideas.length] }); }
    if (picked < 0 && ideas.length) { picked = 0; fitTo(ideas[0]); }
    renderIdeas(k < chosen.length - 1 ? `Checking roads for idea ${k + 2} of ${chosen.length}…` : "");
  }
  ideasUpdating = false;
  const inScot = loopStart[0] > 55.8 || (loopStart[0] > 55.05 && loopStart[1] < -2.9);
  if (!ideas.length) { renderIdeas(inScot ? "Scotland has no byways open to motor vehicles, so there are no lanes to make a loop from. Its rides are road rides: see West Highlands, Cairngorms, Argyll or the Borders under Explore." : "No lanes close enough to this start. Try a longer ride time, or start somewhere else."); if (phone() && sheet.dataset.state === "min") setSheet("mid"); }
}
// Zoom to something while leaving it clear of what covers the map on a phone: the search bar and Show button at the
// top, the Map/Me/Help buttons down the right, and the panel at the bottom at whatever height it is now.
function showBritain(){
  // on a short strip of map the whole of Britain would be a speck in Europe: keep it at a readable size, centred on England
  const b = L.latLngBounds(GB_BOUNDS), p = fitPad(), z = map.getBoundsZoom(b, false, L.point(p.paddingTopLeft).add(p.paddingBottomRight));
  const floor = phone() ? 4.75 : 5;
  if (z >= floor) return fitMap(b, {});
  const regions = window.REGIONS || [];   // (REGION_LIST isn't set yet when this runs at start-up)
  if (!phone() || !regions.length) return viewAt([53.6, -2.4], floor);
  // Centre the area pins, north to south, in the strip between the corner buttons and the panel, so the northern
  // pins aren't under Search/Show and the southern ones aren't behind the panel.
  // (on a small screen they may not all fit; zooming out further makes them overlap, so the ends are partly covered)
  const lats = regions.map(r => r.centre[0]), top = 95, bottom = Math.max(top + 60, sheet.getBoundingClientRect().top - 36), zf = floor;
  const yN = map.project([Math.max(...lats), -2.4], zf).y, yS = map.project([Math.min(...lats), -2.4], zf).y;
  const cy = (yN + yS) / 2 + map.getSize().y / 2 - (top + bottom) / 2;
  // (no animation: at start-up a zoom still running would finish later and undo whatever the map shows by then)
  map.setView(map.unproject([map.project([53.6, -2.4], zf).x, cy], zf), zf, { animate: false });
}
// a place in the middle of the part of the map you can see (on a phone the panel covers the bottom)
function viewAt(ll, z){
  if (!phone()) return map.setView(ll, z);
  const H = sheetHeights(), dy = ((H[sheet.dataset.state] ?? H.peek) + H.tb - 70) / 2;
  map.setView(map.unproject(map.project(ll, z).add([0, dy]), z), z);
}
// Fit the map to something in the part of the map you can see: below the corner buttons and above the panel.
// The last fit is remembered, so turning the phone (or folding the side panel) fits the same thing again.
let lastFit = null, refitAfter = null;
// the padding that keeps a fit in the part of the map you can see
function fitPad(){
  if (!phone()) return { paddingTopLeft: [30, 80], paddingBottomRight: [30, 20] };
  const H = sheetHeights(), st = sheet.dataset.state === "open" ? "mid" : sheet.dataset.state;
  const h = Math.min((H[st] ?? H.peek) + H.tb, innerHeight - 84 - safeTop - 160);   // never fit into less than 160px of map
  return { paddingTopLeft: [30, 84 + safeTop], paddingBottomRight: [30, h + 20] };
}
function fitMap(b, o = {}){
  lastFit = { b, o };
  map.fitBounds(b, { ...o, ...fitPad() });
}
function fitTo(idea){   // the loop itself (its lanes, its roads and the start), not the wider circle it was searched in
  const pts = [idea.sketch[0], ...idea.chain.flatMap(n => [n.a, n.b]), ...(idea.roadGeom || []).flat()];
  if (lastKind === "draw") pts.push(...idea.sketch);
  fitMap(L.latLngBounds(pts).pad(0.05), {});
}
function drawChain(layer, it, on, color){
  // the chosen idea is drawn bold with a dark outline; the others drop right back so it's obvious which one you're looking at
  const R = routeRenderer, line = (c, o) => L.polyline(c, { interactive: false, renderer: R, ...o }).addTo(layer);
  const roads = it.roadGeom ? it.roadGeom.filter(g => g.length > 1) : (() => { const out = []; let p = it.sketch[0]; for (const n of it.chain) { out.push([p, n.a]); p = n.b; } return out; })();
  for (const g of roads) {
    if (on) line(g, { color: "#fff", weight: 8, opacity: .9 });
    line(g, { color, weight: on ? 4 : 2.5, opacity: on ? 1 : .4, dashArray: on ? "9 6" : "5 7" });
  }
  for (const n of it.chain) {
    if (on) { line(n.coords, { color: "#1f1d18", weight: 13, opacity: .9 }); line(n.coords, { color: "#fff", weight: 10, opacity: 1 }); }
    line(n.coords, { color, weight: on ? 7 : 4, opacity: on ? 1 : .5 });
  }
}
function renderIdeas(msg){
  if (ideasUpdating && !ideas.length) {
    $("#ideaList").classList.add("updating"); $("#ideasNote").textContent = msg || "";
    ideaLayer.eachLayer(l => { l.setStyle?.({ opacity: .3 }); l.setOpacity?.(.35); });
    if (sheet.dataset.state === "min") $("#handleText").textContent = "▲ Finding route ideas…";
    return;
  }
  $("#ideaList").classList.remove("updating");
  if (sheet.dataset.state === "min") $("#handleText").textContent = "▲ " + minLabel();
  ideaLayer.clearLayers();
  $("#ideasNote").textContent = msg || (ideas.length ? `Change anything above and the ideas update. Times assume ${LANE_KMH} km/h on lanes and about ${Math.round(roadKmh())} km/h on roads.` : "");
  const order = ideas.map((_, i) => i).filter(i => i !== picked); if (picked >= 0) order.push(picked);
  for (const i of order) drawChain(ideaLayer, ideas[i], i === picked, ideas[i].color);
  // a numbered badge in each idea's colour, matching its card; tap one to pick it
  for (const i of order) {
    const it = ideas[i], n = it.chain[Math.floor(it.chain.length / 2)]; if (!n) continue;
    const at = n.coords[Math.floor(n.coords.length / 2)];
    L.marker(at, { zIndexOffset: i === picked ? 1000 : 0, title: it.name, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="ibadge${i === picked ? " on" : ""}" style="--c:${it.color}">${i + 1}</span>` }) })
      .on("click", () => { picked = i; renderIdeas(msg); }).addTo(ideaLayer);
  }
  const box = $("#ideaList"); box.innerHTML = "";
  ideas.forEach((it, i) => {
    const roadM = it.roadM * (it.checked ? 1 : twistF()), tot = it.laneM + roadM, boats = it.chain.filter(n => n.w.cls === "boat").length;
    const card = document.createElement("div"); card.className = "card"; card.style.setProperty("--c", it.color);
    card.setAttribute("aria-current", i === picked ? "true" : "false");
    card.innerHTML = `<div class="top"><h3><span class="inum">${i + 1}</span>${esc(it.name)}${i === picked ? `<span class="onmap">On the map</span>` : ""}</h3></div>
      <div class="stats"><span><b>${hm(hoursOf(it.laneM, roadM))}</b> riding</span><span><b>${km(tot)}</b> km</span><span><b>${Math.round(100 * it.laneM / tot)}%</b> lanes (${km(it.laneM)} km)</span><span><b>${it.chain.length}</b> lanes${boats === it.chain.length ? ", all byways" : boats ? `, ${boats} byways` : ""}</span></div>`;
    const go = document.createElement("button"); go.className = "btn primary"; go.textContent = "Ride this";
    go.onclick = ev => { ev.stopPropagation(); useIdea(i); };
    card.querySelector(".top").append(go);
    // a loop idea can be joined on to the route already open (two headings from one start, say)
    const inRt = new Set(trip.items.flatMap(x => x.ids));
    if (lastKind === "loop" && trip.items.length && editingDay == null && it.chain.length && trip.name !== it.name && it.chain.some(n => !(n.w.members || [n.w.id]).every(id => inRt.has(id)))) {
      const join = document.createElement("button"); join.className = "btn quiet"; join.textContent = `+ Join on to “${trip.name}”`;
      join.onclick = ev => { ev.stopPropagation(); joinRide({ name: it.name, trip: { items: chainToItems(it.chain) } }); };
      card.append(join);
    }
    const pick = () => { picked = i; renderIdeas(msg); fitTo(it); };
    card.onclick = pick;
    box.append(card);
  });
  // on a phone the cards are a side-swipe row: keep the chosen one in view after redrawing
  scrollToPicked();
}
function scrollToPicked(){
  const box = $("#ideaList");
  if (phone() && picked >= 0 && box.children[picked] && box.clientWidth) { ideaScrollQuiet = true; box.scrollLeft = box.children[picked].offsetLeft - (box.clientWidth - box.children[picked].offsetWidth) / 2; setTimeout(() => ideaScrollQuiet = false, 80); }
}
new ResizeObserver(() => scrollToPicked()).observe($("#ideaList"));
// Swiping to a card makes it the one on the map
var ideaScrollQuiet = false, ideaScrollTimer;
$("#ideaList").addEventListener("scroll", () => {
  if (!phone() || ideaScrollQuiet) return;
  clearTimeout(ideaScrollTimer);
  ideaScrollTimer = setTimeout(() => {
    const box = $("#ideaList"), mid = box.scrollLeft + box.clientWidth / 2;
    let best = -1, bd = Infinity; [...box.children].forEach((c, k) => { const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = k; } });
    if (best >= 0 && best !== picked && ideas[best]) { picked = best; renderIdeas(); fitTo(ideas[best]); }
  }, 140);
}, { passive: true });
$("#ideasBack").onclick = () => { ideaRun++; stopModes(); sketchLayer.clearLayers(); goBack(); };

/* ---------- a route: a list of lanes plus optional start and finish ---------- */
const newTrip = () => ({ name: "My route", start: null, finish: null, loop: false, items: [] });
let trip = store.get("trip2", null) || newTrip();
let built = store.get("built5", null);
let editingDay = null;       // when editing one day of a tour
let dayBefore = null;        // the route that was open before a tour day was opened for editing, put back afterwards
const saveTrip = () => { store.set("trip2", trip); store.set("built5", built); store.set("editing", editingDay == null ? null : { day: editingDay, before: dayBefore }); };
const routeLayer = L.layerGroup().addTo(map);
const itemFromWay = (w, coords) => { const t = w.tags; return { ids: w.members ? w.members.slice() : [w.id], name: laneName(t), kind: DESIG[t.designation] || "Byway", cls: w.cls, coords: coords || w.coords.slice(), surface: surfTxt(t) }; };
function chainToItems(chain){   // join lanes that touch into one entry, so the list reads as lanes, not fragments
  const items = [];
  for (const n of chain) {
    const last = items.at(-1);
    if (last && hav(last.coords.at(-1), n.a) < 30 && last.cls === n.w.cls) {
      last.coords = last.coords.concat(n.coords.slice(1)); last.ids.push(...(n.w.members || [n.w.id]));
      if (last.name.startsWith("Unnamed")) last.name = laneName(n.w.tags);
      continue;
    }
    items.push(itemFromWay(n.w, n.coords.slice()));
  }
  return items;
}
function addItem(item){
  const first = !trip.items.length;
  if (first) { trip = newTrip(); trip.items.push(item); }
  else {
    // put the new lane where it adds the least extra distance, facing the way that fits
    let best = { cost: Infinity };
    const endP = trip.finish || (trip.loop ? trip.start : null);
    for (let pos = 0; pos <= trip.items.length; pos++) {
      const prev = pos === 0 ? trip.start : trip.items[pos - 1].coords.at(-1);
      const next = pos === trip.items.length ? endP : trip.items[pos].coords[0];
      for (const rev of [false, true]) {
        const a = rev ? item.coords.at(-1) : item.coords[0], b = rev ? item.coords[0] : item.coords.at(-1);
        const cost = (prev ? hav(prev, a) : 0) + (next ? hav(b, next) : 0) - (prev && next ? hav(prev, next) : 0);
        if (cost < best.cost) best = { cost, pos, rev };
      }
    }
    if (best.rev) item.coords = item.coords.slice().reverse();
    trip.items.splice(best.pos, 0, item);
  }
  built = null; saveTrip();
  if (view !== "route") showView("route", "mid"); else renderRoute();
  // a new route's first lane goes where you can see it, above the panel that has just come up
  if (first) fitMap(L.latLngBounds(item.coords).pad(0.4), { maxZoom: 15 });
  drawRoute(); tidyNow(item);
}
function addLane(w){ addItem(itemFromWay(w)); status(`Added ${laneName(w.tags)}`); }
const itemVia = p => ({ via: true, ids: [], name: "Via point", kind: "Via", cls: "via", coords: [p] });
// Put an item at a given place in the ride, facing whichever way joins up best.
function insertAt(pos, item, replace = false){
  const prev = pos === 0 ? trip.start : trip.items[pos - 1].coords.at(-1);
  const nextIdx = replace ? pos + 1 : pos;
  const next = nextIdx >= trip.items.length ? (trip.finish || (trip.loop ? trip.start : null)) : trip.items[nextIdx].coords[0];
  if (item.coords.length > 1) {
    const cost = c => (prev ? hav(prev, c[0]) : 0) + (next ? hav(c.at(-1), next) : 0);
    const rev = item.coords.slice().reverse(); if (cost(rev) < cost(item.coords)) item.coords = rev;
  }
  trip.items.splice(pos, replace ? 1 : 0, item);
  built = null; saveTrip(); renderRoute(); drawRoute(); build();
}
// The ridable lane nearest a point on screen, within a finger's width, not already in the route.
function laneNear(ll, px = 28){
  const p = map.latLngToContainerPoint(ll); let best = null, bd = px;
  const pad = 0.02, bb = [ll.lat - pad, ll.lng - pad * 1.6, ll.lat + pad, ll.lng + pad * 1.6];
  for (const k of cells(bb)) for (const id of grid.get(k) || []) {
    const w = osmWays.get(id); if (!CLASSES[w.cls].ride || inRoute(id)) continue;
    const pts = w.coords.map(c => map.latLngToContainerPoint(c));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
      if (d < bd) { bd = d; best = w; }
    }
  }
  return best;
}
// The stop icon under a point on screen (only kinds switched on under Show, or already found along the route).
function stopNear(ll, px = 24){
  if (!stops) return null;
  const p = map.latLngToContainerPoint(ll); let best = null, bd = px;
  for (const i of stopsNear([ll.lat, ll.lng])) {
    const st = stops[i]; if (!groupOn(st.code) && !routeStopIdx.has(i)) continue;
    const q = map.latLngToContainerPoint([st.lat, st.lng]), d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) { bd = d; best = st; }
  }
  return best;
}
function highlightStop(st){ if (!st) return; L.circleMarker([st.lat, st.lng], { radius: 20, color: "#ffd21f", weight: 5, fill: false, interactive: false }).addTo(highlightLayer); }
function dragMarker(at, cls, onDrop, html){
  const m = L.marker(at, { draggable: true, autoPan: true, autoPanPadding: L.point(14, 14), keyboard: false, zIndexOffset: 2000,
    icon: L.divIcon({ className: "", iconSize: [0, 0], html: html || `<div class="handle ${cls}"></div>` }), title: "Drag onto a green lane or a stop" });
  // a stop icon wins over a lane, because it's the smaller target and you aimed at it
  const target = ll => { const st = stopNear(ll); return st ? { st } : { w: laneNear(ll) }; };
  m.on("drag", e => { const t = target(e.target.getLatLng()); highlightLane(t.w || null); highlightStop(t.st); });
  m.on("dragend", e => { highlightLane(null); const ll = e.target.getLatLng(), t = target(ll); onDrop(t.w || null, [ll.lat, ll.lng], t.st || null); });
  return m;
}
function removeLane(id){ const i = trip.items.findIndex(it => it.ids.some(x => x === id || laneOf.get(x) === id)); if (i >= 0) removeItem(i); }
// Taking a lane or stop out can be undone for six seconds (and taking out the last one isn't the end of the route)
let removed = [];
function removeItem(i){
  const [gone] = trip.items.splice(i, 1); if (!gone) return; built = null;
  for (const id of gone.ids || []) (trip.declined ||= []).push(laneOf.get(id) ?? id);   // not offered again by "Add lanes close to this route"
  saveTrip();
  if ($("#undoBar").hidden) removed = [];
  removed.push({ i, gone });
  const last = !trip.items.length;
  undoBar(last ? "Took out the last lane: the route is empty" : removed.length > 1 ? `Took out ${removed.length} lanes` : `Took out ${gone.name || "a lane"}`, () => {
    for (const r of removed.slice().reverse()) trip.items.splice(Math.min(r.i, trip.items.length), 0, r.gone);
    removed = []; built = null; saveTrip();
    if (view !== "route") showView("route", "mid"); renderRoute(); drawRoute(); buildSoon(300);
  }, null);   // the list is reset when the bar has gone, not when the next removal replaces the bar
  if (!trip.items.length) { routeLayer.clearLayers(); routeStopIdx = new Set(); routeStopLayer.clearLayers(); showView(editingDay != null ? "tour" : "plan", "peek"); return; }
  renderRoute(); drawRoute(); tidyNow();
}
// Back from a route always goes somewhere: to the loop or drawn ideas it came from, the area page of a ready-made
// ride, or "Where to ride?" (for a saved route, or one still open when the app is reopened).
let routeFrom = { kind: "plan" };
$("#routeBack").onclick = () => {
  if (lastKind && ideas.length) { showView("ideas", "mid"); setIdeasUi(); drawSketch(); renderIdeas(); if (picked >= 0 && ideas[picked]) fitTo(ideas[picked]); return; }
  if (routeFrom.kind === "region" && regionBySlug(routeFrom.slug)) { openRegion(routeFrom.slug); return; }
  if (routeFrom.kind === "lanes") { openLanes(); return; }   // back to the lane list it was started from
  goBack();
};
function useIdea(i){
  dropUndo();
  const it = ideas[i], sk = it.sketch, loop = isLoop(sk);
  trip = { name: it.name, start: sk[0], finish: loop ? null : sk.at(-1), loop, items: chainToItems(it.chain) };
  built = null; editingDay = null; ideaRun++;
  // Show the idea straight away on the quickest roads it was checked with, so the numbers are there at once;
  // the twisty-road version replaces it when BRouter has answered (half a minute or more on the free server).
  if (it.roadGeom) {
    const roadM = it.roadM * (it.checked ? 1 : twistF()), lanes = trip.items.filter(x => !x.via);
    built = { provisional: true, twisty: -1, via: "OSRM", jumps: 0, failed: 0, joinM: 0,
      segs: [...it.roadGeom.filter(g => g.length > 1).map(c => ({ type: "road", coords: c })), ...lanes.map((x, i) => ({ type: "lane", coords: x.coords, i }))],
      total: it.laneM + roadM, off: it.laneM, hours: hoursOf(it.laneM, roadM), bend: bendiness(it.roadGeom) };
  }
  trip.keepOrder = lastKind === "draw";   // a drawing has a way round; a loop idea's order is only the planner's guess
  saveTrip(); sketchLayer.clearLayers();
  showView("route", "mid"); renderRoute(); fitTo(it); if (built) findRouteStops();
  const t = trip;
  (lastKind === "draw" && settings.followLine !== false ? followLine(t, sk) : Promise.resolve()).then(() => { if (t === trip) tidyNow(); });
}
$("#followLine").checked = settings.followLine !== false;
$("#followLine").onchange = e => { settings.followLine = e.target.checked; saveSettings(); };
// A drawn route keeps to the line you drew. Lanes are found along it; where there's no lane for a while, a via point
// every 3 km or so, put on the nearest road, takes the roads along your line (round a lake, over a pass, both
// halves of a figure 8), in the order and direction you drew. Without them the roads take the quickest way
// from lane to lane and the shape is lost.
async function followLine(t, sk){
  const dense = []; for (const p of sk) { if (dense.length) { const a = dense.at(-1), n = Math.ceil(hav(a, p) / 150); for (let k = 1; k < n; k++) dense.push([a[0] + (p[0] - a[0]) * k / n, a[1] + (p[1] - a[1]) * k / n]); } dense.push(p); }
  const cum = [0]; for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + hav(dense[i - 1], dense[i]));
  // how far along the drawing a point is, looking forward from `from` (a figure 8 crosses itself, so order matters)
  const alongFrom = (p, from) => { let bi = -1, bd = Infinity; for (let i = 0; i < dense.length; i++) { if (cum[i] < from - 2000) continue; const d = hav(p, dense[i]) + (cum[i] < from ? 3000 : 0); if (d < bd) { bd = d; bi = i; } } return bi < 0 ? from : cum[bi]; };
  const lanes = t.items.filter(it => !it.via), laneAt = []; let from = 0;
  for (const it of lanes) { const a = alongFrom(it.coords[Math.floor(it.coords.length / 2)], from); laneAt.push(a); from = a; }
  const lanePts = lanes.flatMap(it => thin(it.coords, 250));
  const want = [];
  for (let d = 3000; d < cum.at(-1) - 1500; d += 3000) {
    const i = cum.findIndex(c => c >= d), p = dense[i];
    if (!lanePts.some(q => hav(p, q) < 1500)) want.push({ at: d, p });
  }
  // a drawing that comes back through its start between petals (a clover from a café) comes back there too
  for (let i = 1, last = -1e9; i < dense.length - 1; i++) {
    const d = hav(dense[i], sk[0]);
    if (d < 500 && cum[i] > 2000 && cum[i] < cum.at(-1) - 2000 && cum[i] - last > 3000 && d <= hav(dense[i - 1], sk[0]) && d <= hav(dense[i + 1], sk[0])) { want.push({ at: cum[i], p: sk[0] }); last = cum[i]; }
  }
  want.sort((a, b) => a.at - b.at);
  if (!want.length) return;
  // onto a proper road (up to residential streets): a farm drive or a service road would be ridden up and back
  const snapped = await localRouter.call({ type: "snap", pts: want.map(w => w.p), maxCls: 11 });
  const vias = want.map((w, k) => snapped?.[k] && snapped[k].d < 1500 ? { at: w.at, it: { ...itemVia(snapped[k].pt), name: "On your line", drawn: true } } : null).filter(Boolean);
  if (t !== trip || !vias.length) return;
  const all = lanes.map((it, k) => ({ at: laneAt[k], it })).concat(vias).sort((a, b) => a.at - b.at);
  const stopsKept = t.items.filter(it => it.via && !it.drawn && !lanes.includes(it));   // anything else keeps its place at the end of the list
  t.items = all.map(x => x.it).concat(stopsKept); t.keepOrder = true; built = null; saveTrip();
}
// Face each lane the way that joins up best with the ones either side (a route that was tidied already is).
function orientTrip(t){
  const it = t.items; if (!it.length || t.tidy) return;
  const dirs = []; orderCost(it.map(x => orderEnds(x)), t.start, t.finish || (t.loop ? t.start : null), hav, dirs);
  dirs.forEach((k, i) => { if (k) it[i].coords = it[i].coords.slice().reverse(); });
}

/* ---------- putting the lanes in a sensible order ----------
   Tapping lanes adds each one where it adds least, measured in straight lines. After many taps that leaves
   a route that crosses itself, rides roads twice and turns back on itself, and straight lines hop across
   water (the Medina between Cowes and East Cowes, say). So after every change the whole route is put in the
   order, and each lane faced the way, that needs the least road between lanes, measured by road on the
   phone. The start and finish stay where they are, and a loop still comes back to its start. */
const roadGap = new Map();   // road metres between two points, "a|b", as the phone's router measured them
const ptKey = p => p[0].toFixed(5) + "," + p[1].toFixed(5);
const gapTried = new Set();   // points already measured from (to the points of the route at that time)
async function measureGaps(pts){
  const keys = pts.map(ptKey), rows = [];
  // only from points not measured from before: the new ones measure to all the others, and roads mostly run both
  // ways, so their figures do for the way back too (a pair with no road between them stays unknown, not re-asked)
  keys.forEach((k, i) => { if (!gapTried.has(k)) rows.push(i); });
  if (!rows.length || pts.length > 120) return;
  const r = await localRouter.call({ type: "matrix", pts, t: tw(), rows }); if (!r) return;
  for (const i of rows) { gapTried.add(keys[i]); if (r.snap[i] != null) offRoad.set(keys[i], r.snap[i]); r.d[i].forEach((d, j) => { if (i !== j && d != null) roadGap.set(keys[i] + "|" + keys[j], d); }); }
}
// A lane end is a dead end when it's well away from any road and no other lane carries on from it: the only way
// out is back along the lane. The build already rides back that way; tidying treats the lane as there and back
// from its open end, so it doesn't count on a straight line across the fields from the dead end.
const offRoad = new Map();   // metres from a point to the nearest road the phone can route on
function deadEnd(it, p){
  if ((offRoad.get(ptKey(p)) ?? 0) < 150) return false;
  const own = new Set(it.ids.map(id => laneOf.get(id) ?? id)), pad = 0.001, bb = [p[0] - pad, p[1] - pad * 1.6, p[0] + pad, p[1] + pad * 1.6];
  for (const k of cells(bb)) for (const id of grid.get(k) || []) {
    const w = osmWays.get(id); if (!w || own.has(id) || !CLASSES[w.cls].ride) continue;
    if (distToLine(p, w.coords) < 30) return false;   // (a lane that meets the middle of another joins it there)
  }
  return true;
}
function distToLine(p, line){
  const k = Math.cos(p[0] * Math.PI / 180) * 111320; let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][1] - p[1]) * k, ay = (line[i - 1][0] - p[0]) * 111320, dx = (line[i][1] - line[i - 1][1]) * k, dy = (line[i][0] - line[i - 1][0]) * 111320;
    const L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return line.length === 1 ? hav(p, line[0]) : best;
}
const deadEndOf = it => it.via || it.coords.length < 2 ? null : deadEnd(it, it.coords.at(-1)) && !deadEnd(it, it.coords[0]) ? "end" : deadEnd(it, it.coords[0]) && !deadEnd(it, it.coords.at(-1)) ? "start" : null;
// Where the build would join two points along other lanes (see routeTrip), that's lane riding, which is what
// the route is for: it counts at 40% of its length, so the order keeps joins along lanes rather than trading
// them for road. Worked out once per pair of points within 3 km, and kept.
const laneGap = new Map();
function laneJoin(a, b){
  const h = hav(a, b); if (h > 3000) return null;
  const k = [ptKey(a), ptKey(b)].sort().join("|") + (settings.useUcr ? "" : "-");
  if (!laneGap.has(k)) { const lp = laneGraphPath(a, b, settings.useUcr, h * 3 + 3000); laneGap.set(k, lp && lp.len <= h * 1.6 + 1000 ? lp.len : null); }
  return laneGap.get(k);
}
function gapFn(){
  // Two lane ends that touch cost nothing. Most roads run both ways, so a figure measured the other way round
  // will do; with none, a straight line with a third added for bends.
  return (a, b) => {
    const h = hav(a, b); if (h < 30) return 0;
    const lj = laneJoin(a, b); if (lj != null) return lj * 0.4;
    const ka = ptKey(a), kb = ptKey(b); return roadGap.get(ka + "|" + kb) ?? roadGap.get(kb + "|" + ka) ?? h * 1.35;
  };
}
// Each item for ordering: its two ends (the same point for a stop, a via or a dead-end lane) and the item itself.
const orderEnds = (it, pt) => { const a = pt || it.coords[0], b = pt || it.coords.at(-1); return { a, b, one: !!pt || it.coords.length < 2 || hav(a, b) < 1, it }; };
// The same distances again and again, so each pair is worked out once per tidy (the points are the route's own arrays).
function memoD(D){
  const id = new Map(), memo = new Map(), ix = p => { let i = id.get(p); if (i === undefined) id.set(p, i = id.size); return i; };
  return (a, b) => { const k = ix(a) * 8192 + ix(b); let v = memo.get(k); if (v === undefined) memo.set(k, v = D(a, b)); return v; };
}
// The least road for items in a given order: each lane can be ridden either way (a small dynamic programme).
function orderCost(xs, start, end, D, keep){
  let c0 = 0, c1 = 0, e0 = null, e1 = null;   // c0: last item ridden as drawn, c1: reversed; e0/e1: where it then ends
  const back = keep ? [] : null;
  for (let i = 0; i < xs.length; i++) {
    const { a, b, one } = xs[i];
    if (i === 0) { c0 = start ? D(start, a) : 0; c1 = one ? Infinity : start ? D(start, b) : 0; back?.push(0, 0); }
    else {
      const p0 = c0 + D(e0, a), p1 = c1 + D(e1, a), q0 = c0 + D(e0, b), q1 = c1 + D(e1, b);
      back?.push(p0 <= p1 ? 0 : 1, q0 <= q1 ? 0 : 1);
      c0 = Math.min(p0, p1); c1 = one ? Infinity : Math.min(q0, q1);
    }
    e0 = b; e1 = a;
  }
  if (end) { c0 += D(e0, end); c1 += D(e1, end); }
  if (keep) { let k = c0 <= c1 ? 0 : 1; const f = []; for (let i = xs.length - 1; i >= 0; i--) { f[i] = k; k = back[2 * i + k]; } keep.push(...f); }
  return Math.min(c0, c1);
}
// Local search over the order: move a run of one to three items elsewhere, or ride a run backwards.
function bestOrder(items, start, end, D, allowed = null){
  let cur = items.slice(), best = orderCost(cur, start, end, D);
  const tryOrder = o => { if (allowed && !allowed(o)) return false; const c = orderCost(o, start, end, D); if (c < best - 1) { best = c; cur = o; return true; } return false; };
  for (let pass = 0, better = true; better && pass < 40; pass++) {
    better = false;
    for (let len = 1; len <= 3; len++) for (let i = 0; i + len <= cur.length; i++) {
      const run = cur.slice(i, i + len), rest = cur.slice(0, i).concat(cur.slice(i + len));
      for (let j = 0; j <= rest.length; j++) if (j !== i && tryOrder(rest.slice(0, j).concat(run, rest.slice(j)))) { better = true; break; }
    }
    for (let i = 0; i < cur.length - 1; i++) for (let j = i + 1; j < cur.length; j++)
      if (tryOrder(cur.slice(0, i).concat(cur.slice(i, j + 1).reverse(), cur.slice(j + 1)))) better = true;
  }
  return { order: cur, cost: best };
}
function nearestFirst(xs, start, D){   // a second starting point for the search: always ride to the nearest lane next
  const left = xs.slice(), out = []; let at = start || left[0].a;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((x, i) => { const d = Math.min(D(at, x.a), D(at, x.b)); if (d < bd) { bd = d; bi = i; } });
    const [x] = left.splice(bi, 1); out.push(x);
    at = D(at, x.a) <= D(at, x.b) ? x.b : x.a;
  }
  return out;
}
function tidyTrip(t, D0 = gapFn()){
  if (t.items.length < 2 && !t.start) return false;
  const D = memoD(D0);
  // (a dead-end lane has been made there and back already, so it starts and ends at its open end, like a point)
  const xs = t.items.map(it => orderEnds(it));
  const end = t.finish || (t.loop ? t.start : null);
  const before = orderCost(xs, t.start, end, D);
  // via points you placed keep their order (they set the way round a lake, say); lanes and stops can move
  const pins = xs.filter(x => x.it.via && !x.it.stop), ok = o => { let k = 0; for (const x of o) if (x === pins[k]) k++; return k === pins.length; };
  let res = bestOrder(xs, t.start, end, D, pins.length > 1 ? ok : null);
  if (xs.length > 3) { const nf = nearestFirst(xs, t.start, D); if (pins.length < 2 || ok(nf)) { const alt = bestOrder(nf, t.start, end, D, pins.length > 1 ? ok : null); if (alt.cost < res.cost) res = alt; } }
  const changed = res.cost < before - 200;   // don't shuffle a route for a few hundred metres
  let order = changed ? res.order : xs; const faces = [];
  // a loop (or a route with no fixed ends) costs the same either way round: keep the way round it was going
  if (changed && pins.length < 2 && (t.loop || (!t.start && !t.finish))) {
    let fwd = 0, back = 0; const was = new Map(xs.map((x, i) => [x, i]));
    for (let i = 1; i < order.length; i++) was.get(order[i]) > was.get(order[i - 1]) ? fwd++ : back++;
    if (back > fwd) order = order.slice().reverse();
  }
  orderCost(order, t.start, end, D, faces);
  faces.forEach((k, i) => { if (k && !order[i].one) order[i].it.coords = order[i].it.coords.slice().reverse(); });
  t.items = order.map(x => x.it); t.tidy = true;
  return changed;
}
let tidyRun = 0;
// After a change: measure the road gaps (a second or two for a big route), ride dead-end lanes there and back, then
// either reorder the whole route (a set of lanes you tapped) or, for a route with an order of its own (drawn, a
// loop idea, a ready-made ride, a tour day), only fit the lane just added into it. Via points keep their order
// either way: you put them there to make the route go a certain way.
async function tidyNow(placed = null){
  const run = ++tidyRun, t = trip;
  const pts = [t.start, t.finish].filter(Boolean).concat(t.items.flatMap(it => it.coords.length > 1 ? [it.coords[0], it.coords.at(-1)] : [it.coords[0]]));
  if (t.items.length > 1 || t.start) { $("#routeStatus").textContent = "Putting the lanes in order…"; await measureGaps(pts); }
  if (run !== tidyRun || t !== trip) return;
  const doubled = thereAndBack(t);
  let moved = doubled;
  if (!t.keepOrder) moved = tidyTrip(t) || moved;
  else if (placed && t.items.includes(placed)) {
    // the lane now does the job of any point near it that kept the route to the drawn line
    if (!placed.via) t.items = t.items.filter(it => !(it.drawn && distToLine(it.coords[0], placed.coords) < 1500));
    moved = placeItem(t, placed) || moved;
  }
  joinTouching(t);
  built = null; saveTrip();
  if (view === "route") { renderRoute(); drawRoute(); }
  buildSoon(moved ? 50 : 300);
}
// A lane that stops short of any road, with no other lane carrying on from it, can only be ridden in and back out:
// make that part of the route itself, so the GPX and the ride screen follow the lane back instead of a straight
// line across the fields to the next road.
function thereAndBack(t){
  let n = 0;
  for (const it of t.items) {
    if (it.there || it.via) continue;
    const de = deadEndOf(it); if (!de) continue;
    if (de === "start") it.coords = it.coords.slice().reverse();
    it.coords = it.coords.concat(it.coords.slice(0, -1).reverse()); it.there = true; n++;
  }
  return n > 0;
}
// Pieces of one lane that end up next to each other, end to start, become one row (Red Lane in three pieces is Red Lane)
function joinTouching(t){
  for (let i = t.items.length - 1; i > 0; i--) {
    const a = t.items[i - 1], b = t.items[i];
    if (a.via || b.via || a.there || b.there || a.cls !== b.cls || hav(a.coords.at(-1), b.coords[0]) > 30) continue;
    if (a.name !== b.name && !/^Unnamed/.test(a.name) && !/^Unnamed/.test(b.name)) continue;
    a.coords = a.coords.concat(b.coords.slice(1)); a.ids.push(...b.ids); if (/^Unnamed/.test(a.name)) a.name = b.name;
    t.items.splice(i, 1);
  }
}
// Fit one item into a route that keeps its order: where it adds the least, facing the way that fits.
function placeItem(t, item){
  const D = memoD(gapFn()), i0 = t.items.indexOf(item); t.items.splice(i0, 1);
  const end = t.finish || (t.loop ? t.start : null); let best = { cost: Infinity, pos: i0, rev: false };
  for (let pos = 0; pos <= t.items.length; pos++) {
    const prev = pos === 0 ? t.start : t.items[pos - 1].coords.at(-1), next = pos === t.items.length ? end : t.items[pos].coords[0];
    for (const rev of [false, true]) {
      const a = rev ? item.coords.at(-1) : item.coords[0], b = rev ? item.coords[0] : item.coords.at(-1);
      const cost = (prev ? D(prev, a) : 0) + (next ? D(b, next) : 0) - (prev && next ? D(prev, next) : 0);
      if (cost < best.cost - 1) best = { cost, pos, rev };
    }
  }
  if (best.rev) item.coords = item.coords.slice().reverse();
  t.items.splice(best.pos, 0, item);
  return best.pos !== i0 || best.rev;
}

/* ---------- roads between lanes: BRouter with our motorbike profile, OSRM as a fallback ---------- */
// twisty 0 = quickest roads; 1 = prefer B-roads and back lanes, avoid A-roads, motorways and towns.
// Tracks explicitly tagged open to motor vehicles are allowed. A copy of this profile is in data/moto.brf.
const MOTO_PROFILE = `---context:global
assign twisty = 0.5
assign validForCars = true
assign turnInstructionMode = 0
assign processUnusedTags = false
assign pass1coefficient = 1.3
---context:way
assign access_no = or access=no|private or motor_vehicle=no|private|agricultural motorcycle=no
assign fast = switch highway=motorway|motorway_link 1.0 switch highway=trunk|trunk_link 1.1 switch highway=primary|primary_link 1.25 switch highway=secondary|secondary_link 1.45 switch highway=tertiary|tertiary_link 1.65 switch highway=unclassified 1.95 switch highway=residential|living_street 2.3 switch highway=service 3.0 switch route=ferry 5.0 0
assign fun = switch highway=motorway|motorway_link 25 switch highway=trunk|trunk_link 9 switch highway=primary|primary_link 3.5 switch highway=secondary|secondary_link 1.15 switch highway=tertiary|tertiary_link 1.0 switch highway=unclassified 1.1 switch highway=residential|living_street 3.5 switch highway=service 5.0 switch route=ferry 8.0 0
assign legaltrack = and highway=track or motor_vehicle=yes|designated|permissive motorcycle=yes|designated|permissive
assign costfactor switch access_no 10000 switch legaltrack 1.4 switch equal fast 0 10000 add multiply fast sub 1 twisty multiply fun twisty
assign turncost = 0
assign initialcost = 0
---context:node
assign initialcost = switch or barrier=gate|lift_gate|bollard access=no|private 1000 0
`;
async function brouterProfile(fresh){
  const saved = store.get("brouterProfile2", null);
  if (saved && !fresh && Date.now() - saved.t < 6 * 3600e3) return saved.id;
  const r = await polite("brouter", "https://brouter.de/brouter/profile", { method: "POST", body: MOTO_PROFILE, headers: { "Content-Type": "text/plain" } }, { cache: false });
  const j = JSON.parse(r.text); if (j.error || !j.profileid) throw new Error(j.error || "no profile id");
  store.set("brouterProfile2", { id: j.profileid, t: Date.now() }); return j.profileid;
}
/* ---------- routing on the phone ----------
   Roads between lanes are worked out on the phone from our own road tiles (data/roads/, built by
   experiments/local-routing/build_road_graph.py), in a background worker, with the same costs as the app's BRouter
   profile. So planning works without the public servers and with no signal, for any area whose tiles the phone has.
   BRouter and OSRM are only asked where the tiles can't be had. */
const localRouter = (() => {
  let w = null, seq = 0, broken = false; const wait = new Map();
  const start = () => {
    try { w = new Worker("js/route-worker.js"); w.onmessage = e => { const f = wait.get(e.data.id); wait.delete(e.data.id); f?.(e.data.r); }; w.onerror = () => { broken = true; for (const f of wait.values()) f(null); wait.clear(); }; }
    catch { broken = true; }
  };
  const call = msg => new Promise(res => {
    if (!w && !broken) start(); if (broken || !w) return res(null);
    const id = ++seq; wait.set(id, res); w.postMessage({ ...msg, id });
    setTimeout(() => { if (wait.has(id)) { wait.delete(id); res(null); } }, 30000);
  });
  return { route: (a, b, t) => call({ type: "route", a, b, t }), has: p => call({ type: "has", p }), call };
})();
async function localLink(a, b){
  const r = await localRouter.route(a, b, tw());
  if (!r || !r.coords?.length) return null;
  return { coords: [a, ...r.coords, b], ok: true, jumpA: r.snapA, jumpB: r.snapB, via: "this phone", ferry: !!r.ferry };
}
// the quick check of a loop idea's roads (what OSRM did): quickest roads between each lane and the next
async function localLegs(sk, chain){
  const pts = [sk[0]]; for (const n of chain) pts.push(n.a, n.b); pts.push(isLoop(sk) ? sk[0] : sk.at(-1));
  const dist = [], snap = [], geom = [], ferry = [];
  for (let k = 0; k < pts.length; k += 2) {
    const r = await localRouter.route(pts[k], pts[k + 1], tw()); if (!r) return null;   // the same roads the route will take, so the card's figures hold
    dist.push(r.len); snap.push(r.snapA, r.snapB); geom.push(r.coords); ferry.push(!!r.ferry);
  }
  return { pts, dist, snap, geom, ferry };
}
// One road link, lane end to next lane start. Answers are cached, so edits only re-route the links that changed.
async function brLink(a, b){
  let freshProfile = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    let pid; try { pid = await brouterProfile(freshProfile); } catch { return null; }
    const url = `https://brouter.de/brouter?lonlats=${a[1].toFixed(6)},${a[0].toFixed(6)}|${b[1].toFixed(6)},${b[0].toFixed(6)}&profile=${pid}&alternativeidx=0&format=geojson&profile:twisty=${tw().toFixed(2)}`;
    const r = await polite("brouter", url, {}, { timeout: 45000 });
    if (!r.ok) {
      // the free server says "Please, retry later!" when it's busy: wait a little longer each time before giving up
      if (/retry later/i.test(r.text) && attempt < 3) { await sleep(3000 * (attempt + 1)); continue; }
      if (!freshProfile && /profile/i.test(r.text)) { freshProfile = true; continue; }
      return null;
    }
    try {
      const c = JSON.parse(r.text).features[0].geometry.coordinates.map(([x, y]) => [y, x]);
      return { coords: [a, ...c, b], ok: true, jumpA: hav(a, c[0]), jumpB: hav(c.at(-1), b), via: "BRouter" };
    } catch { return null; }
  }
  return null;
}
async function osrmLink(a, b){
  const r = await polite("osrm", `https://router.project-osrm.org/route/v1/driving/${a[1].toFixed(6)},${a[0].toFixed(6)};${b[1].toFixed(6)},${b[0].toFixed(6)}?overview=full&geometries=geojson`);
  try { const d = JSON.parse(r.text); if (d.code !== "Ok") throw 0;
    return { coords: [a, ...d.routes[0].geometry.coordinates.map(([x, y]) => [y, x]), b], ok: true, jumpA: d.waypoints[0].distance, jumpB: d.waypoints[1].distance, via: "OSRM" };
  } catch { return { coords: [a, b], ok: false, jumpA: hav(a, b), jumpB: 0, via: "none" }; }
}
const tripLinks = t => {
  const end = t.finish || (t.loop && t.start ? t.start : null), links = []; let prev = t.start;
  for (const it of t.items) { links.push(prev && hav(prev, it.coords[0]) > 25 ? [prev, it.coords[0]] : null); prev = it.coords.at(-1); }
  links.push(end && hav(prev, end) > 25 ? [prev, end] : null);
  return links;
};
// Route every link of a trip. A short join along other legal lanes beats a road detour, and out on the
// hills it's the only option; otherwise BRouter, then OSRM.
async function routeTrip(t, alive, onLink){
  orientTrip(t);
  const roads = await Promise.all(tripLinks(t).map(async (l, k) => {
    if (!l) return null;
    // a link's ends are lane ends, or points (the start, the finish, a via or a stop)
    const aPoint = k === 0 || !!t.items[k - 1]?.via, bPoint = k === t.items.length || !!t.items[k]?.via;
    const straight = hav(l[0], l[1]);
    const lp = straight < 15000 ? laneGraphPath(l[0], l[1], settings.useUcr, straight * 3 + 3000) : null;
    let r;
    if (lp && lp.len <= straight * 1.6 + 1000) r = { coords: lp.coords, ok: true, jump: 0, via: "lanes", lanes: true };
    else {
      // the phone's own router first; the servers only with a signal (with none they'd only queue up and fail)
      r = { ...((await localLink(l[0], l[1])) || (navigator.onLine ? (await brLink(l[0], l[1])) || (await osrmLink(l[0], l[1]))
        : { coords: [l[0], l[1]], ok: false, jumpA: 0, jumpB: 0, via: "none", offline: true })) };   // counted as "no signal", not as a gap
      // A point off the road (a town centre, a pass, a pub) is reached by the road nearest it: drop the straight
      // line out to it, which would put a spike in the GPX. A lane end off the road keeps its line, and counts as a gap.
      if (r.ok) { if (aPoint && r.jumpA > 25) r.coords = r.coords.slice(1); if (bPoint && r.jumpB > 25) r.coords = r.coords.slice(0, -1); }
      r.jump = r.ok ? Math.max(aPoint ? 0 : r.jumpA, bPoint ? 0 : r.jumpB) : r.jumpA;
      if (lp && (r.jump > 100 || !r.ok)) r = { coords: lp.coords, ok: true, jump: 0, via: "lanes", lanes: true, instead: !r.ok };   // instead: no road route came back
    }
    onLink?.();
    return r;
  }));
  if (!alive()) return null;
  const segs = [];
  t.items.forEach((it, i) => { if (roads[i]) segs.push({ type: "road", link: i, ...roads[i] }); if (!it.via) segs.push({ type: "lane", coords: it.coords, i }); });
  if (roads.at(-1)) segs.push({ type: "road", link: t.items.length, ...roads.at(-1) });
  const isOff = s => s.type === "lane" || s.lanes;
  const off = segs.filter(isOff).reduce((a, s) => a + lineLen(s.coords), 0);
  const roadM = segs.filter(s => !isOff(s)).reduce((a, s) => a + lineLen(s.coords), 0);
  const vias = [...new Set(segs.filter(s => s.type === "road" && !s.lanes).map(s => s.via))].filter(v => v !== "none");
  const ferries = segs.filter(s => s.ferry).length;   // a crossing is about 45 minutes with the wait and boarding, not road riding
  return { segs, off, road: roadM, joinM: segs.filter(s => s.lanes).reduce((a, s) => a + lineLen(s.coords), 0), total: off + roadM, hours: hoursOf(off, roadM) + 0.75 * ferries,
    bend: bendiness(segs.filter(s => s.type === "road" && !s.lanes).map(s => s.coords)),
    jumps: segs.filter(s => s.type === "road" && s.jump > 100).length, failed: segs.filter(s => s.type === "road" && s.ok === false).length,
    via: vias.join(" and ") || "none needed", twisty: settings.twisty };
}
let buildRun = 0, buildTimer, nearAdded = null;
function buildSoon(ms = 900){ clearTimeout(buildTimer); buildTimer = setTimeout(build, ms); }
async function build(){
  const run = ++buildRun;
  if (!trip.items.length) return;
  $("#gpxBtn").disabled = true;
  // a route saved for no signal opens from its saved line, with no routing at all
  const kept = typeof Offline !== "undefined" && await Offline.keptBuilt(trip);
  if (run !== buildRun) return;
  if (kept) { built = kept; saveTrip(); drawRoute(); renderRoute(); findRouteStops(); $("#routeStatus").textContent = "Saved on this phone for no signal."; return; }
  const todo = tripLinks(trip).filter(Boolean).length; let done = 0;
  const say = n => (built?.provisional ? "Rough figures on the quickest roads. Finding the twisty roads" : "Finding roads between the lanes") + ` (${n} of ${todo})…`;
  $("#routeStatus").textContent = todo ? say(0) : "";
  const b = await routeTrip(trip, () => run === buildRun, () => { if (run === buildRun) $("#routeStatus").textContent = say(++done); });
  if (!b) return;
  // a point that keeps a drawn route to its line but makes it ride up a road and straight back: drop it, build again
  const spurs = trip.items.filter(it => it.drawn && isSpur(trip, b, trip.items.indexOf(it)));
  if (spurs.length) { trip.items = trip.items.filter(it => !spurs.includes(it)); saveTrip(); build(); return; }
  built = b; saveTrip(); drawRoute(); renderRoute(); findRouteStops();
  if (nearAdded && !$("#undoBar").hidden) $("#undoText").textContent = `Added ${nearAdded.n} lane${nearAdded.n > 1 ? "s" : ""}: ${km(b.off - nearAdded.off)} km more off-road, ${km(b.total - b.off - nearAdded.road)} km more road, ${hm(b.hours)} riding now`;
  nearAdded = null;
  // a saved copy of this route keeps the figures it has now
  const all = store.get("saved", []), mine = all.find(o => o.trip && o.name === trip.name && tripSig(o.trip) === tripSig(trip));
  if (mine) { mine.summary = `${km(b.total)} km, ${hm(b.hours)}`; store.set("saved", all); }
}
// Does the route go to item i and come straight back the way it came? (the road in and the road out overlap)
function isSpur(t, b, i){
  const before = b.segs.find(s => s.type === "road" && s.link === i), after = b.segs.find(s => s.type === "road" && s.link === i + 1);
  if (!before || !after || lineLen(before.coords) < 300 || lineLen(after.coords) < 300) return false;
  const tail = [], head = []; let d = 0;
  for (let k = before.coords.length - 1; k > 0 && d < 1000; k--) { tail.push(before.coords[k]); d += hav(before.coords[k], before.coords[k - 1]); }
  d = 0; for (let k = 0; k < after.coords.length - 1 && d < 1000; k++) { head.push(after.coords[k]); d += hav(after.coords[k], after.coords[k + 1]); }
  const back = head.filter(p => distToLine(p, tail) < 30).length;
  return head.length > 3 && back / head.length > 0.6;
}
// Degrees of turning per km, sampled every 20 m so GPS jitter doesn't count.
function bendiness(lines){
  let turn = 0, len = 0;
  for (const c of lines) {
    const pts = [c[0]]; for (const q of c) if (hav(pts.at(-1), q) >= 20) { len += hav(pts.at(-1), q); pts.push(q); }
    for (let i = 2; i < pts.length; i++) {
      const h1 = Math.atan2(pts[i-1][0] - pts[i-2][0], (pts[i-1][1] - pts[i-2][1]) * Math.cos(pts[i][0] * Math.PI / 180));
      const h2 = Math.atan2(pts[i][0] - pts[i-1][0], (pts[i][1] - pts[i-1][1]) * Math.cos(pts[i][0] * Math.PI / 180));
      turn += Math.abs(((h2 - h1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
    }
  }
  return len > 500 ? turn / (len / 1000) : 0;
}
const bendLabel = b => !b ? "–" : b < 90 ? "Straight" : b < 160 ? "Bendy" : "Twisty";
function drawBuilt(layer, t, b, bold, numbers = bold, col = "#c2185b"){
  const R = routeRenderer, op = bold ? 1 : .45, numPlaced = [];
  // a road ride (Scotland: only waypoints, no lanes) is all road, so its roads are the route itself: drawn solid, not as links
  const roadRide = t.items.length && t.items.every(it => it.via);
  if (b && roadRide) for (const s of b.segs) if (s.type === "road") {
    if (bold) L.polyline(s.coords, { color: "#fff", weight: 9, interactive: false, renderer: R }).addTo(layer);
    L.polyline(s.coords, { color: col, weight: bold ? 5 : 3, opacity: op, interactive: false, renderer: R }).addTo(layer);
  }
  if (b && !roadRide) for (const s of b.segs) if (s.type === "road") {
    if (s.lanes) { if (bold) L.polyline(s.coords, { color: "#fff", weight: 9, interactive: false, renderer: R }).addTo(layer); L.polyline(s.coords, { color: col, weight: bold ? 5 : 3, opacity: op, interactive: false, renderer: R }).addTo(layer); }
    else L.polyline(s.coords, { color: col, weight: bold ? 4 : 2.5, opacity: bold ? .9 : .4, dashArray: s.ok === false ? "2 7" : "9 6", interactive: false, renderer: R }).addTo(layer);
  }
  t.items.forEach((it, i) => {
    if (it.via) return;
    if (bold) L.polyline(it.coords, { color: "#fff", weight: 11, opacity: 1, interactive: false, renderer: R }).addTo(layer);
    L.polyline(it.coords, { color: col, weight: bold ? 6 : 4, opacity: op, interactive: false, renderer: R }).addTo(layer);
    if (numbers) {   // a number that would sit on another is left off until you zoom in
      const p = map.latLngToContainerPoint(it.coords[0]);
      if (!numPlaced.some(q => Math.abs(q.x - p.x) < 24 && Math.abs(q.y - p.y) < 22)) { numPlaced.push(p); L.marker(it.coords[0], { interactive: false, icon: L.divIcon({ className: "", html: `<span class="lane-num">${rowNo(t, i)}</span>`, iconSize: [0, 0] }) }).addTo(layer); }
    }
  });
}
// A row's number: the same on the map, in the list, in the GPX and on the ride screen. The points that only keep a
// drawn route to its line aren't counted, as they aren't listed.
function rowNo(t, i){ let n = 0; for (let k = 0; k <= i; k++) if (!t.items[k]?.drawn) n++; return n; }
function drawRoute(){
  routeLayer.clearLayers();
  if ((view !== "route" && !(typeof Ride !== "undefined" && Ride.on)) || !trip.items.length) return;   // (riding a tour day from the tour screen draws it too)
  drawBuilt(routeLayer, trip, built, true);
  if (built) drawArrows(routeLayer, built);
  if (trip.start) flag(trip.start, trip.loop ? "START / FINISH" : "START").addTo(routeLayer);
  if (trip.finish) flag(trip.finish, "FINISH").addTo(routeLayer);
  // A round handle on each road stretch: drag it onto a green lane to take the route that way,
  // or anywhere else to make the road pass through that spot.
  // (only from zoom 13: further out they'd cover the route, and a finger can't place a lane that precisely)
  if (built && !built.provisional && map.getZoom() >= 13 && !(typeof Ride !== "undefined" && Ride.on)) for (const s of built.segs) {
    const len = lineLen(s.coords); if (s.type !== "road" || len < 300) continue;
    // one handle in the middle of a short stretch, one every 5 km or so on a long one
    const n = Math.max(1, Math.round(len / 5000));
    for (let h = 1; h <= n; h++) {
    let half = len * h / (n + 1), at = s.coords[0];
    for (let i = 1; i < s.coords.length; i++) { const d = hav(s.coords[i - 1], s.coords[i]); if (d >= half) { const f = half / d; at = [s.coords[i-1][0] + (s.coords[i][0] - s.coords[i-1][0]) * f, s.coords[i-1][1] + (s.coords[i][1] - s.coords[i-1][1]) * f]; break; } half -= d; }
    dragMarker(at, "", (w, p, st) => { const before = clone(trip); st ? insertAt(s.link, itemStop(st)) : w ? insertAt(s.link, itemFromWay(w)) : onRoad(p).then(q => insertAt(s.link, itemVia(q)));
      undoBar(st ? `Added ${stopName(st)}` : w ? `Added ${laneName(w.tags)}` : "Added a via point", () => { trip = before; built = null; saveTrip(); renderRoute(); drawRoute(); build(); }); }).addTo(routeLayer);
    }
  }
  trip.items.forEach((it, i) => {
    if (!it.via) return;
    dragMarker(it.coords[0], it.drawn ? "via small" : "via", (w, p, st) => {
      const before = clone(trip); undoBar("Moved a via point", () => { trip = before; built = null; saveTrip(); renderRoute(); drawRoute(); build(); });
      if (st) insertAt(i, itemStop(st), true);
      else if (w) insertAt(i, itemFromWay(w), true);
      else onRoad(p).then(q => { Object.assign(it, itemVia(q)); delete it.stop; built = null; saveTrip(); renderRoute(); drawRoute(); build(); });
    }, it.stop ? `<div class="poi-pin via-stop">${poiBadge(it.stop.code)}</div>` : null).addTo(routeLayer);
  });
}
// Lanes near the route that are worth tacking on: at least 300 m long, within about 3 km of it, and needing less
// extra road than 70% of the lane's length (800 m for short ones), judged by where each would fit best in the order.
function nearbyLanes(t, b){
  const line = b.segs.flatMap(sg => sg.coords), seen = new Set(), out = [], pad = 0.027;
  const D = gapFn(), end = t.finish || (t.loop ? t.start : null);
  const ends = [t.start, ...t.items.map(it => it.coords[0]), ...t.items.map(it => it.coords.at(-1))];
  for (let i = 0; i < line.length; i += 10) {
    const p = line[i];
    for (const k of cells([p[0] - pad, p[1] - pad * 1.6, p[0] + pad, p[1] + pad * 1.6])) for (const id of grid.get(k) || []) {
      if (seen.has(id)) continue; seen.add(id);
      const w = osmWays.get(id);
      if (!w || !CLASSES[w.cls].ride || w.len < 300 || inRoute(id) || t.declined?.includes(id) || window.COUNCIL_FLAGS?.ways?.[id] || w.season?.soon) continue;
      if (!settings.useUcr && (w.cls === "ucr" || w.cls === "tro")) continue;
      let extra = Infinity;
      for (let pos = 0; pos <= t.items.length; pos++) {
        const prev = pos === 0 ? t.start : t.items[pos - 1].coords.at(-1), next = pos === t.items.length ? end : t.items[pos].coords[0];
        for (const [a, c] of [[w.coords[0], w.coords.at(-1)], [w.coords.at(-1), w.coords[0]]]) {
          const e = (prev ? D(prev, a) : 0) + (next ? D(c, next) : 0) - (prev && next ? D(prev, next) : 0);
          if (e < extra) extra = e;
        }
      }
      if (extra <= Math.max(800, w.len * 0.7) && ends.every(q => !q || hav(q, w.coords[0]) > 30 || hav(q, w.coords.at(-1)) > 30)) out.push({ w, extra: Math.max(0, extra) });
    }
  }
  return out.sort((a, c) => a.extra / a.w.len - c.extra / c.w.len).slice(0, 6);   // a few at a time: the best value first
}
// Arrows along the whole ride, about every 110 px at this zoom (at most 300), so you can see which way it goes.
function drawArrows(layer, b){
  const line = b.segs.flatMap(sg => sg.coords); if (line.length < 2) return;
  const total = lineLen(line), mpp = 40075016 * Math.cos(map.getCenter().lat * Math.PI / 180) / 2 ** (map.getZoom() + 8);
  const step = Math.max(130 * mpp, total / 300);
  let next = step / 2, along = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], c = line[i], d = hav(a, c);
    while (d > 0 && along + d >= next) {
      const f = (next - along) / d;
      const pa = map.latLngToContainerPoint(a), pc = map.latLngToContainerPoint(c), deg = Math.atan2(pc.y - pa.y, pc.x - pa.x) * 180 / Math.PI;
      // a little to the left of the line (the side you ride on), so on a there-and-back the two ways sit side by side
      const len = Math.hypot(pc.x - pa.x, pc.y - pa.y) || 1, px = pa.x + (pc.x - pa.x) * f + (pc.y - pa.y) / len * 11, py = pa.y + (pc.y - pa.y) * f - (pc.x - pa.x) / len * 11;
      const at = map.containerPointToLatLng([px, py]);
      L.marker(at, { interactive: false, keyboard: false, pane: "route", icon: L.divIcon({ className: "", iconSize: [0, 0],
        html: `<svg class="route-arrow" width="18" height="18" viewBox="0 0 22 22" style="transform:translate(-50%,-50%) rotate(${deg.toFixed(0)}deg)"><path d="M7 4l8 7-8 7" fill="none" stroke="#5b0a2c" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 4l8 7-8 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` }) }).addTo(layer);
      next += step;
    }
    along += d;
  }
}
// A via point dropped on a hillside goes onto the nearest road within 500 m; otherwise the route would ride to the
// nearest road and back, a spur nobody asked for.
async function onRoad(p){
  const r = await localRouter.call({ type: "snap", pts: [p] });
  return r?.[0] && r[0].d < 500 ? r[0].pt : p;
}
function routeWarnings(b, t = trip){
  const warn = [];
  const flagged = t.items.filter(it => it.ids?.some(id => window.COUNCIL_FLAGS?.ways?.[id]));
  if (flagged.length) warn.push(`The council says ${flagged.length > 1 ? `${flagged.length} of these lanes aren't` : `${flagged[0].name} isn't`} open to motors. Take ${flagged.length > 1 ? "them" : "it"} out.`);
  const closing = t.items.filter(it => it.ids?.some(id => { const w = osmWays.get(laneOf.get(id) ?? id); return w?.season?.soon; }));
  if (closing.length) {
    const said = closing.slice(0, 3).map(it => { const w = osmWays.get(laneOf.get(it.ids[0]) ?? it.ids[0]); return `${it.name} (row ${t.items.indexOf(it) + 1}${w?.season ? `, closed ${w.season.text}` : ""})`; });
    warn.push(`Closing to motor vehicles for the winter within the next fortnight: ${said.join("; ")}${closing.length > 3 ? ` and ${closing.length - 3} more` : ""}. Take ${closing.length > 1 ? "them" : "it"} out if you're riding after that.`);
  }
  if (b?.jumps && t === trip) {
    const gaps = b.segs.filter(sg => sg.type === "road" && sg.jump > 100), worst = gaps.reduce((a, g) => g.jump > a.jump ? g : a, gaps[0]);
    warn.push(`${b.jumps === 1 ? "A lane end is" : `${b.jumps} lane ends are`} off the road network, so the GPX draws a straight line there${b.jumps > 1 ? `, the longest ${km(worst.jump)} km` : ` of ${km(worst.jump)} km`}. <a href="#" data-gap>Show me</a>`);
  } else if (b?.jumps) warn.push(`${b.jumps} gap${b.jumps > 1 ? "s" : ""} over 100 m from a road: the GPX draws a straight line there.`);
  const ferries = b?.segs?.filter(sg => sg.ferry).length || 0;
  if (ferries) warn.push(`This route crosses by ferry ${ferries === 1 ? "once" : ferries + " times"}; the time allows 45 minutes a crossing. Check the sailings and book for the bike.`);
  const fallback = b?.segs?.filter(sg => sg.type === "road" && sg.via === "OSRM").length || 0;
  if (fallback && t === trip && !t.keepOrder) warn.push(`The twisty-roads server was busy, so ${fallback} road stretch${fallback > 1 ? "es use" : " uses"} the quickest roads instead. <a href="#" data-retry>Try again</a>`);
  const instead = b?.segs?.filter(sg => sg.instead).length || 0;
  if (instead) warn.push(`The road servers didn't answer for ${instead} stretch${instead > 1 ? "es" : ""}, so ${instead > 1 ? "they follow" : "it follows"} other lanes instead of roads.`);
  const noSignal = b?.segs?.filter(sg => sg.offline).length || 0;
  if (noSignal) warn.push(`${noSignal} road link${noSignal > 1 ? "s" : ""} couldn't be planned: there's no signal, and the roads there aren't saved on this phone. ${noSignal > 1 ? "They show" : "It shows"} as straight lines until you have a signal.`);
  if (b?.failed > noSignal) warn.push(`${b.failed - noSignal} road link${b.failed - noSignal > 1 ? "s" : ""} couldn't be routed.`);
  return warn;
}
function renderRoute(){
  $("#routeName").value = trip.name;
  if (sheet.dataset.state === "min") $("#handleText").textContent = "▲ " + minLabel();   // the lowered panel's title carries the distance
  $("#rStartBtn").textContent = trip.start ? "⚑ Change where it starts" : "⚑ Set where it starts"; $("#rLoop").checked = !!trip.loop;
  $("#backBtn").hidden = !!trip.loop;   // a loop comes back already
  $("#editingBar").hidden = editingDay == null;
  $("#routeBack").hidden = editingDay != null;
  $("#routeBack").textContent = lastKind && ideas.length ? "← Route ideas" : routeFrom.kind === "region" && regionBySlug(routeFrom.slug) ? `← ${regionBySlug(routeFrom.slug).name}` : routeFrom.kind === "lanes" ? "← Find lanes" : `← ${{ plan: "Explore", start: "Plan", saved: "Saved", help: "Help", region: "Back" }[lastBrowse] || "Back"}`;
  if (editingDay != null) $("#editingText").textContent = `Editing day ${editingDay + 1}`;
  const off = trip.items.reduce((t, it) => t + lineLen(it.coords), 0);
  $("#stTime").textContent = built ? hm(built.hours) : "…";
  $("#stKm").textContent = built ? km(built.total) : "…";
  $("#stLane").textContent = built ? Math.round(100 * built.off / built.total) + "%" : "…";
  $("#stTwist").textContent = built ? bendLabel(built.bend) : "…";
  $("#gpxBtn").disabled = !built || !!built.provisional;
  $("#saveBtn").disabled = !built;   // saved with its distance and time, once the route is worked out
  $("#rideBtn").disabled = !built || !!built.provisional;
  $("#vRoute .bigstats").classList.toggle("rough", !!built?.provisional);   // rough figures look rough until the real ones arrive
  const nLanes = trip.items.filter(it => !it.via).length;
  const amber = trip.items.filter(it => it.cls === "ucr" || (it.cls === "tro" && it.kind !== "BOAT")).length;   // (a byway with a seasonal order is still a byway)
  $("#dropUcr").hidden = settings.useUcr || !amber;
  $("#dropUcr").textContent = `Take out the ${amber} unclassified road${amber === 1 ? "" : "s"} already in this route`;
  $("#routeStatus").textContent = built?.provisional ? "Rough figures on the quickest roads. Finding the twisty roads…" : built ? `${nLanes} lane${nLanes !== 1 ? "s" : ""} · ${km(built.off)} km off-road` : "Finding roads between the lanes…";
  $("#routeStatus").title = built ? `Includes ${km(built.joinM || 0)} km of connecting lanes. Roads by ${built.via}.` : "";
  const warn = routeWarnings(built).map(w => /data-(retry|gap)/.test(w) ? esc(w.split(" <a")[0]) + " <a" + w.split(" <a")[1] : esc(w));
  $("#routeWarn").innerHTML = warn.join("<br>");
  const retry = $("#routeWarn [data-retry]"); if (retry) retry.onclick = e => { e.preventDefault(); built = null; renderRoute(); build(); };
  const gap = $("#routeWarn [data-gap]");
  if (gap) gap.onclick = e => {   // zoom to the longest straight line, with its two ends in view
    e.preventDefault(); const g = built.segs.filter(sg => sg.type === "road" && sg.jump > 100).sort((a, c) => c.jump - a.jump)[0]; if (!g) return;
    const c = g.coords, ends = hav(c[0], c[1]) > hav(c.at(-2), c.at(-1)) ? [c[0], c[1]] : [c.at(-2), c.at(-1)];
    if (phone()) setSheet("min"); fitMap(L.latLngBounds(ends).pad(0.6), { maxZoom: 16 });
  }; $("#routeWarn").hidden = !warn.length;
  if (typeof Offline !== "undefined") Offline.refreshButton();
  const near = built && !built.provisional && editingDay == null ? nearbyLanes(trip, built) : [];
  $("#nearBtn").hidden = !near.length;
  if (near.length) {
    const laneKm = near.reduce((a, n) => a + n.w.len, 0), roadKm = near.reduce((a, n) => a + n.extra, 0);
    $("#nearBtn").textContent = `+ Add ${near.length} lane${near.length > 1 ? "s" : ""} close to this route (${km(laneKm)} km of lanes)`;
    $("#nearBtn").onclick = () => {
      const before = clone(trip), was = { off: built.off, road: built.total - built.off, n: near.length };
      for (const n of near) { const it = itemFromWay(n.w); trip.items.push(it); if (trip.keepOrder) placeItem(trip, it); }
      trip.tidy = false; built = null; saveTrip(); renderRoute(); drawRoute(); tidyNow();
      nearAdded = was;   // the Undo bar gives the real difference once the route is rebuilt
      undoBar(`Added ${near.length} lane${near.length > 1 ? "s" : ""}…`, () => { nearAdded = null; trip = before; built = null; saveTrip(); renderRoute(); drawRoute(); buildSoon(300); }, null, 10000);
    };
  }
  const ul = $("#laneList"); ul.innerHTML = "";
  trip.items.forEach((it, i) => {
    if (it.drawn) return;   // the points keeping a drawn route to its line get one line at the end, not a row each
    const li = document.createElement("li");
    const col = it.cls === "file" ? "#0e7490" : it.stop ? GROUPS[CODE[it.stop.code]?.g]?.color || "#5d5848" : it.via ? "#5d5848" : css(CLASSES[it.cls]?.color || "--ucr");
    li.innerHTML = `<span class="num">${rowNo(trip, i)}</span><span class="grow"><span class="t">${esc(it.name)}</span><br><span class="s"><span class="chip" style="background:${col}">${esc(it.kind)}</span> ${it.stop ? "stop on the way" : it.via ? "the road passes through here" : km(lineLen(it.coords)) + " km" + (it.there ? ` (dead end: ${km(lineLen(it.coords) / 2)} km each way, there and back)` : "")}${it.surface ? " · " + esc(it.surface) : ""}</span></span>`;
    li.querySelector(".grow").onclick = () => { if (phone()) setSheet("min"); it.via ? map.setView(it.coords[0], 15) : fitMap(L.latLngBounds(it.coords).pad(0.3), { maxZoom: 15 }); };
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", "Take out " + it.name);
    x.onclick = () => removeItem(i);
    li.append(x); ul.append(li);
  });
  const drawnN = trip.items.filter(it => it.drawn).length;
  if (drawnN) ul.insertAdjacentHTML("beforeend", `<li class="muted small">And ${drawnN} small dot${drawnN > 1 ? "s" : ""} on the map keeping the roads to the line you drew: drag one to move it.</li>`);
  renderStops();
}
$("#routeName").oninput = e => { trip.name = e.target.value || "My route"; saveTrip(); $("#offlineNote").hidden = true; if (typeof Offline !== "undefined") Offline.refreshButton(); };
$("#dropUcr").onclick = () => {
  trip.items = trip.items.filter(it => it.via || !(it.cls === "ucr" || (it.cls === "tro" && it.kind !== "BOAT")));
  built = null; saveTrip();
  if (!trip.items.length) { showView("plan", "peek"); return; }
  renderRoute(); drawRoute(); build();
};
// Where a route of tapped lanes starts, and whether it comes back there: the order is then worked out from it
$("#rStartBtn").onclick = () => pickSpot("Tap the map where the route starts", (p, name) => {
  trip.start = p; if (!trip.finish) trip.loop = $("#rLoop").checked; built = null; saveTrip();
  showView("route", "mid"); renderRoute(); tidyNow(); status(`Starts at ${name || "the spot you tapped"}`, 3000);
});
$("#rLoop").onchange = e => { trip.loop = e.target.checked; if (trip.loop) trip.finish = null; built = null; saveTrip(); renderRoute(); tidyNow(); };
// Come back the same way: the route out, then the same lanes back in reverse, finishing where it began
$("#backBtn").onclick = () => {
  if (!trip.items.length) return;
  const back = trip.items.slice().reverse().map(it => ({ ...clone(it), coords: it.coords.slice().reverse() }));
  const start = trip.start || trip.items[0].coords[0];
  trip.items = trip.items.concat(back); trip.start = start; trip.finish = null; trip.loop = true; trip.keepOrder = true;
  if (!/there and back/.test(trip.name)) trip.name += ", there and back";
  built = null; saveTrip(); renderRoute(); drawRoute(); build();
};
$("#revBtn").onclick = () => {
  trip.items.reverse(); trip.items.forEach(it => it.coords = it.coords.slice().reverse());
  if (!trip.loop) [trip.start, trip.finish] = [trip.finish, trip.start];
  built = null; saveTrip(); renderRoute(); drawRoute(); build();
};
function armed(btn, label, then){
  if (!btn.dataset.armed) { btn.dataset.armed = 1; btn.textContent = "Sure? Tap again"; setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000); return; }
  delete btn.dataset.armed; btn.textContent = label; then();
}
// New route asks first, in the panel: save it, clear it, or keep going.
function clearRoute(){ dropUndo(); trip = newTrip(); built = null; editingDay = null; lastKind = null; saveTrip(); routeStopIdx = new Set(); routeStops = []; showView("plan", "peek"); }
$("#newBtn").onclick = () => { $("#newConfirm").hidden = !$("#newConfirm").hidden; if (!$("#newConfirm").hidden) $("#newClear").focus(); };
$("#newCancel").onclick = () => { $("#newConfirm").hidden = true; $("#newBtn").focus(); };
$("#newClear").onclick = clearRoute;
$("#newSaveFirst").onclick = () => { saveItem({ name: trip.name, trip, summary: built ? `${km(built.total)} km, ${hm(built.hours)}` : "" }); clearRoute(); };
document.querySelectorAll("#routeTabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#routeTabs button").forEach(x => x.setAttribute("aria-pressed", x === b));
  $("#rtLanes").hidden = b.dataset.rt !== "lanes"; $("#rtStops").hidden = b.dataset.rt !== "stops";
  if (b.dataset.rt === "stops" && !stops) loadStops().then(findRouteStops); else renderStops();
});
$("#editingBack").onclick = () => {   // back to the tour, keeping what you changed (Undo puts the day back as it was)
  if (editingDay == null) return;
  const d = editingDay, changed = tour && tripSig(tour.days[d].trip) !== tripSig(trip);
  if (!changed) { editingDay = null; trip = dayBefore || newTrip(); dayBefore = null; built = null; saveTrip(); showView("tour", "mid"); renderTour(); return; }
  const old = clone(tour.days[d]), wasEdited = tour.edited;
  $("#editingSave").click();
  undoBar(`Day ${d + 1} saved to your tour`, () => { if (!tour?.days[d]) return; tour.days[d] = old; tour.edited = wasEdited; saveTour(); renderTour(); }, null, 8000);
};
$("#editingSave").onclick = () => {
  if (editingDay == null || !tour) return;
  const d = tour.days[editingDay]; if (tripSig(d.trip) !== tripSig(trip)) tour.edited = true;   // saving an unchanged day isn't an edit
  d.trip = clone(trip); d.built = built; d.stops = routeStops;
  saveTour(); editingDay = null; trip = dayBefore || newTrip(); dayBefore = null; built = null; saveTrip();
  showView("tour", "mid"); renderTour(); status("Saved to your tour");
};

/* ---------- stops along a route ---------- */
let routeStops = [];
// Walk the whole ride in 150 m steps, noting how far along each nearby stop is.
function stopsAlong(b){
  const line = b.segs.flatMap(s => s.coords), found = new Map();
  let along = 0, last = line[0], since = Infinity;
  for (const p of line) {
    const d = hav(last, p); along += d; since += d; last = p;
    if (since < 150) continue; since = 0;
    for (const i of stopsNear(p, 1)) {
      const s = stops[i], limit = s.code === "fuel" ? 2000 : CODE[s.code].g === "stay" ? 1500 : 800, off = hav(p, [s.lat, s.lng]);
      if (off > limit) continue;
      const f = found.get(i); if (!f || off < f.off) found.set(i, { i, off, along });
    }
  }
  // keep a sensible spread: the nearest of each kind in every 2 km of route (up to 3 places to stay),
  // so a route through a town lists a handful of cafés, not every one in it
  const buckets = new Map();
  for (const r of found.values()) {
    const g = CODE[stops[r.i].code].g, k = g + ":" + Math.floor(r.along / 2000);
    if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r);
  }
  const list = [...buckets.entries()].flatMap(([k, rs]) => rs.sort((a, c) => a.off - c.off).slice(0, k.startsWith("stay") ? 3 : 1)).sort((a, c) => a.along - c.along);
  const fuel = [...found.values()].filter(r => stops[r.i].code === "fuel").map(r => r.along).sort((a, c) => a - c);
  const marks = [0, ...fuel, along]; let gap = 0; for (let i = 1; i < marks.length; i++) gap = Math.max(gap, marks[i] - marks[i - 1]);
  return { list, fuelGap: gap, fuelCount: fuel.length };
}
async function findRouteStops(){
  if (!built) return;
  if (!stops) { await loadStops(); if (!stops || !built) return; }   // (the route may be being rebuilt by now)
  const r = stopsAlong(built);
  routeStops = r.list; built.fuelGap = r.fuelGap; built.fuelCount = r.fuelCount;
  renderStops(); drawRouteStops();
}
function drawRouteStops(){
  routeStopLayer.clearLayers(); routeStopIdx = new Set();
  if (!stops || map.getZoom() < 10) return;
  const lists = view === "route" ? [routeStops] : view === "tour" && tour ? tour.days.filter((d, i) => tourPick < 0 || i === tourPick).map(d => d.stops || []) : [];
  const off = new Map(), idxs = [];
  for (const list of lists) for (const r of list) { if (!groupOn(stops[r.i].code)) continue; routeStopIdx.add(r.i); off.set(r.i, r.off); idxs.push(r.i); }
  drawPicked(routeStopLayer, idxs, i => off.get(i));
}
function renderStops(){
  if (!built || !stops) { $("#stopList").innerHTML = `<li class="muted">${built ? "Loading stops…" : "Stops appear once the route is ready."}</li>`; $("#fuelNote").textContent = ""; $("#stopChips").innerHTML = ""; return; }
  $("#stopChips").innerHTML = `<span class="small muted">Showing the kinds turned on with Show, at the top of the map.</span>`;
  $("#fuelNote").textContent = built.fuelCount === 0 ? "No fuel within 2 km of this route. Fill up before you set off."
    : `Longest stretch without fuel: ${km(built.fuelGap)} km.` + (built.fuelGap > 150000 ? " That's a long way on a small tank." : "");
  const ul = $("#stopList"); ul.innerHTML = "";
  const list = routeStops.filter(r => groupOn(stops[r.i].code));
  if (!list.length) ul.innerHTML = `<li class="muted">Nothing of the kinds you've turned on near the route.</li>`;
  for (const r of list) {
    const s = stops[r.i];
    const li = document.createElement("li");
    const planned = trip.items.findIndex(it => it.stop && hav(it.coords[0], [s.lat, s.lng]) < 5);
    li.innerHTML = `${poiBadge(s.code)}<span class="grow" role="button" tabindex="0"><span class="t">${esc(stopName(s))}</span><br><span class="s">${s.name ? esc(CODE[s.code].one) + " · " : ""}${r.along < 500 ? "at the start" : `${km(r.along)} km along${built?.total ? `, about ${mins(built.hours * r.along / built.total)} in` : ""}`} · ${r.off < 60 ? "on the route" : r.off < 950 ? Math.round(r.off / 50) * 50 + " m off it" : km(r.off) + " km off it"}</span></span>`;
    // tap the row to see the place on the map; the button makes it a planned stop the route goes through (or takes it out)
    li.querySelector(".grow").onclick = () => {
      if (phone()) setSheet("min");
      map.setView([s.lat, s.lng], 16);
      setTimeout(() => L.popup({ maxWidth: 300 }).setLatLng([s.lat, s.lng]).setContent(stopPopup(s)).openOn(map), 80);
    };
    const b = document.createElement("button"); b.className = "btn " + (planned >= 0 ? "" : "quiet"); b.style.minHeight = "44px";
    b.textContent = planned >= 0 ? "✓ Stopping" : "+ Stop"; b.setAttribute("aria-label", (planned >= 0 ? "Take out stop at " : "Stop at ") + stopName(s));
    b.onclick = () => planned >= 0 ? removeItem(planned) : addStop(s);
    li.append(b);
    ul.append(li);
  }
}

/* ---------- GPX ---------- */
function simplifyTrack(pts, maxPts){ if (pts.length <= maxPts) return pts; for (let tol = 3; tol < 200; tol *= 1.5) { const s = dp(pts, tol); if (s.length <= maxPts) return s; } return pts; }
function dp(pts, tol){
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const k = 111320, cos = Math.cos(pts[0][0] * Math.PI / 180), xy = pts.map(p => [p[1] * k * cos, p[0] * k]);
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(), [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const [px, py] = xy[i]; const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0; const d = Math.hypot(px - ax - t * dx, py - ay - t * dy); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// parts: [{ name, trip, built, stops, prefix, nightAt, nightName }]. One track per part (one per day on a tour).
function gpxText(title, parts){
  const f = n => n.toFixed(6), x = esc, w = [], trks = [];
  const budget = Math.floor(9000 / parts.length);   // older Garmins cut tracks at 10,000 points
  parts.forEach((p, n) => {
    if (n === 0 && p.trip.start) w.push(`<wpt lat="${f(p.trip.start[0])}" lon="${f(p.trip.start[1])}"><name>Start</name><sym>Flag, Blue</sym></wpt>`);
    // lanes are numbered as on the map and in the list (L3 is the third row), so the GPX and the app agree
    p.trip.items.forEach((it, i) => { const ln = rowNo(p.trip, i); w.push(it.stop ? `<wpt lat="${f(it.coords[0][0])}" lon="${f(it.coords[0][1])}"><name>${x(`${p.prefix}Stop: ${it.name}`.slice(0, 40))}</name><desc>${x(it.kind)}, a stop you chose</desc><sym>${CODE[it.stop.code]?.sym || "Waypoint"}</sym></wpt>`
      : it.drawn ? ""   // the points that keep a drawn route to its line are in the track already
      : it.via ? `<wpt lat="${f(it.coords[0][0])}" lon="${f(it.coords[0][1])}"><name>${x(`${p.prefix}${it.name && it.name !== "Via point" ? it.name : "Via " + (i + 1)}`.slice(0, 40))}</name><sym>Waypoint</sym></wpt>`
      : `<wpt lat="${f(it.coords[0][0])}" lon="${f(it.coords[0][1])}"><name>${x(`${p.prefix}L${ln} ${it.name}`.slice(0, 40))}</name><desc>${x(`${it.kind}, ${km(lineLen(it.coords))} km`)}</desc><sym>Flag, Green</sym></wpt>`); });
    // stops along the way: planned stops are already in, and the rest are thinned to one of each kind every 5 km,
    // or a sat nav screen fills with every café in the one town the route passes through
    const planned = p.trip.items.filter(it => it.stop).map(it => it.coords[0]), seen = new Set();
    if (stops) for (const r of p.stops || []) { const s = stops[r.i]; const k = CODE[s.code].g + ":" + Math.floor(r.along / 5000);
      if (!groupOn(s.code) || seen.has(k) || planned.some(q => hav(q, [s.lat, s.lng]) < 30)) continue; seen.add(k); w.push(`<wpt lat="${f(s.lat)}" lon="${f(s.lng)}"><name>${x((CODE[s.code].one + ": " + (s.name || "")).replace(/: $/, "").slice(0, 40))}</name><desc>${x(`${p.prefix}${km(r.along)} km in${s.extra ? ", " + s.extra : ""}`)}</desc><sym>${CODE[s.code].sym}</sym></wpt>`); }
    if (p.nightAt) w.push(`<wpt lat="${f(p.nightAt[0])}" lon="${f(p.nightAt[1])}"><name>${x(p.nightName.slice(0, 40))}</name><sym>Lodging</sym></wpt>`);
    let pts = []; for (const s of p.built.segs) for (const q of s.coords) { const l = pts.at(-1); if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q); }
    pts = simplifyTrack(pts, budget);
    trks.push(`<trk><name>${x(p.name)}</name><trkseg>\n${pts.map(q => `<trkpt lat="${f(q[0])}" lon="${f(q[1])}"/>`).join("\n")}\n</trkseg></trk>`);
  });
  const last = parts.at(-1).trip;
  const lastPart = parts.at(-1);   // a day that ends at its night stop already has that waypoint, so no second "Finish" on top of it
  if (last.finish && !(lastPart.nightAt && hav(lastPart.nightAt, last.finish) < 300)) w.push(`<wpt lat="${f(last.finish[0])}" lon="${f(last.finish[1])}"><name>Finish</name><sym>Flag, Red</sym></wpt>`);
  const tot = parts.reduce((a, p) => a + p.built.total, 0), off = parts.reduce((a, p) => a + p.built.off, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Green Lanes Planner" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${x(title)}</name><desc>${x(`${km(tot)} km, ${km(off)} km on lanes.`)}</desc><time>${new Date().toISOString()}</time></metadata>
${w.join("\n")}
${trks.join("\n")}
</gpx>
`;
}
// On a phone the GPX goes through the share sheet, straight into OsmAnd, Locus, Files or AirDrop; an iPhone can
// open a plain download as raw text. Elsewhere, or if sharing isn't offered or is cancelled, it downloads.
function download(name, text){
  const fname = (name.replace(/[^\w\- ]+/g, "").trim() || "route").replace(/\s+/g, "-") + ".gpx";
  const save = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/gpx+xml" })); a.download = fname;
    document.body.append(a); a.click(); a.remove(); status(`Saved ${fname}`);
  };
  let file = null; try { file = new File([text], fname, { type: "application/gpx+xml" }); } catch {}
  if (phone() && file && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: name }).then(() => status(`Sent ${fname}`)).catch(err => { if (err?.name !== "AbortError") save(); });
  } else save();
  return text;
}
$("#gpxBtn").onclick = () => built && download(trip.name, gpxText(trip.name, [{ name: trip.name, trip, built, stops: routeStops, prefix: "" }]));

/* ---------- saved routes and tours ---------- */
let undoTimer = null, undoCommit = null;
function dropUndo(){ clearTimeout(undoTimer); const c = undoCommit; undoCommit = null; $("#undoBar").hidden = true; c?.(); }   // something else opened: that undo no longer applies
function undoBar(text, undo, commit, ms = 6000){
  clearTimeout(undoTimer); if (undoCommit) undoCommit();   // a second one settles the first (and the first's timer can't hide this one)
  $("#undoText").textContent = text; $("#undoBar").hidden = false; undoCommit = commit;
  // on an upright phone it sits on the map just above the panel, so it doesn't cover the next row in the list
  // (unless the panel is up so high there's no map to sit on)
  const top = phone() && !Ride.on ? sheet.getBoundingClientRect().top : 0;
  $("#undoBar").style.bottom = top > 180 ? `${innerHeight - top + 10}px` : "";
  $("#undoGo").onclick = () => { clearTimeout(undoTimer); undoCommit = null; $("#undoBar").hidden = true; undo(); };
  undoTimer = setTimeout(() => { $("#undoBar").hidden = true; const c = undoCommit; undoCommit = null; c?.(); }, ms);
}
function renderSaved(){
  const saved = store.get("saved", []);
  // what's open now comes first, so it's one tap back after reopening the app
  const now = $("#openNow"); now.innerHTML = "";
  const openCard = (title, sub, go) => { const c = document.createElement("div"); c.className = "card"; c.innerHTML = `<div class="top"><h3>${esc(title)}</h3></div><div class="small muted">${esc(sub)}</div>`;
    const b = document.createElement("button"); b.className = "btn primary"; b.textContent = "Open"; b.onclick = e => { e.stopPropagation(); go(); }; c.querySelector(".top").append(b); c.onclick = go; now.append(c); };
  const openSaved = saved.find(o => o.trip && o.name === trip.name && tripSig(o.trip) === tripSig(trip));
  if (trip.items.length && !openSaved) openCard(trip.name || "Your route", `Open now · ${built ? `${km(built.total)} km, ${hm(built.hours)}` : `${trip.items.length} lanes`}`, () => {
    showView("route", "mid"); renderRoute(); fitMap(L.latLngBounds(trip.items.flatMap(it => it.coords)).pad(0.1)); if (!built) build(); });
  if (tour?.days?.length) openCard(tour.name || "Your tour", `Open now · ${tour.days.length} day${tour.days.length > 1 ? "s" : ""}`, () => openTour());
  $("#savedHead").hidden = !saved.length; $("#savedEmpty").hidden = !!saved.length;
  const ul = $("#savedList"); ul.innerHTML = "";
  saved.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="grow"><span class="t">${s.tour ? "⛺ " : ""}${esc(s.name)}</span><br><span class="s">${esc(s.summary || "")} · saved ${new Date(s.when).toLocaleDateString("en-GB")}</span></span>`;
    li.querySelector(".grow").onclick = () => {
      if (s.tour) { tour = clone(s.tour); saveTour(); openTour(); return; }
      if (trip.items.length && editingDay == null && !saved.some(o => o.trip && tripSig(o.trip) === tripSig(trip))) keepCurrent();   // the open route, if it isn't saved, is kept
      dropUndo(); trip = clone(s.trip); built = null; editingDay = null; lastKind = null; ideas = []; routeFrom = { kind: "plan" }; saveTrip(); showView("route", "mid"); renderRoute();
      fitMap(L.latLngBounds(trip.items.flatMap(it => it.coords)).pad(0.1)); build();
    };
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", "Delete " + s.name);
    x.onclick = () => {
      const all = store.get("saved", []), k = all.findIndex(o => o.name === s.name && o.when === s.when); if (k < 0) return;
      const [gone] = all.splice(k, 1); store.set("saved", all); renderSaved();
      // six seconds to change your mind; the no-signal copy goes only once it's final
      undoBar(`Deleted “${gone.name}”`, () => { const now = store.get("saved", []); now.splice(Math.min(k, now.length), 0, gone); store.set("saved", now); renderSaved(); },
        () => { if (typeof Offline !== "undefined" && !store.get("saved", []).some(o => o.name === gone.name)) Offline.forget(gone.name); });
    };
    li.dataset.name = s.name; li.append(x); ul.append(li);
    if (s === openSaved) li.querySelector(".s").append(" · open now");
  });
  // mark the ones kept for use with no signal
  if (typeof Offline !== "undefined") Offline.keptNames().then(names => { for (const li of ul.children) if (names.has(li.dataset.name)) li.querySelector(".s").append(" · ready with no signal"); });
}
// Only say "Saved" when it was. Tours are large, so if storage is full the oldest saved items make way first.
function saveItem(entry, replace = false){
  // the same route saved again replaces its old copy; a different route with the same name gets a number instead
  const own = entry.trip || entry.tour, stamp = own?.savedAt;   // when this route was last saved: its own saved copy carries the same time
  const same = s => (stamp && s.when === stamp) || s.name === entry.name && ((entry.tour ? !!s.tour && tripSig(s.tour.days[0]?.trip || {items: []}) === tripSig(entry.tour.days[0]?.trip || {items: []}) : s.trip && entry.trip && tripSig(s.trip) === tripSig(entry.trip)));
  const taken = store.get("saved", []).filter(s => s.name === entry.name && !same(s));
  const updating = store.get("saved", []).some(s => s.name === entry.name);
  if (taken.length) {
    let k = 2; const names = new Set(store.get("saved", []).map(s => s.name)); while (names.has(`${entry.name} (${k})`)) k++; entry = { ...entry, name: `${entry.name} (${k})` };
    // the route takes the new name too, so saving it again updates this copy rather than making (3), (4)…
    if (own) own.name = entry.name;
    if (entry.trip === trip) { $("#routeName").value = entry.name; saveTrip(); }
    if (entry.tour && entry.tour === tour) { saveTour(); if (typeof renderTour === "function" && view === "tour") renderTour(); }
  }
  const when = Date.now(); if (own) own.savedAt = when;
  let all = store.get("saved", []).filter(s => s.name !== entry.name && !same(s)); all.unshift({ ...entry, when }); all = all.slice(0, 30);   // (a renamed route replaces its old copy)
  while (all.length && !store.set("saved", all)) { if (all.length === 1) break; all.pop(); }
  const ok = store.get("saved", []).some(s => s.name === entry.name);
  status(ok ? `${updating && !taken.length ? "Updated" : "Saved"} “${entry.name}”` : "Couldn't save: this browser's storage is full or turned off (private browsing?). Download the GPX to keep it.", ok ? 2500 : 6000);
  return ok;
}
$("#saveBtn").onclick = () => editingDay != null ? $("#editingSave").click() : saveItem({ name: trip.name, trip, summary: built ? `${km(built.total)} km, ${hm(built.hours)}` : "" }, true);

/* ---------- multi-day tours ----------
   1. Find a way from start to finish through lane country: a shortest path over the 10 km lane squares,
      where squares with more lane cost less to cross. The off-road slider sets how far it will bend.
   2. Split that line into days of roughly equal length, and at each split find a place to stay:
      somewhere with a choice of hotels, B&Bs, hostels or campsites close to the line.
   3. Plan each day like a drawn route, fitted to the hours per day, then route its roads. */
let tour = store.get("tour", null), tourPick = -1, tourRun = 0;
const tourLayer = L.layerGroup().addTo(map);
const saveTour = () => store.set("tour", tour);
const daysTxt = n => `${n} day${n === 1 ? "" : "s"}`;
const tourPlaces = { start: null, end: null };
function zonePath(a, b, avoid){
  const ci = p => [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)];
  const [ai, aj] = ci(a), [bi, bj] = ci(b), pad = 5;
  const i0 = Math.min(ai, bi) - pad, i1 = Math.max(ai, bi) + pad, j0 = Math.min(aj, bj) - pad * 2, j1 = Math.max(aj, bj) + pad * 2;
  const k = 0.25 + 0.4 * (1 - settings.mix / 100);           // how much lane country bends the line
  const centre = (i, j) => [(i + .5) * CELL, (j + .5) * CELL];
  const key = (i, j) => i + "," + j, rich = kk => Math.min(1, (zoneSum.get(kk) || 0) / 25000);
  const dist = new Map([[key(ai, aj), 0]]), from = new Map(), heap = [[0, ai, aj]];
  const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2*i+1, r = l+1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, i, j] = pop(), kk = key(i, j);
    if (d > (dist.get(kk) ?? Infinity)) continue;
    if (i === bi && j === bj) break;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj; if (ni < i0 || ni > i1 || nj < j0 || nj > j1) continue;
      const nk = key(ni, nj), step = hav(centre(i, j), centre(ni, nj)) * (1 - k * rich(nk)) * (avoid?.has(nk) ? 1.7 : 1);
      if (d + step < (dist.get(nk) ?? Infinity)) { dist.set(nk, d + step); from.set(nk, kk); push([d + step, ni, nj]); }
    }
  }
  const path = []; for (let kk = key(bi, bj); kk; kk = from.get(kk)) path.push(kk);
  path.reverse();
  const pts = [a, ...path.slice(1, -1).map(kk => { const [i, j] = kk.split(",").map(Number); return centre(i, j); }), b];
  // smooth the stair-steps of the grid, then thin
  let sm = pts;
  for (let r = 0; r < 2; r++) { const o = [sm[0]]; for (let i = 0; i < sm.length - 1; i++) { const p = sm[i], q = sm[i + 1]; o.push([p[0] * .75 + q[0] * .25, p[1] * .75 + q[1] * .25], [p[0] * .25 + q[0] * .75, p[1] * .25 + q[1] * .75]); } o.push(sm.at(-1)); sm = o; }
  return { line: thin(sm, 400), cells: new Set(path) };
}
function pointAlong(line, frac){
  const total = lineLen(line), target = total * frac; let acc = 0;
  for (let i = 1; i < line.length; i++) { const d = hav(line[i-1], line[i]); if (acc + d >= target) { const t = (target - acc) / (d || 1); return { p: [line[i-1][0] + (line[i][0] - line[i-1][0]) * t, line[i-1][1] + (line[i][1] - line[i-1][1]) * t], idx: i }; } acc += d; }
  return { p: line.at(-1), idx: line.length - 1 };
}
// Places to stay near a point, best first: a town with several choices beats a lone B&B, closer beats further.
function stayOptions(p, radiusM){
  const allowed = new Set(Object.entries(settings.sleep).filter(([, v]) => v).map(([k]) => k));
  const cand = stopsNear(p, Math.ceil(radiusM / 5000) + 1).filter(i => allowed.has(stops[i].code) && hav(p, [stops[i].lat, stops[i].lng]) <= radiusM);
  const scored = cand.map(i => {
    const s = stops[i], at = [s.lat, s.lng];
    const choice = stopsNear(at, 1).filter(j => allowed.has(stops[j].code) && hav(at, [stops[j].lat, stops[j].lng]) < 2000).length;
    return { i, score: Math.min(choice, 8) * 1.2 - hav(p, at) / 2500, choice };
  }).sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of scored) { if (out.length >= 6) break; const s = stops[c.i]; if (out.every(o => hav([stops[o.i].lat, stops[o.i].lng], [s.lat, s.lng]) > 400)) out.push(c); }
  return out;
}
async function placeName(p){
  const r = await polite("nominatim", `https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&lat=${p[0].toFixed(5)}&lon=${p[1].toFixed(5)}`);
  try { const a = JSON.parse(r.text).address || {}; return a.village || a.town || a.city || a.hamlet || a.suburb || a.county || ""; } catch { return ""; }
}
function openTour(){
  showView("tour", "mid"); $("#tourBack").textContent = backLabel();
  placeSettings("tour");
  $("#tourSetup").hidden = !!tour; $("#tourResult").hidden = !tour;
  // nights and stops need the places data; a ready-made or saved tour can open before it has loaded
  if (tour && !stops) loadStops().then(() => { if (view === "tour" && tour) renderTour(); });
  if (tour) { renderTour(); if (tour.days.length) fitMap(L.latLngBounds(tour.days.flatMap(d => d.trip.items.flatMap(it => it.coords)).concat([tour.start, tour.end])).pad(0.05)); }
  else renderTourSetup();
}
$("#goTour").onclick = () => { if (tour?.days?.length && !featNames().has(tour.name)) saveItem({ name: tour.name || "My tour", tour, summary: daysTxt(tour.days.length) }); tour = null; tourPick = -1; openTour(); };
$("#tourBack").onclick = () => { tourRun++; tourLayer.clearLayers(); goBack(); };
// A rough size for the tour before the long wait. Planned tours so far come out at about 2.1 times the straight
// distance and average about 29 km/h including the lanes, so this is a guide, not a promise.
function tourEstimate(){
  const el = $("#tourEst"); if (!el) return;
  if (!tourPlaces.start || !tourPlaces.end) { el.textContent = ""; return; }
  const kmEst = hav(tourPlaces.start.p, tourPlaces.end.p) * ($("#tRound").checked ? 2 : 1) * 2.1 / 1000, hrs = kmEst / 29;
  const days = settings.days || Math.max(1, Math.ceil(hrs / settings.dayHours - 0.15));
  el.textContent = `Roughly ${Math.round(kmEst / 10) * 10} km and ${Math.round(hrs)} h of riding: ${settings.days ? `${days} days at about ${Math.round(hrs / days * 10) / 10} h a day` : `about ${days} day${days > 1 ? "s" : ""} at ${settings.dayHours} h a day`}. Planning takes a minute or so.`;
}
function renderTourSetup(){
  tourEstimate();
  $("#tStartPicked").textContent = tourPlaces.start ? "✓ Set" : "";
  $("#tEndPicked").textContent = tourPlaces.end ? "✓ Set" : "";
  if (tourPlaces.start && !$("#tStart").value) $("#tStart").value = tourPlaces.start.name;
  if (tourPlaces.end && !$("#tEnd").value) $("#tEnd").value = tourPlaces.end.name;
  const chips = $("#sleepChips"); chips.innerHTML = "";
  for (const [k, label] of [["hotel", "Hotels"], ["guest", "B&Bs"], ["hostel", "Hostels"], ["camp", "Campsites"]]) {
    const b = document.createElement("button"); b.setAttribute("aria-pressed", !!settings.sleep[k]); b.textContent = label;
    b.onclick = () => { settings.sleep[k] = !settings.sleep[k]; if (!Object.values(settings.sleep).some(Boolean)) settings.sleep[k] = true; saveSettings(); renderTourSetup(); };
    chips.append(b);
  }
  tourLayer.clearLayers();
  if (tourPlaces.start) flag(tourPlaces.start.p, "START").addTo(tourLayer);
  if (tourPlaces.end) flag(tourPlaces.end.p, "FINISH").addTo(tourLayer);
}
async function searchPlace(q){
  const r = await polite("nominatim", `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`);
  try { const d = JSON.parse(r.text)[0]; return d ? { p: [+d.lat, +d.lon], name: d.display_name.split(",").slice(0, 2).join(",") } : null; } catch { return null; }
}
for (const which of ["start", "end"]) {
  const input = $(which === "start" ? "#tStart" : "#tEnd");
  input.onkeydown = async e => {
    if (e.key !== "Enter") return; e.preventDefault();
    const typed = input.value.trim();
    if (!typed) { tourPlaces[which] = null; renderTourSetup(); return; }   // an emptied box clears the place
    const found = await searchPlace(typed);
    // not found: the box no longer shows the old place as set
    if (!found) { tourPlaces[which] = null; renderTourSetup(); status(navigator.onLine ? `Couldn't find “${typed}”. Check the spelling, or tap “Tap map” and choose the spot.` : "No signal, so places can't be looked up. Tap “Tap map” and choose the spot instead.", 6000); return; }
    found.name = found.name.split(",")[0]; input.value = found.name;   // the place it found, which may not be the one you meant: so it says which
    tourPlaces[which] = found; renderTourSetup();
    // with both ends chosen, show both; otherwise the one just found
    const other = tourPlaces[which === "start" ? "end" : "start"];
    if (other?.p) fitMap(L.latLngBounds([found.p, other.p]).pad(0.25), { maxZoom: 11 }); else viewAt(found.p, 10);
  };
  input.onchange = () => input.onkeydown({ key: "Enter", preventDefault(){} });
  $(which === "start" ? "#tStartMap" : "#tEndMap").onclick = () => pickSpot(`Tap the map where the tour ${which === "start" ? "starts" : "finishes"}`, async (p, found) => {
    tourPlaces[which] = { p, name: found || "Map point" }; openTour(); renderTourSetup();   // found: the name, if it was picked from search
    if (found) return;
    const n = await placeName(p); if (n) { tourPlaces[which].name = n; renderTourSetup(); }
  });
}
$("#tRound").onchange = e => { $("#tEnd").placeholder = e.target.checked ? "Furthest point, town or postcode" : "Town or postcode"; tourEstimate(); };
$("#dhMinus").onclick = () => { settings.dayHours = Math.max(2, settings.dayHours - 0.5); saveSettings(); syncSettings(); tourEstimate(); };
$("#dhPlus").onclick = () => { settings.dayHours = Math.min(10, settings.dayHours + 0.5); saveSettings(); syncSettings(); tourEstimate(); };
$("#dMinus").onclick = () => { settings.days = settings.days ? (settings.days > 1 ? settings.days - 1 : null) : null; saveSettings(); syncSettings(); tourEstimate(); };
$("#dPlus").onclick = () => { settings.days = Math.min(14, (settings.days || 1) + 1); saveSettings(); syncSettings(); tourEstimate(); };
$("#tourGo").onclick = () => planTour();
async function planTour(){
  if (!tourPlaces.start || !tourPlaces.end) { status("Set a start and a finish first"); return; }
  const run = ++tourRun, alive = () => run === tourRun && !$("#busy").hidden, before = tour;
  busy.show("Planning your tour", () => { tourRun++; tour = before; saveTour(); openTour(); status("Tour planning cancelled"); });
  busy.set("Loading places to stay…", 0.02);
  await loadStops(); if (!stops || !alive()) return;
  const round = $("#tRound").checked, A = tourPlaces.start.p, B = tourPlaces.end.p;
  busy.set("Finding a way through lane country…", 0.05);
  await sleep(30);
  const out = zonePath(A, B);
  let line = out.line;
  if (round) { const back = zonePath(B, A, out.cells); line = line.concat(back.line.slice(1)); }
  // how many days: estimate ride time along the line
  const share = 0.4 - 0.3 * settings.mix / 100;
  const speed = 1 / (share / LANE_KMH + (1 - share) / roadKmh());
  const estH = lineLen(line) * 1.35 * twistF() / 1000 / speed;
  const days = settings.days || Math.max(1, Math.round(estH / settings.dayHours));
  // nights
  const nights = [];
  for (let k = 1; k < days; k++) {
    busy.set(`Finding somewhere to stay on night ${k}…`, 0.05 + 0.1 * k / days);
    const { p } = pointAlong(line, k / days);
    let opts = stayOptions(p, 10000); if (!opts.length) opts = stayOptions(p, 25000);
    const s = opts.length ? stops[opts[0].i] : null;
    const at = s ? [s.lat, s.lng] : p;
    const town = await placeName(at); if (!alive()) return;
    nights.push({ at, want: p, town, stay: opts[0]?.i ?? null, options: opts.map(o => o.i) });
  }
  // days
  const ends = [A, ...nights.map(n => n.at), round ? A : B];
  const idx = [0, ...nights.map(n => nearestIdx(line, n.at)), line.length - 1];
  tour = { name: `${tourPlaces.start.name.split(",")[0]} to ${tourPlaces.end.name.split(",")[0]}${round ? " and back" : ""}`, start: A, end: round ? A : B, round, line, nights, days: [], dayHours: settings.dayHours };
  const wr = mixToWr(settings.mix);
  for (let d = 0; d < days; d++) {
    busy.set(`Planning day ${d + 1} of ${days}: picking lanes and checking roads…`, 0.15 + 0.45 * d / days);
    const sk = [ends[d], ...line.slice(Math.min(idx[d], idx[d + 1]) + 1, Math.max(idx[d], idx[d + 1])), ends[d + 1]];
    const plan = await fitPlan(thin(sk, 300), Math.max(8000, settings.width * 1000), wr, settings.dayHours, alive, 4);
    if (!alive()) return;
    tour.days.push({ trip: { name: "", start: ends[d], finish: ends[d + 1], loop: false, items: chainToItems(plan?.chain || []) }, built: null, stops: [] });
  }
  await routeTourDays(0.6, alive);
  if (!alive()) return;
  busy.hide(); tourPick = -1; saveTour(); openTour();
}
const nearestIdx = (line, p) => { let bi = 0, bd = Infinity; line.forEach((q, i) => { const d = hav(p, q); if (d < bd) { bd = d; bi = i; } }); return bi; };
async function routeTourDays(from, alive, only){
  const days = tour.days.map((d, i) => i).filter(i => only == null || only.includes(i));
  let n = 0;
  for (const i of days) {
    const d = tour.days[i];
    d.trip.name = dayName(i);
    busy.set(`Routing roads for day ${i + 1}…`, from + (1 - from) * n / days.length);
    const todo = tripLinks(d.trip).filter(Boolean).length; let done = 0;
    d.built = await routeTrip(d.trip, alive, () => busy.set(`Routing roads for day ${i + 1}: ${++done} of ${todo}…`, from + (1 - from) * (n + done / Math.max(1, todo)) / days.length));
    if (!alive()) return;
    d.stops = stopsAlong(d.built).list; d.built.fuelGap = stopsAlong(d.built).fuelGap;
    n++;
  }
}
function dayName(i){
  const startName = tour.startName || tourPlaces.start?.name?.split(",")[0] || "Start", endName = tour.endName || tourPlaces.end?.name?.split(",")[0] || "Finish";
  const from = i === 0 ? startName : tour.nights[i - 1].town || `night ${i}`;
  const to = i === tour.days.length - 1 ? (tour.round ? startName : endName) : tour.nights[i].town || `night ${i + 1}`;
  return `Day ${i + 1}: ${from} to ${to}`;
}
function renderTour(){
  if (!tour) return;
  $("#tourName").value = tour.name;
  const tot = tour.days.reduce((a, d) => a + (d.built?.total || 0), 0), off = tour.days.reduce((a, d) => a + (d.built?.off || 0), 0), hrs = tour.days.reduce((a, d) => a + (d.built?.hours || 0), 0);
  // a ready-made trip carries a one-line description and what to know before going (seasonal passes, closures)
  $("#tourLine").hidden = !tour.line2; $("#tourLine").textContent = tour.line2 || "";
  // A planned tour whose days run well over the hours asked for says so, and offers one more day
  const dayHrs = tour.days.map(d => d.built?.hours || 0), avg = dayHrs.reduce((a, h) => a + h, 0) / Math.max(1, dayHrs.length);
  const long = !tour.featured && avg > tour.dayHours * 1.2;
  const notes = (tour.notes || []).map(esc);
  if (long) notes.unshift(`These days average ${hm(avg)} of riding, more than the ${tour.dayHours} h a day you asked for. <a href="#" data-moreday>Plan it over ${tour.days.length + 1} days</a>`);
  $("#tourNotes").hidden = !notes.length; $("#tourNotes").innerHTML = notes.join("<br>");
  const more = $("#tourNotes [data-moreday]");
  if (more) more.onclick = e => { e.preventDefault(); settings.days = tour.days.length + 1; saveSettings(); syncSettings(); $("#tourReplan").click(); planTour(); };
  $("#tourReplan").hidden = !!tour.featured;
  $("#tsDays").textContent = tour.days.length; $("#tsKm").textContent = km(tot); $("#tsLane").textContent = tour.kind === "road" ? "Roads" : tot ? Math.round(100 * off / tot) + "%" : "–"; $("#tsHours").textContent = hm(hrs);
  $("#tsDays").nextElementSibling.textContent = tour.days.length === 1 ? "day" : "days";
  $("#tsLane").nextElementSibling.textContent = tour.kind === "road" ? "trip" : "lanes";
  $("#tourGpx").textContent = tour.days.length === 1 ? "⬇ Download GPX" : "⬇ Download tour GPX (all days)";
  $("#tourDayHint").hidden = tour.days.length === 1;   // no nights to change on a one-day trip
  const box = $("#dayList"); box.innerHTML = "";
  // ready-made tours made before the places data covered Scotland have no bed for the night: pick the nearest now
  if (stops) tour.nights.forEach(n => { if (n.stay == null && (n.want || n.at)) { const o = stayOptions(n.want || n.at, 15000)[0]; if (o) { n.stay = o.i; n.want ||= n.at; } } });
  tour.days.forEach((d, i) => {
    // days built before the places data covered Scotland have no stops: work them out now
    if (d.built && stops && !d.stops?.length && d.built.noStops) { const a = stopsAlong(d.built); d.stops = a.list; d.built.fuelGap = a.fuelGap; delete d.built.noStops; }
    const b = d.built, card = document.createElement("div");
    card.className = "day"; card.setAttribute("aria-pressed", tourPick === i); card.tabIndex = 0; card.setAttribute("role", "button");
    const warn = routeWarnings(b, d.trip);
    card.innerHTML = `<div class="top"><h3>${esc(d.trip.name || dayName(i))}</h3></div>
      <div class="stats"><span><b>${b ? hm(b.hours) : "–"}</b> riding</span><span><b>${b ? km(b.total) : "–"}</b> km</span>${tour.kind === "road" ? "" : `<span><b>${b && b.total ? Math.round(100 * b.off / b.total) : 0}%</b> lanes</span>`}${tour.kind === "road" ? "" : `<span><b>${d.trip.items.filter(it => !it.via).length}</b> lanes</span>`}${b?.fuelGap ? `<span>fuel gap <b>${km(b.fuelGap)}</b> km</span>` : ""}</div>
      ${b && b.hours > tour.dayHours * 1.3 ? `<div class="small" style="color:#b45309">Longer than your ${tour.dayHours} h a day.</div>` : b && !tour.featured && b.hours < tour.dayHours * 0.6 ? `<div class="small" style="color:#b45309">Shorter than your ${tour.dayHours} h a day: there aren't enough lanes along this part of the way. Fewer days would fill them.</div>` : ""}
      ${warn.length ? `<div class="small muted">${esc(warn[0])}</div>` : ""}
      <div class="acts"></div>`;
    const acts = card.querySelector(".acts");
    const mk = (label, fn) => { const x = document.createElement("button"); x.className = "btn quiet"; x.textContent = label; x.onclick = ev => { ev.stopPropagation(); fn(); }; acts.append(x); };
    const keepIfNotADay = () => { if (!tour.days.some(dd => tripSig(dd.trip) === tripSig(trip))) keepCurrent(); };
    if (b) mk("▶ Ride", () => { keepIfNotADay(); trip = clone(d.trip); built = clone(b); saveTrip(); routeStops = d.stops || []; Ride.start(); });
    mk("Edit day", () => { keepIfNotADay(); dayBefore = trip.items.length && !tour.days.some(dd => tripSig(dd.trip) === tripSig(trip)) ? clone(trip) : null; editingDay = i; trip = clone(d.trip); trip.keepOrder = true; built = d.built; saveTrip(); showView("route", "mid"); renderRoute(); findRouteStops(); fitMap(L.latLngBounds(trip.items.flatMap(it => it.coords).concat([trip.start, trip.finish])).pad(0.05)); });
    if (tour.days.length > 1) mk("GPX for this day", () => download(`${tour.name} day ${i + 1}`, gpxText(d.trip.name, [{ name: d.trip.name, trip: d.trip, built: d.built, stops: d.stops, prefix: "", nightAt: tour.nights[i]?.at, nightName: nightLabel(i) }])));
    const pick = () => { tourPick = tourPick === i ? -1 : i; renderTour(); if (tourPick >= 0) fitMap(L.latLngBounds(d.built ? d.built.segs.flatMap(s => s.coords) : [d.trip.start, d.trip.finish]).pad(0.05), {}); };
    card.onclick = pick; card.onkeydown = e => { if (e.key === "Enter") pick(); };
    box.append(card);
    if (i < tour.nights.length) box.append(nightRow(i));
  });
  drawTour();
}
function nightLabel(i){ const n = tour.nights[i], s = n.stay != null && stops ? stops[n.stay] : null; return `Night ${i + 1}: ${n.town || ""}${s ? " - " + stopName(s) : ""}`.replace(": - ", ": "); }
function nightRow(i){
  const n = tour.nights[i], s = n.stay != null && stops ? stops[n.stay] : null;
  const row = document.createElement("div"); row.className = "night";
  row.innerHTML = `${poiBadge(s ? s.code : "hotel")}<div class="grow"><b>Night ${i + 1}${n.town ? ": " + esc(n.town) : ""}</b><br><span class="small muted">${s ? esc(stopName(s)) + " · " + esc(CODE[s.code].one) : !stops ? "Loading places to stay…" : tour.days[i]?.built?.noStops ? "Places to stay aren't loaded for Scotland, so book this one yourself." : "No places to stay found near here. Try allowing campsites or changing the days."}</span><div class="opts" hidden></div></div>`;
  const btn = document.createElement("button"); btn.className = "btn quiet"; btn.textContent = "Change";
  const opts = row.querySelector(".opts");
  queueMicrotask(() => row.append(opts));   // below the row, the panel's full width, not squeezed beside the Change button
  btn.onclick = () => {
    opts.hidden = !opts.hidden; opts.innerHTML = "";
    const list = stayOptions(n.want, 30000).map(o => o.i).filter(k => k !== n.stay);
    if (!list.length) opts.innerHTML = `<span class="small muted">No other places to stay within 30 km.</span>`;
    for (const k of list) {
      const o = stops[k], b = document.createElement("button");
      b.innerHTML = `${esc(stopName(o))} <span class="muted">· ${esc(CODE[o.code].one)} · ${km(hav(n.want, [o.lat, o.lng]))} km off the line</span>`;
      b.onclick = () => changeNight(i, k);
      opts.append(b);
    }
  };
  row.append(btn);
  return row;
}
async function changeNight(i, k){
  const s = stops[k], n = tour.nights[i];
  const undo = { night: clone(n), a: clone(tour.days[i]), b: clone(tour.days[i + 1]), edited: tour.edited };
  tour.edited = true; n.stay = k; n.at = [s.lat, s.lng];
  const run = ++tourRun, alive = () => run === tourRun && !$("#busy").hidden;
  busy.show("Re-planning the two days either side", () => {   // Cancel: the night and both days as they were
    tourRun++; Object.assign(n, undo.night); tour.days[i] = undo.a; tour.days[i + 1] = undo.b; tour.edited = undo.edited; saveTour(); renderTour();
  });
  n.town = (await placeName(n.at)) || n.town;
  const wr = mixToWr(settings.mix);
  for (const d of [i, i + 1]) {
    busy.set(`Planning day ${d + 1}…`, d === i ? 0.1 : 0.4);
    const day = tour.days[d], a = d === 0 ? tour.start : tour.nights[d - 1].at, b = d === tour.days.length - 1 ? tour.end : tour.nights[d].at;
    const ia = nearestIdx(tour.line, a), ib = nearestIdx(tour.line, b);
    const sk = [a, ...tour.line.slice(Math.min(ia, ib) + 1, Math.max(ia, ib)), b];
    if (tour.kind === "road") {   // a road trip: the two days share out the trip's named waypoints either side of the new night
      const named = [...undo.a.trip.items, ...undo.b.trip.items].filter(it => it.via), cut = nearestIdx(tour.line, n.at);
      const mine = named.filter(it => (d === i) === (nearestIdx(tour.line, it.coords[0]) < cut) && hav(it.coords[0], n.at) > 2000);
      day.trip = { name: "", start: a, finish: b, loop: false, items: mine.length ? mine.map(clone) : thin(sk, 20000).slice(1, -1).map(p => itemVia(p)) };
      continue;
    }
    const plan = await fitPlan(thin(sk, 300), Math.max(8000, settings.width * 1000), wr, tour.dayHours, alive, 4);
    if (!alive()) return;
    day.trip = { name: "", start: a, finish: b, loop: false, items: chainToItems(plan?.chain || []) };
  }
  await routeTourDays(0.6, alive, [i, i + 1]);
  if (!alive()) return;
  busy.hide(); saveTour(); renderTour();
}
function drawTour(){
  tourLayer.clearLayers();
  if (!tour || view !== "tour") return;
  tour.days.forEach((d, i) => drawBuilt(tourLayer, d.trip, d.built, tourPick < 0 || tourPick === i, tourPick === i));
  flag(tour.start, tour.round ? "START / FINISH" : "START").addTo(tourLayer);
  if (!tour.round) flag(tour.end, "FINISH").addTo(tourLayer);
  const ends = [tour.start, tour.end].map(p => map.latLngToContainerPoint(p));
  tour.nights.forEach((n, i) => L.marker(n.at, { icon: L.divIcon({ className: "", html: `<span class="flag night${ends.some(e => e.distanceTo(map.latLngToContainerPoint(n.at)) < 60) ? " below" : ""}" style="background:#6d28d9">Night ${i + 1}</span>`, iconSize: [0, 0] }) }).bindPopup(() => { const s = n.stay != null ? stops?.[n.stay] : null; return s ? stopPopup(s) : `<h3>Night ${i + 1}</h3>`; }).addTo(tourLayer));
  drawRouteStops();
}
$("#tourName").oninput = e => { tour.name = e.target.value || "My tour"; saveTour(); };
$("#tourGpx").onclick = () => tour && download(tour.name, gpxText(tour.name, tour.days.map((d, i) => ({ name: d.trip.name || dayName(i), trip: d.trip, built: d.built, stops: d.stops, prefix: `D${i + 1} `, nightAt: tour.nights[i]?.at, nightName: tour.nights[i] ? nightLabel(i) : "" }))));
$("#tourSave").onclick = () => tour && saveItem({ name: tour.name, tour, summary: `${daysTxt(tour.days.length)}, ${km(tour.days.reduce((a, d) => a + (d.built?.total || 0), 0))} km` }, true);
$("#tourNew").onclick = () => armed($("#tourNew"), "+ New tour", () => { tour = null; saveTour(); tourPick = -1; openTour(); });
$("#tourReplan").onclick = () => { if (!tour) return; tourPlaces.start = tourPlaces.start || { p: tour.start, name: tour.name.split(" to ")[0] }; tourPlaces.end = tourPlaces.end || { p: tour.round ? tour.line[Math.floor(tour.line.length / 2)] : tour.end, name: tour.name.split(" to ")[1] || "Finish" }; $("#tRound").checked = tour.round; tour = null; openTour(); };

/* ---------- Explore: riding areas, ready-made rides and tours ---------- */
const REGION_LIST = window.REGIONS || [];
const feat = () => window.FEATURED || null;
const regionBySlug = slug => REGION_LIST.find(r => r.slug === slug);
const featuredIn = slug => (feat()?.rides || []).filter(r => r.region === slug);
const posterHtml = (r, lazy = true) => `<img src="img/regions/${r.slug}.jpg" alt="Poster of ${esc(r.name)}" loading="${lazy ? "lazy" : "eager"}" onerror="this.remove()">`;
const laneKmCache = new Map();
function regionLaneKm(r){   // lane km within 25 km of the area's centre (worked out at build time, see tools/build_featured.py)
  if (window.REGION_STATS?.[r.slug]) return REGION_STATS[r.slug].laneKm * 1000;
  if (laneKmCache.has(r.slug)) return laneKmCache.get(r.slug);
  const c = r.centre, bb = [c[0] - 0.25, c[1] - 0.4, c[0] + 0.25, c[1] + 0.4], seen = new Set(); let m = 0;
  for (const k of cells(bb)) for (const id of grid.get(k) || []) {
    if (seen.has(id)) continue; seen.add(id);
    const w = osmWays.get(id); if (!CLASSES[w.cls].ride) continue;
    if (hav(c, w.coords[Math.floor(w.coords.length / 2)]) < 25000) m += w.len;
  }
  laneKmCache.set(r.slug, m); return m;
}
let exploreNear = null;   // after a search, the areas nearest the place come first
function renderExplore(){
  const box = $("#regionCards"); box.innerHTML = "";
  const list = exploreNear ? [...REGION_LIST].sort((a, b) => hav(exploreNear, a.centre) - hav(exploreNear, b.centre)) : REGION_LIST;
  for (const r of list) {
    const n = featuredIn(r.slug).length;
    const b = document.createElement("button"); b.className = "rcard"; b.setAttribute("role", "listitem");
    b.innerHTML = `<div class="poster">${posterHtml(r)}</div><div class="cap"><b>${esc(r.name)}</b><span>${r.kind === "road" ? `${n + (feat()?.tours || []).filter(t => t.region === r.slug).length} road rides` : `${n ? `${n} ride${n > 1 ? "s" : ""} · ` : ""}${Math.round(regionLaneKm(r) / 1000)} km of lanes`}</span></div>`;
    b.onclick = () => openRegion(r.slug);
    box.append(b);
  }
  const tb = $("#tourCards"); tb.innerHTML = "";
  const feats = feat()?.tours || [];
  // lane tours first, then road trips, each under its own heading
  const groups = [["Green-lane tours", feats.filter(t => t.kind !== "road")], ["Road trips", feats.filter(t => t.kind === "road")]];
  if (feats.length) for (const [head, list] of groups) { if (!list.length) continue; tb.insertAdjacentHTML("beforeend", `<h4 class="tgroup">${head}</h4>`); for (const t of list) {
    const tot = t.tour.days.reduce((a, d) => a + (d.built?.total || 0), 0), off = t.tour.days.reduce((a, d) => a + (d.built?.off || 0), 0);
    const c = document.createElement("div"); c.className = "card tcard";
    const road = t.kind === "road", nd = t.tour.days.length;
    // the route's shape and its name side by side, the description the full width underneath
    c.innerHTML = `<div class="sk">${routeSketch(t.tour.days.flatMap(d => d.built?.segs?.flatMap(sg => sg.coords) || []), t.tour.round)}</div><div class="th"><h3>${esc(t.name)}</h3><div class="stats"><span>${nd > 1 ? `<b>${nd}</b> days, ${nd - 1} night${nd > 2 ? "s" : ""}` : "<b>1</b> day"}</span><span><b>${km(tot)}</b> km</span>${road ? `<span>road trip${t.country && t.country !== "England" ? ", " + esc(t.country) : ""}</span>` : `<span><b>${tot ? Math.round(100 * off / tot) : 0}%</b> lanes</span>`}</div></div>${t.line ? `<p class="small muted td">${esc(t.line)}</p>` : ""}`;
    const go = document.createElement("button"); go.className = "btn primary"; go.textContent = "Open"; go.setAttribute("aria-label", "Open " + t.name);
    go.onclick = e => { e.stopPropagation(); loadFeaturedTour(t); };
    c.onclick = () => loadFeaturedTour(t);
    c.append(go); tb.append(c);
  } } else for (const p of window.TOUR_PRESETS || []) {
    const c = document.createElement("div"); c.className = "card tcard";
    c.innerHTML = `<div><h3>${esc(p.name)}</h3><div class="stats"><span><b>${p.days}</b> days</span><span><b>${p.dayHours} h</b> a day</span></div></div>`;
    const go = document.createElement("button"); go.className = "btn primary"; go.textContent = "Plan it";
    go.onclick = () => {
      tourPlaces.start = { p: p.start.at, name: p.start.name }; tourPlaces.end = { p: p.end.at, name: p.end.name };
      settings.days = p.days; settings.dayHours = p.dayHours; saveSettings(); syncSettings();
      tour = null; tourPick = -1; openTour(); $("#tRound").checked = !!p.round;
    };
    c.append(go); tb.append(c);
  }
  $("#tourBlock").hidden = !tb.children.length;
  // posters on the map when zoomed out
  drawRegionPins();
}
// Area pins when zoomed out: the areas with most lanes first, and any pin that would overlap one already placed waits
// until you zoom in (the same areas are in the list below the map, so nothing is lost)
function drawRegionPins(){
  regionPinLayer.clearLayers(); const placed = [];
  for (const r of [...REGION_LIST].sort((a, b) => regionLaneKm(b) - regionLaneKm(a))) {
    const p = map.latLngToContainerPoint(r.centre);
    if (placed.some(q => Math.abs(q.x - p.x) < 88 && Math.abs(q.y - p.y) < 64)) continue; placed.push(p);
    L.marker(r.centre, { keyboard: false, title: r.name, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="rpin"><span class="dot">${posterHtml(r)}</span><b>${esc(r.name)}</b></div>` }) })
      .on("click", () => openRegion(r.slug)).addTo(regionPinLayer);
  }
}
// Ready-made rides on an area page: each in its own colour with a numbered badge matching its card.
// Tapping a card (or badge) draws that ride bold and fades the others.
let regionRidesNow = [], regionPick = -1;
function drawRegionRides(){
  regionRideLayer.clearLayers();
  const order = regionRidesNow.map((_, i) => i).filter(i => i !== regionPick); if (regionPick >= 0) order.push(regionPick);
  for (const i of order) {
    const rd = regionRidesNow[i], col = IDEA_COLORS[i % IDEA_COLORS.length], on = i === regionPick;
    drawBuilt(regionRideLayer, rd.trip, rd.built, on || regionPick < 0, false, col);   // none picked yet: all drawn clearly, each in its colour
    const pool = rd.built.segs.filter(sg => sg.type === "lane"), segsOf = pool.length ? pool : rd.built.segs, sg = segsOf[Math.floor(segsOf.length * (0.3 + 0.2 * (i % 3)))] || rd.built.segs[0];   // spread, so two rides' badges don't stack
    L.marker(sg.coords[Math.floor(sg.coords.length / 2)], { zIndexOffset: on ? 1000 : 0, title: rd.name, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="ibadge${on ? " on" : ""}" style="--c:${col}">${i + 1}</span>` }) })
      .on("click", () => pickRegionRide(i)).addTo(regionRideLayer);
  }
  document.querySelectorAll("#regionRides .card").forEach((c, i) => c.setAttribute("aria-pressed", i === regionPick));
}
function pickRegionRide(i){
  regionPick = i; drawRegionRides();
  if (phone()) setSheet("min");
  fitMap(L.latLngBounds(regionRidesNow[i].built.segs.flatMap(sg => sg.coords)).pad(0.05), {});
}
let regionOpen = null;
function openRegion(slug){
  regionOpen = slug;
  const r = regionBySlug(slug); if (!r) return;
  showView("region", "peek");   // the preview, so the map it has just moved to stays in view
  $("#regionPoster").innerHTML = posterHtml(r, false);   // lazy loading missed it as the panel opened
  $("#regionName").textContent = r.name + (r.sub ? " " + r.sub : "");
  $("#regionLine").textContent = r.line;
  const rides = featuredIn(slug), road = r.kind === "road", trips = (feat()?.tours || []).filter(t => t.region === slug);
  // Scottish areas are for road riding: there are no byways to count or to plan loops from
  $("#regionStats").innerHTML = (road ? `<div><b>Roads</b><span>no byways</span></div>` : `<div><b>${Math.round(regionLaneKm(r) / 1000)}</b><span>km of lanes</span></div>`)
    + `<div><b>${rides.length + trips.length}</b><span>rides</span></div><div><b>${esc(r.starts[0].name)}</b><span>start</span></div>`;
  $("#regionPlanOwn").hidden = road; $("#regionRoadNote").hidden = !road;
  const box = $("#regionRides"); box.innerHTML = rides.length ? "" : `<p class="small muted">No ready-made rides here yet. Plan your own below.</p>`;
  regionRidesNow = rides; regionPick = -1; drawRegionRides();
  rides.forEach((rd, i) => {
    const b = rd.built, pct = b.total ? Math.round(100 * b.off / b.total) : 0, isRoad = rd.kind === "road";
    const c = document.createElement("div"); c.className = "card"; c.style.setProperty("--c", IDEA_COLORS[i % IDEA_COLORS.length]);
    c.setAttribute("aria-pressed", "false");
    c.innerHTML = `<div class="top"><h3><span class="inum">${i + 1}</span>${esc(rd.name)}</h3></div>
      <div class="stats"><span><b>${hm(b.hours)}</b> riding</span><span><b>${km(b.total)}</b> km</span>${isRoad ? `<span>${rd.trip.loop ? "loop" : "one way"}</span>` : `<span><b>${pct}%</b> lanes</span>`}</div>
      <div>${isRoad ? `<span class="chip" style="background:#5b6b8c">Road ride</span>` : rd.byways ? `<span class="chip" style="background:var(--boat)">Byways only</span>` : `<span class="chip" style="background:var(--ucr)">Includes unclassified roads</span>`} <span class="small muted">from ${esc(rd.startName)}</span></div>`;
    const go = document.createElement("button"); go.className = "btn primary"; go.textContent = "Ride this"; go.setAttribute("aria-label", "Ride " + rd.name);
    go.onclick = () => loadFeaturedRide(rd);
    c.querySelector(".top").append(go);
    // with another route open, this one can be joined on to it (two rides in one day)
    let join = null;
    const inIt = new Set(trip.items.flatMap(it => it.ids));
    if (trip.items.length && editingDay == null && trip.name !== rd.name && !isRoad && rd.trip.items.some(it => !it.via && !it.ids.every(id => inIt.has(id)))) {
      join = document.createElement("button"); join.className = "btn quiet"; join.textContent = `+ Join on to “${trip.name}”`;
      join.onclick = e => { e.stopPropagation(); joinRide(rd); };
      c.append(join);
    }
    c.onclick = e => { if (e.target !== go && e.target !== join) pickRegionRide(i); };
    box.append(c);
  });
  // the area's big trips (the NC500 on the West Highlands page)
  for (const t of trips) {
    const c = document.createElement("div"); c.className = "card";
    const tk = t.tour.days.reduce((a, d) => a + (d.built?.total || 0), 0);
    c.innerHTML = `<div class="top"><h3>${esc(t.name)}</h3></div><div class="stats"><span><b>${t.tour.days.length}</b> days</span><span><b>${km(tk)}</b> km</span></div><div><span class="chip" style="background:#6d28d9">Big trip</span></div>`;
    const go = document.createElement("button"); go.className = "btn primary"; go.textContent = "Open"; go.setAttribute("aria-label", "Open " + t.name);
    go.onclick = () => loadFeaturedTour(t); c.querySelector(".top").append(go); c.onclick = e => { if (e.target !== go) loadFeaturedTour(t); };
    box.append(c);
  }
  const lines = (rides.length ? rides.map(rd => rd.built.segs.flatMap(sg => sg.coords)) : trips.flatMap(t => t.tour.days.map(d => d.built?.segs?.flatMap(sg => sg.coords) || []))).flat();
  if (lines.length) setTimeout(() => fitMap(L.latLngBounds(lines).pad(0.05), {}), 30); else fly(r.centre, r.zoom);
  $("#regionLoop").onclick = () => { loopStart = r.starts[0].at; loopStartName = r.starts[0].name; lastKind = "loop"; ideas = []; picked = -1; ideaRun++; openIdeas(); runIdeas(); };
  $("#regionDraw").onclick = () => { map.setView(r.centre, r.zoom); lastKind = "draw"; strokes = []; shapeChoice = null; ideas = []; picked = -1; ideaRun++; openIdeas(); startDrawing(); };
}
$("#regionBack").onclick = () => { showView("plan", sheet.dataset.state === "open" ? "open" : "peek"); setTimeout(showBritain, 30); };   // keep the panel where it was
// Opening a ready-made ride or tour replaces the current one, so anything the rider planned goes to Saved first.
const featNames = () => new Set([...(feat()?.rides || []).map(r => r.name), ...(feat()?.tours || []).map(t => t.name)]);
// A plan's shape: its start, finish and lanes (lane ids, or the point for a via), so an edit can be told from the original
const tripSig = t => JSON.stringify([t.start, t.finish, !!t.loop, t.items.map(i => i.via ? i.coords[0] : (i.ids || []).join(","))]);
function keepCurrent(){
  if (!trip.items.length) return;
  const orig = (feat()?.rides || []).find(r => r.name === trip.name);
  if (!orig) saveItem({ name: trip.name, trip, summary: built ? `${km(built.total)} km, ${hm(built.hours)}` : "" });
  else if (tripSig(orig.trip) !== tripSig(trip)) saveItem({ name: trip.name + " (edited)", trip, summary: built ? `${km(built.total)} km, ${hm(built.hours)}` : "" });   // a ready-made ride you changed
}
// Two rides as one day: the second one's lanes and stops go into the open route, and the whole lot is put in
// the order that needs least road (it's a new ride now, so the first one's order no longer holds).
function joinRide(rd){
  const before = clone(trip), name = trip.name;
  const have = new Set(trip.items.flatMap(it => it.ids));
  for (const it of clone(rd.trip).items) if (it.via || !it.ids.some(id => have.has(id))) trip.items.push(it);
  trip.name = `${name} + ${rd.name}`; trip.keepOrder = false; trip.tidy = false; built = null; saveTrip();
  showView("route", "mid"); renderRoute(); drawRoute(); tidyNow();
  undoBar(`Joined ${rd.name} on to ${name}`, () => { trip = before; built = null; saveTrip(); renderRoute(); drawRoute(); buildSoon(300); }, null, 8000);
}
function loadFeaturedRide(rd){
  dropUndo(); keepCurrent();
  routeFrom = view === "region" ? { kind: "region", slug: rd.region || regionOpen } : { kind: "plan" };
  trip = clone(rd.trip); trip.keepOrder = true; built = clone(rd.built); editingDay = null; lastKind = null; ideas = [];
  saveTrip(); showView("route", "mid"); renderRoute();
  fitMap(L.latLngBounds(built.segs.flatMap(sg => sg.coords)).pad(0.05), {});
  findRouteStops();
}
function loadFeaturedTour(t){
  if (tour?.days?.length && (!featNames().has(tour.name) || tour.edited)) saveItem({ name: (tour.name || "My tour") + (featNames().has(tour.name) ? " (edited)" : ""), tour, summary: daysTxt(tour.days.length) });
  tour = clone(t.tour); tour.featured = true; tour.line2 = t.line || ""; tour.notes = t.notes || []; tour.kind = t.kind || "lanes";
  // the start and finish names come from the trip's own day names ("Day 1: Inverness to Applecross")
  const first = (tour.days[0]?.trip?.name || "").match(/:\s*(.+?) to /), last = (tour.days.at(-1)?.trip?.name || "").match(/ to (.+)$/);
  tour.startName = first?.[1] || tour.name.split(" ")[0]; tour.endName = last?.[1] || tour.startName;
  tourPick = -1; saveTour(); openTour(); }

/* ---------- finding lanes: by name or number, the longest here or anywhere, or the closest ---------- */
let laneSort = "here";
const laneMid = w => w.coords[Math.floor(w.coords.length / 2)];
function whereIs(w){   // "Salisbury Plain" if it's in one of the riding areas, otherwise how far from the middle of the map
  const m = laneMid(w), r = REGION_LIST.map(r => [r, hav(m, r.centre)]).sort((a, b) => a[1] - b[1])[0];
  if (r && r[1] < 40000) return r[0].name;
  const c = map.getCenter(); return `${km(hav(m, [c.lat, c.lng]))} km from the map centre`;
}
function renderLaneFinder(){
  if (view !== "lanes") return;
  let q = $("#laneQ").value.trim().toLowerCase(), boatOnly = $("#laneBoatOnly").checked, onlyUcr = false;
  // words that name a type of lane filter by type rather than matching reference numbers that happen to contain them
  if (/^(boat|boats|byway|byways)$/.test(q)) { boatOnly = true; q = ""; }
  else if (/^(ucr|ucrs|unclassified)$/.test(q)) { onlyUcr = true; q = ""; }
  const b = map.getBounds(), c = map.getCenter(), cc = [c.lat, c.lng];
  let list = [];
  for (const w of osmWays.values()) {
    if (!CLASSES[w.cls].ride || (boatOnly && w.cls !== "boat") || (onlyUcr && w.cls === "boat") || w.len < 100) continue;   // scraps under 100 m are mapping leftovers
    if (q && !(w.search ? w.search.includes(q) : [w.tags.name, w.tags.prow_ref, w.tags.ref].some(t => t && t.toLowerCase().includes(q)))) continue;   // every piece's name and number counts
    if (laneSort === "here" && !q && !b.intersects(L.latLngBounds([w.bbox[0], w.bbox[1]], [w.bbox[2], w.bbox[3]]))) continue;
    list.push(w);
  }
  // closest first when sorting by nearness, or when searching a name (the Ridgeway near you before one 280 km away)
  if (laneSort === "near") { for (const w of list) w._d = hav(cc, laneMid(w)); list.sort((a, b) => a._d - b._d); }
  else if (q && laneSort === "here") {
    const starts = w => [w.tags.name, w.tags.prow_ref, w.tags.ref].some(t => t && t.toLowerCase().replace(/^the\s+/, "").startsWith(q.replace(/^the\s+/, "")));
    for (const w of list) w._d = hav(cc, laneMid(w)) / (1 + w.len / 4000) / (starts(w) ? 20 : 1);
    list.sort((a, b) => a._d - b._d);
  }
  else list.sort((a, b) => b.len - a.len);
  const total = list.length; list = list.slice(0, 40);
  $("#laneCount").textContent = !total ? (laneSort === "here" && !q ? "No lanes on the map here. Move the map, or try Longest anywhere." : "Nothing matches.")
    : `${total.toLocaleString()} lane${total > 1 ? "s" : ""}${laneSort === "here" && !q ? " on the map" : ""}${total > 40 ? ", showing the first 40" : ""}. Tap one to see it.`;
  const ul = $("#laneResults"); ul.innerHTML = "";
  for (const w of list) {
    const t = w.tags, c2 = CLASSES[w.cls], surf = surfTxt(t);
    const li = document.createElement("li");
    li.innerHTML = `<span class="grow" role="button" tabindex="0"><span class="t">${esc(laneName(t))}</span><br><span class="s"><span class="chip" style="background:${css(c2.color)}">${esc(DESIG[t.designation] || "Byway")}</span> <b>${km(w.len)} km</b>${inRoute(w.id) ? " · in your route" : ""} · ${esc(whereIs(w))}${surf ? " · " + esc(surf) : ""}</span></span>`;
    const go = () => showLane(w);
    li.querySelector(".grow").onclick = go; li.querySelector(".grow").onkeydown = e => { if (e.key === "Enter") go(); };
    ul.append(li);
  }
}
function showLane(w){
  laneJump = true;
  // on a phone the list drops to the bottom bar so the lane gets the screen; the bar says "Find lanes" to go back
  if (phone()) setSheet("min");
  fitMap(L.latLngBounds(w.coords).pad(0.2), { maxZoom: 16, animate: false });
  const m = laneMid(w);
  setTimeout(() => { L.popup({ maxWidth: 300 }).setLatLng(m).setContent(lanePopup(w)).openOn(map); highlightLane(w); }, 50);
}
let laneJump = false;
map.on("popupclose", () => { if (view === "lanes") highlightLane(null); });
function openLanes(){ showView("lanes", "open"); $("#lanesBack").textContent = backLabel(); renderLaneFinder(); renderClassics(); }   // full height: the list is the point
// Lanes riders ask about by name, with whether they're open and where that comes from (data/classics.js)
function renderClassics(){
  const ul = $("#classicList"); if (ul.children.length) return;
  const word = { open: "Open", check: "Check first", closed: "Closed" };
  for (const c of window.CLASSICS || []) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="grow" role="button" tabindex="0"><span class="t">${esc(c.name)}</span><span class="s"><span class="stat-chip stat-${c.status}">${word[c.status]}</span>${esc(c.text)} <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.source)}</a></span></span>`;
    li.querySelector(".grow").onclick = e => {
      if (e.target.tagName === "A") return; if (phone()) setSheet("min");
      // light up the lane itself: every piece near the spot whose name, number or closing order matches (closed ones too)
      const hits = c.match ? [...osmWays.values()].filter(w => hav(c.at, laneMid(w)) < 15000 && ((w.search || [w.tags.name, w.tags.prow_ref].join(" ").toLowerCase()).includes(c.match) || (w.closure?.order || "").toLowerCase().includes(c.match))) : [];
      if (hits.length) { fitMap(L.latLngBounds(hits.flatMap(w => [w.coords[0], w.coords.at(-1)])).pad(0.3), { maxZoom: 14 }); highlightMany(hits); }
      else map.setView(c.at, c.zoom);
    };
    ul.append(li);
  }
  $("#classicBox").hidden = !ul.children.length;
}
$("#goLanes").onclick = openLanes;
$("#lanesBack").onclick = () => goBack();
$("#laneQ").oninput = () => renderLaneFinder();
$("#laneBoatOnly").onchange = () => renderLaneFinder();
document.querySelectorAll("#laneSort button").forEach(bt => bt.onclick = () => {
  laneSort = bt.dataset.sort; document.querySelectorAll("#laneSort button").forEach(x => x.setAttribute("aria-pressed", x === bt)); renderLaneFinder();
});
// "Longest here" and "Closest" follow the map, except straight after jumping to a lane from the list
map.on("moveend", () => { if (view !== "lanes") return; if (laneJump) { laneJump = false; return; } if (laneSort !== "all") renderLaneFinder(); });

/* ---------- search ---------- */
// the place you searched for gets a pin, so you can see where it is on the map (the next search replaces it)
let searchPin = null;
function placePin(at, name){
  if (searchPin) map.removeLayer(searchPin);
  searchPin = L.marker(at, { interactive: false, title: name, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="flag" style="background:#1a73e8">${esc(name)}</span>` }) }).addTo(map);
}
// On a phone, search is a button in the corner that opens the search bar, so the map keeps the screen until you need it
function openSearch(){ if (!$("#searchWrap").classList.contains("open")) navPush(); $("#searchWrap").classList.add("open"); $("#btnSearch").setAttribute("aria-expanded", "true"); setTimeout(() => $("#q").focus(), 30); }
function closeSearch(){ $("#searchWrap").classList.remove("open"); $("#btnSearch").setAttribute("aria-expanded", "false"); $("#results").hidden = true; }
$("#btnSearch").onclick = openSearch;
$("#searchClose").onclick = closeSearch;
$("#searchForm").onsubmit = async e => {
  e.preventDefault(); const q = $("#q").value.trim(); if (!q) return;
  $("#q").blur(); $("#results").hidden = true; status("Searching…", 0);   // a new search clears the last one's list
  const r = await polite("nominatim", `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=gb&q=${encodeURIComponent(q)}`);
  status("");
  let d = []; try { d = JSON.parse(r.text); } catch {}
  if (!r.ok || !d.length) { status(!navigator.onLine ? "No signal, so places can't be looked up. You can still move the map and tap where you want." : r.ok ? `Couldn't find “${q}”. Check the spelling, or move the map there and tap.` : "Place search isn't answering. Try again in a minute, or move the map and tap where you want.", 6000); return; }
  // while choosing a start or finish, picking a place from search sets it there; otherwise it just moves the map
  const go = p => {
    $("#results").hidden = true; closeSearch(); const at = [+p.lat, +p.lon];
    if (picking) { const then = picking; stopModes(); map.setView(at, 11); then(at, p.display_name.split(",")[0]); return; }
    viewAt(at, drawing || drawWhenZoomed ? 10 : 12); placePin(at, p.display_name.split(",")[0]);
    exploreNear = at; renderExplore(); $("#regionCards").scrollLeft = 0;
  };
  const label = p => p.display_name.split(",").slice(0, 3).join(",");
  d = d.filter((p, i) => d.findIndex(x => label(x) === label(p)) === i);   // Nominatim often returns the same town twice
  if (d.length === 1) return go(d[0]);
  const box = $("#results"); box.innerHTML = ""; box.hidden = false;
  for (const p of d) { const b = document.createElement("button"); b.textContent = label(p); b.onclick = () => go(p); box.append(b); }
};

/* ---------- something is being worked out: say so at the top of the map ----------
   The screens already write progress into their own notes ("Checking roads for idea 2 of 4…"), but those can be
   down the panel or behind it when it's lowered. This bar repeats whichever one is running, over the map, with a
   spinner and, where the note counts ("2 of 4"), how far along it is. */
const WORK_FROM = ["#routeStatus", "#ideasNote", "#offlineNote", "#status", "#queueChip", "#stopList li"];
function syncWork(){
  let src = null;
  if ($("#busy").hidden) for (const sel of WORK_FROM) {
    const el = $(sel); if (!el || el.hidden || el.closest(".view[hidden]") || el.closest("[hidden]")) continue;
    if (/…\s*$/.test(el.textContent.trim()) || (sel === "#queueChip" && el.textContent)) { src = el; break; }
  }
  $("#workBar").hidden = !src || Ride.on;
  $("#status").classList.toggle("mirrored", src === $("#status"));
  $("#queueChip").classList.add("mirrored");   // the queue's count shows in the bar instead
  if (!src) return;
  const t = src.textContent.trim(), m = t.match(/(\d+) of (\d+)/);
  if ($("#workText").textContent !== t) $("#workText").textContent = t;
  $("#workFill").style.width = m ? Math.round(100 * +m[1] / +m[2]) + "%" : "0";
}
setInterval(syncWork, 250);

/* ---------- pop-overs, toggles, boot ---------- */
function togglePop(id){
  const opening = $("#" + id).hidden; if (opening) navPush();
  if (opening && phone()) setSheet("min");   // on a phone the panel goes down so the whole box, and its close button, fits
  for (const p of ["layersPop"]) $("#" + p).hidden = p !== id || !opening;
  if (opening) { $("#poiMenu").hidden = true; closeSearch(); }
}
$("#btnLayers").onclick = () => togglePop("layersPop");
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => $("#" + b.dataset.close).hidden = true);
map.on("movestart", () => { $("#results").hidden = true; });
map.on("click", () => { if (!picking) $("#layersPop").hidden = true; });
// On a phone, a popup must not open underneath the bottom sheet: drop the sheet and move the map to clear it.
map.on("popupopen", e => {
  // screens whose preview is a small strip drop to it; the half-height ones (route, ideas, tour, lanes) drop to the bar
  if (phone() && sheet.dataset.state !== "min") setSheet("min");
  // then move the map so the whole popup sits between the search bar and buttons at the top and the panel at the bottom
  setTimeout(() => {
    const el = e.popup.getElement(); if (!el || !map.hasLayer(e.popup)) return;
    const r = el.getBoundingClientRect(), m = map.getContainer().getBoundingClientRect();
    const top = Math.max(m.top, ...["#searchWrap", "#tools", "#poiWrap"].map(q => { const b = $(q)?.getBoundingClientRect(); return b && b.height ? b.bottom : 0; })) + 8;
    const bottom = (phone() ? sheet.getBoundingClientRect().top : m.bottom) - 8;
    const dy = r.top < top ? r.top - top : r.bottom > bottom ? Math.min(r.bottom - bottom, r.top - top) : 0;
    if (dy) map.panBy([0, dy], { animate: false });
  }, phone() ? 320 : 30);
});
const toggles = store.get("toggles", {});
for (const id of ["tLanes", "tUcr", "tZones", "tClosed", "tNotes"]) {
  if (id in toggles) $("#" + id).checked = toggles[id];
  $("#" + id).onchange = e => {
    toggles[id] = e.target.checked; store.set("toggles", toggles);
    if (id === "tNotes") showNotes(e.target.checked); else { drawLanes(); drawZones(); }
  };
}
document.addEventListener("keydown", e => { if (e.key === "Escape") { stopModes(); $("#layersPop").hidden = true; } });
let moveTimer;
map.on("zoomend", () => { if (view === "route" && trip.items.length) drawRoute(); });   // lane numbers re-spread at the new zoom
map.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { drawLanes(); drawZones(); drawStops(); drawRouteStops(); }, 120); });

// boot: carry on where you left off (including half way through changing one day of a tour)
const wasEditing = store.get("editing", null);
if (wasEditing && tour?.days?.[wasEditing.day] && trip.items.length) { editingDay = wasEditing.day; dayBefore = wasEditing.before; }
if (tour && store.get("lastView", "") === "tour" && editingDay == null) openTour();
else if (trip.items.length) {
  showView("route", "peek"); renderRoute();
  fitMap(L.latLngBounds(trip.items.flatMap(it => it.coords).concat(trip.start ? [trip.start] : [])).pad(0.1));
  if (!built || built.twisty !== settings.twisty) build(); else findRouteStops();
} else if (["help", "saved"].includes(store.get("lastView", ""))) showView(store.get("lastView", ""), "mid");
else { showView("plan", "peek"); showBritain(); }
navPush();   // one step to go back to, so the phone's Back from here shows the start screen instead of leaving
addEventListener("pagehide", () => store.set("lastView", view));

/* ---------- the phone's back gesture steps back inside the planner ----------
   Every move forward (a new screen, ride mode, the search bar, the map key) adds a step to the browser's history, so
   Back closes what's open or returns to the screen before, instead of leaving the planner altogether. */
addEventListener("popstate", () => {
  navBusy = true;
  try {
    if (typeof Ride !== "undefined" && Ride.on) Ride.end();
    else if (!$("#welcome").hidden) { if (!$("#wlCarry").hidden) $("#wlCarry").click(); else closeWelcome(); }
    else if ($("#searchWrap").classList.contains("open")) closeSearch();
    else if (!$("#layersPop").hidden) $("#layersPop").hidden = true;
    else if (!$("#poiMenu").hidden) $("#poiMenu").hidden = true;
    else if (picking || drawing || drawWhenZoomed) $("#bannerCancel").click();
    else {
      const back = document.querySelector(`#${{ route: editingDay != null ? "editingBack" : "routeBack", ideas: "ideasBack", region: "regionBack", lanes: "lanesBack", tour: "tourBack" }[view] || "none"}`);
      if (back && !back.hidden) back.click();
      else if (view !== "plan") showView("plan", "peek");
      else showWelcome();
    }
  } finally { navBusy = false; }
});

/* ---------- start screen: shown once per visit ---------- */
function showWelcome(){
  // big trips: a sketch of each one's line, drawn from the tour data
  const trips = (feat()?.tours || []).filter(t => t.tour?.line?.length > 1);
  $("#wlTripsSec").hidden = !trips.length;
  const box = $("#wlTrips"); box.innerHTML = "";
  trips.sort((a, b) => b.tour.days.length - a.tour.days.length).forEach(t => {
    const tk = t.tour.days.reduce((a, d) => a + (d.built?.total || 0), 0), b = document.createElement("button");
    b.className = "wl-trip"; b.setAttribute("aria-label", `${t.name}, ${daysTxt(t.tour.days.length)}`);
    b.innerHTML = `${routeSketch(t.tour.days.flatMap(d => d.built?.segs?.flatMap(sg => sg.coords) || []), t.tour.round)}<div class="cap"><b>${esc(t.name)}</b><span>${t.tour.days.length} day${t.tour.days.length > 1 ? "s" : ""} · ${km(tk)} km${t.kind === "road" ? " · roads" : " · lanes"}</span></div>`;
    b.onclick = () => { closeWelcome(); loadFeaturedTour(t); };
    box.append(b);
  });
  // a way back to wherever you were: the route or tour you had open, the area, the ideas, or just the map
  const back = { saved: "Back to Saved", help: "Back to Help", start: "Back to Plan" }[view] || "Back to the map";
  const carry = view === "tour" && tour ? "Carry on: " + (tour.name || "your tour") : trip.items.length && view !== "ideas" && view !== "region" ? "Carry on: " + (trip.name || "your route")
    : view === "region" && regionOpen ? "Back to " + (regionBySlug(regionOpen)?.name || "the area") : view === "ideas" && ideas.length ? "Back to your route ideas"
    : welcomeFromHome ? back : null;
  carryRoute = !!carry && carry.startsWith("Carry on: ") && view !== "tour" && view !== "route";
  welcomeFromHome = false;
  $("#wlCarry").hidden = !carry;
  if (carry) $("#wlCarry").textContent = carry;
  $("#wlLoading").hidden = true;
  $("#welcome").hidden = false; $("#welcome").scrollTop = 0;
}
// A route's shape as a small drawing for a card: the line in the route colour on the poster paper, with its start marked
function routeSketch(pts, round){
  if (pts.length < 2) return "";
  const step = Math.max(1, Math.floor(pts.length / 400)), P = pts.filter((_, i) => i % step === 0).concat([pts.at(-1)]);
  const k = Math.cos(P[0][0] * Math.PI / 180), xs = P.map(p => p[1] * k), ys = P.map(p => -p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), W = 300, H = 200, pad = 22;
  const sc = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1)), ox = (W - sc * (x1 - x0)) / 2, oy = (H - sc * (y1 - y0)) / 2;
  const d = P.map((p, i) => `${i ? "L" : "M"}${(ox + sc * (xs[i] - x0)).toFixed(1)} ${(oy + sc * (ys[i] - y0)).toFixed(1)}`).join("");
  const [sx, sy] = d.slice(1).split("L")[0].split(" "), [ex, ey] = d.split("L").at(-1).split(" ");
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="#fffdf6" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#c2185b" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${sx}" cy="${sy}" r="7" fill="#1f1d18" stroke="#fffdf6" stroke-width="2.5"/>${round ? "" : `<circle cx="${ex}" cy="${ey}" r="6" fill="#fffdf6" stroke="#1f1d18" stroke-width="3"/>`}</svg>`;
}
// tapping an area card (the cards are drawn before the app loads, so one handler serves them all)
$("#wlAreas").addEventListener("click", e => { const c = e.target.closest(".rcard"); if (c) { closeWelcome(); openRegion(c.dataset.slug); } });
$("#wlRides").onclick = () => $(trips0() ? "#wlTripsSec" : "#wlAreasTop").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
const trips0 = () => !$("#wlTripsSec").hidden;
// nearest areas first, with the distance on each card
$("#wlNear").onclick = () => {
  const btn = $("#wlNear");
  if (btn.dataset.on) { delete btn.dataset.on; btn.textContent = "📍 Nearest first"; renderAreas(); return; }
  if (!navigator.geolocation) { status("This browser can't read your location."); return; }
  btn.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(pos => {
    const me = [pos.coords.latitude, pos.coords.longitude], d = r => hav(me, r.starts[0].at);
    renderAreas([...REGION_LIST].sort((a, b) => d(a) - d(b)));
    for (const c of $("#wlAreas").querySelectorAll(".rcard")) { const r = regionBySlug(c.dataset.slug); c.querySelector(".dist").textContent = `${Math.round(d(r) / 1000)} km away`; }
    btn.dataset.on = "1"; btn.textContent = "By country";
  }, () => { btn.textContent = "Location is off"; setTimeout(() => { btn.textContent = "📍 Nearest first"; }, 4000); }, { timeout: 15000, maximumAge: 600000 });
};
function closeWelcome(){ $("#welcome").hidden = true; try { sessionStorage.setItem("glp:welcomed", "1"); } catch (e) {} map.invalidateSize(); }
let carryRoute = false;   // "Carry on" from another screen opens the route itself
$("#wlCarry").onclick = () => {
  closeWelcome();
  if (carryRoute) { showView("route", "mid"); renderRoute(); drawRoute(); fitMap(L.latLngBounds(trip.items.flatMap(it => it.coords)).pad(0.1)); if (!built) build(); return; }
  if (view === "plan" || view === "region") setSheet(sheet.dataset.state);
};
$("#wlMap").onclick = () => { closeWelcome(); showView("plan", phone() || sideAuto() ? "min" : "peek"); setTimeout(showBritain, 30); };
$("#wlLoop").onclick = () => { closeWelcome(); $("#goLoop").click(); };
$("#wlDraw").onclick = () => { closeWelcome(); $("#goDraw").click(); };
$("#wlTour").onclick = () => { closeWelcome(); $("#goTour").click(); };
$("#wlLanes").onclick = () => { closeWelcome(); openLanes(); };
$("#helpHome").onclick = () => { welcomeFromHome = true; navPush(); showWelcome(); };
let welcomed = false; try { welcomed = !!sessionStorage.getItem("glp:welcomed"); } catch (e) {}
if (!welcomed) showWelcome(); else $("#welcome").hidden = true;
if (innerWidth < 360) $("#q").placeholder = "Town or postcode";
document.documentElement.classList.remove("booting");   // the start screen's buttons work from here
// Keep the app, its data and the map tiles you've looked at on the phone, so it opens and exports GPX with no signal
// the app keeping itself for use with no signal is in js/offline.js
// The 2012 notes are kept out of the public copy (they're someone else's writing); hide the switch when absent.
fetch("data/qwerf-lanes.js", { method: "HEAD" }).then(r => { if (!r.ok) { $("#tNotes").closest("label").hidden = true; $("#tNotes").checked = false; } else if ($("#tNotes").checked) showNotes(true); }).catch(() => { $("#tNotes").closest("label").hidden = true; });
drawLanes(); drawZones(); drawStops();
