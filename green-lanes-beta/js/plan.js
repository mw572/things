// Route-finding for the Green Lanes Planner. Pure functions over the lane index built in app.js
// (osmWays, grid, cells) plus small geometry helpers. Tested 26 Sep 2026; see notes/green-lanes-sources.md.
"use strict";

function thin(pts, minGap){ const out = [pts[0]]; for (const p of pts) if (hav(out.at(-1), p) >= minGap) out.push(p); if (out.at(-1) !== pts.at(-1)) out.push(pts.at(-1)); return out; }
const isLoop = sk => hav(sk[0], sk.at(-1)) < Math.max(2000, lineLen(sk) * 0.08);

// Pick the chain of lanes that maximises lane distance minus a penalty for road detours, moving from A towards B.
function planAlong(sk, widthM, wr, useUcr, exclude){
  const lat0 = sk[0][0] * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110574;
  const P = p => [p[1] * kx, p[0] * ky];
  const S = sk.map(P), T = [0];
  for (let i = 1; i < S.length; i++) T.push(T[i-1] + Math.hypot(S[i][0]-S[i-1][0], S[i][1]-S[i-1][1]));
  const total = T.at(-1);
  function project(p){
    const [x, y] = P(p); let bd = Infinity, bt = 0;
    for (let i = 1; i < S.length; i++) {
      const [ax, ay] = S[i-1], [bx, by] = S[i], dx = bx-ax, dy = by-ay, L2 = dx*dx + dy*dy;
      const u = L2 ? Math.max(0, Math.min(1, ((x-ax)*dx + (y-ay)*dy) / L2)) : 0;
      const d = Math.hypot(x - ax - u*dx, y - ay - u*dy);
      if (d < bd) { bd = d; bt = T[i-1] + u * Math.sqrt(L2); }
    }
    return { d: bd, t: bt };
  }
  // candidate lanes from the grid cells under the sketch's bounding box
  const padLat = widthM / 110574, padLng = widthM / kx;
  let a = 90, b = 180, c = -90, d = -180;
  for (const [la, lo] of sk) { a = Math.min(a, la); b = Math.min(b, lo); c = Math.max(c, la); d = Math.max(d, lo); }
  const ids = new Set();
  for (const k of cells([a - padLat, b - padLng, c + padLat, d + padLng])) for (const id of grid.get(k) || []) ids.add(id);
  const nodes = [];
  for (const id of ids) {
    const w = osmWays.get(id);
    if (!(w.cls === "boat" || (useUcr && w.cls === "ucr"))) continue;
    if (exclude && exclude.has(id)) continue;
    const len = w.len ?? lineLen(w.coords); if (len < 120) continue;
    const pa = project(w.coords[0]), pb = project(w.coords.at(-1)), pm = project(w.coords[Math.floor(w.coords.length/2)]);
    if (Math.min(pa.d, pb.d, pm.d) > widthM) continue;
    const fwd = pa.t <= pb.t;
    const coords = fwd ? w.coords : w.coords.slice().reverse();
    nodes.push({ w, coords, a: coords[0], b: coords.at(-1), ta: Math.min(pa.t, pb.t), tb: Math.max(pa.t, pb.t), len });
  }
  nodes.sort((x, y) => x.ta - y.ta);
  const A = sk[0], B = sk.at(-1);
  const road = (p, q) => hav(p, q) * 1.3;                        // road distance estimate
  // A link costs the road it adds beyond the progress it makes along the sketch, plus a fixed-weight
  // penalty when it claims more progress than it rides, i.e. it skips a stretch of the line you drew.
  const cost = (p, q, tp, tq) => {
    const prog = Math.max(0, tq - tp), r = road(p, q);
    return Math.max(0, r - prog) + SKIP * Math.max(0, prog - 1.5 * r - 500) / wr;
  };
  const SKIP = 1.0;
  const BACK = 1500, MAXGAP = 25000, NEAR = widthM + 1500;
  // A road link has to stay near the line you drew: its midpoint (and quarter points on long links)
  // must be within the search width. Stops routes cutting across the middle of a loop.
  const mid = (p, q, f) => [p[0] + (q[0]-p[0]) * f, p[1] + (q[1]-p[1]) * f];
  const linkOk = (p, q) => {
    const g = hav(p, q); if (g < 1500) return true;
    const fs = g > 6000 ? [0.25, 0.5, 0.75] : [0.5];
    return fs.every(f => project(mid(p, q, f)).d <= NEAR);
  };
  const best = new Float64Array(nodes.length), prev = new Int32Array(nodes.length).fill(-1);
  for (let j = 0; j < nodes.length; j++) {
    const nj = nodes[j];
    nj.gain = nj.len - SKIP * Math.max(0, (nj.tb - nj.ta) - 1.5 * hav(nj.a, nj.b) - 500);  // lane that spans a big stretch of the sketch
    best[j] = linkOk(A, nj.a) ? nj.gain - wr * cost(A, nj.a, 0, nj.ta) : -Infinity;
    for (let i = j - 1; i >= 0; i--) {
      const ni = nodes[i];
      if (nj.ta - ni.ta > MAXGAP + 20000) break;               // sorted by ta, nothing earlier can link
      if (ni.tb - BACK > nj.ta) continue;                     // would ride backwards along the sketch
      const gap = hav(ni.b, nj.a); if (gap > MAXGAP) continue;
      const v = best[i] + nj.gain - wr * cost(ni.b, nj.a, ni.tb, nj.ta);
      if (v > best[j] && linkOk(ni.b, nj.a)) { best[j] = v; prev[j] = i; }
    }
  }
  let end = -1, endV = -Infinity;
  for (let j = 0; j < nodes.length; j++) {
    if (best[j] === -Infinity) continue;
    const v = best[j] - wr * cost(nodes[j].b, B, nodes[j].tb, total);
    if (v > endV && linkOk(nodes[j].b, B)) { endV = v; end = j; }
  }
  const chain = [];
  for (let j = end; j >= 0; j = prev[j]) chain.unshift(nodes[j]);
  // estimate road distance for the card
  let roadM = 0, p = A;
  for (const n of chain) { roadM += road(p, n.a); p = n.b; }
  roadM += road(p, B);
  return { chain, laneM: chain.reduce((t, n) => t + n.len, 0), roadM, candidates: nodes.length };
}

