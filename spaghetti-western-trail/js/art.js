/* The pictographic map of the trail and the drawn product pictures. */
window.SWT = window.SWT || {};
SWT.art = {};
(function () {
  var SPAIN = [[-7.7,43.79],[-6,43.57],[-5,43.47],[-3.8,43.46],[-3,43.38],[-1.8,43.39],[-1.4,43.05],[-0.7,42.85],[0.7,42.85],[1.5,42.45],[2.4,42.42],[3.3,42.32],[3.2,41.9],[2.2,41.35],[1,41.05],[0.9,40.7],[0.2,40],[-0.3,39.5],[-0.2,39],[0.2,38.75],[-0.5,38.3],[-0.75,37.9],[-0.8,37.6],[-1,37.55],[-1.6,37.35],[-1.85,37.14],[-1.95,36.95],[-2.19,36.72],[-2.45,36.83],[-3,36.75],[-3.6,36.72],[-4.4,36.72],[-5,36.45],[-5.35,36.15],[-5.6,36],[-6,36.3],[-6.3,36.55],[-6.4,36.8],[-7,37.2],[-7.4,37.2],[-7.5,37.5],[-7.25,38.2],[-7,38.8],[-7,39],[-7.5,39.7],[-6.9,40.25],[-6.8,41],[-6.2,41.6],[-6.6,41.95],[-7.2,41.9],[-8.1,41.85],[-8.85,41.9],[-8.9,42.2],[-9,42.6],[-9.3,42.9],[-9.2,43.2],[-8.5,43.35],[-8,43.65]];
  var PORTUGAL = [[-8.85,41.9],[-8.65,41.0],[-8.9,40.1],[-9.4,39.4],[-9.5,38.75],[-8.9,38.5],[-8.8,37.95],[-8.95,37.0],[-8.0,37.0],[-7.4,37.2],[-7.5,37.5],[-7.25,38.2],[-7,38.8],[-7,39],[-7.5,39.7],[-6.9,40.25],[-6.8,41],[-6.2,41.6],[-6.6,41.95],[-7.2,41.9],[-8.1,41.85]];
  // which places get a pictogram on the poster map (the rest are on the zoomable map)
  var PICK = ["sad-hill", "arlanza", "rio-lobos", "gormaz", "atienza", "rio-dulce", "zorita", "caras", "belmonte", "rio-mundo", "segura", "utrero", "gorafe", "guadix-station", "la-calahorra", "calar-alto", "fort-bravo", "cortijo-fraile"];
  var LABEL = { "sad-hill": ["Sad Hill", 1], "caras": ["Faces in the rock", 1], "rio-mundo": ["Waterfall", 1], "gorafe": ["Dolmens", 1], "calar-alto": ["Observatory", 1], "fort-bravo": ["Film towns", 1], "la-calahorra": ["Flagstone", -1], "belmonte": ["Belmonte", 1], "gormaz": ["Gormaz", 1] };
  SWT.art.picto = function (route, opts) {
    opts = opts || {};
    var W = 520, H = 760, LON0 = -5.2, LON1 = 0.35, LAT0 = 42.45, LAT1 = 36.45;
    function P(lon, lat) { return [(lon - LON0) / (LON1 - LON0) * W, (LAT0 - lat) / (LAT0 - LAT1) * H]; }
    function f(n) { return n.toFixed(1); }
    function path(pts, step) { var out = [], s = step || 1; for (var i = 0; i < pts.length; i += s) { var p = P(pts[i][0], pts[i][1]); out.push(f(p[0]) + " " + f(p[1])); } var l = P(pts[pts.length - 1][0], pts[pts.length - 1][1]); out.push(f(l[0]) + " " + f(l[1])); return "M" + out.join("L"); }
    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Pictorial map of the Spaghetti Western Trail from Sad Hill to Tabernas">';
    o += '<defs><pattern id="pm-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V7" stroke="var(--land2)" stroke-width="2.4"/></pattern>' +
         '<pattern id="pm-dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="var(--land2)"/></pattern></defs>';
    o += '<rect width="' + W + '" height="' + H + '" fill="var(--sea)"/>';
    o += '<path d="' + path(PORTUGAL) + 'Z" fill="var(--paper2)" stroke="var(--soft)" stroke-width="1.2"/>';
    o += '<path d="' + path(SPAIN) + 'Z" fill="var(--land)" stroke="var(--ink)" stroke-width="2.2"/>';
    o += '<path d="' + path(SPAIN) + 'Z" fill="url(#pm-dots)" opacity=".7"/>';
    // sierras
    [[-3.6,40.95,60,18,-12],[-2.75,38.1,30,48,8],[-3.2,37.08,58,12,-4],[-2.45,37.27,40,10,-6],[-1.95,40.25,36,30,0],[-2.45,38.55,26,16,0]].forEach(function (s) {
      var p = P(s[0], s[1]); o += '<ellipse cx="' + f(p[0]) + '" cy="' + f(p[1]) + '" rx="' + s[2] + '" ry="' + s[3] + '" transform="rotate(' + s[4] + ' ' + f(p[0]) + ' ' + f(p[1]) + ')" fill="url(#pm-hatch)"/>';
    });
    // mountains as little peaks
    [[-3.3,37.07],[-3.05,37.1],[-2.55,37.25],[-2.8,38.05],[-2.65,38.2],[-3.75,40.9],[-3.45,41.0]].forEach(function (m) {
      var p = P(m[0], m[1]); o += '<path d="M' + f(p[0] - 11) + ' ' + f(p[1] + 7) + 'l11-15 11 15" fill="none" stroke="var(--soft)" stroke-width="1.6" stroke-linejoin="round"/>';
    });
    // towns for context
    [["Burgos", -3.70, 42.34, 1], ["Madrid", -3.70, 40.42, -1], ["Cuenca", -2.13, 40.07, 1], ["Albacete", -1.86, 38.99, 1], ["Murcia", -1.13, 37.99, 1]].forEach(function (c) {
      var p = P(c[1], c[2]); o += '<rect x="' + f(p[0] - 3.5) + '" y="' + f(p[1] - 3.5) + '" width="7" height="7" fill="var(--soft)"/>' +
        '<text x="' + f(p[0] + (c[3] > 0 ? 8 : -8)) + '" y="' + f(p[1] + 4) + '" text-anchor="' + (c[3] > 0 ? "start" : "end") + '" font-family="Courier Prime, monospace" font-size="12.5" fill="var(--soft)">' + c[0] + '</text>';
    });
    // route: tarmac then trail
    (route.stages || []).forEach(function (s) {
      if (s.tarmac) o += '<path d="' + path(s.tarmac, 6) + '" fill="none" stroke="var(--tarmac)" stroke-width="' + (s.n ? 2.2 : 1.6) + '" ' + (s.n ? '' : 'stroke-dasharray="2 4"') + ' stroke-linejoin="round" opacity=".85"/>';
    });
    (route.stages || []).forEach(function (s) {
      if (s.trail) o += '<path d="' + path(s.trail, 6) + '" fill="none" stroke="var(--trail)" stroke-width="3.6" stroke-dasharray="8 4" stroke-linejoin="round"/>';
    });
    // stage numbers at stage starts
    (route.stages || []).forEach(function (s) {
      if (!s.n) return; var w = s.waypoints[0], p = P(w[0], w[1]);
      o += '<g transform="translate(' + f(p[0] - 34) + ' ' + f(p[1]) + ')"><rect x="-9" y="-9" width="18" height="18" fill="var(--ink)"/><text y="5" text-anchor="middle" font-family="Courier Prime, monospace" font-weight="700" font-size="13" fill="var(--paper)">' + s.n + '</text></g>';
    });
    // pictograms
    var byId = {}; SWT.places.forEach(function (p) { byId[p.id] = p; });
    PICK.forEach(function (id) {
      var pl = byId[id]; if (!pl) return; var p = P(pl.lon, pl.lat), col = SWT.cats[pl.cat].color;
      o += '<a href="#place/' + id + '" aria-label="' + pl.name + '"><g transform="translate(' + f(p[0] - 15) + ' ' + f(p[1] - 15) + ')">' +
        '<circle cx="15" cy="15" r="13.5" fill="#fff" stroke="' + col + '" stroke-width="2.4"/><g transform="translate(4.2 4.2) scale(.9)" fill="none" stroke="' + col + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + SWT.icons[pl.icon] + '"/></g></g>';
      var lb = LABEL[id];
      if (lb) o += '<text x="' + f(p[0] + (lb[1] > 0 ? 19 : -19)) + '" y="' + f(p[1] + 5) + '" text-anchor="' + (lb[1] > 0 ? "start" : "end") + '" font-family="Rye, serif" font-size="14" fill="' + col + '" paint-order="stroke" stroke="var(--land)" stroke-width="4">' + lb[0] + '</text>';
      o += '</a>';
    });
    // sun, compass, sea name, cactus and rider doodles
    o += '<g transform="translate(442 70)"><circle r="26" fill="var(--sun)"/>' + [0,30,60,90,120,150,180,210,240,270,300,330].map(function (r) { return '<path d="M0 -33V-44" stroke="var(--sun)" stroke-width="3" transform="rotate(' + r + ')"/>'; }).join("") + '</g>';
    o += '<g transform="translate(478 470)" font-family="Rye, serif" font-size="14" fill="var(--ink)" text-anchor="middle"><path d="M0 -30L7 0 0 30-7 0z" fill="var(--ink)"/><path d="M0 -30L7 0H-7z" fill="var(--sun)"/><text y="-36">N</text></g>';
    var sea = P(-0.45, 37.25); o += '<text x="' + f(sea[0]) + '" y="' + f(sea[1]) + '" font-family="Rye, serif" font-size="17" fill="var(--soft)" text-anchor="middle">Mar</text><text x="' + f(sea[0]) + '" y="' + f(sea[1] + 20) + '" font-family="Rye, serif" font-size="17" fill="var(--soft)" text-anchor="middle">Mediterráneo</text>';
    var cact = [[-1.6, 37.55], [-4.3, 37.6], [-1.3, 38.6]];
    cact.forEach(function (c) { var p = P(c[0], c[1]); o += '<g transform="translate(' + f(p[0] - 14) + ' ' + f(p[1] - 14) + ') scale(1.2)" fill="none" stroke="var(--trail)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + SWT.icons.cactus + '"/></g>'; });
    var a = P(-3.4084, 41.9908), b = P(-2.3905, 37.0496);
    o += '<text x="' + f(a[0] - 2) + '" y="' + f(a[1] - 22) + '" font-family="Rye, serif" font-size="13" fill="var(--blood)" text-anchor="middle">START</text>';
    if (!opts.bare) o += '<text x="18" y="' + (H - 18) + '" font-family="Courier Prime, monospace" font-size="11" fill="var(--soft)">Not to scale for navigation. Use the Map for that.</text>';
    return o + "</svg>";
  };

  // drawn product pictures where no generated picture exists
  SWT.art.foldmap = function () {
    return '<svg viewBox="0 0 400 400"><rect width="400" height="400" fill="var(--land)"/>' +
      '<g transform="translate(60 70)"><path d="M0 20L90 0 180 20 270 0V240L180 260 90 240 0 260Z" fill="#fbf7ee" stroke="#2b2e31" stroke-width="3"/>' +
      '<path d="M90 0V240M180 20V260" stroke="#2b2e31" stroke-width="1.5" opacity=".5"/><path d="M0 20L90 0V240L0 260Z" fill="#000" opacity=".05"/><path d="M180 20L270 0V240L180 260Z" fill="#000" opacity=".06"/>' +
      '<path d="M40 40q30 30 20 60t50 40 30 50 60 30 40 40" fill="none" stroke="#3d7a46" stroke-width="5" stroke-dasharray="10 5"/>' +
      '<path d="M44 46q26 34 18 62t52 38 26 48 64 30 36 40" fill="none" stroke="#1f2023" stroke-width="2.5"/>' +
      '<circle cx="40" cy="40" r="7" fill="#a3262a"/><circle cx="240" cy="240" r="7" fill="#a3262a"/></g>' +
      '<text x="200" y="368" text-anchor="middle" font-family="Rye, serif" font-size="22" fill="#2b2e31">North · Middle · South</text></svg>';
  };
  SWT.art.gpx = function () {
    return '<svg viewBox="0 0 400 400"><rect width="400" height="400" fill="var(--land)"/>' +
      '<g transform="translate(130 50)"><rect width="140" height="260" rx="18" fill="#2b2e31"/><rect x="10" y="26" width="120" height="200" fill="#fbf7ee"/>' +
      '<path d="M30 46q20 30 10 60t40 40 10 50 30 20" fill="none" stroke="#3d7a46" stroke-width="5" stroke-dasharray="9 4"/><circle cx="30" cy="46" r="6" fill="#a3262a"/><circle cx="120" cy="216" r="6" fill="#a3262a"/><rect x="55" y="236" width="30" height="8" rx="4" fill="#6a6760"/></g>' +
      '<text x="200" y="358" text-anchor="middle" font-family="Courier Prime, monospace" font-weight="700" font-size="24" fill="#2b2e31">.GPX · 9 files</text></svg>';
  };
})();
