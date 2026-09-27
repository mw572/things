// Motorbike road routing in the browser, from the tiles made by build_road_graph.py.
// Costs follow the app's BRouter profile (data/moto.brf): length x costfactor(class, twisty), +1000 at gates,
// one-way streets and turn restrictions respected. A* with a straight-line heuristic that never overestimates.
// Works in a page or a Web Worker: const r = new LocalRouter(base); await r.route([lat, lon], [lat, lon], 0.6).
(function (root) {
  // fast and fun factors per class, from the profile, in the order of CLASSES in build_road_graph.py
  const FAST = [1.0, 1.0, 1.1, 1.1, 1.25, 1.25, 1.45, 1.45, 1.65, 1.65, 1.95, 2.3, 2.3, 3.0, 1.4, 5.0];
  const FUN = [25, 25, 9, 9, 3.5, 3.5, 1.15, 1.15, 1.0, 1.0, 1.1, 3.5, 3.5, 5.0, 1.4, 8.0];
  const TRACK = 14, CELL = 0.01;   // CELL: grid squares for finding the nearest road, 0.01 x 0.016 degrees (about 1.1 km)
  const cf = (cls, t) => cls === TRACK ? 1.4 : FAST[cls] * (1 - t) + FUN[cls] * t;
  const R = 6371000, rad = Math.PI / 180;
  const hav = (a, b) => { const dl = (b[1] - a[1]) * rad, p1 = a[0] * rad, p2 = b[0] * rad; return 2 * R * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2)); };

  class LocalRouter {
    constructor(base, fetcher) {
      this.base = base.replace(/\/?$/, "/"); this.fetcher = fetcher || (u => fetch(u));
      this.tiles = new Map(); this.node = new Map(); this.adj = new Map(); this.edge = new Map(); this.turns = new Map();
      this.stats = { tilesLoaded: 0, bytes: 0, loadMs: 0 };
    }
    async index() { if (!this.meta) this.meta = await (await this.fetcher(this.base + "index.json")).json(); return this.meta; }
    tileKey(lat, lon) { const [a, b] = this.meta.tile; return Math.floor(lat / a) + "_" + Math.floor(lon / b); }

    async loadTile(key) {
      if (this.tiles.has(key)) return this.tiles.get(key);
      if (!this.meta.tiles[key]) { this.tiles.set(key, null); return null; }
      const t0 = performance.now();
      // the build date in the URL keeps tiles from different road-data builds apart (junction numbers differ)
      const res = await this.fetcher(this.base + key + ".bin.gz?b=" + (this.meta.built || ""));
      if (!res.ok) throw new Error("tile " + key + " " + res.status);
      const gz = await res.arrayBuffer(); this.stats.bytes += gz.byteLength;
      const buf = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      const h = new Uint32Array(buf, 0, 5), [nN, nE, nT, nG] = h; let o = 20;
      const take = (T, n, bytes) => { const a = new T(buf, o, n); o += n * bytes; return a; };
      const nid = take(Uint32Array, nN, 4), nll = take(Int32Array, nN * 2, 4);
      const eid = take(Uint32Array, nE, 4), ea = take(Uint32Array, nE, 4), eb = take(Uint32Array, nE, 4), elen = take(Float32Array, nE, 4);
      const gs = take(Uint32Array, nE, 4); const gc = new Uint16Array(buf.slice(o, o + nE * 2)); o += nE * 2;
      const fl = new Uint8Array(buf, o, nE); o += nE; if (o % 4) o += 4 - o % 4;
      const geo = take(Int32Array, nG * 2, 4), tr = take(Uint32Array, nT * 4, 4);
      const S = this.meta.scale;
      for (let i = 0; i < nN; i++) this.node.set(nid[i], [nll[2 * i] / S, nll[2 * i + 1] / S]);
      const tile = { key, geo, nid, eid, via: [], used: performance.now() };
      for (let i = 0; i < nE; i++) {
        const f = fl[i], e = { a: ea[i], b: eb[i], len: elen[i], cls: f & 31, ow: ((f >> 5) & 3) - 1, gate: f >> 7, tile, g0: gs[i], gn: gc[i] };
        this.edge.set(eid[i], e);
        this.addAdj(e.a, eid[i]); this.addAdj(e.b, eid[i]);
      }
      for (let i = 0; i < nT; i++) {   // [only?, edge in, via node, edge out]
        const v = tr[4 * i + 2]; tile.via.push(v); if (!this.turns.has(v)) this.turns.set(v, []);
        this.turns.get(v).push([tr[4 * i], tr[4 * i + 1], tr[4 * i + 3]]);
      }
      // roads that cross into this tile can now be drawn out, so the neighbours file their roads by square again
      for (const t of this.tiles.values()) if (t) t.cells = null;
      this.snapped = null;
      this.tiles.set(key, tile); this.stats.tilesLoaded++; this.stats.loadMs += performance.now() - t0;
      return tile;
    }
    addAdj(n, e) { let l = this.adj.get(n); if (!l) this.adj.set(n, l = []); l.push(e); }
    // phones have little memory: drop the least recently used tiles beyond a cap, keeping the ones this query needs
    unload(keep, cap = 12) {
      const loaded = [...this.tiles.values()].filter(t => t && !keep.has(t.key)).sort((a, b) => a.used - b.used);
      const total = [...this.tiles.values()].filter(Boolean).length;
      for (const t of loaded.slice(0, Math.max(0, total - cap))) {
        for (const id of t.eid) this.edge.delete(id);
        for (const n of t.nid) { this.node.delete(n); this.adj.delete(n); }
        for (const v of t.via) this.turns.delete(v);
        this.tiles.delete(t.key); this.stats.unloaded = (this.stats.unloaded || 0) + 1;
      }
    }

    // load every tile touching the box around a and b, with a margin for detours
    async loadFor(a, b, marginKm = 12) {
      await this.index();
      const dLat = marginKm / 111, dLon = dLat / Math.cos(((a[0] + b[0]) / 2) * rad);
      const s = Math.min(a[0], b[0]) - dLat, n = Math.max(a[0], b[0]) + dLat, w = Math.min(a[1], b[1]) - dLon, e = Math.max(a[1], b[1]) + dLon;
      const [TL, TO] = this.meta.tile, keys = [];
      for (let i = Math.floor(s / TL); i <= Math.floor(n / TL); i++) for (let j = Math.floor(w / TO); j <= Math.floor(e / TO); j++) keys.push(i + "_" + j);
      await Promise.all(keys.map(k => this.loadTile(k)));
      const now = performance.now(); for (const k of keys) { const t = this.tiles.get(k); if (t) t.used = now; }
      this.unload(new Set(keys), Math.max(12, keys.length));
    }

    // the roads in a box, for drawing a plain map with no signal: flat arrays, so they can be handed to the page cheaply
    async linesIn(s, w, n, e, maxCls = 13) {
      await this.index();
      const [TL, TO] = this.meta.tile, keys = [];
      for (let i = Math.floor(s / TL); i <= Math.floor(n / TL); i++) for (let j = Math.floor(w / TO); j <= Math.floor(e / TO); j++) keys.push(i + "_" + j);
      await Promise.all(keys.map(k => this.loadTile(k).catch(() => null)));
      const now = performance.now(); for (const k of keys) { const t = this.tiles.get(k); if (t) t.used = now; }
      this.unload(new Set(keys), Math.max(12, keys.length));
      const pad = 0.03, cls = [], off = [0], xy = [];
      const inBox = p => p && p[0] > s - pad && p[0] < n + pad && p[1] > w - pad && p[1] < e + pad;
      for (const k of keys) {
        const t = this.tiles.get(k); if (!t) continue;
        for (const id of t.eid) {
          const ed = this.edge.get(id); if (!ed || ed.cls > maxCls) continue;
          if (!inBox(this.node.get(ed.a)) && !inBox(this.node.get(ed.b))) continue;
          for (const q of this.geom(id)) xy.push(q[0], q[1]);
          cls.push(ed.cls); off.push(xy.length / 2);
        }
      }
      return { cls: new Uint8Array(cls), off: new Uint32Array(off), xy: new Float32Array(xy) };
    }

    // an edge's points from its start junction to its end junction
    geom(id) {
      const e = this.edge.get(id), S = this.meta.scale, p0 = this.node.get(e.a), out = [p0];
      let la = p0[0], lo = p0[1];
      for (let i = 0; i < e.gn; i++) { la += e.tile.geo[2 * (e.g0 + i)] / S; lo += e.tile.geo[2 * (e.g0 + i) + 1] / S; out.push([la, lo]); }
      const p1 = this.node.get(e.b); if (p1) out.push(p1); return out;
    }

    // nearest point on the network: the edge, how far along it, and how far off
    // how many junctions can be reached from n (ignoring one-ways), stopping once it's clearly part of the network
    connected(n, enough = 300) {
      if (!this.conn) this.conn = new Map(); if (this.conn.has(n)) return this.conn.get(n);
      const seen = new Set([n]), q = [n];
      while (q.length && seen.size < enough) { const x = q.pop(); for (const id of this.adj.get(x) || []) { const e = this.edge.get(id); if (!e) continue; const m = e.a === x ? e.b : e.a; if (this.node.has(m) && !seen.has(m)) { seen.add(m); q.push(m); } } }
      const ok = seen.size >= enough; if (ok) for (const x of seen) this.conn.set(x, true); else this.conn.set(n, false); return ok;
    }
    snap(p) {   // remembered per point until the roads loaded change
      const k = p[0].toFixed(6) + "," + p[1].toFixed(6), c = this.snapped?.get(k);
      if (c !== undefined && (c === null || this.edge.has(c.id))) return c;
      const r = this.snapNew(p); (this.snapped ||= new Map()).set(k, r); return r;
    }
    snapNew(p) {
      // the nearest road that joins the wider network: a lane end can sit next to an isolated stub or a track that
      // only connects through a private road, and routing from there finds nothing. Look within about 3 km first, as
      // that's quick; failing a joined road within 300 m there, look wider. Some lane ends are deep in forest or moor,
      // so take the nearest joined one within 5 km (the distance goes back to the app, which shows it as a gap).
      for (const r of [0.03, 0.07]) {
        const cands = this.snapAll(p, r).sort((a, b) => a.d - b.d);
        for (const c of cands.slice(0, 200)) { const e = this.edge.get(c.id); if (this.connected(e.a) || this.connected(e.b)) { if (c.d < 300 || r > 0.03) return c; break; } }
      }
      return null;
    }
    cellsOf(t) {
      if (t.cells) return t.cells;
      const cells = t.cells = new Map();
      for (const id of t.eid) {
        if (!this.node.get(this.edge.get(id)?.a) || !this.node.get(this.edge.get(id).b)) continue;
        let s = 90, n = -90, w = 180, e = -180; for (const q of this.geom(id)) { s = Math.min(s, q[0]); n = Math.max(n, q[0]); w = Math.min(w, q[1]); e = Math.max(e, q[1]); }
        for (let i = Math.floor(s / CELL); i <= Math.floor(n / CELL); i++) for (let j = Math.floor(w / (CELL * 1.6)); j <= Math.floor(e / (CELL * 1.6)); j++) {
          const k = i + "_" + j; let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(id);
        }
      }
      return cells;
    }
    snapAll(p, r = 0.07) {
      const k = Math.cos(p[0] * rad) * 111320, out = [];
      // only the roads in the grid squares within r of the point (each tile files its roads by square when first
      // asked; a road that runs on into the next tile is filed by the tile it belongs to, so look in the tiles around)
      const ids = new Set(), rl = r * 1.7, [ti, tj] = this.tileKey(p[0], p[1]).split("_").map(Number), near = [];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const t = this.tiles.get((ti + di) + "_" + (tj + dj)); if (t) near.push(this.cellsOf(t)); }
      for (let i = Math.floor((p[0] - r) / CELL); i <= Math.floor((p[0] + r) / CELL); i++)
        for (let j = Math.floor((p[1] - rl) / (CELL * 1.6)); j <= Math.floor((p[1] + rl) / (CELL * 1.6)); j++)
          for (const cells of near) for (const id of cells.get(i + "_" + j) || []) ids.add(id);
      for (const id of ids) {
        const e = this.edge.get(id); if (!e || e.cls === 15 || !this.node.get(e.a) || !this.node.get(e.b)) continue;
        const g = this.geom(id); let along = 0, best = null;
        for (let i = 1; i < g.length; i++) {
          const ax = (g[i - 1][1] - p[1]) * k, ay = (g[i - 1][0] - p[0]) * 111320, bx = (g[i][1] - p[1]) * k, by = (g[i][0] - p[0]) * 111320;
          const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
          const d = Math.hypot(ax + t * dx, ay + t * dy), seg = Math.sqrt(L2);
          if (!best || d < best.d) best = { id, d, at: along + t * seg, pt: [g[i - 1][0] + (g[i][0] - g[i - 1][0]) * t, g[i - 1][1] + (g[i][1] - g[i - 1][1]) * t], i };
          along += seg;
        }
        if (best && best.d < 5000) { best.frac = along ? best.at / along : 0; out.push(best); }
      }
      return out;
    }

    allowedTurn(v, ein, eout) {
      const rules = this.turns.get(v); if (!rules || ein == null) return true;
      let only = null;
      for (const [isOnly, a, b] of rules) { if (a !== ein) continue; if (isOnly) (only ||= new Set()).add(b); else if (b === eout) return false; }
      return !only || only.has(eout);
    }

    // Road distance in metres from every point to every other, for putting the lanes of a route in a sensible order.
    // One search from each point, stopping once every other point is reached or the cost passes a limit.
    // Uses the same costs as route() (so it measures the roads route() would take) but ignores turn restrictions.
    // Unreachable pairs are null. Also returns how far each point is from its road (snap). rows: work out only the distances from these points (the rest of the rows are null).
    async matrix(pts, twisty = 0.6, rows = null, maxLen = 60000) {
      await this.index();
      const lat = pts.map(p => p[0]), lon = pts.map(p => p[1]);
      await this.loadFor([Math.min(...lat), Math.min(...lon)], [Math.max(...lat), Math.max(...lon)], 6);
      const sn = pts.map(p => this.snap(p)), N = pts.length, out = pts.map(() => new Array(N).fill(null));
      const maxCf = Math.max(...FAST.map((_, i) => cf(i, twisty)));
      for (const i of rows || pts.keys()) {
        const sa = sn[i]; if (!sa) continue;
        const g = new Map(), len = new Map(), heap = [], done = new Set();
        const push = (f, n) => { heap.push([f, n]); let k = heap.length - 1; while (k) { const q = (k - 1) >> 1; if (heap[q][0] <= heap[k][0]) break; [heap[q], heap[k]] = [heap[k], heap[q]]; k = q; } };
        const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
        const ea = this.edge.get(sa.id), ca = cf(ea.cls, twisty);
        const seed = (n, c, l) => { if (c < (g.get(n) ?? Infinity)) { g.set(n, c); len.set(n, l); push(c, n); } };
        if (ea.ow !== 1) seed(ea.a, sa.frac * ea.len * ca, sa.frac * ea.len);
        if (ea.ow !== -1) seed(ea.b, (1 - sa.frac) * ea.len * ca, (1 - sa.frac) * ea.len);
        // each target is reached through either end of its edge; best cost so far and its length
        const best = sn.map(() => [Infinity, null]);
        sn.forEach((sb, j) => { if (sb && sb.id === sa.id) best[j] = [Math.abs(sb.frac - sa.frac) * ea.len * ca, Math.abs(sb.frac - sa.frac) * ea.len]; });
        const byNode = new Map();
        sn.forEach((sb, j) => {
          if (!sb || j === i) return; const e = this.edge.get(sb.id), c = cf(e.cls, twisty);
          if (e.ow !== -1) (byNode.get(e.a) || byNode.set(e.a, []).get(e.a)).push([j, sb.frac * e.len * c, sb.frac * e.len]);
          if (e.ow !== 1) (byNode.get(e.b) || byNode.set(e.b, []).get(e.b)).push([j, (1 - sb.frac) * e.len * c, (1 - sb.frac) * e.len]);
        });
        sn.forEach((s, j) => { if (!s) best[j].fin = true; }); best[i].fin = true;
        let left = best.filter(b => !b.fin).length;
        while (heap.length && left > 0) {
          const [c, n] = pop(); if (c > g.get(n) + 1e-6 || done.has(n)) continue; done.add(n);
          if (c > maxLen * maxCf) break;
          for (const [j, dc, dl] of byNode.get(n) || []) if (c + dc < best[j][0]) best[j] = [c + dc, len.get(n) + dl];
          // a target is final once nothing cheaper can still reach it
          if (left < 8 || done.size % 64 === 0) for (let j = 0; j < N; j++) if (j !== i && !best[j].fin && best[j][0] <= c) { best[j].fin = true; left--; }
          for (const id of this.adj.get(n) || []) {
            const e = this.edge.get(id); if (!e) continue; const fwd = e.a === n, m = fwd ? e.b : e.a;
            if (!this.node.has(m) || (fwd && e.ow === -1) || (!fwd && e.ow === 1)) continue;
            const nc = c + e.len * cf(e.cls, twisty) + (e.gate ? 1000 : 0);
            if (nc < (g.get(m) ?? Infinity)) { g.set(m, nc); len.set(m, len.get(n) + e.len); push(nc, m); }
          }
        }
        for (let j = 0; j < N; j++) if (j !== i && best[j][1] != null) out[i][j] = best[j][1] + (sa.d || 0) + (sn[j]?.d || 0);
        out[i][i] = 0;
      }
      return { d: out, snap: sn.map(s => s ? Math.round(s.d) : null) };
    }

    async route(a, b, twisty = 0.6) {
      const t0 = performance.now();
      await this.loadFor(a, b);
      const tLoad = performance.now();
      const sa = this.snap(a), sb = this.snap(b);
      if (!sa || !sb) return null;
      const minCf = Math.min(...FAST.map((_, i) => cf(i, twisty)));
      const g = new Map(), from = new Map(), heap = [];
      const push = (f, n) => { heap.push([f, n]); let i = heap.length - 1; while (i) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      const bT = this.node.get(this.edge.get(sb.id).a); const hTo = n => hav(this.node.get(n), sb.pt) * minCf;
      // start: from the snapped point along its edge to either end, where the one-way allows
      const ea = this.edge.get(sa.id), ca = cf(ea.cls, twisty);
      if (ea.ow !== 1) { g.set(ea.a, sa.frac * ea.len * ca); from.set(ea.a, [null, sa.id, -1]); push(g.get(ea.a) + hTo(ea.a), ea.a); }
      if (ea.ow !== -1) { const c = (1 - sa.frac) * ea.len * ca; if (c < (g.get(ea.b) ?? Infinity)) { g.set(ea.b, c); from.set(ea.b, [null, sa.id, 1]); push(c + hTo(ea.b), ea.b); } }
      // finish: which ends of the target edge can reach the snapped point, and at what cost
      const eb = this.edge.get(sb.id), cb = cf(eb.cls, twisty), finish = new Map();
      if (eb.ow !== -1) finish.set(eb.a, sb.frac * eb.len * cb);
      if (eb.ow !== 1) finish.set(eb.b, (1 - sb.frac) * eb.len * cb);
      let best = Infinity, bestNode = null, settled = 0;
      if (sa.id === sb.id) { const d = Math.abs(sb.frac - sa.frac) * ea.len * ca; if ((sb.frac >= sa.frac ? ea.ow !== -1 : ea.ow !== 1)) { best = d; bestNode = "same"; } }
      while (heap.length) {
        const [f, n] = pop(); const gn = g.get(n);
        if (f - hTo(n) > gn + 1e-6) continue;
        if (f >= best) break;
        settled++;
        if (finish.has(n) && gn + finish.get(n) < best) { best = gn + finish.get(n); bestNode = n; }
        const inEdge = from.get(n)?.[1];
        for (const id of this.adj.get(n) || []) {
          if (id === inEdge && (this.adj.get(n).length > 1)) continue;   // no U-turn back along the same edge
          const e = this.edge.get(id); if (!e) continue; const fwd = e.a === n; const m = fwd ? e.b : e.a;
          if (!this.node.has(m)) continue;
          if ((fwd && e.ow === -1) || (!fwd && e.ow === 1)) continue;
          if (!this.allowedTurn(n, inEdge, id)) continue;
          const c = gn + e.len * cf(e.cls, twisty) + (e.gate ? 1000 : 0);
          if (c < (g.get(m) ?? Infinity)) { g.set(m, c); from.set(m, [n, id, fwd ? 1 : -1]); push(c + hTo(m), m); }
        }
      }
      if (bestNode == null) return null;
      // rebuild the line: snapped start, edges, snapped finish
      const pts = [], used = [];
      const part = (id, fromFrac, toFrac) => {   // the stretch of an edge between two fractions of its length
        const gm = this.geom(id), L = gm.reduce((s, q, i) => i ? s + hav(gm[i - 1], q) : 0, 0), out = [];
        const lo = Math.min(fromFrac, toFrac) * L, hi = Math.max(fromFrac, toFrac) * L; let d = 0;
        const at = x => { let s = 0; for (let i = 1; i < gm.length; i++) { const l = hav(gm[i - 1], gm[i]); if (s + l >= x) { const t = l ? (x - s) / l : 0; return [gm[i - 1][0] + (gm[i][0] - gm[i - 1][0]) * t, gm[i - 1][1] + (gm[i][1] - gm[i - 1][1]) * t]; } s += l; } return gm.at(-1); };
        out.push(at(lo)); for (let i = 1; i < gm.length - 1; i++) { d += hav(gm[i - 1], gm[i]); if (d > lo && d < hi) out.push(gm[i]); } out.push(at(hi));
        return toFrac < fromFrac ? out.reverse() : out;
      };
      if (bestNode === "same") pts.push(...part(sa.id, sa.frac, sb.frac));
      else {
        const chain = []; for (let n = bestNode; n != null;) { const [p, id, dir] = from.get(n); chain.push([id, dir, p]); n = p; }
        chain.reverse(); for (const [id] of chain) used.push(id);
        for (const [id, dir, p] of chain) {
          if (p == null) pts.push(...part(id, sa.frac, dir === 1 ? 1 : 0));
          else { const gm = this.geom(id); pts.push(...(dir === 1 ? gm : gm.slice().reverse()).slice(1)); }
        }
        pts.push(...part(sb.id, bestNode === eb.a ? 0 : 1, sb.frac).slice(1));
      }
      const len = pts.reduce((s, q, i) => i ? s + hav(pts[i - 1], q) : 0, 0);
      const ferry = used.some(id => this.edge.get(id)?.cls === 15);
      return { coords: pts, len, cost: best, edges: used, ferry, snapA: sa.d, snapB: sb.d, settled, loadMs: tLoad - t0, searchMs: performance.now() - tLoad };
    }
  }
  root.LocalRouter = LocalRouter;
})(typeof self !== "undefined" ? self : this);