// A loop through the start point: a circle sized to the ride time, in one of 8 compass directions.
function loopSketch(start, bearingDeg, radiusM){
  const r = bearingDeg * Math.PI / 180, kx = 111320 * Math.cos(start[0] * Math.PI / 180), ky = 110574;
  const c = [start[0] + Math.cos(r) * radiusM / ky, start[1] + Math.sin(r) * radiusM / kx];
  const pts = [], a0 = r + Math.PI;
  for (let i = 0; i <= 36; i++) { const a = a0 + i * 2 * Math.PI / 36; pts.push([c[0] + Math.cos(a) * radiusM / ky, c[1] + Math.sin(a) * radiusM / kx]); }
  pts[0] = start; pts[pts.length - 1] = start;
  return pts;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

// Loops that go where the lanes are: find lane-dense 3 km cells around the start, try loops through
// pairs of them whose length suits the ride time, and keep the three with the most lane (in different directions).
function pickLoops(start, perim, radius, width, wr, useUcr){
  const kx = 111320 * Math.cos(start[0] * Math.PI / 180), ky = 110574, C = 3000;
  const reach = radius * 2.2, dens = new Map();
  const bb = [start[0] - reach/ky, start[1] - reach/kx, start[0] + reach/ky, start[1] + reach/kx];
  const seen = new Set();
  for (const k of cells(bb)) for (const id of grid.get(k) || []) {
    if (seen.has(id)) continue; seen.add(id);
    const w = osmWays.get(id);
    const wt = w.cls === "boat" ? 1 : (useUcr && w.cls === "ucr" ? 0.7 : 0); if (!wt) continue;
    const m = w.coords[Math.floor(w.coords.length / 2)];
    const x = Math.floor((m[1] - start[1]) * kx / C), y = Math.floor((m[0] - start[0]) * ky / C);
    const key = x + "," + y; dens.set(key, (dens.get(key) || 0) + wt * lineLen(w.coords));
  }
  // anchors: dense cells at a sensible distance, at least 5 km apart
  const cand = [...dens.entries()].map(([k, v]) => { const [x, y] = k.split(",").map(Number); const p = [start[0] + (y + .5) * C / ky, start[1] + (x + .5) * C / kx]; return { p, v, d: hav(start, p), brg: Math.atan2(x + .5, y + .5) }; })
    .filter(c => c.d > radius * 0.5 && c.d < radius * 2.0).sort((a, b) => b.v - a.v);
  const anchors = [];
  for (const c of cand) { if (anchors.length >= 14) break; if (anchors.every(a => hav(a.p, c.p) > 5000)) anchors.push(c); }
  const densify = pts => { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const n = Math.max(1, Math.round(hav(pts[i-1], pts[i]) / 1000)); for (let j = 1; j <= n; j++) out.push([pts[i-1][0] + (pts[i][0]-pts[i-1][0]) * j/n, pts[i-1][1] + (pts[i][1]-pts[i-1][1]) * j/n]); } return out; };
  const loops = [];
  for (let i = 0; i < anchors.length; i++) for (let j = 0; j < anchors.length; j++) {
    if (i === j) continue;
    const A = anchors[i], B = anchors[j];
    let dA = B.brg - A.brg; while (dA > Math.PI) dA -= 2*Math.PI; while (dA < -Math.PI) dA += 2*Math.PI;
    if (dA < 0.5 || dA > 2.4) continue;                     // go out one way, come back another (clockwise pairs only)
    const P = A.d + hav(A.p, B.p) + B.d;
    if (P < perim * 0.55 || P > perim * 1.25) continue;
    loops.push({ sk: densify([start, A.p, B.p, start]), brg: A.brg + dA / 2 });
  }
  for (let i = 0; i < 8; i++) loops.push({ sk: loopSketch(start, i * 45, radius), brg: i * Math.PI / 4 });   // plain circles as a fallback
  for (const l of loops) l.laneM = planAlong(l.sk, width, wr, useUcr).laneM;
  loops.sort((a, b) => b.laneM - a.laneM);
  const out = [];
  for (const l of loops) {
    if (out.length === 3) break;
    if (out.every(o => { let d = Math.abs(o.brg - l.brg) % (2*Math.PI); if (d > Math.PI) d = 2*Math.PI - d; return d > 0.9; })) out.push(l);
  }
  const deg = b => ((b * 180 / Math.PI) + 360) % 360;
  return out.map(l => ({ ...l, name: COMPASS[Math.round(deg(l.brg) / 45) % 8] }));
}

