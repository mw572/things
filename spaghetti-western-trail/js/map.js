/* The zoomable trail map. Two Protomaps files: a light overview of Spain (zoom 0 to 8) drawn underneath,
   and the detailed trail corridor (zoom 0 to 14) on top. Read from the phone once saved, else streamed from the site. */
window.SWT = window.SWT || {};
(function () {
  var M = SWT.map = { visibleCats: { film: 1, odd: 1, beauty: 1, stay: 1, eat: 1, coffee: 1, wc: 1, fuel: 1 }, stage: null };
  var protocol = null, keys = null;
  function base() { return location.href.replace(/[#?].*$/, "").replace(/[^/]*$/, ""); }
  function flavor(pale) {
    var f = Object.assign({}, basemaps.namedFlavor("light"));
    Object.assign(f, {
      background: "#efe8d8", earth: "#f6f0e2", water: "#a9c9d2", park_a: "#e1e3c9", park_b: "#cfd8b5", wood_a: "#e3e5cb", wood_b: "#cdd6b3",
      scrub_a: "#ede6cc", scrub_b: "#dfd9b6", sand: "#f1e3c2", beach: "#f1e3c2", glacier: "#ffffff", industrial: "#e9e2d4", military: "#e7dfd2",
      buildings: "#ddd3c1", railway: "#9a9284", boundaries: "#b4aa96",
      other: "#b08f60", minor_service: "#fffdf8", minor_a: "#fffdf8", minor_b: "#ffffff", link: "#ffffff", major: "#fbeacb", highway: "#f0cf8e",
      minor_casing: "#d8ccb3", minor_service_casing: "#d8ccb3", link_casing: "#d0bf9c", major_casing_early: "#cfb688", major_casing_late: "#cfb688", highway_casing_early: "#c4a467", highway_casing_late: "#c4a467",
      city_label: "#2b2e31", city_label_halo: "#f6f0e2", subplace_label: "#5c5a54", subplace_label_halo: "#f6f0e2", state_label: "#a39b8b", state_label_halo: "#f6f0e2", country_label: "#a39b8b",
      roads_label_minor: "#6a6760", roads_label_major: "#5c5a54", ocean_label: "#6b8c96"
    });
    f.landcover = { grassland: "rgba(234,231,203,1)", barren: "rgba(243,231,204,1)", urban_area: "rgba(233,227,215,1)", farmland: "rgba(241,234,212,1)", glacier: "rgba(255,255,255,1)", scrub: "rgba(231,228,199,1)", forest: "rgba(217,223,194,1)" };
    if (pale) { // outside the corridor: the same map faded towards paper
      ["earth", "park_a", "park_b", "wood_a", "wood_b", "scrub_a", "scrub_b", "sand", "beach"].forEach(function (k) { f[k] = "#f1ebde"; });
      f.water = "#c4d6db"; f.major = "#f3e6cc"; f.highway = "#ecd7ad"; f.major_casing_early = f.major_casing_late = "#e2d3b4"; f.highway_casing_early = f.highway_casing_late = "#dcc79e";
      f.landcover = { grassland: "rgba(241,235,222,1)", barren: "rgba(241,235,222,1)", urban_area: "rgba(233,227,215,1)", farmland: "rgba(241,235,222,1)", glacier: "rgba(255,255,255,1)", scrub: "rgba(241,235,222,1)", forest: "rgba(232,230,212,1)" };
    }
    return f;
  }
  function style(k) {
    var ov = basemaps.layers("overview", flavor(true), { lang: "es" }).filter(function (l) { return l.id !== "pois"; }).map(function (l) {
      l = Object.assign({}, l, { id: "ov-" + l.id }); if (l.type === "symbol") l.maxzoom = 8.5; return l;
    });
    var tr = basemaps.layers("protomaps", flavor(false), { lang: "es" }).filter(function (l) { return l.id !== "pois" && l.id !== "background"; }).map(function (l) {
      l = Object.assign({}, l); l.minzoom = Math.max(l.minzoom || 0, l.type === "symbol" ? 8.5 : 7.5); return l;
    });
    var attr = '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';
    return { version: 8, glyphs: base() + "fonts/glyphs/{fontstack}/{range}.pbf", sprite: base() + "sprites/light",
      sources: { overview: { type: "vector", url: "pmtiles://" + k.overview, attribution: attr }, protomaps: { type: "vector", url: "pmtiles://" + k.trail } },
      layers: ov.concat(tr) };
  }
  // Pick the map files: the saved copies on this phone, else stream them from the website.
  M.prepare = function () {
    if (!protocol) { protocol = new pmtiles.Protocol(); maplibregl.addProtocol("pmtiles", protocol.tile); }
    return SWT.offline.loadMapFiles().then(function (files) {
      var next = files ? { trail: "trail.pmtiles", overview: "overview.pmtiles", local: true } : { trail: base() + "data/trail.pmtiles", overview: base() + "data/overview.pmtiles", local: false };
      if (!keys || keys.trail !== next.trail) {
        if (files) { protocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(files["trail.pmtiles"]))); protocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(files["overview.pmtiles"]))); }
        else { protocol.add(new pmtiles.PMTiles(next.trail)); protocol.add(new pmtiles.PMTiles(next.overview)); }
        keys = next;
      }
      M.local = keys.local; return keys;
    });
  };
  function routeGeo() {
    var feats = [], starts = [];
    SWT.route.stages.forEach(function (s) {
      if (s.tarmac) feats.push({ type: "Feature", properties: { kind: s.n ? "tarmac" : "coda", stage: s.n }, geometry: { type: "LineString", coordinates: s.tarmac } });
      if (s.trail) feats.push({ type: "Feature", properties: { kind: "trail", stage: s.n }, geometry: { type: "LineString", coordinates: s.trail } });
      if (s.n) starts.push({ type: "Feature", properties: { n: String(s.n), stage: s.n }, geometry: { type: "Point", coordinates: s.waypoints[0].slice(0, 2) } });
    });
    var last = SWT.route.stages.filter(function (s) { return s.n; }).pop();
    starts.push({ type: "Feature", properties: { n: "", end: true, stage: last.n }, geometry: { type: "Point", coordinates: last.waypoints[last.waypoints.length - 1].slice(0, 2) } });
    return { lines: { type: "FeatureCollection", features: feats }, starts: { type: "FeatureCollection", features: starts } };
  }
  M.placesGeo = function () {
    return { type: "FeatureCollection", features: SWT.allPlaces().map(function (p) {
      return { type: "Feature", properties: { id: p.id, cat: p.cat, stage: p.stage, img: "pin-" + p.cat + "-" + p.icon + (p.sample ? "-s" : ""), rank: { film: 0, odd: 1, beauty: 2, stay: 3, eat: 4, coffee: 5, wc: 6, fuel: 7 }[p.cat] + (p.sample ? 10 : 0), name: p.name },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] } };
    }) };
  };
  function addImages(map) {
    SWT.allPlaces().forEach(function (p) {
      var key = "pin-" + p.cat + "-" + p.icon + (p.sample ? "-s" : "");
      if (!map.hasImage(key)) map.addImage(key, SWT.badgeImage(p.icon, SWT.cats[p.cat].color, !!p.sample), { pixelRatio: 2 });
    });
  }
  function dim(on, off) { return M.stage == null ? on : ["case", ["==", ["get", "stage"], M.stage], on, off]; }
  M.addOverlays = function (map, opts) {
    opts = opts || {};
    var g = routeGeo();
    map.addSource("route", { type: "geojson", data: g.lines });
    map.addSource("starts", { type: "geojson", data: g.starts });
    map.addLayer({ id: "route-tarmac", type: "line", source: "route", filter: ["==", ["get", "kind"], "tarmac"], paint: { "line-color": "#2b2e31", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.2, 12, 3], "line-opacity": .8 }, layout: { "line-join": "round", "line-cap": "round" } });
    map.addLayer({ id: "route-coda", type: "line", source: "route", filter: ["==", ["get", "kind"], "coda"], paint: { "line-color": "#2b2e31", "line-width": 2, "line-dasharray": [1, 2], "line-opacity": .7 }, layout: { "line-cap": "round" } });
    map.addLayer({ id: "route-trail-casing", type: "line", source: "route", filter: ["==", ["get", "kind"], "trail"], paint: { "line-color": "#fffdf6", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 4.5, 12, 9] }, layout: { "line-join": "round", "line-cap": "round" } });
    map.addLayer({ id: "route-trail", type: "line", source: "route", filter: ["==", ["get", "kind"], "trail"], paint: { "line-color": "#3d7a46", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2.6, 12, 5], "line-dasharray": [2.4, 1.2] }, layout: { "line-join": "round" } });
    map.addLayer({ id: "starts", type: "circle", source: "starts", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 7, 10, 11], "circle-color": ["case", ["has", "end"], "#a3262a", "#2b2e31"], "circle-stroke-color": "#fffdf6", "circle-stroke-width": 2 } });
    map.addLayer({ id: "starts-n", type: "symbol", source: "starts", layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Medium"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 10, 13], "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } });
    addImages(map);
    map.addSource("places", { type: "geojson", data: M.placesGeo() });
    map.addLayer({ id: "places", type: "symbol", source: "places", layout: {
      "icon-image": ["get", "img"], "icon-size": ["interpolate", ["linear"], ["zoom"], 5, .5, 8, .7, 11, .9, 14, 1], "symbol-sort-key": ["get", "rank"],
      "icon-allow-overlap": ["step", ["zoom"], false, 10, true], "icon-padding": 1,
      "text-field": ["step", ["zoom"], "", 10, ["get", "name"]], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-offset": [0, 1.5], "text-anchor": "top", "text-optional": true, "text-max-width": 9 },
      paint: { "text-color": "#2b2e31", "text-halo-color": "#fffdf6", "text-halo-width": 1.6 } });
    if (opts.interactive !== false) {
      map.on("click", "places", function (e) { var f = e.features && e.features[0]; if (f && M.onPick) M.onPick(f.properties.id); });
      map.on("mouseenter", "places", function () { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "places", function () { map.getCanvas().style.cursor = ""; });
    }
  };
  M.applyFilter = function (map) {
    if (!map || !map.getLayer("places")) return;
    var on = Object.keys(M.visibleCats).filter(function (k) { return M.visibleCats[k]; });
    map.setFilter("places", ["in", ["get", "cat"], ["literal", on]]);
    map.setPaintProperty("route-trail", "line-opacity", dim(1, .3));
    map.setPaintProperty("route-trail-casing", "line-opacity", dim(1, .3));
    map.setPaintProperty("route-tarmac", "line-opacity", dim(.8, .25));
    map.setPaintProperty("places", "icon-opacity", dim(1, .35));
    map.setPaintProperty("starts", "circle-opacity", dim(1, .35));
  };
  M.refreshPlaces = function (map) { if (map && map.getSource("places")) { addImages(map); map.getSource("places").setData(M.placesGeo()); } };
  M.bounds = function (stageN) {
    var pts = [];
    SWT.route.stages.forEach(function (s) { if (stageN == null ? s.n : s.n === stageN) pts = pts.concat(s.trail || s.tarmac); });
    var b = new maplibregl.LngLatBounds(pts[0], pts[0]); pts.forEach(function (p) { b.extend(p); }); return b;
  };
  M.create = function (el, opts) {
    opts = opts || {};
    return M.prepare().then(function (k) {
      var map = new maplibregl.Map({ container: el, style: style(k), bounds: opts.center ? undefined : M.bounds(null), center: opts.center, zoom: opts.zoom,
        fitBoundsOptions: { padding: 30 }, maxBounds: [[-11, 34.5], [5, 45]], minZoom: 4.5, maxZoom: 16.5, attributionControl: { compact: true }, cooperativeGestures: !!opts.cooperative, dragRotate: false, pitchWithRotate: false });
      map.touchZoomRotate.disableRotation();
      if (opts.controls !== false) {
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "bottom-right");
        map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      }
      if (window.ResizeObserver) new ResizeObserver(function () { map.resize(); }).observe(el);
      requestAnimationFrame(function () { map.resize(); });
      map.on("load", function () { map.resize(); M.addOverlays(map, opts); if (opts.controls !== false) M.applyFilter(map); if (opts.onLoad) opts.onLoad(map); });
      return map;
    });
  };
})();
