/* The zoomable trail map: MapLibre drawing a Protomaps file of the corridor, from the phone if saved, else from the web. */
window.SWT = window.SWT || {};
(function () {
  var M = SWT.map = { visibleCats: { film: 1, odd: 1, beauty: 1, stay: 1, eat: 1, coffee: 1, wc: 1, fuel: 1 } };
  var protocol = null, sourceUrl = null;
  function base() { return location.href.replace(/[#?].*$/, "").replace(/[^/]*$/, ""); }
  function flavor() {
    var f = Object.assign({}, basemaps.namedFlavor("light"));
    Object.assign(f, {
      background: "#e9e4d8", earth: "#f6f1e5", water: "#9fc4cf", park_a: "#dfe3c7", park_b: "#c8d5ad", wood_a: "#e1e4c8", wood_b: "#c9d4ae",
      scrub_a: "#ece6cb", scrub_b: "#dcd7b2", sand: "#f1e3c2", beach: "#f1e3c2", glacier: "#ffffff", industrial: "#e7e0d2", military: "#e5ddd0",
      buildings: "#d9cfbd", railway: "#8d8678", boundaries: "#a39a88",
      other: "#a8865a", minor_service: "#fffdf8", minor_a: "#fffdf8", minor_b: "#ffffff", link: "#ffffff", major: "#fbe9c4", highway: "#f2c879",
      minor_casing: "#d2c6ad", minor_service_casing: "#d2c6ad", link_casing: "#cbb994", major_casing_early: "#c9ad78", major_casing_late: "#c9ad78", highway_casing_early: "#b8924c", highway_casing_late: "#b8924c",
      city_label: "#2b2e31", city_label_halo: "#f6f1e5", subplace_label: "#5c5a54", subplace_label_halo: "#f6f1e5", state_label: "#9a9284", state_label_halo: "#f6f1e5",
      roads_label_minor: "#6a6760", roads_label_major: "#5c5a54", ocean_label: "#5b7e8a"
    });
    f.landcover = { grassland: "rgba(233,230,200,1)", barren: "rgba(243,230,201,1)", urban_area: "rgba(232,226,214,1)", farmland: "rgba(240,233,210,1)", glacier: "rgba(255,255,255,1)", scrub: "rgba(229,226,196,1)", forest: "rgba(214,221,190,1)" };
    return f;
  }
  function style(url) {
    var layers = basemaps.layers("protomaps", flavor(), { lang: "es" }).filter(function (l) { return l.id !== "pois"; });
    return { version: 8, glyphs: base() + "fonts/glyphs/{fontstack}/{range}.pbf", sprite: base() + "sprites/light",
      sources: { protomaps: { type: "vector", url: "pmtiles://" + url, attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>' } },
      layers: layers };
  }
  // Pick the map file: the saved copy on this phone, else stream it from the website.
  M.prepare = function () {
    if (!protocol) { protocol = new pmtiles.Protocol(); maplibregl.addProtocol("pmtiles", protocol.tile); }
    return SWT.offline.loadMapFile().then(function (file) {
      if (file) { if (sourceUrl !== "trail.pmtiles") { protocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(file))); sourceUrl = "trail.pmtiles"; M.local = true; } }
      else { var u = base() + "data/trail.pmtiles"; if (sourceUrl !== u) { protocol.add(new pmtiles.PMTiles(u)); sourceUrl = u; M.local = false; } }
      return sourceUrl;
    });
  };
  function routeGeo() {
    var feats = [], starts = [];
    SWT.route.stages.forEach(function (s) {
      if (s.tarmac) feats.push({ type: "Feature", properties: { kind: s.n ? "tarmac" : "coda", stage: s.n }, geometry: { type: "LineString", coordinates: s.tarmac } });
      if (s.trail) feats.push({ type: "Feature", properties: { kind: "trail", stage: s.n }, geometry: { type: "LineString", coordinates: s.trail } });
      if (s.n) starts.push({ type: "Feature", properties: { n: String(s.n), name: s.from }, geometry: { type: "Point", coordinates: s.waypoints[0].slice(0, 2) } });
    });
    var last = SWT.route.stages.filter(function (s) { return s.n; }).pop();
    starts.push({ type: "Feature", properties: { n: "", end: true, name: "Tabernas" }, geometry: { type: "Point", coordinates: last.waypoints[last.waypoints.length - 1].slice(0, 2) } });
    return { lines: { type: "FeatureCollection", features: feats }, starts: { type: "FeatureCollection", features: starts } };
  }
  M.placesGeo = function () {
    return { type: "FeatureCollection", features: SWT.allPlaces().map(function (p) {
      return { type: "Feature", properties: { id: p.id, cat: p.cat, img: "pin-" + p.cat + "-" + p.icon + (p.sample ? "-s" : ""), rank: { film: 0, odd: 1, beauty: 2, stay: 3, eat: 4, coffee: 5, wc: 6, fuel: 7 }[p.cat] + (p.sample ? 10 : 0), name: p.name },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] } };
    }) };
  };
  function addImages(map) {
    SWT.allPlaces().forEach(function (p) {
      var key = "pin-" + p.cat + "-" + p.icon + (p.sample ? "-s" : "");
      if (!map.hasImage(key)) map.addImage(key, SWT.badgeImage(p.icon, SWT.cats[p.cat].color, !!p.sample), { pixelRatio: 2 });
    });
  }
  M.addOverlays = function (map, opts) {
    opts = opts || {};
    var g = routeGeo();
    map.addSource("route", { type: "geojson", data: g.lines });
    map.addSource("starts", { type: "geojson", data: g.starts });
    map.addLayer({ id: "route-tarmac", type: "line", source: "route", filter: ["==", ["get", "kind"], "tarmac"], paint: { "line-color": "#1f2023", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.4, 12, 3], "line-opacity": .85 }, layout: { "line-join": "round", "line-cap": "round" } });
    map.addLayer({ id: "route-coda", type: "line", source: "route", filter: ["==", ["get", "kind"], "coda"], paint: { "line-color": "#1f2023", "line-width": 2, "line-dasharray": [1, 2] }, layout: { "line-cap": "round" } });
    map.addLayer({ id: "route-trail-casing", type: "line", source: "route", filter: ["==", ["get", "kind"], "trail"], paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 8] }, layout: { "line-join": "round", "line-cap": "round" } });
    map.addLayer({ id: "route-trail", type: "line", source: "route", filter: ["==", ["get", "kind"], "trail"], paint: { "line-color": "#3d7a46", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.4, 12, 5], "line-dasharray": [2.2, 1.1] }, layout: { "line-join": "round" } });
    map.addLayer({ id: "starts", type: "circle", source: "starts", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 7, 10, 11], "circle-color": ["case", ["has", "end"], "#a3262a", "#2b2e31"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "starts-n", type: "symbol", source: "starts", layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Medium"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 10, 13], "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } });
    addImages(map);
    map.addSource("places", { type: "geojson", data: M.placesGeo() });
    map.addLayer({ id: "places", type: "symbol", source: "places", layout: {
      "icon-image": ["get", "img"], "icon-size": ["interpolate", ["linear"], ["zoom"], 5, .5, 8, .7, 11, .9, 14, 1], "symbol-sort-key": ["get", "rank"],
      "icon-allow-overlap": ["step", ["zoom"], false, 10, true], "icon-padding": 1,
      "text-field": ["step", ["zoom"], "", 10, ["get", "name"]], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-offset": [0, 1.5], "text-anchor": "top", "text-optional": true, "text-max-width": 9 },
      paint: { "text-color": "#2b2e31", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
    if (opts.interactive !== false) {
      map.on("click", "places", function (e) { var f = e.features && e.features[0]; if (f && M.onPick) M.onPick(f.properties.id); });
      map.on("mouseenter", "places", function () { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "places", function () { map.getCanvas().style.cursor = ""; });
    }
  };
  M.applyFilter = function (map) {
    var on = Object.keys(M.visibleCats).filter(function (k) { return M.visibleCats[k]; });
    if (map && map.getLayer("places")) map.setFilter("places", ["in", ["get", "cat"], ["literal", on]]);
  };
  M.refreshPlaces = function (map) { if (map && map.getSource("places")) { addImages(map); map.getSource("places").setData(M.placesGeo()); } };
  M.bounds = function (stageN) {
    var pts = [];
    SWT.route.stages.forEach(function (s) { if (stageN == null ? s.n : s.n === stageN) pts = pts.concat(s.trail || s.tarmac); });
    var b = new maplibregl.LngLatBounds(pts[0], pts[0]); pts.forEach(function (p) { b.extend(p); }); return b;
  };
  M.create = function (el, opts) {
    opts = opts || {};
    return M.prepare().then(function (url) {
      var map = new maplibregl.Map({ container: el, style: style(url), bounds: opts.center ? undefined : M.bounds(null), center: opts.center, zoom: opts.zoom,
        fitBoundsOptions: { padding: 30 }, maxBounds: [[-6.2, 35.8], [0.4, 43.0]], minZoom: 5, maxZoom: 16.5, attributionControl: { compact: true }, cooperativeGestures: !!opts.cooperative, dragRotate: false, pitchWithRotate: false });
      map.touchZoomRotate.disableRotation();
      if (opts.controls !== false) {
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
        map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
      }
      map.on("load", function () { M.addOverlays(map, opts); M.applyFilter(map); if (opts.onLoad) opts.onLoad(map); });
      return map;
    });
  };
})();