function parseFile(name, text){
  const lines = [], points = [];
  if (/\.(geo)?json$/i.test(name)) {
    const g = JSON.parse(text);
    const feats = g.type === "FeatureCollection" ? g.features : g.type === "Feature" ? [g] : [{ geometry: g, properties: {} }];
    for (const f of feats) {
      const geo = f.geometry; if (!geo) continue;
      const nm = f.properties?.name || name;
      const ll = cs => cs.map(([x, y]) => [y, x]);
      if (geo.type === "LineString") lines.push({ name: nm, coords: ll(geo.coordinates) });
      if (geo.type === "MultiLineString") geo.coordinates.forEach((c, i) => lines.push({ name: nm + " " + (i+1), coords: ll(c) }));
      if (geo.type === "Point") points.push({ name: nm, at: [geo.coordinates[1], geo.coordinates[0]] });
    }
  } else {
    const x = new DOMParser().parseFromString(text, "application/xml");
    const nameOf = el => el.querySelector(":scope > name")?.textContent?.trim();
    if (/\.gpx$/i.test(name)) {
      x.querySelectorAll("trk").forEach(trk => trk.querySelectorAll("trkseg").forEach((seg, i, all) => {
        const c = [...seg.querySelectorAll("trkpt")].map(p => [+p.getAttribute("lat"), +p.getAttribute("lon")]);
        if (c.length > 1) lines.push({ name: (nameOf(trk) || name) + (all.length > 1 ? " part " + (i+1) : ""), coords: c });
      }));
      x.querySelectorAll("rte").forEach(r => {
        const c = [...r.querySelectorAll("rtept")].map(p => [+p.getAttribute("lat"), +p.getAttribute("lon")]);
        if (c.length > 1) lines.push({ name: nameOf(r) || name, coords: c });
      });
      x.querySelectorAll("gpx > wpt").forEach(w => points.push({ name: nameOf(w) || "", at: [+w.getAttribute("lat"), +w.getAttribute("lon")] }));
    } else {
      x.querySelectorAll("Placemark").forEach(pm => {
        const nm = pm.querySelector("name")?.textContent?.trim() || name;
        pm.querySelectorAll("LineString > coordinates").forEach(c => lines.push({ name: nm, coords: c.textContent.trim().split(/\s+/).map(s => s.split(",").map(Number)).filter(a => a.length >= 2).map(([lo, la]) => [la, lo]) }));
        pm.querySelectorAll("Point > coordinates").forEach(c => { const [lo, la] = c.textContent.trim().split(",").map(Number); points.push({ name: nm, at: [la, lo] }); });
      });
    }
  }
  return { lines, points };
}

