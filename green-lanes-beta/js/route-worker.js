// The phone's own router, off the main thread (js/localroute.js). One question at a time, answered in order.
importScripts("localroute.js");
// a weak signal must not hang a route: give up on a road tile after 20 s (the page then tries the routing servers)
const router = new LocalRouter("../data/roads/", u => { const c = new AbortController(), t = setTimeout(() => c.abort(), 20000); return fetch(u, { signal: c.signal }).finally(() => clearTimeout(t)); });
let queue = Promise.resolve();
onmessage = e => {
  const m = e.data;
  queue = queue.then(async () => {
    let r = null, move = [];
    try {
      if (m.type === "route") {
        r = await router.route(m.a, m.b, m.t);
        if (r && r.coords) r = { coords: r.coords, len: r.len, snapA: r.snapA, snapB: r.snapB, ms: r.loadMs + r.searchMs };
      } else if (m.type === "has") { const meta = await router.index(); r = !!meta.tiles[router.tileKey(m.p[0], m.p[1])]; }
      else if (m.type === "lines") { r = await router.linesIn(...m.box, m.maxCls); move = [r.cls.buffer, r.off.buffer, r.xy.buffer]; }
      else if (m.type === "meta") { const meta = await router.index(); r = { built: meta.built, tile: meta.tile, kb: Object.fromEntries(Object.entries(meta.tiles).map(([k, v]) => [k, v.kb])) }; }
    } catch (err) { r = null; }
    postMessage({ id: m.id, r }, move);
  });
};
