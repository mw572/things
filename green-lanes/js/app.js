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
const hm = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}`; };
const clone = o => JSON.parse(JSON.stringify(o));
const store = {
  get(k, d){ try { const v = localStorage.getItem("glp:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem("glp:" + k, JSON.stringify(v)); } catch {} }
};
function loadScript(src){ return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.append(s); }); }
let statusTimer;
function status(msg, ms = 5000){ const el = $("#status"); el.textContent = msg; el.hidden = !msg; clearTimeout(statusTimer); if (msg && ms) statusTimer = setTimeout(() => el.hidden = true, ms); }
const phone = () => innerWidth <= 820;

/* ---------- polite requests to the free public servers ----------
   OSRM's demo server, BRouter and Nominatim are free and ask users to keep requests modest
   (Nominatim and OSRM: about one a second). Each server gets its own queue with a gap between
   requests, and every answer is cached. The queue length shows on screen so waiting is never silent. */
const SERVERS = { osrm: { gap: 1000, lanes: 1 }, brouter: { gap: 300, lanes: 2 }, nominatim: { gap: 1100, lanes: 1 } };
for (const k in SERVERS) Object.assign(SERVERS[k], { next: 0, pending: 0, q: Array.from({ length: SERVERS[k].lanes }, () => ({ last: 0, chain: Promise.resolve() })) });
const reqCache = new Map();
function queueChanged(){
  const n = Object.values(SERVERS).reduce((t, s) => t + s.pending, 0);
  $("#busyQueue").textContent = n ? `Waiting on the free routing servers: ${n} request${n > 1 ? "s" : ""} in the queue.` : "";
  $("#queueChip").hidden = !n || !$("#busy").hidden;
  $("#queueChip").textContent = `Asking the routing servers… ${n} in the queue`;
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
const map = L.map("map", { preferCanvas: true, renderer: L.canvas({ tolerance: 10 }), zoomControl: false }).setView([52.6, -2.3], 7);
L.control.zoom({ position: "bottomright" }).addTo(map);
map.createPane("route"); map.getPane("route").style.zIndex = 450; map.getPane("route").style.pointerEvents = "none";
const routeRenderer = L.svg({ pane: "route" });
const bases = {
  Map: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri, HERE, Garmin, OS, © OpenStreetMap contributors" }),
  Satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri, Maxar, Earthstar Geographics" }),
  Topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors" })
};
let baseName = store.get("base", "Map"); if (!bases[baseName]) baseName = "Map";
bases[baseName].addTo(map);
function setBase(name){
  map.removeLayer(bases[baseName]); baseName = name; bases[name].addTo(map); bases[name].bringToBack(); store.set("base", name);
  document.querySelectorAll("#baseSeg button").forEach(b => b.setAttribute("aria-selected", b.dataset.base === name));
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
  closed: { color: "--closed", weight: 2,   dash: "2 6", say: "Recorded as closed to motor vehicles.", ride: false },
  rb:     { color: "--closed", weight: 2,   dash: "2 6", say: "Restricted byway: no motor vehicles.", ride: false }
};
function classify(t){
  const no = v => ["no", "private", "forestry", "agricultural", "delivery", "permit"].includes(v);
  if (t.designation === "restricted_byway") return "rb";
  if (no(t.motor_vehicle) || no(t.motorcycle) || (no(t.access) && !t.motor_vehicle && !t.motorcycle)) return "closed";
  const txt = [t.note, t.description].join(" ").toLowerCase();
  if (t["motor_vehicle:conditional"] || t["motorcycle:conditional"] || /\btro\b|traffic regulation/.test(txt) || t.seasonal) return "tro";
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
function putWay(id, tags, coords){
  let a = 90, b = 180, c = -90, d = -180;
  for (const [la, lo] of coords) { if (la < a) a = la; if (lo < b) b = lo; if (la > c) c = la; if (lo > d) d = lo; }
  const council = window.COUNCIL_FLAGS?.ways?.[id] || null;   // the council's own record says it isn't a byway
  const w = { id, tags, coords, cls: council ? "closed" : classify(tags), council, bbox: [a, b, c, d], len: lineLen(coords) };
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
(window.COUNCIL_BOATS?.ways || []).forEach(([ref, council, coords], i) => {
  if (coords.length < 2) return;
  putWay(-(i + 1), { designation: "byway_open_to_all_traffic", name: `${council} byway ${ref.split("|").slice(1).join(" ")}`, source: "council", council }, coords);
  councilAdded++;
});
$("#dataNote").textContent = `Lanes: ${(osmWays.size - councilAdded).toLocaleString()} from OpenStreetMap, ${window.OSM_LANES?.built || "date unknown"}` + (councilAdded ? `, plus ${councilAdded.toLocaleString()} byway stretches from council records.` : ".");
const laneLayer = L.layerGroup().addTo(map);
const shown = new Set();
let fadeLanes = false;
function laneStyle(w){
  const c = CLASSES[w.cls], z = map.getZoom();
  return { color: css(c.color), weight: c.weight + (z >= 13 ? 1 : 0), dashArray: w.tags.source === "council" ? "10 4" : c.dash, opacity: fadeLanes ? .22 : .5 };
}
function layerOf(w){
  if (!w.layer) w.layer = L.polyline(w.coords, laneStyle(w)).bindPopup(() => lanePopup(w), { maxWidth: 300 })
    .on("popupopen", () => highlightLane(w)).on("popupclose", () => highlightLane(null));
  return w.layer;
}
// While you look at a lane its whole length lights up, so you can see where it goes before adding it.
const highlightLayer = L.layerGroup().addTo(map);
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
const inRoute = id => trip.items.some(it => it.ids.includes(id));
function lanePopup(w){
  const t = w.tags, c = CLASSES[w.cls], mid = w.coords[Math.floor(w.coords.length / 2)];
  const div = document.createElement("div");
  const surface = [t.surface, t.tracktype && t.tracktype.replace("grade", "grade ")].filter(Boolean).join(", ");
  div.innerHTML = `<h3>${esc(laneName(t))}</h3>
    <div><span class="chip" style="background:${css(c.color)}">${esc(DESIG[t.designation] || "Byway")}</span> ${km(w.len)} km${surface ? " · " + esc(surface) : ""}</div>
    <p style="margin-top:6px">${esc(w.tags.source === "council" ? `From ${w.tags.council} Council's rights-of-way record, where it's a byway open to all traffic. It isn't in OpenStreetMap yet, so the line on the map may be rough.` : w.council ? `OpenStreetMap calls this a byway, but ${w.council.council} Council's rights-of-way record calls it a ${w.council.calls} (${w.council.ref.split("|").slice(1).join(" ")}). Treated as not open to motor vehicles.` : c.say)}</p>`;
  const away = view === "route" && !inRoute(w.id) ? distFromRoute(w) : null;
  if (away != null) div.insertAdjacentHTML("beforeend", `<p class="small muted">${away < 150 ? "Right next to your route." : `About ${km(away)} km from your route.`}</p>`);
  if (c.ride && view !== "tour") {
    const acts = document.createElement("div"); acts.className = "pop-actions";
    const b = document.createElement("button"); b.className = "btn " + (inRoute(w.id) ? "" : "primary");
    b.textContent = inRoute(w.id) ? "− Take out of route" : (trip.items.length ? "+ Add to route" : "+ Start a route with this lane");
    b.onclick = () => { map.closePopup(); inRoute(w.id) ? removeLane(w.id) : addLane(w); };
    acts.append(b); div.append(acts);
  }
  div.insertAdjacentHTML("beforeend", `<div class="pop-links">
    <a href="https://www.greenroadmap.org.uk/" target="_blank" rel="noopener">Check closures (TRF map)</a>
    <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${mid[0].toFixed(6)},${mid[1].toFixed(6)}" target="_blank" rel="noopener">Street View</a>
    <a href="#" class="whole">Show the whole lane</a></div>`);
  div.querySelector(".whole").onclick = e => { e.preventDefault(); map.fitBounds(L.latLngBounds(w.coords).pad(0.4), { maxZoom: 16, paddingBottomRight: phone() ? [0, 200] : [0, 0] }); };
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
    L.circle([(i + .5) * CELL, (j + .5) * CELL], { radius: 6000 + 3000 * rich, stroke: false, fillColor: "#236b3a", fillOpacity: .10 + .28 * rich, interactive: false, renderer: zoneRenderer }).addTo(zoneLayer);
  }
})();
function drawZones(){
  const on = $("#tZones").checked && map.getZoom() <= 8 && view === "plan";
  on ? zoneLayer.addTo(map) : map.removeLayer(zoneLayer);
  (view === "plan" && map.getZoom() <= 8) ? regionPinLayer.addTo(map) : map.removeLayer(regionPinLayer);
  $("#zoomHint").hidden = !(on && !drawing && !picking && !(phone() && sheet.dataset.state === "open"));
}
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
  return `<h3 style="display:flex;gap:8px;align-items:center">${poiBadge(s.code)} ${esc(stopName(s))}</h3><div class="muted">${esc(CODE[s.code].one)}${info ? " · " + esc(info) : ""}</div>
    <div class="pop-links">${web}<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((s.name ? s.name + " " : "") )}${s.lat.toFixed(5)},${s.lng.toFixed(5)}" target="_blank" rel="noopener">Google Maps: reviews and hours</a></div>`;
}
const pinIcon = (code, small) => L.divIcon({ className: "", html: `<div class="poi-pin${small ? " small" : ""}">${poiBadge(code)}</div>`, iconSize: [0, 0] });
const stopLayer = L.layerGroup().addTo(map), routeStopLayer = L.layerGroup().addTo(map);
let routeStopIdx = new Set();
const groupBadge = g => `<span class="poi" style="background:${g.color};--pc:${g.color}"><svg viewBox="0 0 16 16" aria-hidden="true">${ICON[g.icon]}</svg></span>`;
// Draw stops grouped: one marker per patch of screen, showing up to three kinds and how many places are in it.
// Zooming in splits the patches (big when zoomed out, smaller closer in) and from zoom 16 every place shows
// where it really is. Tapping a group zooms in on it.
function drawGrouped(layer, idxs, pickRep){
  const z = map.getZoom(), px = z >= 16 ? 0 : z >= 14 ? 58 : z >= 13 ? 70 : 88, groups = new Map();
  for (const i of idxs) {
    const s = stops[i], pt = map.latLngToLayerPoint([s.lat, s.lng]);
    const key = px ? Math.floor(pt.x / px) + ":" + Math.floor(pt.y / px) : "i" + i;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i);
  }
  const order = Object.keys(GROUPS);
  for (const m of groups.values()) {
    const rep = pickRep ? pickRep(m) : m[Math.floor(m.length / 2)], s = stops[rep];
    if (m.length === 1) { L.marker([s.lat, s.lng], { icon: pinIcon(s.code, z < 13), keyboard: false }).bindPopup(stopPopup(s)).addTo(layer); continue; }
    const tally = {}; for (const i of m) { const g = CODE[stops[i].code].g; tally[g] = (tally[g] || 0) + 1; }
    const kinds = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || order.indexOf(a) - order.indexOf(b));
    const lat = m.reduce((t, i) => t + stops[i].lat, 0) / m.length, lng = m.reduce((t, i) => t + stops[i].lng, 0) / m.length;
    const words = kinds.map(k => GROUPS[k].label.toLowerCase()).join(", ");
    L.marker(pickRep ? [s.lat, s.lng] : [lat, lng], { keyboard: false, title: `${m.length} places: ${words}. Tap to zoom in.`,
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="poi-pin cl">${groupBadge(GROUPS[kinds[0]])}<b class="count">${m.length > 99 ? "99+" : m.length}</b>${kinds.length > 1 ? `<span class="dots">${kinds.slice(1, 5).map(k => `<i style="background:${GROUPS[k].color}"></i>`).join("")}</span>` : ""}</div>` }) })
      .on("click", () => { const b = L.latLngBounds(m.map(i => [stops[i].lat, stops[i].lng])); b.getNorthEast().distanceTo(b.getSouthWest()) > 30 ? map.fitBounds(b.pad(0.3), { maxZoom: Math.min(18, z + 3) }) : map.setView([lat, lng], Math.min(18, z + 3)); })
      .addTo(layer);
  }
}
function drawStops(){
  stopLayer.clearLayers();
  if (!Object.values(GROUPS).some(g => g.on) || map.getZoom() < 13) return;   // everywhere: town level only; along your route they show from zoom 10
  if (!stops) { loadStops().then(s => s && drawStops()); return; }
  const b = map.getBounds().pad(0.05), idxs = [];
  for (let i = Math.floor(b.getSouth()/SCELL); i <= Math.floor(b.getNorth()/SCELL); i++)
    for (let j = Math.floor(b.getWest()/SCELL); j <= Math.floor(b.getEast()/SCELL); j++)
      for (const k of stopGrid.get(i + "," + j) || []) { const s = stops[k]; if (!routeStopIdx.has(k) && groupOn(s.code) && b.contains([s.lat, s.lng])) idxs.push(k); }
  drawGrouped(stopLayer, idxs);
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
      else if (g.on && map.getZoom() < 13 && !routeStopIdx.size) status("Zoom in to town level to see them on the map", 3500);
    };
    menu.append(lab);
  }
  menu.insertAdjacentHTML("beforeend", `<p class="small muted">Shown when you zoom in, and along your route. The ones ticked also go into the GPX.</p>`);
}
$("#poiBtn").onclick = e => { e.stopPropagation(); const m = $("#poiMenu"); m.hidden = !m.hidden; $("#poiBtn").setAttribute("aria-expanded", !m.hidden); };
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
  grp.addTo(map); map.fitBounds(grp.getBounds());
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
  document.querySelectorAll(".laneKind button").forEach(b => b.setAttribute("aria-selected", (b.dataset.k === "all") === settings.useUcr));
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
  if (view === "route") { renderRoute(); buildSoon(300); } else replanSoon();
});
for (const id of ["twisty", "twisty2"]) $("#" + id).onchange = e => { settings.twisty = +e.target.value; saveSettings(); syncSettings(); if (view === "route") buildSoon(); else replanSoon(); };

/* ---------- views and the phone sheet ---------- */
let view = "plan";
const sheet = $("#sheet");
const PEEK = { plan: 300, region: 250, ideas: 176, route: 206, tour: 206 };
// On a phone the panel has three positions: a collapsed bar, a preview, and full height.
// The preview is the short peek on Explore and the area page, and half height on the working screens.
const previewState = () => ["plan", "region"].includes(view) ? "peek" : "mid";
const SHEET_ORDER = () => ["min", previewState(), "open"];
function setSheet(state){
  if (state === "peek" || state === "mid") state = previewState();
  sheet.dataset.state = state;
  const h = { min: "54px", peek: (PEEK[view] || 176) + "px", mid: "50vh", open: "82vh" }[state];
  document.documentElement.style.setProperty("--sheet-h", h);
  // map credits and the zoom hint tuck behind the panel when it's fully open, instead of floating near the top
  document.documentElement.style.setProperty("--sheet-ctl", state === "open" ? "0px" : h);
  if (typeof drawZones === "function" && view) drawZones();
  $("#handleText").textContent = state === "open" ? "▼ Show the map" : state === "min" ? "▲ " + minLabel() : "▲ Pull up for more";
  $("#sheetHandle").setAttribute("aria-label", state === "open" ? "Show the map" : "Show more");
}
// What the collapsed bar says, so it reads as something to open rather than a clipped panel.
function minLabel(){
  if (view === "region") return $("#regionName").textContent || "Area";
  if (view === "ideas") return "Route ideas";
  if (view === "route") return (trip.name || "Your route") + (built ? ` · ${km(built.total)} km` : "");
  if (view === "tour") return tour?.name || "Tour";
  return "Where to ride";
}
function stepSheet(dir){ const o = SHEET_ORDER(), i = Math.max(0, o.indexOf(sheet.dataset.state)); setSheet(o[Math.min(o.length - 1, Math.max(0, i + dir))]); }
// Swipe the handle up or down to move between positions; a tap moves up one, or back to the preview from full.
let handleY = null;
$("#sheetHandle").addEventListener("pointerdown", e => { handleY = e.clientY; $("#sheetHandle").setPointerCapture?.(e.pointerId); });
$("#sheetHandle").addEventListener("pointerup", e => {
  if (handleY == null) return; const dy = e.clientY - handleY; handleY = null;
  if (dy < -25) stepSheet(1); else if (dy > 25) stepSheet(-1);
  else sheet.dataset.state === "open" ? setSheet(previewState()) : stepSheet(1);
});
// Moving the map on a phone tucks the panel away so the map gets the screen.
map.on("dragstart", () => { if (phone() && !drawing && !picking && sheet.dataset.state !== "min") setSheet("min"); });
function showView(v, sheetState){
  view = v;
  for (const [id, name] of [["vPlan", "plan"], ["vRegion", "region"], ["vIdeas", "ideas"], ["vRoute", "route"], ["vTour", "tour"]]) $("#" + id).hidden = v !== name;
  if (v !== "region") regionRideLayer.clearLayers();
  $("#newConfirm").hidden = true;
  document.documentElement.style.setProperty("--sheet-peek", PEEK[v] + "px");
  setFade(v === "ideas" || v === "tour");
  if (v !== "ideas") { ideaLayer.clearLayers(); sketchLayer.clearLayers(); }
  if (v !== "tour") tourLayer.clearLayers();
  if (v === "route") { drawRoute(); } else routeLayer.clearLayers();
  setSheet(sheetState || sheet.dataset.state || previewState());
  $("#sheetBody").scrollTop = 0;
  if (v === "plan") { renderSaved(); renderExplore(); }
  drawRouteStops(); drawStops(); drawZones();
}

/* ---------- picking a spot / drawing a route in strokes ---------- */
let picking = null, drawing = false, painting = null, liveLine = null, loopStart = null, lastKind = null;
let strokes = [], shapeChoice = null;       // the drawn route is a list of finger strokes; shape is auto unless chosen
const sketchLayer = L.layerGroup().addTo(map);
function setBanner(text, opts = {}){
  $("#banner").hidden = !text; $("#bannerText").textContent = text || "";
  $("#bannerMe").hidden = !opts.me; $("#bannerMove").hidden = !opts.draw; $("#bannerUndo").hidden = !opts.draw || !strokes.length; $("#bannerDone").hidden = !opts.draw;
  $("#bannerCancel").hidden = !!opts.draw;
  $("#zoomHint").hidden = true;
}
function stopModes(){
  picking = null; drawing = false; painting = null;
  if (liveLine) { map.removeLayer(liveLine); liveLine = null; }
  map.dragging.enable(); map.getContainer().style.cursor = ""; map.getContainer().style.touchAction = "";
  setBanner(null); drawZones();
}
function pickSpot(text, then){
  stopModes(); picking = then; map.getContainer().style.cursor = "crosshair";
  setBanner(text, { me: true }); setSheet("peek");
  if (map.getZoom() < 9) status("Zoom in a little so you can tap the right spot", 6000);
}
$("#bannerCancel").onclick = stopModes;
$("#bannerMe").onclick = () => { const then = picking; locate(p => { stopModes(); then?.(p); }); };
map.on("click", e => { if (!picking) return; const then = picking; stopModes(); then([e.latlng.lat, e.latlng.lng]); });

// Loop from a place: set the start, then the ideas and all the controls stay on one screen.
$("#goLoop").onclick = () => {
  lastKind = "loop"; ideas = []; picked = -1; ideaRun++;
  openIdeas();
  if (loopStart) runIdeas(); else pickSpot("Tap the map where you'll start", setLoopStart);
};
$("#changeStart").onclick = () => pickSpot("Tap the map where you'll start", setLoopStart);
function setLoopStart(p){ loopStart = p; drawSketch(); setIdeasUi(); runIdeas(); }

// Draw a route: as many strokes as you like; lift your finger, move the map, carry on.
$("#goDraw").onclick = () => { lastKind = "draw"; ideas = []; picked = -1; ideaRun++; openIdeas(); if (!strokes.length) startDrawing(); else runIdeas(); };
$("#drawMore").onclick = () => startDrawing();
function startDrawing(){
  stopModes(); drawing = true; map.dragging.disable();
  map.getContainer().style.cursor = "crosshair"; map.getContainer().style.touchAction = "none";
  setBanner(strokes.length ? "Keep drawing. Lift your finger and draw again to add more." : "Draw roughly where you want to go. Lift your finger and draw again to add more.", { draw: true });
  setSheet("peek");
}
$("#bannerMove").onclick = () => {   // pause drawing so the map can be moved, then carry on
  if (drawing) { drawing = false; map.dragging.enable(); map.getContainer().style.cursor = ""; map.getContainer().style.touchAction = ""; $("#bannerMove").textContent = "✎ Draw again"; $("#bannerText").textContent = "Move the map, then press Draw again."; }
  else { $("#bannerMove").textContent = "✋ Move map"; startDrawing(); }
};
$("#bannerUndo").onclick = () => { strokes.pop(); drawSketch(); setBanner($("#bannerText").textContent, { draw: true }); };
$("#bannerDone").onclick = () => { $("#bannerMove").textContent = "✋ Move map"; stopModes(); setIdeasUi(); if (strokes.length) runIdeas(); };
$("#undoStroke").onclick = () => { strokes.pop(); drawSketch(); setIdeasUi(); strokes.length ? replanSoon() : clearIdeas(); };
$("#clearStrokes").onclick = () => { strokes = []; shapeChoice = null; drawSketch(); setIdeasUi(); clearIdeas(); };
document.querySelectorAll("#shapeSeg button").forEach(b => b.onclick = () => { shapeChoice = b.dataset.shape; drawSketch(); setIdeasUi(); replanSoon(); });
const mapEl = map.getContainer();
mapEl.addEventListener("pointerdown", ev => {
  if (!drawing || ev.button > 0) return;
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
  if (lineLen(pts) < 200) return;
  strokes.push(thin(pts, 60)); drawSketch(); setIdeasUi();
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
const flag = (p, t, bg) => L.marker(p, { interactive: false, icon: L.divIcon({ className: "", html: `<span class="flag" style="background:${bg || "#1f1d18"}">${t}</span>`, iconSize: [0, 0] }) });
function drawSketch(){
  sketchLayer.clearLayers();
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
    const rl = await osrmLegs(sk, plan.chain);
    if (!alive()) return null;
    if (!rl) break;
    const estH = hoursOf(plan.laneM, plan.roadM * tf);
    plan.roadM = rl.dist.reduce((x, y) => x + y, 0); plan.roadGeom = rl.geom; plan.checked = true;
    const realH = hoursOf(plan.laneM, plan.roadM * tf);
    scale = Math.max(0.6, Math.min(2.5, realH / (estH || 1)));
    const ends = rl.pts, last = plan.chain.length, bad = new Set();
    rl.dist.forEach((m, k) => {
      const h = hav(ends[2*k], ends[2*k+1]);
      if (h > 25) { if (k > 0 && rl.snap[2*k] > 100) bad.add(k - 1); if (k < last && rl.snap[2*k+1] > 100) bad.add(k); }
      if (m > 3000 && m / (h + 1000) > 2.5) bad.add(Math.min(k, last - 1));
    });
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
const IDEA_COLORS = ["#c2185b", "#1d4ed8", "#1f1d18"];
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
  $("#startText").textContent = loopStart ? "✓ Start set" : "Tap the map to set your start";
  const shape = drawnShape();
  document.querySelectorAll("#shapeSeg button").forEach(b => b.setAttribute("aria-selected", b.dataset.shape === shape));
  $("#undoStroke").disabled = !strokes.length; $("#clearStrokes").disabled = !strokes.length;
  $("#drawMore").textContent = strokes.length ? "✎ Draw more" : "✎ Draw";
  placeSettings("ideas");
}
function openIdeas(){ showView("ideas", "mid"); setIdeasUi(); drawSketch(); renderIdeas(lastKind === "loop" && !loopStart ? "Tap the map to set your start." : lastKind === "draw" && !strokes.length ? "Draw on the map to start." : ""); }
function clearIdeas(){ ideaRun++; ideas = []; picked = -1; renderIdeas(lastKind === "draw" ? "Draw on the map to start." : ""); }
async function runIdeas(){
  const run = ++ideaRun, alive = () => run === ideaRun;
  ideas = []; picked = -1;
  if (view !== "ideas") showView("ideas", "mid");
  setIdeasUi();
  const wr = mixToWr(settings.mix), target = settings.hours;
  if (lastKind === "draw") {
    const sk = drawnSketch(); if (!sk) { renderIdeas("Draw on the map to start."); return; }
    renderIdeas("Finding lanes along your route…");
    const r = await fitPlan(sk, settings.width * 1000, wr, target, alive);
    if (!alive()) return;
    if (r && r.chain.length) ideas.push({ ...r, name: drawnShape() === "loop" ? "Your loop" : "Your route", color: IDEA_COLORS[0] });
    picked = ideas.length ? 0 : -1;
    renderIdeas(ideas.length ? "" : `No lanes within ${settings.width} km of what you drew. Look for lanes further out, or draw somewhere else.`);
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
      if (!r.chain.length || hoursOf(r.laneM, r.roadM * twistF()) <= target * 1.2) break;
      sk = e.sk.map(p => [loopStart[0] + (p[0] - loopStart[0]) * 0.7, loopStart[1] + (p[1] - loopStart[1]) * 0.7]);
    }
    if (r.chain.length) ideas.push({ ...r, name: `Loop heading ${e.name}`, color: IDEA_COLORS[ideas.length] });
    if (picked < 0 && ideas.length) { picked = 0; fitTo(ideas[0]); }
    renderIdeas(k < chosen.length - 1 ? `Checking roads for idea ${k + 2} of ${chosen.length}…` : "");
  }
  if (!ideas.length) renderIdeas("No lanes close enough to this start. Try a longer ride time, or start somewhere else.");
}
function fitTo(idea){ map.fitBounds(L.latLngBounds(idea.sketch.concat(idea.chain.flatMap(n => [n.a, n.b]))).pad(0.08), { paddingBottomRight: phone() ? [0, innerHeight * 0.5] : [0, 0] }); }
function drawChain(layer, it, on, color){
  const R = routeRenderer, road = { color, weight: on ? 3 : 2, opacity: on ? .9 : .3, dashArray: "6 6", interactive: false, renderer: R };
  if (it.roadGeom) for (const g of it.roadGeom) { if (g.length > 1) L.polyline(g, road).addTo(layer); }
  else { let p = it.sketch[0]; for (const n of it.chain) { L.polyline([p, n.a], road).addTo(layer); p = n.b; } }
  for (const n of it.chain) {
    if (on) L.polyline(n.coords, { color: "#fff", weight: 11, opacity: 1, interactive: false, renderer: R }).addTo(layer);
    L.polyline(n.coords, { color, weight: on ? 6 : 4, opacity: on ? 1 : .35, interactive: false, renderer: R }).addTo(layer);
  }
}
function renderIdeas(msg){
  ideaLayer.clearLayers();
  $("#ideasNote").textContent = msg || (ideas.length ? `Change anything above and the ideas update. Times assume ${LANE_KMH} km/h on lanes and about ${Math.round(roadKmh())} km/h on roads.` : "");
  const order = ideas.map((_, i) => i).filter(i => i !== picked); if (picked >= 0) order.push(picked);
  for (const i of order) drawChain(ideaLayer, ideas[i], i === picked, ideas[i].color);
  const box = $("#ideaList"); box.innerHTML = "";
  ideas.forEach((it, i) => {
    const roadM = it.roadM * twistF(), tot = it.laneM + roadM, boats = it.chain.filter(n => n.w.cls === "boat").length;
    const card = document.createElement("div"); card.className = "card"; card.style.setProperty("--c", it.color);
    card.setAttribute("role", "button"); card.tabIndex = 0; card.setAttribute("aria-pressed", i === picked);
    card.innerHTML = `<div class="top"><h3>${esc(it.name)}</h3></div>
      <div class="stats"><span><b>${hm(hoursOf(it.laneM, roadM))}</b> riding</span><span><b>${km(tot)}</b> km</span><span><b>${Math.round(100 * it.laneM / tot)}%</b> lanes (${km(it.laneM)} km)</span><span><b>${it.chain.length}</b> lanes${boats === it.chain.length ? ", all byways" : boats ? `, ${boats} byways` : ""}</span></div>`;
    const go = document.createElement("button"); go.className = "btn primary"; go.textContent = "Ride this";
    go.onclick = ev => { ev.stopPropagation(); useIdea(i); };
    card.querySelector(".top").append(go);
    const pick = () => { picked = i; renderIdeas(msg); fitTo(it); };
    card.onclick = pick; card.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
    box.append(card);
  });
}
$("#ideasBack").onclick = () => { ideaRun++; stopModes(); sketchLayer.clearLayers(); showView("plan", "peek"); };

/* ---------- a route: a list of lanes plus optional start and finish ---------- */
const newTrip = () => ({ name: "My route", start: null, finish: null, loop: false, items: [] });
let trip = store.get("trip2", null) || newTrip();
let built = store.get("built5", null);
let editingDay = null;       // when editing one day of a tour
const saveTrip = () => { store.set("trip2", trip); store.set("built5", built); };
const routeLayer = L.layerGroup().addTo(map);
const itemFromWay = (w, coords) => { const t = w.tags; return { ids: [w.id], name: laneName(t), kind: DESIG[t.designation] || "Byway", cls: w.cls, coords: coords || w.coords.slice(), surface: [t.surface, t.tracktype].filter(Boolean).join(", ") }; };
function chainToItems(chain){   // join lanes that touch into one entry, so the list reads as lanes, not fragments
  const items = [];
  for (const n of chain) {
    const last = items.at(-1);
    if (last && hav(last.coords.at(-1), n.a) < 30 && last.cls === n.w.cls) {
      last.coords = last.coords.concat(n.coords.slice(1)); last.ids.push(n.w.id);
      if (last.name.startsWith("Unnamed")) last.name = laneName(n.w.tags);
      continue;
    }
    items.push(itemFromWay(n.w, n.coords.slice()));
  }
  return items;
}
function addItem(item){
  if (!trip.items.length) { trip = newTrip(); trip.items.push(item); }
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
  drawRoute(); buildSoon(300);
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
function dragMarker(at, cls, onDrop){
  const m = L.marker(at, { draggable: true, autoPan: true, keyboard: false, zIndexOffset: 500,
    icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="handle ${cls}"></div>` }), title: "Drag onto a green lane" });
  m.on("drag", e => { const w = laneNear(e.target.getLatLng()); w ? highlightLane(w) : highlightLane(null); });
  m.on("dragend", e => { highlightLane(null); const ll = e.target.getLatLng(); onDrop(laneNear(ll), [ll.lat, ll.lng]); });
  return m;
}
function removeLane(id){ const i = trip.items.findIndex(it => it.ids.includes(id)); if (i >= 0) removeItem(i); }
function removeItem(i){
  trip.items.splice(i, 1); built = null; saveTrip();
  if (!trip.items.length) { routeLayer.clearLayers(); routeStopIdx = new Set(); routeStopLayer.clearLayers(); showView(editingDay != null ? "tour" : "plan", "peek"); return; }
  renderRoute(); drawRoute(); buildSoon(300);
}
$("#routeBack").onclick = () => { if (!lastKind) return; showView("ideas", "mid"); setIdeasUi(); drawSketch(); renderIdeas(); if (picked >= 0 && ideas[picked]) fitTo(ideas[picked]); };
function useIdea(i){
  const it = ideas[i], sk = it.sketch, loop = isLoop(sk);
  trip = { name: it.name, start: sk[0], finish: loop ? null : sk.at(-1), loop, items: chainToItems(it.chain) };
  built = null; editingDay = null; saveTrip(); ideaRun++;
  sketchLayer.clearLayers();
  showView("route", "mid"); build();
}
function orientTrip(t){
  const it = t.items; if (!it.length) return;
  if (t.start) { if (hav(t.start, it[0].coords.at(-1)) < hav(t.start, it[0].coords[0])) it[0].coords.reverse(); }
  else if (it.length > 1) {
    const nx = [it[1].coords[0], it[1].coords.at(-1)];
    if (Math.min(...nx.map(p => hav(it[0].coords[0], p))) < Math.min(...nx.map(p => hav(it[0].coords.at(-1), p)))) it[0].coords.reverse();
  }
  for (let i = 1; i < it.length; i++) { const prev = it[i-1].coords.at(-1); if (hav(prev, it[i].coords.at(-1)) < hav(prev, it[i].coords[0])) it[i].coords.reverse(); }
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
// One road link, lane end to next lane start. Answers are cached, so edits only re-route the links that changed.
async function brLink(a, b){
  for (let attempt = 0; attempt < 2; attempt++) {
    let pid; try { pid = await brouterProfile(attempt > 0); } catch { return null; }
    const url = `https://brouter.de/brouter?lonlats=${a[1].toFixed(6)},${a[0].toFixed(6)}|${b[1].toFixed(6)},${b[0].toFixed(6)}&profile=${pid}&alternativeidx=0&format=geojson&profile:twisty=${tw().toFixed(2)}`;
    const r = await polite("brouter", url, {}, { timeout: 45000 });
    if (!r.ok) { if (attempt === 0 && /profile/i.test(r.text)) continue; return null; }
    try {
      const c = JSON.parse(r.text).features[0].geometry.coordinates.map(([x, y]) => [y, x]);
      return { coords: [a, ...c, b], ok: true, jump: Math.max(hav(a, c[0]), hav(c.at(-1), b)), via: "BRouter" };
    } catch { return null; }
  }
  return null;
}
async function osrmLink(a, b){
  const r = await polite("osrm", `https://router.project-osrm.org/route/v1/driving/${a[1].toFixed(6)},${a[0].toFixed(6)};${b[1].toFixed(6)},${b[0].toFixed(6)}?overview=full&geometries=geojson`);
  try { const d = JSON.parse(r.text); if (d.code !== "Ok") throw 0;
    return { coords: [a, ...d.routes[0].geometry.coordinates.map(([x, y]) => [y, x]), b], ok: true, jump: Math.max(d.waypoints[0].distance, d.waypoints[1].distance), via: "OSRM" };
  } catch { return { coords: [a, b], ok: false, jump: hav(a, b), via: "none" }; }
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
  const roads = await Promise.all(tripLinks(t).map(async l => {
    if (!l) return null;
    const straight = hav(l[0], l[1]);
    const lp = straight < 15000 ? laneGraphPath(l[0], l[1], settings.useUcr, straight * 3 + 3000) : null;
    let r;
    if (lp && lp.len <= straight * 1.6 + 1000) r = { coords: lp.coords, ok: true, jump: 0, via: "lanes", lanes: true };
    else {
      r = (await brLink(l[0], l[1])) || (await osrmLink(l[0], l[1]));
      if (lp && (r.jump > 100 || !r.ok)) r = { coords: lp.coords, ok: true, jump: 0, via: "lanes", lanes: true };
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
  return { segs, off, road: roadM, joinM: segs.filter(s => s.lanes).reduce((a, s) => a + lineLen(s.coords), 0), total: off + roadM, hours: hoursOf(off, roadM),
    bend: bendiness(segs.filter(s => s.type === "road" && !s.lanes).map(s => s.coords)),
    jumps: segs.filter(s => s.type === "road" && s.jump > 100).length, failed: segs.filter(s => s.type === "road" && s.ok === false).length,
    via: vias.join(" and ") || "none needed", twisty: settings.twisty };
}
let buildRun = 0, buildTimer;
function buildSoon(ms = 900){ clearTimeout(buildTimer); buildTimer = setTimeout(build, ms); }
async function build(){
  const run = ++buildRun;
  if (!trip.items.length) return;
  $("#gpxBtn").disabled = true;
  const todo = tripLinks(trip).filter(Boolean).length; let done = 0;
  $("#routeStatus").textContent = todo ? `Finding roads between the lanes (0 of ${todo})…` : "";
  const b = await routeTrip(trip, () => run === buildRun, () => { if (run === buildRun) $("#routeStatus").textContent = `Finding roads between the lanes (${++done} of ${todo})…`; });
  if (!b) return;
  built = b; saveTrip(); drawRoute(); renderRoute(); findRouteStops();
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
function drawBuilt(layer, t, b, bold, numbers = bold){
  const R = routeRenderer, op = bold ? 1 : .45;
  if (b) for (const s of b.segs) if (s.type === "road") {
    if (s.lanes) { if (bold) L.polyline(s.coords, { color: "#fff", weight: 9, interactive: false, renderer: R }).addTo(layer); L.polyline(s.coords, { color: "#c2185b", weight: bold ? 5 : 3, opacity: op, interactive: false, renderer: R }).addTo(layer); }
    else L.polyline(s.coords, { color: "#c2185b", weight: bold ? 4 : 2.5, opacity: bold ? .9 : .4, dashArray: s.ok === false ? "2 7" : "9 6", interactive: false, renderer: R }).addTo(layer);
  }
  t.items.forEach((it, i) => {
    if (it.via) return;
    if (bold) L.polyline(it.coords, { color: "#fff", weight: 11, opacity: 1, interactive: false, renderer: R }).addTo(layer);
    L.polyline(it.coords, { color: "#c2185b", weight: bold ? 6 : 4, opacity: op, interactive: false, renderer: R }).addTo(layer);
    if (numbers) L.marker(it.coords[0], { interactive: false, icon: L.divIcon({ className: "", html: `<span class="lane-num">${i + 1}</span>`, iconSize: [0, 0] }) }).addTo(layer);
  });
}
function drawRoute(){
  routeLayer.clearLayers();
  if (view !== "route" || !trip.items.length) return;
  drawBuilt(routeLayer, trip, built, true);
  if (trip.start) flag(trip.start, trip.loop ? "START / FINISH" : "START").addTo(routeLayer);
  if (trip.finish) flag(trip.finish, "FINISH").addTo(routeLayer);
  // A round handle on each road stretch: drag it onto a green lane to take the route that way,
  // or anywhere else to make the road pass through that spot.
  if (built) for (const s of built.segs) {
    if (s.type !== "road" || lineLen(s.coords) < 300) continue;
    let half = lineLen(s.coords) / 2, at = s.coords[0];
    for (let i = 1; i < s.coords.length; i++) { const d = hav(s.coords[i - 1], s.coords[i]); if (d >= half) { const f = half / d; at = [s.coords[i-1][0] + (s.coords[i][0] - s.coords[i-1][0]) * f, s.coords[i-1][1] + (s.coords[i][1] - s.coords[i-1][1]) * f]; break; } half -= d; }
    dragMarker(at, "", (w, p) => { w ? insertAt(s.link, itemFromWay(w)) : insertAt(s.link, itemVia(p)); status(w ? `Added ${laneName(w.tags)}` : "Added a via point"); }).addTo(routeLayer);
  }
  trip.items.forEach((it, i) => { if (it.via) dragMarker(it.coords[0], "via", (w, p) => { w ? insertAt(i, itemFromWay(w), true) : (it.coords = [p], built = null, saveTrip(), drawRoute(), build()); }).addTo(routeLayer); });
}
function routeWarnings(b, t = trip){
  const warn = [];
  const flagged = t.items.filter(it => it.ids?.some(id => window.COUNCIL_FLAGS?.ways?.[id]));
  if (flagged.length) warn.push(`The council says ${flagged.length > 1 ? `${flagged.length} of these lanes aren't` : `${flagged[0].name} isn't`} open to motors. Take ${flagged.length > 1 ? "them" : "it"} out.`);
  if (b?.jumps) warn.push(`${b.jumps} gap${b.jumps > 1 ? "s" : ""} over 100 m from a road: the GPX draws a straight line there.`);
  if (b?.failed) warn.push(`${b.failed} road link${b.failed > 1 ? "s" : ""} couldn't be routed.`);
  return warn;
}
function renderRoute(){
  $("#routeName").value = trip.name;
  $("#editingBar").hidden = editingDay == null;
  $("#routeBack").hidden = !(lastKind && ideas.length) || editingDay != null;
  if (editingDay != null) $("#editingText").textContent = `Editing day ${editingDay + 1} of your tour`;
  const off = trip.items.reduce((t, it) => t + lineLen(it.coords), 0);
  $("#stTime").textContent = built ? hm(built.hours) : "…";
  $("#stKm").textContent = built ? km(built.total) : "…";
  $("#stLane").textContent = built ? Math.round(100 * built.off / built.total) + "%" : km(off) + " km";
  $("#stTwist").textContent = built ? bendLabel(built.bend) : "…";
  $("#gpxBtn").disabled = !built;
  const nLanes = trip.items.filter(it => !it.via).length;
  const amber = trip.items.filter(it => it.cls === "ucr" || it.cls === "tro").length;
  $("#dropUcr").hidden = settings.useUcr || !amber;
  $("#dropUcr").textContent = `Take out the ${amber} unclassified road${amber === 1 ? "" : "s"} already in this route`;
  $("#routeStatus").textContent = built ? `${nLanes} lane${nLanes !== 1 ? "s" : ""} · ${km(built.off)} km off-road` : "Finding roads between the lanes…";
  $("#routeStatus").title = built ? `Includes ${km(built.joinM || 0)} km of connecting lanes. Roads by ${built.via}.` : "";
  const warn = routeWarnings(built).map(esc);
  warn.push(`Check each lane for closures before you ride (<a href="https://www.greenroadmap.org.uk/" target="_blank" rel="noopener">TRF map</a>).`);
  $("#routeWarn").innerHTML = warn.join("<br>");
  const ul = $("#laneList"); ul.innerHTML = "";
  trip.items.forEach((it, i) => {
    const li = document.createElement("li");
    const col = it.cls === "file" ? "#0e7490" : it.via ? "#5d5848" : css(CLASSES[it.cls]?.color || "--ucr");
    li.innerHTML = `<span class="num">${i + 1}</span><span class="grow"><span class="t">${esc(it.name)}</span><br><span class="s"><span class="chip" style="background:${col}">${esc(it.kind)}</span> ${it.via ? "the road passes through here" : km(lineLen(it.coords)) + " km"}${it.surface ? " · " + esc(it.surface) : ""}</span></span>`;
    li.querySelector(".grow").onclick = () => { it.via ? map.setView(it.coords[0], 15) : map.fitBounds(L.latLngBounds(it.coords).pad(0.3), { maxZoom: 15 }); if (phone()) setSheet("peek"); };
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", "Take out " + it.name);
    x.onclick = () => removeItem(i);
    li.append(x); ul.append(li);
  });
  renderStops();
}
$("#routeName").oninput = e => { trip.name = e.target.value || "My route"; saveTrip(); };
$("#dropUcr").onclick = () => {
  trip.items = trip.items.filter(it => it.via || !(it.cls === "ucr" || it.cls === "tro"));
  built = null; saveTrip();
  if (!trip.items.length) { showView("plan", "peek"); return; }
  renderRoute(); drawRoute(); build();
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
function clearRoute(){ trip = newTrip(); built = null; editingDay = null; lastKind = null; saveTrip(); routeStopIdx = new Set(); routeStops = []; showView("plan", "peek"); }
$("#newBtn").onclick = () => { $("#newConfirm").hidden = !$("#newConfirm").hidden; if (!$("#newConfirm").hidden) $("#newClear").focus(); };
$("#newCancel").onclick = () => { $("#newConfirm").hidden = true; $("#newBtn").focus(); };
$("#newClear").onclick = clearRoute;
$("#newSaveFirst").onclick = () => { saveItem({ name: trip.name, trip, summary: built ? `${km(built.total)} km, ${hm(built.hours)}` : "" }); clearRoute(); };
document.querySelectorAll("#routeTabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#routeTabs button").forEach(x => x.setAttribute("aria-selected", x === b));
  $("#rtLanes").hidden = b.dataset.rt !== "lanes"; $("#rtStops").hidden = b.dataset.rt !== "stops";
  if (b.dataset.rt === "stops" && !stops) loadStops().then(findRouteStops); else renderStops();
});
$("#editingSave").onclick = () => {
  if (editingDay == null || !tour) return;
  const d = tour.days[editingDay]; d.trip = clone(trip); d.built = built; d.stops = routeStops;
  saveTour(); editingDay = null; trip = newTrip(); built = null; saveTrip();
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
  if (!stops) { await loadStops(); if (!stops) return; }
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
  drawGrouped(routeStopLayer, idxs, m => m.reduce((a, b) => (off.get(a) <= off.get(b) ? a : b)));
}
function renderStops(){
  if (!built || !stops) { $("#stopList").innerHTML = `<li class="muted">${built ? "Loading stops…" : "Stops appear once the route is ready."}</li>`; $("#fuelNote").textContent = ""; $("#stopChips").innerHTML = ""; return; }
  $("#stopChips").innerHTML = `<span class="small muted">Showing the kinds turned on under the search box.</span>`;
  $("#fuelNote").textContent = built.fuelCount === 0 ? "No fuel within 2 km of this route. Fill up before you set off."
    : `Longest stretch without fuel: ${km(built.fuelGap)} km.` + (built.fuelGap > 150000 ? " That's a long way on a small tank." : "");
  const ul = $("#stopList"); ul.innerHTML = "";
  const list = routeStops.filter(r => groupOn(stops[r.i].code));
  if (!list.length) ul.innerHTML = `<li class="muted">Nothing of the kinds you've turned on near the route.</li>`;
  for (const r of list) {
    const s = stops[r.i];
    const li = document.createElement("li");
    li.innerHTML = `${poiBadge(s.code)}<span class="grow"><span class="t">${esc(stopName(s))}</span><br><span class="s">${esc(CODE[s.code].one)} · ${km(r.along)} km in · ${Math.round(r.off / 10) * 10} m off route</span></span>`;
    li.querySelector(".grow").onclick = () => { map.setView([s.lat, s.lng], 15); if (phone()) setSheet("peek"); };
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
    p.trip.items.forEach((it, i) => w.push(it.via ? `<wpt lat="${f(it.coords[0][0])}" lon="${f(it.coords[0][1])}"><name>${x(`${p.prefix}Via ${i + 1}`)}</name><sym>Waypoint</sym></wpt>`
      : `<wpt lat="${f(it.coords[0][0])}" lon="${f(it.coords[0][1])}"><name>${x(`${p.prefix}L${i + 1} ${it.name}`.slice(0, 40))}</name><desc>${x(`${it.kind}, ${km(lineLen(it.coords))} km. Check for closures before riding.`)}</desc><sym>Flag, Green</sym></wpt>`));
    if (stops) for (const r of p.stops || []) { const s = stops[r.i]; if (groupOn(s.code)) w.push(`<wpt lat="${f(s.lat)}" lon="${f(s.lng)}"><name>${x((CODE[s.code].one + ": " + (s.name || "")).replace(/: $/, "").slice(0, 40))}</name><desc>${x(`${p.prefix}${km(r.along)} km in${s.extra ? ", " + s.extra : ""}`)}</desc><sym>${CODE[s.code].sym}</sym></wpt>`); }
    if (p.nightAt) w.push(`<wpt lat="${f(p.nightAt[0])}" lon="${f(p.nightAt[1])}"><name>${x(p.nightName.slice(0, 40))}</name><sym>Lodging</sym></wpt>`);
    let pts = []; for (const s of p.built.segs) for (const q of s.coords) { const l = pts.at(-1); if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q); }
    pts = simplifyTrack(pts, budget);
    trks.push(`<trk><name>${x(p.name)}</name><trkseg>\n${pts.map(q => `<trkpt lat="${f(q[0])}" lon="${f(q[1])}"/>`).join("\n")}\n</trkseg></trk>`);
  });
  const last = parts.at(-1).trip;
  if (last.finish) w.push(`<wpt lat="${f(last.finish[0])}" lon="${f(last.finish[1])}"><name>Finish</name><sym>Flag, Red</sym></wpt>`);
  const tot = parts.reduce((a, p) => a + p.built.total, 0), off = parts.reduce((a, p) => a + p.built.off, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Green Lanes Planner" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${x(title)}</name><desc>${x(`${km(tot)} km, ${km(off)} km on lanes. Check every lane for closures before riding.`)}</desc><time>${new Date().toISOString()}</time></metadata>
${w.join("\n")}
${trks.join("\n")}
</gpx>
`;
}
function download(name, text){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/gpx+xml" }));
  a.download = (name.replace(/[^\w\- ]+/g, "").trim() || "route").replace(/\s+/g, "-") + ".gpx";
  document.body.append(a); a.click(); a.remove(); status(`Saved ${a.download}`);
  return text;
}
$("#gpxBtn").onclick = () => built && download(trip.name, gpxText(trip.name, [{ name: trip.name, trip, built, stops: routeStops, prefix: "" }]));

/* ---------- saved routes and tours ---------- */
function renderSaved(){
  const saved = store.get("saved", []);
  $("#savedBlock").hidden = !saved.length;
  const ul = $("#savedList"); ul.innerHTML = "";
  saved.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="grow"><span class="t">${s.tour ? "⛺ " : ""}${esc(s.name)}</span><br><span class="s">${esc(s.summary || "")} · saved ${new Date(s.when).toLocaleDateString("en-GB")}</span></span>`;
    li.querySelector(".grow").onclick = () => {
      if (s.tour) { tour = clone(s.tour); saveTour(); openTour(); return; }
      trip = clone(s.trip); built = null; editingDay = null; saveTrip(); showView("route", "mid"); renderRoute();
      map.fitBounds(L.latLngBounds(trip.items.flatMap(it => it.coords)).pad(0.1)); build();
    };
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", "Delete " + s.name);
    x.onclick = () => { const all = store.get("saved", []); all.splice(i, 1); store.set("saved", all); renderSaved(); };
    li.append(x); ul.append(li);
  });
}
function saveItem(entry){ const all = store.get("saved", []).filter(s => s.name !== entry.name); all.unshift({ ...entry, when: Date.now() }); store.set("saved", all.slice(0, 30)); status(`Saved “${entry.name}”`); }
$("#saveBtn").onclick = () => saveItem({ name: trip.name, trip, summary: built ? `${km(built.total)} km, ${hm(built.hours)}` : "" });

/* ---------- multi-day tours ----------
   1. Find a way from start to finish through lane country: a shortest path over the 10 km lane squares,
      where squares with more lane cost less to cross. The off-road slider sets how far it will bend.
   2. Split that line into days of roughly equal length, and at each split find a place to stay:
      somewhere with a choice of hotels, B&Bs, hostels or campsites close to the line.
   3. Plan each day like a drawn route, fitted to the hours per day, then route its roads. */
let tour = store.get("tour", null), tourPick = -1, tourRun = 0;
const tourLayer = L.layerGroup().addTo(map);
const saveTour = () => store.set("tour", tour);
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
  showView("tour", tour ? "mid" : "open");
  placeSettings("tour");
  $("#tourSetup").hidden = !!tour; $("#tourResult").hidden = !tour;
  if (tour) { renderTour(); if (tour.days.length) map.fitBounds(L.latLngBounds(tour.days.flatMap(d => d.trip.items.flatMap(it => it.coords)).concat([tour.start, tour.end])).pad(0.05)); }
  else renderTourSetup();
}
$("#goTour").onclick = () => { if (tour?.days?.length && !featNames().has(tour.name)) saveItem({ name: tour.name || "My tour", tour, summary: `${tour.days.length} days` }); tour = null; tourPick = -1; openTour(); };
$("#tourBack").onclick = () => { tourRun++; tourLayer.clearLayers(); showView(trip.items.length ? "route" : "plan", "peek"); };
function renderTourSetup(){
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
    const found = await searchPlace(input.value.trim());
    if (!found) { status(`Couldn't find “${input.value}”`); return; }
    const typed = input.value.trim(); found.name = typed.charAt(0).toUpperCase() + typed.slice(1);
    tourPlaces[which] = found; renderTourSetup(); map.setView(found.p, 10);
  };
  input.onchange = () => input.onkeydown({ key: "Enter", preventDefault(){} });
  $(which === "start" ? "#tStartMap" : "#tEndMap").onclick = () => pickSpot(`Tap the map where the tour ${which === "start" ? "starts" : "finishes"}`, async p => {
    tourPlaces[which] = { p, name: "Map point" }; openTour(); renderTourSetup();
    const n = await placeName(p); if (n) { tourPlaces[which].name = n; renderTourSetup(); }
  });
}
$("#tRound").onchange = e => { $("#tEnd").placeholder = e.target.checked ? "Furthest point, town or postcode" : "Town or postcode"; };
$("#dhMinus").onclick = () => { settings.dayHours = Math.max(2, settings.dayHours - 0.5); saveSettings(); syncSettings(); };
$("#dhPlus").onclick = () => { settings.dayHours = Math.min(10, settings.dayHours + 0.5); saveSettings(); syncSettings(); };
$("#dMinus").onclick = () => { settings.days = settings.days ? (settings.days > 1 ? settings.days - 1 : null) : null; saveSettings(); syncSettings(); };
$("#dPlus").onclick = () => { settings.days = Math.min(14, (settings.days || 1) + 1); saveSettings(); syncSettings(); };
$("#tourGo").onclick = () => planTour();
async function planTour(){
  if (!tourPlaces.start || !tourPlaces.end) { status("Set a start and a finish first"); return; }
  const run = ++tourRun, alive = () => run === tourRun && !$("#busy").hidden;
  busy.show("Planning your tour", () => { tourRun++; });
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
  const from = i === 0 ? tourPlaces.start?.name?.split(",")[0] || "Start" : tour.nights[i - 1].town || `night ${i}`;
  const to = i === tour.days.length - 1 ? (tour.round ? from && (tourPlaces.start?.name?.split(",")[0] || "Start") : tourPlaces.end?.name?.split(",")[0] || "Finish") : tour.nights[i].town || `night ${i + 1}`;
  return `Day ${i + 1}: ${from} to ${to}`;
}
function renderTour(){
  if (!tour) return;
  $("#tourName").value = tour.name;
  const tot = tour.days.reduce((a, d) => a + (d.built?.total || 0), 0), off = tour.days.reduce((a, d) => a + (d.built?.off || 0), 0), hrs = tour.days.reduce((a, d) => a + (d.built?.hours || 0), 0);
  $("#tsDays").textContent = tour.days.length; $("#tsKm").textContent = km(tot); $("#tsLane").textContent = tot ? Math.round(100 * off / tot) + "%" : "–"; $("#tsHours").textContent = hm(hrs);
  const box = $("#dayList"); box.innerHTML = "";
  tour.days.forEach((d, i) => {
    const b = d.built, card = document.createElement("div");
    card.className = "day"; card.setAttribute("aria-pressed", tourPick === i); card.tabIndex = 0; card.setAttribute("role", "button");
    const warn = routeWarnings(b, d.trip);
    card.innerHTML = `<div class="top"><h3>${esc(d.trip.name || dayName(i))}</h3></div>
      <div class="stats"><span><b>${b ? hm(b.hours) : "–"}</b> riding</span><span><b>${b ? km(b.total) : "–"}</b> km</span><span><b>${b && b.total ? Math.round(100 * b.off / b.total) : 0}%</b> lanes</span><span><b>${d.trip.items.length}</b> lanes</span>${b?.fuelGap ? `<span>fuel gap <b>${km(b.fuelGap)}</b> km</span>` : ""}</div>
      ${b && b.hours > tour.dayHours * 1.3 ? `<div class="small" style="color:#b45309">Longer than your ${tour.dayHours} h a day.</div>` : ""}
      ${warn.length ? `<div class="small muted">${esc(warn[0])}</div>` : ""}
      <div class="acts"></div>`;
    const acts = card.querySelector(".acts");
    const mk = (label, fn) => { const x = document.createElement("button"); x.className = "btn quiet"; x.textContent = label; x.onclick = ev => { ev.stopPropagation(); fn(); }; acts.append(x); };
    mk("Edit lanes", () => { editingDay = i; trip = clone(d.trip); built = d.built; saveTrip(); showView("route", "mid"); renderRoute(); findRouteStops(); map.fitBounds(L.latLngBounds(trip.items.flatMap(it => it.coords).concat([trip.start, trip.finish])).pad(0.05)); });
    mk("GPX for this day", () => download(`${tour.name} day ${i + 1}`, gpxText(d.trip.name, [{ name: d.trip.name, trip: d.trip, built: d.built, stops: d.stops, prefix: "", nightAt: tour.nights[i]?.at, nightName: nightLabel(i) }])));
    const pick = () => { tourPick = tourPick === i ? -1 : i; renderTour(); if (tourPick >= 0) map.fitBounds(L.latLngBounds(d.built ? d.built.segs.flatMap(s => s.coords) : [d.trip.start, d.trip.finish]).pad(0.05), { paddingBottomRight: phone() ? [0, innerHeight * .45] : [0, 0] }); };
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
  row.innerHTML = `${poiBadge(s ? s.code : "hotel")}<div class="grow"><b>Night ${i + 1}${n.town ? ": " + esc(n.town) : ""}</b><br><span class="small muted">${s ? esc(stopName(s)) + " · " + esc(CODE[s.code].one) : "No places to stay found near here. Try allowing campsites or changing the days."}</span><div class="opts" hidden></div></div>`;
  const btn = document.createElement("button"); btn.className = "btn quiet"; btn.textContent = "Change";
  const opts = row.querySelector(".opts");
  btn.onclick = () => {
    opts.hidden = !opts.hidden; opts.innerHTML = "";
    const list = stayOptions(n.want, 15000).map(o => o.i).filter(k => k !== n.stay);
    if (!list.length) opts.innerHTML = `<span class="small muted">No other places to stay within 15 km.</span>`;
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
  n.stay = k; n.at = [s.lat, s.lng];
  const run = ++tourRun, alive = () => run === tourRun && !$("#busy").hidden;
  busy.show("Re-planning the two days either side", () => { tourRun++; });
  n.town = (await placeName(n.at)) || n.town;
  const wr = mixToWr(settings.mix);
  for (const d of [i, i + 1]) {
    busy.set(`Planning day ${d + 1}…`, d === i ? 0.1 : 0.4);
    const day = tour.days[d], a = d === 0 ? tour.start : tour.nights[d - 1].at, b = d === tour.days.length - 1 ? tour.end : tour.nights[d].at;
    const ia = nearestIdx(tour.line, a), ib = nearestIdx(tour.line, b);
    const sk = [a, ...tour.line.slice(Math.min(ia, ib) + 1, Math.max(ia, ib)), b];
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
  tour.nights.forEach((n, i) => L.marker(n.at, { icon: L.divIcon({ className: "", html: `<span class="flag" style="background:#6d28d9">Night ${i + 1}</span>`, iconSize: [0, 0] }) }).bindPopup(() => { const s = n.stay != null ? stops?.[n.stay] : null; return s ? stopPopup(s) : `<h3>Night ${i + 1}</h3>`; }).addTo(tourLayer));
  drawRouteStops();
}
$("#tourName").oninput = e => { tour.name = e.target.value || "My tour"; saveTour(); };
$("#tourGpx").onclick = () => tour && download(tour.name, gpxText(tour.name, tour.days.map((d, i) => ({ name: d.trip.name || dayName(i), trip: d.trip, built: d.built, stops: d.stops, prefix: `D${i + 1} `, nightAt: tour.nights[i]?.at, nightName: tour.nights[i] ? nightLabel(i) : "" }))));
$("#tourSave").onclick = () => tour && saveItem({ name: tour.name, tour, summary: `${tour.days.length} days, ${km(tour.days.reduce((a, d) => a + (d.built?.total || 0), 0))} km` });
$("#tourNew").onclick = () => armed($("#tourNew"), "✕ New", () => { tour = null; saveTour(); tourPick = -1; openTour(); });
$("#tourReplan").onclick = () => { if (!tour) return; tourPlaces.start = tourPlaces.start || { p: tour.start, name: tour.name.split(" to ")[0] }; tourPlaces.end = tourPlaces.end || { p: tour.round ? tour.line[Math.floor(tour.line.length / 2)] : tour.end, name: tour.name.split(" to ")[1] || "Finish" }; $("#tRound").checked = tour.round; tour = null; openTour(); };

/* ---------- Explore: riding areas, ready-made rides and tours ---------- */
const REGION_LIST = window.REGIONS || [];
const feat = () => window.FEATURED || null;
const regionBySlug = slug => REGION_LIST.find(r => r.slug === slug);
const featuredIn = slug => (feat()?.rides || []).filter(r => r.region === slug);
const posterHtml = (r, lazy = true) => `<img src="img/regions/${r.slug}.jpg" alt="Poster of ${esc(r.name)}" loading="${lazy ? "lazy" : "eager"}" onerror="this.remove()">`;
const laneKmCache = new Map();
function regionLaneKm(r){   // lane km within 25 km of the area's centre
  if (laneKmCache.has(r.slug)) return laneKmCache.get(r.slug);
  const c = r.centre, bb = [c[0] - 0.25, c[1] - 0.4, c[0] + 0.25, c[1] + 0.4], seen = new Set(); let m = 0;
  for (const k of cells(bb)) for (const id of grid.get(k) || []) {
    if (seen.has(id)) continue; seen.add(id);
    const w = osmWays.get(id); if (!CLASSES[w.cls].ride) continue;
    if (hav(c, w.coords[Math.floor(w.coords.length / 2)]) < 25000) m += w.len;
  }
  laneKmCache.set(r.slug, m); return m;
}
function renderExplore(){
  const box = $("#regionCards"); box.innerHTML = "";
  for (const r of REGION_LIST) {
    const n = featuredIn(r.slug).length;
    const b = document.createElement("button"); b.className = "rcard"; b.setAttribute("role", "listitem");
    b.innerHTML = `<div class="poster">${posterHtml(r)}</div><div class="cap"><b>${esc(r.name)}</b><span>${n ? `${n} ride${n > 1 ? "s" : ""} · ` : ""}${Math.round(regionLaneKm(r) / 1000)} km of lanes</span></div>`;
    b.onclick = () => openRegion(r.slug);
    box.append(b);
  }
  const tb = $("#tourCards"); tb.innerHTML = "";
  const feats = feat()?.tours || [];
  if (feats.length) for (const t of feats) {
    const tot = t.tour.days.reduce((a, d) => a + (d.built?.total || 0), 0), off = t.tour.days.reduce((a, d) => a + (d.built?.off || 0), 0);
    const c = document.createElement("div"); c.className = "card tcard";
    c.innerHTML = `<div><h3>${esc(t.name)}</h3><div class="stats"><span><b>${t.tour.days.length}</b> days</span><span><b>${km(tot)}</b> km</span><span><b>${tot ? Math.round(100 * off / tot) : 0}%</b> lanes</span></div></div>`;
    const go = document.createElement("button"); go.className = "btn primary"; go.textContent = "Open"; go.setAttribute("aria-label", "Open " + t.name);
    go.onclick = e => { e.stopPropagation(); loadFeaturedTour(t); };
    c.onclick = () => loadFeaturedTour(t);
    c.append(go); tb.append(c);
  } else for (const p of window.TOUR_PRESETS || []) {
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
  regionPinLayer.clearLayers();
  for (const r of REGION_LIST) L.marker(r.centre, { keyboard: true, title: r.name, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="rpin"><span class="dot">${posterHtml(r)}</span><b>${esc(r.name)}</b></div>` }) })
    .on("click", () => openRegion(r.slug)).addTo(regionPinLayer);
}
function openRegion(slug){
  const r = regionBySlug(slug); if (!r) return;
  showView("region", "open");
  $("#regionPoster").innerHTML = posterHtml(r, false);   // lazy loading missed it as the panel opened
  $("#regionName").textContent = r.name + (r.sub ? " " + r.sub : "");
  $("#regionLine").textContent = r.line;
  const rides = featuredIn(slug);
  $("#regionStats").innerHTML = `<div><b>${Math.round(regionLaneKm(r) / 1000)}</b><span>km of lanes</span></div><div><b>${rides.length}</b><span>rides</span></div><div><b>${esc(r.starts[0].name)}</b><span>start</span></div>`;
  const box = $("#regionRides"); box.innerHTML = rides.length ? "" : `<p class="small muted">No ready-made rides here yet. Plan your own below.</p>`;
  regionRideLayer.clearLayers();
  for (const rd of rides) {
    drawBuilt(regionRideLayer, rd.trip, rd.built, false, false);
    const b = rd.built, pct = b.total ? Math.round(100 * b.off / b.total) : 0;
    const c = document.createElement("div"); c.className = "card";
    c.innerHTML = `<div class="top"><h3>${esc(rd.name)}</h3></div>
      <div class="stats"><span><b>${hm(b.hours)}</b> riding</span><span><b>${km(b.total)}</b> km</span><span><b>${pct}%</b> lanes</span></div>
      <div>${rd.byways ? `<span class="chip" style="background:var(--boat)">Byways only</span>` : `<span class="chip" style="background:var(--ucr)">Includes unclassified roads</span>`} <span class="small muted">from ${esc(rd.startName)}</span></div>`;
    const go = document.createElement("button"); go.className = "btn primary"; go.textContent = "Ride this"; go.setAttribute("aria-label", "Ride " + rd.name);
    go.onclick = () => loadFeaturedRide(rd);
    c.querySelector(".top").append(go);
    c.onclick = e => { if (e.target !== go) map.fitBounds(L.latLngBounds(rd.built.segs.flatMap(sg => sg.coords)).pad(0.05), { paddingBottomRight: phone() ? [0, innerHeight * 0.45] : [0, 0] }); };
    box.append(c);
  }
  map.flyTo(r.centre, r.zoom, { duration: 0.8 });
  $("#regionLoop").onclick = () => { loopStart = r.starts[0].at; lastKind = "loop"; ideas = []; picked = -1; ideaRun++; openIdeas(); runIdeas(); };
  $("#regionDraw").onclick = () => { map.setView(r.centre, r.zoom); lastKind = "draw"; strokes = []; shapeChoice = null; ideas = []; picked = -1; ideaRun++; openIdeas(); startDrawing(); };
}
$("#regionBack").onclick = () => { showView("plan", "peek"); map.flyTo([52.6, -2.3], 7, { duration: 0.8 }); };
// Opening a ready-made ride or tour replaces the current one, so anything the rider planned goes to Saved first.
const featNames = () => new Set([...(feat()?.rides || []).map(r => r.name), ...(feat()?.tours || []).map(t => t.name)]);
function keepCurrent(){
  if (trip.items.length && !featNames().has(trip.name)) saveItem({ name: trip.name, trip, summary: built ? `${km(built.total)} km, ${hm(built.hours)}` : "" });
}
function loadFeaturedRide(rd){
  keepCurrent();
  trip = clone(rd.trip); built = clone(rd.built); editingDay = null; lastKind = null; ideas = [];
  saveTrip(); showView("route", "mid"); renderRoute();
  map.fitBounds(L.latLngBounds(built.segs.flatMap(sg => sg.coords)).pad(0.05), { paddingBottomRight: phone() ? [0, innerHeight * 0.45] : [0, 0] });
  findRouteStops();
}
function loadFeaturedTour(t){
  if (tour?.days?.length && !featNames().has(tour.name)) saveItem({ name: tour.name || "My tour", tour, summary: `${tour.days.length} days` });
  tour = clone(t.tour); tourPick = -1; saveTour(); openTour(); }

/* ---------- search ---------- */
$("#searchForm").onsubmit = async e => {
  e.preventDefault(); const q = $("#q").value.trim(); if (!q) return;
  $("#q").blur(); status("Searching…", 0);
  const r = await polite("nominatim", `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=gb&q=${encodeURIComponent(q)}`);
  status("");
  let d = []; try { d = JSON.parse(r.text); } catch {}
  if (!r.ok || !d.length) { status(r.ok ? `Couldn't find “${q}”` : "Place search isn't answering. Try again in a minute."); return; }
  const go = p => { map.setView([+p.lat, +p.lon], 12); $("#results").hidden = true; };
  if (d.length === 1) return go(d[0]);
  const box = $("#results"); box.innerHTML = ""; box.hidden = false;
  for (const p of d) { const b = document.createElement("button"); b.textContent = p.display_name.split(",").slice(0, 3).join(","); b.onclick = () => go(p); box.append(b); }
};

/* ---------- pop-overs, toggles, boot ---------- */
function togglePop(id){ for (const p of ["layersPop", "helpPop"]) $("#" + p).hidden = p !== id || !$("#" + p).hidden; }
$("#btnLayers").onclick = () => togglePop("layersPop");
$("#btnHelp").onclick = () => togglePop("helpPop");
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => $("#" + b.dataset.close).hidden = true);
map.on("movestart", () => { $("#results").hidden = true; });
map.on("click", () => { if (!picking) { $("#layersPop").hidden = true; $("#helpPop").hidden = true; } });
// On a phone, a popup must not open underneath the bottom sheet: drop the sheet and move the map to clear it.
map.on("popupopen", e => {
  if (!phone()) return;
  if (sheet.dataset.state !== "peek") setSheet("peek");
  setTimeout(() => {
    const peek = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sheet-peek")) || 180;
    map.panInside(e.popup.getLatLng(), { paddingTopLeft: [20, 300], paddingBottomRight: [20, peek + 30] });
  }, 300);
});
const toggles = store.get("toggles", {});
for (const id of ["tLanes", "tUcr", "tZones", "tClosed", "tNotes"]) {
  if (id in toggles) $("#" + id).checked = toggles[id];
  $("#" + id).onchange = e => {
    toggles[id] = e.target.checked; store.set("toggles", toggles);
    if (id === "tNotes") showNotes(e.target.checked); else { drawLanes(); drawZones(); }
  };
}
document.addEventListener("keydown", e => { if (e.key === "Escape") { stopModes(); $("#layersPop").hidden = true; $("#helpPop").hidden = true; } });
let moveTimer;
map.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { drawLanes(); drawZones(); drawStops(); drawRouteStops(); }, 120); });

// boot: carry on where you left off
if (tour && store.get("lastView", "") === "tour") openTour();
else if (trip.items.length) {
  showView("route", "peek"); renderRoute();
  map.fitBounds(L.latLngBounds(trip.items.flatMap(it => it.coords).concat(trip.start ? [trip.start] : [])).pad(0.1));
  if (!built || built.twisty !== settings.twisty) build(); else findRouteStops();
} else showView("plan", "peek");
addEventListener("pagehide", () => store.set("lastView", view));

/* ---------- start screen: shown once per visit ---------- */
function showWelcome(){
  const pick = REGION_LIST[Math.floor(Math.random() * REGION_LIST.length)];
  $("#wlHero").innerHTML = pick ? posterHtml(pick, false) : "";
  const g = $("#wlGrid"); g.innerHTML = "";
  for (const r of REGION_LIST) {
    const n = featuredIn(r.slug).length, b = document.createElement("button");
    b.className = "rcard"; b.setAttribute("role", "listitem");
    b.innerHTML = `<div class="poster">${posterHtml(r)}</div><div class="cap"><b>${esc(r.name)}</b><span>${n ? `${n} ride${n > 1 ? "s" : ""}` : "Plan your own"}</span></div>`;
    b.onclick = () => { closeWelcome(); openRegion(r.slug); };
    g.append(b);
  }
  const carry = view === "tour" && tour ? tour.name || "your tour" : view === "route" && trip.items.length ? trip.name || "your route" : null;
  $("#wlCarry").hidden = !carry; $("#wlMap").hidden = !!carry;
  if (carry) $("#wlCarry").textContent = "Carry on: " + carry;
  $("#welcome").hidden = false; $("#welcome").scrollTop = 0;
  (carry ? $("#wlCarry") : $("#wlMap")).focus();
}
function closeWelcome(){ $("#welcome").hidden = true; try { sessionStorage.setItem("glp:welcomed", "1"); } catch (e) {} map.invalidateSize(); }
$("#wlCarry").onclick = closeWelcome;
$("#wlMap").onclick = () => { closeWelcome(); showView("plan", phone() ? "min" : "peek"); map.setView([52.6, -2.3], 7); };
$("#wlLoop").onclick = () => { closeWelcome(); $("#goLoop").click(); };
$("#wlDraw").onclick = () => { closeWelcome(); $("#goDraw").click(); };
$("#wlTour").onclick = () => { closeWelcome(); $("#goTour").click(); };
$("#helpHome").onclick = () => { $("#helpPop").hidden = true; showWelcome(); };
let welcomed = false; try { welcomed = !!sessionStorage.getItem("glp:welcomed"); } catch (e) {}
if (!welcomed) showWelcome();
// The 2012 notes are kept out of the public copy (they're someone else's writing); hide the switch when absent.
fetch("data/qwerf-lanes.js", { method: "HEAD" }).then(r => { if (!r.ok) { $("#tNotes").closest("label").hidden = true; $("#tNotes").checked = false; } else if ($("#tNotes").checked) showNotes(true); }).catch(() => { $("#tNotes").closest("label").hidden = true; });
drawLanes(); drawZones(); drawStops();