// Shortest path from a to b along legal lanes only (BOATs, and unclassified roads if allowed).
// Used to join two lanes that meet out on the hills, where there is no road between them.
// Ways share vertices where they meet; a lane end within 25 m of another lane is joined to it too,
// because simplifying the geometry can drop the exact junction vertex. Returns null if no path.
function laneGraphPath(a, b, useUcr, maxLen){
  const pad = Math.min(0.08, (maxLen / 111000) / 2 + 0.01);
  const bb = [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad * 1.6, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad * 1.6];
  const K = p => p[0].toFixed(5) + "," + p[1].toFixed(5);
  const nodes = new Map(), H = 0.0004, hash = new Map();
  const add = p => { const k = K(p); if (!nodes.has(k)) { nodes.set(k, { p, adj: [] }); const h = Math.floor(p[0] / H) + "," + Math.floor(p[1] / H); if (!hash.has(h)) hash.set(h, []); hash.get(h).push(k); } return k; };
  const link = (x, y, d) => { nodes.get(x).adj.push([y, d]); nodes.get(y).adj.push([x, d]); };
  const seen = new Set(), ends = [];
  for (const cell of cells(bb)) for (const id of grid.get(cell) || []) {
    if (seen.has(id)) continue; seen.add(id);
    const w = osmWays.get(id);
    if (!(w.cls === "boat" || (useUcr && (w.cls === "ucr" || w.cls === "tro")))) continue;
    if (w.bbox[2] < bb[0] || w.bbox[0] > bb[2] || w.bbox[3] < bb[1] || w.bbox[1] > bb[3]) continue;
    let prev = null;
    for (const p of w.coords) { const k = add(p); if (prev && prev !== k) link(prev, k, hav(nodes.get(prev).p, p)); prev = k; }
    ends.push(K(w.coords[0]), K(w.coords.at(-1)));
  }
  const near = (p, r) => {
    const out = [], i0 = Math.floor(p[0] / H), j0 = Math.floor(p[1] / H), n = Math.ceil(r / 40);
    for (let i = i0 - n; i <= i0 + n; i++) for (let j = j0 - n; j <= j0 + n; j++) for (const k of hash.get(i + "," + j) || []) { const d = hav(p, nodes.get(k).p); if (d <= r) out.push([k, d]); }
    return out;
  };
  for (const e of ends) { const nd = nodes.get(e); if (nd.adj.length > 1) continue; for (const [k, d] of near(nd.p, 25)) if (k !== e && !nd.adj.some(x => x[0] === k)) link(e, k, d); }
  const pick = p => near(p, 60).sort((x, y) => x[1] - y[1])[0];
  const s = pick(a), t = pick(b); if (!s || !t) return null;
  // Dijkstra with a small binary heap
  const dist = new Map([[s[0], 0]]), from = new Map(), heap = [[0, s[0]]];
  const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2*i+1, r = l+1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, k] = pop();
    if (d > (dist.get(k) ?? Infinity)) continue;
    if (k === t[0]) break;
    if (d > maxLen) return null;
    for (const [y, w] of nodes.get(k).adj) { const nd = d + w; if (nd < (dist.get(y) ?? Infinity)) { dist.set(y, nd); from.set(y, k); push([nd, y]); } }
  }
  if (!dist.has(t[0])) return null;
  const path = []; for (let k = t[0]; k; k = from.get(k)) path.push(nodes.get(k).p);
  path.reverse();
  return { coords: [a, ...path, b], len: dist.get(t[0]) + s[1] + t[1] };
}
