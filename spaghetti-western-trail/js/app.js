/* Pages and routing for the Spaghetti Western Trail demo. Hash routes, so every page works offline from one file. */
window.SWT = window.SWT || {};
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var view = $("#view"), mapview = $("#mapview");
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem("swt-" + k) || "null"); localStorage.setItem("swt-" + k, JSON.stringify(v)); } catch (e) { return null; } }
  function toast(msg) { var t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  SWT.toast = toast;

  // ---------- data helpers ----------
  SWT.community = function () { return store("approved") || []; };
  SWT.allPlaces = function () { return SWT.places.concat(SWT.community()); };
  function place(id) { return SWT.allPlaces().filter(function (p) { return p.id === id; })[0]; }
  function hav(a, b) { var R = 6371, la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180, dla = la2 - la1, dlo = (b[0] - a[0]) * Math.PI / 180;
    var h = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) * Math.sin(dlo / 2); return 2 * R * Math.asin(Math.sqrt(h)); }
  var TRAIL = [], TRAIL_KM = [];
  function prepRoute() {
    var km = 0;
    SWT.route.stages.forEach(function (s) {
      if (!s.n || !s.trail) return;
      s.startKm = km;
      s.trail.forEach(function (p) { if (TRAIL.length) km += hav(TRAIL[TRAIL.length - 1], p); TRAIL.push(p); TRAIL_KM.push(km); });
      s.endKm = km;
    });
    SWT.totalKm = km;
  }
  function locate(p) {
    if (p._near) return p._near;
    var best = 1e9, bi = 0, q = [p.lon, p.lat];
    for (var i = 0; i < TRAIL.length; i += 2) { var d = hav(q, TRAIL[i]); if (d < best) { best = d; bi = i; } }
    p._near = { off: best, km: TRAIL_KM[bi] }; return p._near;
  }
  function stageOf(n) { return SWT.route.stages.filter(function (s) { return s.n === n; })[0]; }
  function kmFmt(k) { return k < 1 ? Math.round(k * 1000) + " m" : k < 10 ? k.toFixed(1) + " km" : Math.round(k) + " km"; }
  function catPill(p) { var c = SWT.cats[p.cat]; return '<span class="pill cat" style="background:' + c.color + '">' + esc(c.short) + '</span>' + (p.sample ? ' <span class="pill sample">Sample</span>' : '') + (p.community ? ' <span class="pill community">Community</span>' : ''); }
  // pictures
  function art(slug) { return (SWT.ART || []).indexOf(slug) >= 0 ? "img/art/" + slug + ".jpg" : null; }
  function areaOfStage(n) { return (SWT.stages[n] || SWT.stages[1]).area; }
  function stageImg(n) { return art("s-" + n) || art(SWT.areas[areaOfStage(n)].art); }
  function placeImg(p) { return art("p-" + p.id) || (p.stage != null ? art(SWT.areas[areaOfStage(p.stage)].art) : null); }
  function banner(img, eyebrow, title, text, cls, pills) {
    return '<section class="banner ' + (cls || "") + '">' + (img ? '<img src="' + img + '" alt="">' : '') + '<div class="wrap">' + (pills ? '<div class="pills">' + pills + '</div>' : '') +
      (eyebrow ? '<div class="eyebrow">' + eyebrow + '</div>' : '') + '<h1>' + title + '</h1>' + (text ? '<p>' + text + '</p>' : '') + '</div></section>';
  }
  function placeCard(p) {
    var n = locate(p), img = placeImg(p);
    return '<a class="pcard" href="#place/' + p.id + '"><div class="pic">' + (img ? '<img src="' + img + '" alt="" loading="lazy">' : '') + '<div class="tag">' + catPill(p) + '</div></div>' +
      '<div class="body"><h3>' + esc(p.name) + '</h3><p>' + esc(p.blurb.split(". ")[0].replace(/\.$/, "")) + '.</p><div class="meta">' + (p.stage ? "Stage " + p.stage : "Coda") + ' · ' + (n.off < 1 ? "on the trail" : kmFmt(n.off) + " off the trail") + '</div></div></a>';
  }
  function stageCard(s) {
    var st = SWT.stages[s.n];
    return '<a class="pcard" href="#stage/' + s.n + '"><div class="pic"><img src="' + stageImg(s.n) + '" alt="" loading="lazy"><span class="num">' + (s.n || "+") + '</span></div>' +
      '<div class="body"><h3>' + esc(st.from) + ' to ' + esc(st.to) + '</h3><p>' + esc(st.note) + '</p><div class="meta">' + SWT.areas[st.area].name + ' · ' + Math.round(s.trail_km || s.tarmac_km) + ' km' + (s.trail_km ? '' : ' by road') + '</div></div></a>';
  }
  function placeRow(p) {
    var n = locate(p);
    return '<li><a href="#place/' + p.id + '">' + SWT.badgeSvg(p.icon, SWT.cats[p.cat].color, 36) + '<div><b>' + esc(p.name) + '</b> ' + (p.sample ? '<span class="pill sample">Sample</span>' : '') + '<div class="sub">' + esc(SWT.cats[p.cat].label) + ' · ' + (p.stage ? "Stage " + p.stage : "Coda") + ' · ' + (n.off < 1 ? "on the trail" : kmFmt(n.off) + " off") + '</div></div><span class="mono muted" style="font-size:13px">' + (p.stage ? "km " + Math.round(n.km) : "") + '</span></a></li>';
  }
  var AV = ["#a3262a", "#3d7a46", "#c9661d", "#3f6f86", "#6b4a33", "#5b5f66"];
  function avatar(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0; return '<span class="avatar" style="background:' + AV[Math.abs(h) % AV.length] + '">' + esc(name.charAt(0).toUpperCase()) + '</span>'; }

  // ---------- layout chrome ----------
  function setNav(route) {
    var top = route.split("/")[0], key = { area: "guide", stage: "guide", place: "places", thread: "saloon", board: "saloon", suggest: "saloon", moderate: "saloon", checkout: "shop" }[top] || top;
    $$("nav.top a, nav.tabs a").forEach(function (a) { a.classList.toggle("on", a.getAttribute("data-k") === key); });
  }
  function netBadge() { var el = $("#net"); if (!el) return; var on = navigator.onLine; el.className = "net " + (on ? "on" : "off"); el.textContent = on ? "Online" : "No signal"; }
  window.addEventListener("online", netBadge); window.addEventListener("offline", netBadge);

  // ---------- pages ----------
  var pages = {};
  var HIGHLIGHTS = ["sad-hill", "gormaz", "caras", "rio-mundo", "gorafe", "la-calahorra", "calar-alto", "fort-bravo"];
  pages.home = function () {
    var stages = SWT.route.stages.filter(function (s) { return s.n; });
    var nReal = SWT.places.filter(function (p) { return !p.sample; }).length;
    return '' +
    '<section class="hero"><div class="art"><img src="img/art/hero.jpg" alt="Poster-style drawing of a rider on a trail bike on a dirt track through desert badlands under a huge orange sun" fetchpriority="high"></div>' +
      '<div class="wrap inner"><div class="panel">' +
        '<div class="stairs" aria-label="The Spaghetti Western Trail"><span>The</span><span>Spaghetti</span><span>Western</span><span>Trail</span></div>' +
        '<p>A ' + Math.round(SWT.totalKm) + ' km route through backcountry Spain, from the cemetery at Sad Hill to the Tabernas desert, linking the places Sergio Leone made his westerns and a lot of wild and weird things on the way. There is an off-road trail for trail bikes, bicycles and walkers, and a tarmac route on the back roads for everyone else.</p>' +
        '<div class="facts"><div><b>' + Math.round(SWT.totalKm) + '</b>km of trail</div><div><b>' + stages.length + '</b>stages</div><div><b>3</b>areas</div><div><b>' + nReal + '</b>landmarks</div></div>' +
        '<div class="actions"><a class="btn" href="#map">Open the map</a><a class="btn ghost" href="#app">Put it on your phone</a></div>' +
      '</div></div></section>' +
    '<section class="band"><div class="wrap picto-wrap"><figure style="margin:0">' + pictoMap() + '' +
      '<div class="legend"><span><i class="ln" style="border-color:var(--trail);border-top-style:dashed"></i>Trail (off-road)</span><span><i class="ln" style="border-color:var(--tarmac)"></i>Tarmac route</span><span>' + SWT.badgeSvg("cross", SWT.cats.film.color, 18) + ' Film location</span><span>' + SWT.badgeSvg("block", SWT.cats.odd.color, 18) + ' Odd and abandoned</span><span>' + SWT.badgeSvg("fall", SWT.cats.beauty.color, 18) + ' Waterfalls and views</span></div></figure>' +
      '<div class="prose"><div class="eyebrow">The route</div><h2 style="margin:8px 0 16px">Sad Hill to the desert</h2>' +
        '<p class="lede">The trail starts at Sad Hill, the circular cemetery south of Burgos where The Good, the Bad and the Ugly ends, and runs south for eight stages to Tabernas in Almería, where the western towns built for the films are still standing.</p>' +
        '<p>In between it crosses limestone canyons, the empty uplands of Guadalajara, the Tagus reservoirs, the plain of La Mancha, the forests of Segura and Cazorla, and the red badlands round Guadix.</p>' +
        '<p>The green line is the trail, mostly on gravel farm and forest tracks. The black line is the tarmac route on quiet back roads between the same places. They split and rejoin all the way down, so you can swap from one to the other when the weather turns or a track is closed.</p>' +
        '<p style="margin-top:22px;display:flex;gap:10px;flex-wrap:wrap"><a class="btn dark" href="#guide">Read the guide</a><a class="btn ghost" href="#map">Open the map</a></p></div></div></section>' +
    '<section class="band alt"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">On the way</div><h2>Highlights</h2></div><a href="#places" class="mono">All ' + nReal + ' places →</a></div>' +
      '<div class="scroller">' + HIGHLIGHTS.map(function (id) { return placeCard(place(id)); }).join("") + '</div></div></section>' +
    '<section class="band"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">The guide</div><h2>Three areas, eight stages</h2></div><a href="#guide" class="mono">The full guide →</a></div><div class="grid3">' +
      ["north", "middle", "south"].map(function (k) { var a = SWT.areas[k]; return '<a class="pcard" href="#area/' + k + '"><div class="pic"><img src="img/art/' + a.art + '.jpg" alt="" loading="lazy"></div><div class="body"><div class="eyebrow">Stages ' + a.stages.join(", ") + '</div><h3>' + a.name + '</h3><p>' + esc(a.short) + '</p></div></a>'; }).join("") +
    '</div><div class="grid4" style="margin-top:22px">' + stages.map(stageCard).join("") + '</div></div></section>' +
    installBanner() +
    '<section class="band"><div class="wrap grid2"><div><div class="eyebrow">Trading Post</div><h2 style="margin:8px 0 18px">The book and the maps</h2>' +
      '<div class="grid2" style="gap:18px">' + [SWT.products[0], SWT.products[2]].map(function (p) { return '<a class="pcard product" href="#shop"><div class="pic">' + productPic(p) + '</div><div class="body"><h3 style="font-size:18px">' + esc(p.name) + '</h3><span class="price">£' + p.price + '</span></div></a>'; }).join("") + '</div>' +
      '<p style="margin-top:18px"><a href="#shop" class="btn dark small">Visit the Trading Post</a></p></div>' +
      '<div><div class="eyebrow">The Saloon</div><h2 style="margin:8px 0 18px">Latest from riders</h2>' +
      SWT.threads.slice(0, 4).map(function (t) { return '<a class="thread-row" href="#thread/' + t.id + '"><span style="display:flex;gap:10px;align-items:flex-start">' + avatar(t.author) + '<span><b>' + esc(t.title) + '</b><br><span class="muted" style="font-size:14px">' + esc(t.author) + '</span></span></span><span class="mono muted" style="font-size:12px">' + esc(t.when) + '</span></a>'; }).join("") +
      '<p style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap"><a href="#saloon" class="btn dark small">Go to the Saloon</a><a href="#suggest" class="btn ghost small">Suggest a place</a></p></div></div></section>';
  };
  function pictoMap() {
    var img = art("picto-map");
    if (!img) return '<div class="picto">' + SWT.art.picto(SWT.route) + '</div>';
    return '<div class="picto painted"><img src="' + img + '" alt="Illustrated map of central and southern Spain"><div class="ov">' + SWT.art.picto(SWT.route, { mode: "overlay" }) + '</div></div>';
  }
  function installBanner() {
    if (SWT.offline.standalone() && SWT._mapSaved) return "";
    var msg = SWT.offline.standalone() ? "The app is installed. Save the trail now so the map works with no signal." : "Riding it? Put the whole guide on your phone. Once saved it works in flight mode, map included.";
    return '<div class="wrap" style="margin-top:8px"><div class="banner-install"><div style="display:flex;gap:14px;align-items:center">' + SWT.svgIcon("phone", { size: 30 }) + '<span>' + msg + '</span></div><a class="btn small" href="#app">Show me how</a></div></div>';
  }

  pages.guide = function () {
    var stages = SWT.route.stages;
    return banner(art("pg-guide") || "img/art/hero.jpg", "The guide", "Trail guide", "Three areas and eight stages, plus an optional coda to the sea. Distances are for the off-road trail, with the tarmac route alongside.") +
      '<section class="band"><div class="wrap"><div class="grid3">' + ["north", "middle", "south"].map(function (k) { var a = SWT.areas[k]; return '<a class="pcard" href="#area/' + k + '"><div class="pic"><img src="img/art/' + a.art + '.jpg" alt="" loading="lazy"></div><div class="body"><div class="eyebrow">Stages ' + a.stages.join(", ") + '</div><h3>' + a.name + '</h3><p>' + esc(a.short) + '</p></div></a>'; }).join("") + '</div>' +
      '<div class="sec-head" style="margin-top:56px"><div><div class="eyebrow">Day by day</div><h2>The stages</h2></div></div><div class="grid4">' + stages.filter(function (s) { return s.n; }).map(stageCard).join("") + '</div>' +
      '<h3 style="margin:48px 0 10px">Distances</h3><div class="tbl"><table class="simple"><thead><tr><th>Stage</th><th>From and to</th><th>Area</th><th>Trail</th><th>Tarmac</th><th>Climb on the trail</th></tr></thead><tbody>' +
      stages.map(function (s) { var st = SWT.stages[s.n]; return '<tr><td class="mono">' + (s.n || "Coda") + '</td><td><a href="#stage/' + s.n + '">' + esc(st.from) + ' to ' + esc(st.to) + '</a></td><td>' + SWT.areas[st.area].name + '</td><td class="mono">' + (s.trail_km ? Math.round(s.trail_km) + " km" : "–") + '</td><td class="mono">' + Math.round(s.tarmac_km) + ' km</td><td class="mono">' + (s.trail_climb ? s.trail_climb + " m" : "–") + '</td></tr>'; }).join("") +
      '</tbody></table></div></div></section>';
  };
  pages.area = function (k) {
    var a = SWT.areas[k]; if (!a) return notFound();
    var ps = SWT.allPlaces().filter(function (p) { return a.stages.indexOf(p.stage) >= 0 && !p.sample; });
    var ss = a.stages.map(stageOf).concat(k === "south" ? [stageOf(0)] : []);
    return banner("img/art/" + a.art + ".jpg", '<a href="#guide">The guide</a> · ' + esc(a.sub), a.name, esc(a.intro)) +
      '<section class="band"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">Stages</div><h2>Riding ' + a.name + '</h2></div></div><div class="grid4">' + ss.map(stageCard).join("") + '</div>' +
      '<div class="grid2" style="margin-top:48px"><div><h3 style="margin-bottom:8px">What the riding is like</h3><p>' + esc(a.ride) + '</p></div><div><h3 style="margin-bottom:2px">Questions about ' + a.name + '</h3>' +
      a.faq.map(function (q) { return '<details class="faq"><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join("") + '</div></div></div></section>' +
      '<section class="band alt"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">Places</div><h2>Worth stopping for</h2></div><a class="mono" href="#places/' + k + '">Everything in ' + a.name + ', with stays and food →</a></div><div class="grid4">' + ps.map(placeCard).join("") + '</div></div></section>';
  };
  pages.stage = function (n) {
    n = +n; var s = stageOf(n), st = SWT.stages[n]; if (!s) return notFound();
    var ps = SWT.allPlaces().filter(function (p) { return p.stage === n; }).sort(function (a, b) { return locate(a).km - locate(b).km; });
    var real = ps.filter(function (p) { return !p.sample; }), samples = ps.filter(function (p) { return p.sample; });
    var prev = n > 1 ? stageOf(n - 1) : null, next = n && n < 8 ? stageOf(n + 1) : (n === 8 ? stageOf(0) : null);
    return banner(stageImg(n), '<a href="#area/' + st.area + '">' + SWT.areas[st.area].name + '</a> · ' + (n ? "Stage " + n : "Coda"), esc(st.from) + ' to ' + esc(st.to), esc(st.note)) +
      '<section class="band"><div class="wrap grid2"><div><div id="stagemap" class="minimap" style="height:380px"></div><ul class="facts-list" style="margin-top:18px">' +
      (s.trail_km ? '<li><span>Trail</span><span>' + s.trail_km + ' km, ' + s.trail_climb + ' m climb</span></li>' : '') + '<li><span>Tarmac route</span><span>' + s.tarmac_km + ' km, ' + s.tarmac_climb + ' m climb</span></li>' +
      (n ? '<li><span>Along the whole trail</span><span>km ' + Math.round(s.startKm) + ' to ' + Math.round(s.endKm) + '</span></li>' : '') +
      '<li><span>Through</span><span>' + s.waypoints.map(function (w) { return esc(w[2]); }).join(", ") + '</span></li></ul>' +
      '<p style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn dark small" href="#map/' + n + '">Open this stage on the map</a></p>' +
      '<div style="display:flex;justify-content:space-between;margin-top:26px;gap:10px;flex-wrap:wrap" class="mono">' + (prev ? '<a href="#stage/' + prev.n + '">← Stage ' + prev.n + '</a>' : '<span></span>') + (next ? '<a href="#stage/' + next.n + '">' + (next.n ? "Stage " + next.n : "Coda") + ' →</a>' : '<span></span>') + '</div></div>' +
      '<div><h2 style="margin-bottom:14px">On this stage</h2><div class="grid2" style="gap:16px">' + real.map(placeCard).join("") + '</div>' +
      (samples.length ? '<h3 style="margin:30px 0 4px">Stay, eat, coffee, water and fuel</h3><ul class="rows">' + samples.map(placeRow).join("") + '</ul>' : '') + '</div></div></section>';
  };
  pages.places = function (areaKey) {
    var cats = Object.keys(SWT.cats);
    return banner(art("pg-places") || "img/art/south.jpg", "Places", "Places on the trail", "Film locations, odd and abandoned things, waterfalls and views, and somewhere to sleep, eat, get a coffee, water and fuel. Places marked Sample are made up for this demo.") +
      '<section class="band"><div class="wrap"><div class="chips" id="pf-area" style="margin-bottom:10px">' + [["", "Whole trail"], ["north", "The North"], ["middle", "The Middle"], ["south", "The South"]].map(function (a) { return '<button class="chip plain" data-a="' + a[0] + '" aria-pressed="' + ((areaKey || "") === a[0]) + '">' + a[1] + '</button>'; }).join("") + '</div>' +
      '<div class="chips" id="pf-cat">' + cats.map(function (c) { return '<button class="chip" data-c="' + c + '" aria-pressed="true"><i class="sw" style="background:' + SWT.cats[c].color + '"></i>' + SWT.cats[c].label + '</button>'; }).join("") + '</div>' +
      '<div class="grid4" id="pf-cards" style="margin-top:26px"></div><div id="pf-rows-wrap"><h3 style="margin:44px 0 6px">Stay, eat, coffee, water and fuel</h3><ul class="rows" id="pf-list"></ul></div></div></section>';
  };
  function wirePlaces(areaKey) {
    var area = areaKey || "", on = {}; Object.keys(SWT.cats).forEach(function (c) { on[c] = true; });
    function draw() {
      var st = area ? SWT.areas[area].stages.concat(area === "south" ? [0] : []) : null;
      var ps = SWT.allPlaces().filter(function (p) { return on[p.cat] && (!st || st.indexOf(p.stage) >= 0); }).sort(function (a, b) { return (a.stage || 99) - (b.stage || 99) || locate(a).km - locate(b).km; });
      var real = ps.filter(function (p) { return !p.sample; }), samples = ps.filter(function (p) { return p.sample; });
      $("#pf-cards").innerHTML = real.map(placeCard).join("") || '<p class="muted">No landmarks with those filters.</p>';
      $("#pf-list").innerHTML = samples.map(placeRow).join(""); $("#pf-rows-wrap").hidden = !samples.length;
    }
    $$("#pf-area .chip").forEach(function (b) { b.onclick = function () { area = b.getAttribute("data-a"); $$("#pf-area .chip").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); draw(); }; });
    $$("#pf-cat .chip").forEach(function (b) { b.onclick = function () { var c = b.getAttribute("data-c"); on[c] = !on[c]; b.setAttribute("aria-pressed", on[c]); draw(); }; });
    draw();
  }
  pages.place = function (id) {
    var p = place(id); if (!p) return notFound();
    var n = locate(p), st = SWT.stages[p.stage], t = threadFor(p);
    var near = SWT.allPlaces().filter(function (q) { return q.id !== p.id && !q.sample && q.stage === p.stage; }).slice(0, 3);
    return banner(placeImg(p), '<a href="#stage/' + p.stage + '">' + (p.stage ? "Stage " + p.stage : "Coda") + ': ' + esc(st.from) + ' to ' + esc(st.to) + '</a>', esc(p.name), "", "", catPill(p)) +
      '<section class="band"><div class="wrap grid2"><div class="prose">' + (p.sample ? '<p class="note">This is a sample listing made up for the demo. In the real guide it would be a place checked by the authors or approved by the moderators.</p>' : '') +
      '<p class="lede">' + esc(p.blurb) + '</p>' +
      (p.tips && p.tips.length ? '<h3 style="margin:26px 0 10px">Good to know</h3><ul class="tips">' + p.tips.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' : '') +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px"><a class="btn" href="#thread/' + t.id + '">Talk about this place (' + t.posts.length + ')</a><a class="btn ghost" href="https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lon + '" target="_blank" rel="noopener">Directions</a></div></div>' +
      '<div><div id="placemap" class="minimap"></div><ul class="facts-list" style="margin-top:16px"><li><span>Distance from the trail</span><span>' + (n.off < 1 ? "On the trail" : kmFmt(n.off)) + '</span></li>' + (p.stage ? '<li><span>Along the trail</span><span>km ' + Math.round(n.km) + ' of ' + Math.round(SWT.totalKm) + '</span></li>' : '') +
      '<li><span>Position</span><span>' + p.lat.toFixed(4) + ', ' + p.lon.toFixed(4) + '</span></li></ul></div></div></section>' +
      (near.length ? '<section class="band alt"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">Same stage</div><h2>Nearby</h2></div></div><div class="grid3">' + near.map(placeCard).join("") + '</div></div></section>' : '');
  };
  function productPic(p) {
    var a = art(p.art); if (a) return '<img src="' + a + '" alt="" loading="lazy">';
    if (p.art === "foldmap") return SWT.art.foldmap();
    if (p.art === "gpx") return SWT.art.gpx();
    return "";
  }
  function basket() { return store("basket") || []; }
  pages.shop = function () {
    return banner(art("pg-shop") || "img/art/book.jpg", "Trading Post", "The book and the maps", "Everything the authors make for the trail. Prices are samples for this demo and the checkout doesn't take payment.") +
      '<section class="band"><div class="wrap shop-layout"><div class="products">' + SWT.products.map(function (p) {
        return '<div class="pcard product"><div class="pic">' + productPic(p) + '</div><div class="body"><div class="eyebrow">' + esc(p.kind) + '</div><h3>' + esc(p.name) + '</h3><p>' + esc(p.text) + '</p>' +
          (p.options.length ? '<label class="mono" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--soft);margin-top:6px">Size<select id="opt-' + p.id + '">' + p.options.map(function (o, i) { return '<option value="' + i + '">' + esc(o[0]) + ' · £' + o[1] + '</option>'; }).join("") + '</select></label>' : '') +
          '<span class="price" id="price-' + p.id + '" style="margin-top:8px">£' + p.price + '</span><button class="btn" data-add="' + p.id + '">Add to basket</button></div></div>';
      }).join("") + '</div><aside class="side-card basket" id="basket"></aside></div></section>';
  };
  function drawBasket() {
    var b = basket(), el = $("#basket"); if (!el) return;
    var tot = b.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    el.innerHTML = '<h3 style="margin-bottom:8px">Your basket</h3>' + (b.length ? b.map(function (l, i) {
      return '<div class="line"><span>' + esc(l.name) + (l.opt ? '<br><span class="muted" style="font-size:13px">' + esc(l.opt) + '</span>' : '') + '</span><span class="qty"><button data-q="' + i + '" data-d="-1" aria-label="One fewer">−</button><span class="mono">' + l.qty + '</span><button data-q="' + i + '" data-d="1" aria-label="One more">+</button></span></div>';
    }).join("") + '<div class="tot"><span>Total</span><span>£' + tot + '</span></div><a class="btn" style="width:100%" href="#checkout">Checkout</a>' : '<p class="muted">Nothing in it yet.</p>') +
      '<p class="muted" style="font-size:13.5px;margin:12px 0 0">UK postage is free on orders over £40. Maps ship flat or rolled.</p>';
    $$("[data-q]", el).forEach(function (btn) { btn.onclick = function () { var b2 = basket(), i = +btn.getAttribute("data-q"); b2[i].qty += +btn.getAttribute("data-d"); if (b2[i].qty <= 0) b2.splice(i, 1); store("basket", b2); drawBasket(); updateBasketCount(); }; });
  }
  function wireShop() {
    SWT.products.forEach(function (p) { var s = $("#opt-" + p.id); if (s) s.onchange = function () { $("#price-" + p.id).textContent = "£" + p.options[+s.value][1]; }; });
    $$("[data-add]").forEach(function (btn) { btn.onclick = function () {
      var p = SWT.products.filter(function (x) { return x.id === btn.getAttribute("data-add"); })[0], s = $("#opt-" + p.id), opt = s ? p.options[+s.value] : null;
      var b = basket(), key = p.id + (opt ? opt[0] : ""), hit = b.filter(function (l) { return l.key === key; })[0];
      if (hit) hit.qty++; else b.push({ key: key, name: p.name, opt: opt ? opt[0] : "", price: opt ? opt[1] : p.price, qty: 1 });
      store("basket", b); drawBasket(); updateBasketCount(); toast("Added " + p.name);
    }; });
    drawBasket();
  }
  pages.checkout = function () {
    var b = basket(), tot = b.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    return '<div class="wrap page-head"><div class="eyebrow"><a href="#shop">Trading Post</a></div><h1>Checkout</h1></div><div class="wrap grid2" style="padding-bottom:60px"><div class="side-card"><h3>Order</h3>' +
      (b.length ? b.map(function (l) { return '<div class="line" style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--rule)"><span>' + l.qty + ' × ' + esc(l.name) + (l.opt ? " (" + esc(l.opt) + ")" : "") + '</span><span class="mono">£' + l.price * l.qty + '</span></div>'; }).join("") + '<div style="display:flex;justify-content:space-between;font-family:var(--display);font-size:22px;margin-top:14px"><span>Total</span><span>£' + tot + '</span></div>' : '<p class="muted">Your basket is empty.</p>') +
      '</div><div><p class="note"><b>This is a demo checkout.</b> Nothing is charged and no order is placed. In the real site this button would hand over to Stripe or Shopify for payment and delivery, so the trail site never handles card details.</p><p style="margin:18px 0 0"><button class="btn" id="fake-pay"' + (b.length ? '' : ' disabled') + '>Place demo order</button></p></div></div>';
  };

  // ---------- saloon (mock forum) ----------
  function localThreads() { return store("threads") || []; }
  function allThreads() { return localThreads().concat(SWT.threads); }
  function threadFor(p) {
    var t = allThreads().filter(function (x) { return x.place === p.id; })[0];
    if (t) return t;
    return { id: "p-" + p.id, board: "places", place: p.id, title: p.name, author: "Trail moderator", when: "pinned", posts: [["Trail moderator", "Questions, updates and photos about " + p.name + " go here."]] };
  }
  function getThread(id) {
    var t = allThreads().filter(function (x) { return x.id === id; })[0];
    if (!t && id.indexOf("p-") === 0) { var p = place(id.slice(2)); if (p) t = threadFor(p); }
    var extra = (store("replies") || {})[id] || [];
    return t ? Object.assign({}, t, { posts: t.posts.concat(extra) }) : null;
  }
  function boardName(id) { var b = SWT.boards.filter(function (x) { return x.id === id; })[0]; return b ? b.name : "Places"; }
  pages.saloon = function () {
    var q = store("queue") || SWT.suggestionsSeed;
    return banner(art("saloon"), "Community", "The Saloon", "Trail conditions, questions and meet-ups from people riding and walking the trail. Spotted something that should be on the map? Suggest it and the moderators will check it.") +
      '<section class="band"><div class="wrap"><p class="note"><b>This forum is a mock-up.</b> The threads are invented and anything you post stays on this device. A real Saloon would be a hosted forum linked to every place on the map.</p>' +
      '<div class="grid2" style="margin-top:28px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)"><div><h2 style="margin-bottom:10px">Latest</h2>' + allThreads().map(function (t) { var n = t.posts.length + (((store("replies") || {})[t.id]) || []).length; return '<a class="thread-row" href="#thread/' + t.id + '"><span style="display:flex;gap:12px;align-items:flex-start">' + avatar(t.author) + '<span><b>' + esc(t.title) + '</b><br><span class="muted" style="font-size:14px">' + esc(boardName(t.board)) + ' · ' + esc(t.author) + '</span></span></span><span class="mono muted" style="font-size:12px;text-align:right">' + n + ' posts<br>' + esc(t.when) + '</span></a>'; }).join("") +
      '<p style="margin-top:18px"><a class="btn dark small" href="#thread/new">Start a thread</a></p></div>' +
      '<div><div class="side-card"><h3>Suggest a place for the map</h3><p style="font-size:15.5px;margin:8px 0 14px">A viewpoint, a bar that opens early, a fuel stop, an abandoned something. Drop a pin, say what it is, and the moderators will check it before it goes on the map for everyone.</p><a class="btn" href="#suggest">Suggest a place</a></div>' +
      '<h3 style="margin:28px 0 6px">Boards</h3><ul class="rows">' + SWT.boards.map(function (b) { return '<li><a href="#board/' + b.id + '" style="grid-template-columns:minmax(0,1fr) auto"><span><b>' + esc(b.name) + '</b><br><span class="sub">' + esc(b.text) + '</span></span><span class="mono muted">→</span></a></li>'; }).join("") + '</ul>' +
      '<p style="margin-top:18px" class="mono"><a href="#moderate">Moderator queue (' + q.length + ' waiting) →</a></p></div></div></div></section>';
  };
  pages.board = function (id) {
    var b = SWT.boards.filter(function (x) { return x.id === id; })[0]; if (!b) return notFound();
    var ts = allThreads().filter(function (t) { return t.board === id; });
    if (id === "places") ts = SWT.allPlaces().filter(function (p) { return !p.sample; }).map(threadFor);
    return '<div class="wrap page-head"><div class="eyebrow"><a href="#saloon">The Saloon</a></div><h1>' + esc(b.name) + '</h1><p>' + esc(b.text) + '</p></div><div class="wrap prose" style="padding-bottom:60px">' +
      (ts.map(function (t) { return '<a class="thread-row" href="#thread/' + t.id + '"><span><b>' + esc(t.title) + '</b></span><span class="mono muted" style="font-size:12px">' + esc(t.when) + '</span></a>'; }).join("") || '<p class="muted">No threads yet.</p>') + '</div>';
  };
  pages.thread = function (id) {
    if (id === "new") return '<div class="wrap page-head"><div class="eyebrow"><a href="#saloon">The Saloon</a></div><h1>Start a thread</h1></div><div class="wrap prose" style="padding-bottom:60px"><form class="stack" id="new-thread"><label>Board<select id="nt-board">' + SWT.boards.filter(function (b) { return b.id !== "places"; }).map(function (b) { return '<option value="' + b.id + '">' + esc(b.name) + '</option>'; }).join("") + '</select></label><label>Title<input id="nt-title" required maxlength="120"></label><label>Your name<input id="nt-name" required maxlength="40" value="' + esc(store("name") || "") + '"></label><label>Message<textarea id="nt-body" required></textarea></label><button class="btn" type="submit" style="align-self:flex-start">Post thread</button></form></div>';
    var t = getThread(id); if (!t) return notFound();
    var p = t.place ? place(t.place) : null;
    var head = p ? banner(placeImg(p), '<a href="#saloon">The Saloon</a> · Places', esc(t.title), '<a href="#place/' + p.id + '" style="color:#f3d7ad">Read about ' + esc(p.name) + ' in the guide →</a>', "short")
      : '<div class="wrap page-head"><div class="eyebrow"><a href="#saloon">The Saloon</a> · <a href="#board/' + t.board + '">' + esc(boardName(t.board)) + '</a></div><h1 style="font-size:clamp(28px,4.5vw,44px)">' + esc(t.title) + '</h1>' + (t.stage ? '<p><a href="#stage/' + t.stage + '">Stage ' + t.stage + ' in the guide →</a></p>' : '') + '</div>';
    return head + '<div class="wrap prose" style="padding-block:20px 60px">' + t.posts.map(function (x) { return '<div class="post"><div class="who">' + avatar(x[0]) + '<b>' + esc(x[0]) + '</b>' + (x[2] ? ' · ' + esc(x[2]) : '') + '</div>' + esc(x[1]) + '</div>'; }).join("") +
      '<form class="stack" id="reply" style="margin-top:28px"><label>Your name<input id="r-name" required maxlength="40" value="' + esc(store("name") || "") + '"></label><label>Reply<textarea id="r-body" required></textarea></label><button class="btn" type="submit" style="align-self:flex-start">Post reply</button>' + (navigator.onLine ? '' : '<p class="muted" style="font-size:14px;margin:0">You have no signal. In the real Saloon your reply would wait and send when you\'re back online.</p>') + '</form></div>';
  };
  function wireThread(id) {
    var f = $("#reply");
    if (f) f.onsubmit = function (e) { e.preventDefault(); var name = $("#r-name").value.trim(), body = $("#r-body").value.trim(); if (!name || !body) return; store("name", name); var r = store("replies") || {}; (r[id] = r[id] || []).push([name, body, "just now"]); store("replies", r); toast("Reply posted"); render(); };
    var n = $("#new-thread");
    if (n) n.onsubmit = function (e) { e.preventDefault(); var t = { id: "u" + Date.now(), board: $("#nt-board").value, title: $("#nt-title").value.trim(), author: $("#nt-name").value.trim(), when: "just now", posts: [[$("#nt-name").value.trim(), $("#nt-body").value.trim(), "just now"]] }; store("name", t.author); var l = localThreads(); l.unshift(t); store("threads", l); location.hash = "#thread/" + t.id; };
  }
  var pickMap = null;
  pages.suggest = function () {
    return '<div class="wrap page-head"><div class="eyebrow"><a href="#saloon">The Saloon</a></div><h1>Suggest a place</h1><p>Tap the map where it is, then tell us what it is. The moderators check every suggestion before it goes on the map.</p></div>' +
      '<div class="wrap grid2" style="padding-bottom:60px"><div><div id="pickmap" class="pick-map"></div><p class="mono muted" style="font-size:13px;margin-top:8px" id="pick-at">No pin yet. Tap the map.</p></div>' +
      '<form class="stack" id="suggest-form"><label>What is it called?<input id="sg-name" required maxlength="80"></label><label>What kind of place<select id="sg-cat">' + Object.keys(SWT.cats).map(function (c) { return '<option value="' + c + '">' + SWT.cats[c].label + '</option>'; }).join("") + '</select></label><label>Why should riders stop?<textarea id="sg-text" required></textarea></label><label>Your name<input id="sg-by" required maxlength="40" value="' + esc(store("name") || "") + '"></label><button class="btn" type="submit" style="align-self:flex-start">Send to the moderators</button></form></div>';
  };
  function wireSuggest() {
    var at = null, marker = null;
    SWT.map.create($("#pickmap"), { controls: false, interactive: false, cooperative: true, onLoad: function (m) {
      m.on("click", function (e) { at = e.lngLat; $("#pick-at").textContent = "Pin at " + at.lat.toFixed(4) + ", " + at.lng.toFixed(4); if (marker) marker.setLngLat(at); else marker = new maplibregl.Marker({ color: "#a3262a" }).setLngLat(at).addTo(m); });
    } }).then(function (m) { pickMap = m; });
    $("#suggest-form").onsubmit = function (e) {
      e.preventDefault(); if (!at) { toast("Tap the map to place the pin first"); return; }
      var near = 1e9, stg = 1; TRAIL.forEach(function (p, i) { var d = hav([at.lng, at.lat], p); if (d < near) { near = d; stg = stageAtKm(TRAIL_KM[i]); } });
      var q = store("queue") || SWT.suggestionsSeed.slice(); q.push({ id: "sg" + Date.now(), name: $("#sg-name").value.trim(), cat: $("#sg-cat").value, lat: at.lat, lon: at.lng, by: $("#sg-by").value.trim(), text: $("#sg-text").value.trim(), stage: stg });
      store("queue", q); store("name", $("#sg-by").value.trim()); toast("Sent to the moderators"); location.hash = "#moderate";
    };
  }
  function stageAtKm(k) { var s = SWT.route.stages.filter(function (x) { return x.n && k >= x.startKm && k <= x.endKm + .01; })[0]; return s ? s.n : 1; }
  var CAT_ICON = { film: "saloon", odd: "block", beauty: "peak", stay: "bed", eat: "eat", coffee: "coffee", wc: "wc", fuel: "fuel" };
  pages.moderate = function () {
    var q = store("queue") || SWT.suggestionsSeed;
    return '<div class="wrap page-head"><div class="eyebrow"><a href="#saloon">The Saloon</a></div><h1>Moderator queue</h1><p>Suggestions from riders wait here until a moderator checks them. Approving one puts it on the map and in the guide straight away, and it reaches phones with the next offline update.</p></div>' +
      '<div class="wrap prose" style="padding-bottom:60px"><p class="note">In this demo anyone can see the queue and approve things, and approvals only show on this device. In the real site only moderators would see this page.</p>' +
      (q.length ? q.map(function (s, i) { return '<div class="side-card queue-item"><div style="display:flex;gap:6px;flex-wrap:wrap">' + catPill({ cat: s.cat }) + ' <span class="pill sample">Stage ' + s.stage + '</span></div><h3 style="margin:10px 0 4px">' + esc(s.name) + '</h3><p style="margin:0 0 6px">' + esc(s.text) + '</p><div class="mono muted" style="font-size:13px">Suggested by ' + esc(s.by) + ' · ' + s.lat.toFixed(4) + ', ' + s.lon.toFixed(4) + '</div><div class="acts"><button class="btn small" data-ok="' + i + '">Approve and add to map</button><button class="btn ghost small" data-no="' + i + '">Reject</button></div></div>'; }).join("") : '<p class="muted">The queue is empty.</p>') +
      (SWT.community().length ? '<h3 style="margin:30px 0 6px">Added by the community</h3><ul class="rows">' + SWT.community().map(placeRow).join("") + '</ul><p style="margin-top:12px"><button class="btn ghost small" id="reset-community">Remove community places from this device</button></p>' : '') + '</div>';
  };
  function wireModerate() {
    $$("[data-ok]").forEach(function (b) { b.onclick = function () {
      var q = store("queue") || SWT.suggestionsSeed.slice(), s = q.splice(+b.getAttribute("data-ok"), 1)[0];
      var a = SWT.community(); a.push({ id: "c-" + s.id, name: s.name, cat: s.cat, icon: CAT_ICON[s.cat], lat: s.lat, lon: s.lon, stage: s.stage, community: true, blurb: s.text, tips: ["Suggested by " + s.by + " and approved by a moderator"] });
      store("approved", a); store("queue", q); SWT.map.refreshPlaces(SWT.mainMap); toast("Approved. It's on the map now."); render();
    }; });
    $$("[data-no]").forEach(function (b) { b.onclick = function () { var q = store("queue") || SWT.suggestionsSeed.slice(); q.splice(+b.getAttribute("data-no"), 1); store("queue", q); toast("Rejected"); render(); }; });
    var r = $("#reset-community"); if (r) r.onclick = function () { store("approved", []); store("queue", null); SWT.map.refreshPlaces(SWT.mainMap); render(); };
  }

  // ---------- install and offline ----------
  var IOS_SHARE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';
  var ADD_SQ = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="vertical-align:-4px"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
  var DOTS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="vertical-align:-3px"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  function phoneFrame(inner) { return '<svg viewBox="0 0 160 220"><rect x="20" y="4" width="120" height="212" rx="16" fill="#fffdf8" stroke="#26292c" stroke-width="3"/>' + inner + '</svg>'; }
  var HOWTO = {
    iphone: { name: "iPhone", steps: [
      ["Open this page in Safari, then tap the Share button " + IOS_SHARE + " at the bottom of the screen.", phoneFrame('<rect x="30" y="20" width="100" height="150" fill="#f2ebdd"/><rect x="30" y="176" width="100" height="26" fill="#faf6ee"/><g transform="translate(68 177)" fill="none" stroke="#c9661d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></g><circle cx="80" cy="189" r="16" fill="none" stroke="#a3262a" stroke-width="2.5"/>')],
      ["Scroll down and tap Add to Home Screen " + ADD_SQ + ". If it isn't there, tap Edit Actions and add it.", phoneFrame('<rect x="30" y="20" width="100" height="60" fill="#f2ebdd"/><rect x="30" y="86" width="100" height="116" fill="#faf6ee"/>' + [0, 1, 2, 3].map(function (i) { return '<rect x="36" y="' + (94 + i * 26) + '" width="88" height="20" rx="3" fill="' + (i === 2 ? '#e0892a' : '#f2ebdd') + '"/>'; }).join("") + '<text x="42" y="' + (94 + 2 * 26 + 14) + '" font-family="Courier Prime,monospace" font-size="9" fill="#241a0f">Add to Home Screen</text>')],
      ["Tap Add in the top corner. The trail's icon appears on your home screen.", phoneFrame('<rect x="30" y="20" width="100" height="182" fill="#faf6ee"/><rect x="102" y="26" width="24" height="13" rx="3" fill="#e0892a"/><text x="105" y="36" font-family="Courier Prime,monospace" font-size="9" fill="#241a0f">Add</text><image href="img/icons/icon-192.png" x="62" y="70" width="36" height="36"/><text x="80" y="122" text-anchor="middle" font-family="Courier Prime,monospace" font-size="9" fill="#26292c">SW Trail</text>')],
      ["Open the trail from the new icon, not from Safari, then save the trail in step 2. On iPhone the home-screen app keeps its own storage, so anything saved in Safari doesn't carry over.", phoneFrame('<rect x="30" y="20" width="100" height="182" fill="#e6dbc2"/>' + [0, 1, 2, 3, 4, 5].map(function (i) { var x = 40 + (i % 3) * 28, y = 34 + Math.floor(i / 3) * 34; return i === 4 ? '<image href="img/icons/icon-192.png" x="' + x + '" y="' + y + '" width="22" height="22"/>' : '<rect x="' + x + '" y="' + y + '" width="22" height="22" rx="5" fill="#d2c6ae"/>'; }).join("") + '<circle cx="79" cy="79" r="17" fill="none" stroke="#a3262a" stroke-width="2.5"/>')]
    ] },
    android: { name: "Android", steps: [
      ["In Chrome, tap Install app when it pops up, or use the Install button on this page.", null],
      ["If nothing pops up, tap the menu " + DOTS + " at the top right, then Install app or Add to Home screen.", phoneFrame('<rect x="30" y="20" width="100" height="20" fill="#faf6ee"/><g transform="translate(116 22)" fill="#26292c"><circle cx="4" cy="3" r="1.6"/><circle cx="4" cy="8" r="1.6"/><circle cx="4" cy="13" r="1.6"/></g><circle cx="120" cy="30" r="11" fill="none" stroke="#a3262a" stroke-width="2.5"/><rect x="62" y="44" width="68" height="110" fill="#fffdf8" stroke="#d2c6ae"/>' + [0, 1, 2, 3].map(function (i) { return '<rect x="66" y="' + (50 + i * 24) + '" width="60" height="18" rx="3" fill="' + (i === 2 ? '#e0892a' : '#f2ebdd') + '"/>'; }).join("") + '<text x="69" y="' + (50 + 48 + 12) + '" font-family="Courier Prime,monospace" font-size="8" fill="#241a0f">Install app</text>')],
      ["Tap Install. The icon goes on your home screen and the trail opens full screen like any other app.", null]
    ] },
    desktop: { name: "Computer", steps: [
      ["In Chrome or Edge, click the install icon at the right of the address bar, or use the Install button on this page.", null],
      ["In Safari on a Mac, choose File, then Add to Dock.", null],
      ["Firefox can't install sites as apps, but the trail still saves for offline use in the browser.", null]
    ] }
  };
  pages.app = function () {
    var plat = SWT._plat || SWT.offline.platform(), h = HOWTO[plat], mb = Math.round((SWT.MAP_BYTES || 73e6) / 1e6);
    return banner(art("pg-app") || "img/art/hero.jpg", "Get the app", "Put the trail on your phone", "Once it's saved, the map, every place and the guide all work with no signal. Do it at home on Wi-Fi before you leave.") +
      '<section class="band"><div class="wrap steps" style="max-width:980px">' +
      '<div class="side-card step"><div class="num">1</div><div><h3>Add it to your home screen</h3>' +
        (SWT.offline.standalone() ? '<p><b>Done.</b> You\'re using the installed app.</p>' :
        '<div class="platform-tabs" role="tablist">' + Object.keys(HOWTO).map(function (k) { return '<button data-plat="' + k + '" class="' + (k === plat ? "on" : "") + '" role="tab" aria-selected="' + (k === plat) + '">' + HOWTO[k].name + '</button>'; }).join("") + '</div>' +
        (SWT.offline.deferredPrompt && plat !== "iphone" ? '<p style="margin-top:10px"><button class="btn" id="install-now">Install the app</button></p>' : '') +
        (plat === "iphone" && SWT.offline.isIOSNotSafari ? '<p class="note">You\'re in another browser on iPhone. Chrome and Firefox on iPhone can add it too, from their Share button, but Safari is the most reliable.</p>' : '') +
        '<div class="how">' + h.steps.map(function (s, i) { return '<figure>' + (s[1] || '') + '<figcaption><b>' + (i + 1) + '.</b> ' + s[0] + '</figcaption></figure>'; }).join("") + '</div>') +
      '</div></div>' +
      '<div class="side-card step"><div class="num">2</div><div><h3>Save the trail for no signal</h3><p>This downloads the map of the whole corridor and an overview of Spain, and keeps them on the phone with the guide, the places and the pictures. It takes a couple of minutes on Wi-Fi and uses about ' + (Math.round((SWT.MAP_BYTES || 73e6) / 1e6) + 14) + ' MB in all.' + (SWT.offline.isIOS && !SWT.offline.standalone() ? ' <b>On an iPhone, do this from the home-screen app (step 1), not in Safari.</b>' : '') + '</p>' +
        '<div id="save-box"></div></div></div>' +
      '<div class="side-card step"><div class="num">3</div><div><h3>Test it before you go</h3><ol style="margin:0;padding-left:20px"><li>Close the app completely.</li><li>Turn on flight mode.</li><li>Open the trail from its icon.</li><li>Zoom in on a stage and check you can see roads and tracks, then tap a place and check it opens.</li></ol><p style="margin-top:12px">While you\'re offline the badge at the top says <span class="net off">No signal</span>. The Saloon and the shop need signal, everything else doesn\'t.</p></div></div>' +
      '<div class="side-card step"><div class="num">4</div><div><h3>Keep it up to date</h3><p>When the guide changes, the app picks up the new version the next time you open it with signal. You only need to save the map again if this page says there\'s a newer one.</p><p class="muted" style="font-size:15px;margin:0">A phone can clear saved websites if it runs very short of space. Open this page before a trip and it will tell you if anything has gone.</p></div></div>' +
      '</div></section>';
  };
  function drawSaveBox() {
    var box = $("#save-box"); if (!box) return;
    SWT.offline.check().then(function (c) {
      var ok = c.map && c.shell === c.shellTotal, mb = Math.round((SWT.MAP_BYTES || 73e6) / 1e6);
      box.innerHTML = '<ul class="checks">' +
        '<li><span>App pages, pictures and fonts</span><span class="' + (c.shell === c.shellTotal ? "ok" : "no") + '">' + (c.shell === c.shellTotal ? "Saved" : c.shell + " of " + c.shellTotal) + '</span></li>' +
        '<li><span>Maps of the trail and of Spain</span><span class="' + (c.map ? "ok" : "no") + '">' + (c.map ? "Saved, " + SWT.offline.mb(c.mapBytes) : "Not saved") + '</span></li>' +
        '<li><span>Protected from automatic clearing</span><span class="' + (c.persisted ? "ok" : "mono muted") + '">' + (c.persisted ? "Yes" : c.persisted === false ? "Not granted" : "Unknown") + '</span></li>' +
        (c.usage != null ? '<li><span>Space used on this device</span><span class="mono">' + SWT.offline.mb(c.usage) + '</span></li>' : '') + '</ul>' +
        '<div class="meter" id="save-meter" ' + (SWT.offline.saving ? "" : "hidden") + '><i></i></div><p class="mono muted" id="save-msg" style="font-size:13px;min-height:1em"></p>' +
        (ok ? '<p><b>Everything is on this device.</b> You can ride with no signal.</p><p style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost small" id="save-again">Save the map again</button><button class="btn ghost small" id="remove-map">Remove the saved map</button></p>' :
          '<p><button class="btn" id="save-now"' + (navigator.onLine && !SWT.offline.saving ? "" : " disabled") + '>' + (SWT.offline.saving ? "Saving…" : "Save the trail (" + mb + " MB)") + '</button></p>' + (navigator.onLine ? '' : '<p class="muted">You need signal to save the trail.</p>'));
      var go = function () {
        var m = $("#save-meter"), msg = $("#save-msg"); m.hidden = false;
        SWT.offline.saveMap(function (got, tot) { if (tot) $("#save-meter i").style.width = Math.min(100, got / tot * 100) + "%"; msg.textContent = "Downloading " + SWT.offline.mb(got) + (tot ? " of " + SWT.offline.mb(tot) : ""); })
          .then(function () { SWT._mapSaved = true; toast("Saved. The trail works with no signal now."); resetMainMap(); drawSaveBox(); })
          .catch(function (e) { msg.textContent = e.message || "Saving failed. Try again on Wi-Fi."; drawSaveBox(); });
      };
      var b = $("#save-now"); if (b) b.onclick = go;
      var a = $("#save-again"); if (a) a.onclick = go;
      var r = $("#remove-map"); if (r) r.onclick = function () { SWT.offline.removeMap().then(function () { SWT._mapSaved = false; resetMainMap(); drawSaveBox(); }); };
    });
  }
  function wireApp() {
    $$("[data-plat]").forEach(function (b) { b.onclick = function () { SWT._plat = b.getAttribute("data-plat"); render(); }; });
    var i = $("#install-now"); if (i) i.onclick = function () { SWT.offline.promptInstall().then(function (ok) { if (ok) toast("Installed"); render(); }); };
    drawSaveBox();
  }

  pages.faq = function () {
    return banner(art("pg-faq") || "img/art/saloon.jpg", "FAQ", "Questions", "General questions about the trail first, then each area's own.") +
      '<section class="band"><div class="wrap grid2"><div><h2 style="margin-bottom:6px">The trail</h2>' +
      SWT.faq.map(function (q) { return '<details class="faq"><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join("") + '</div><div style="display:grid;gap:28px">' +
      ["north", "middle", "south"].map(function (k) { var a = SWT.areas[k]; return '<div><a href="#area/' + k + '" style="display:flex;gap:14px;align-items:center;text-decoration:none"><img src="img/art/' + a.art + '.jpg" alt="" style="width:88px;height:58px;object-fit:cover;border-radius:3px"><h3 style="font-size:24px">' + a.name + '</h3></a>' + a.faq.map(function (q) { return '<details class="faq"><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join("") + '</div>'; }).join("") + '</div></div></section>';
  };
  pages.about = function () {
    var mb = Math.round((SWT.MAP_BYTES || 73e6) / 1e6);
    return banner(art("pg-about") || "img/art/wallmap.jpg", "About this demo", "How this was put together", "This is a concept demo of what the Spaghetti Western Trail's website and app could look like. It isn't the official site and isn't connected to it.") +
      '<section class="band"><div class="wrap grid2"><div class="prose"><h3 style="margin-bottom:8px">What is real and what is made up</h3><ul><li>The route line is invented. It follows the general direction of the trail\'s hand-drawn map from Sad Hill to Tabernas and comes out at about ' + Math.round(SWT.totalKm) + ' km. The real trail is 800 km.</li><li>Landmarks such as Sad Hill, Gormaz and Calar Alto are real places in their real positions. Places to stay, eat, get coffee, water and fuel are invented and marked Sample.</li><li>Shop prices, forum threads and usernames are invented.</li><li>The pictures are generated illustrations in the style of a 1960s western poster, not photographs.</li></ul></div>' +
      '<div class="prose"><h3 style="margin-bottom:8px">How it works</h3><ul><li>It is one website that installs on a phone as an app (a progressive web app), so there\'s no App Store or Play Store, and one set of content serves the website and the app.</li><li>The map is drawn on the phone from two map files (' + mb + ' MB together) made from OpenStreetMap data with Protomaps: a detailed one of the trail corridor and a light one of Spain. It is displayed with MapLibre and needs no signal once saved.</li><li>The phone keeps the app\'s pages, pictures and fonts automatically. The "Save the trail" button downloads the maps and checks everything is there.</li><li>A real Saloon would be a hosted forum, linked from every place. Discourse has a free plan, or it can be self-hosted for a few pounds a month. Suggested places would go through a moderation queue, as in the demo, so the map only shows checked places.</li></ul><p class="muted" style="font-size:14px">Map data © OpenStreetMap contributors. Map tiles by Protomaps. Route lines worked out with BRouter.</p></div></div></section>';
  };
  function notFound() { return '<div class="wrap page-head"><h1>Not here</h1><p>That page doesn\'t exist. <a href="#home">Go to the start</a>.</p></div>'; }

  // ---------- map page ----------
  SWT.mainMap = null;
  function resetMainMap() { if (SWT.mainMap) { SWT.mainMap.remove(); SWT.mainMap = null; $("#map").innerHTML = ""; } if (current.split("/")[0] === "map") showMap(SWT.map.stage); }
  function drawSide() {
    var side = $("#map-side"), counts = {};
    SWT.allPlaces().forEach(function (p) { counts[p.cat] = (counts[p.cat] || 0) + 1; });
    side.innerHTML = '<button class="grab" aria-label="Close"></button><div class="eyebrow">The map</div><h2 style="margin:4px 0 6px">Sad Hill to Tabernas</h2><p class="muted" style="font-size:15px;margin:0">' + Math.round(SWT.totalKm) + ' km of trail in eight stages. Tap a stage to zoom to it, or a picture on the map to read about a place.</p>' +
      '<div class="map-legend" style="margin-top:14px"><span><i style="width:26px;border-top:4px dashed var(--trail)"></i>Trail (off-road)</span><span><i style="width:26px;border-top:3px solid var(--tarmac)"></i>Tarmac route</span></div>' +
      '<h4>Stages</h4><div id="side-stages"><button class="stage-row' + (SWT.map.stage == null ? " on" : "") + '" data-st="all"><span class="th"><img src="img/art/hero.jpg" alt=""></span><span class="t"><b>Whole trail</b></span><span class="km">' + Math.round(SWT.totalKm) + ' km</span></button>' +
      SWT.route.stages.map(function (s) { var st = SWT.stages[s.n]; return '<button class="stage-row' + (SWT.map.stage === s.n ? " on" : "") + '" data-st="' + s.n + '"><span class="th"><img src="' + stageImg(s.n) + '" alt="" loading="lazy"><b>' + (s.n || "+") + '</b></span><span class="t">' + esc(st.from) + ' to ' + esc(st.to) + '</span><span class="km">' + Math.round(s.trail_km || s.tarmac_km) + ' km</span></button>'; }).join("") + '</div>' +
      '<h4>Show on the map</h4><div id="side-cats">' + Object.keys(SWT.cats).map(function (c) { var p = SWT.places.filter(function (x) { return x.cat === c; })[0]; return '<button class="cat-row" data-cat="' + c + '" aria-pressed="' + !!SWT.map.visibleCats[c] + '">' + SWT.badgeSvg(p ? p.icon : "star", SWT.cats[c].color, 28) + '<span>' + SWT.cats[c].label + '</span><span class="count">' + (counts[c] || 0) + '</span><span class="switch"></span></button>'; }).join("") + '</div>';
    $$("#side-cats .cat-row").forEach(function (b) { b.onclick = function () { var c = b.getAttribute("data-cat"); SWT.map.visibleCats[c] = !SWT.map.visibleCats[c]; b.setAttribute("aria-pressed", !!SWT.map.visibleCats[c]); SWT.map.applyFilter(SWT.mainMap); }; });
    $$("#side-stages .stage-row").forEach(function (b) { b.onclick = function () { var v = b.getAttribute("data-st"); history.replaceState(null, "", v === "all" ? "#map" : "#map/" + v); zoomStage(v === "all" ? null : +v); side.classList.remove("open"); }; });
    $(".grab", side).onclick = function () { side.classList.remove("open"); };
  }
  function showMap(stageN) {
    mapview.hidden = false; view.hidden = true; $("footer.site").hidden = true;
    drawSide();
    $("#open-filters").onclick = function () { var s = $("#map-side"); s.classList.add("open"); $("#side-cats").scrollIntoView({ block: "start" }); };
    $("#open-stages").onclick = function () { var s = $("#map-side"); s.classList.add("open"); s.scrollTop = 0; };
    function after(m) { setTimeout(function () { m.resize(); zoomStage(stageN); }, 30); }
    if (SWT.mainMap) after(SWT.mainMap);
    else SWT.map.create($("#map"), { onLoad: function (m) { after(m); } }).then(function (m) { SWT.mainMap = m; drawMapStatus(); });
    drawMapStatus();
  }
  function zoomStage(n) {
    if (n != null && isNaN(n)) n = null;
    SWT.map.stage = n; var m = SWT.mainMap;
    $$("#side-stages .stage-row").forEach(function (b) { b.classList.toggle("on", String(n == null ? "all" : n) === b.getAttribute("data-st")); });
    if (!m) return;
    SWT.map.applyFilter(m);
    var wide = window.innerWidth > 900;
    m.fitBounds(SWT.map.bounds(n), { padding: wide ? { top: 60, bottom: 50, left: 50, right: 60 } : { top: 60, bottom: 60, left: 24, right: 24 }, duration: 700 });
  }
  function drawMapStatus() {
    var el = $("#map-status");
    SWT.offline.mapSaved().then(function (saved) {
      SWT._mapSaved = saved;
      el.innerHTML = saved ? "✓ Map saved on this device" : (navigator.onLine ? 'Streaming map · <a href="#app">Save for no signal</a>' : 'No signal and the map isn\'t saved · <a href="#app">How to save it</a>');
    });
  }
  SWT.map.onPick = function (id) {
    var p = place(id); if (!p) return; var n = locate(p), sh = $("#sheet"), img = placeImg(p);
    sh.hidden = false;
    sh.innerHTML = '<button class="x" aria-label="Close">×</button>' + (img ? '<div class="pic"><img src="' + img + '" alt=""></div>' : '') + '<div class="in"><div style="display:flex;gap:6px;flex-wrap:wrap">' + catPill(p) + '</div><h3>' + esc(p.name) + '</h3><p>' + esc(p.blurb.length > 170 ? p.blurb.slice(0, 167).replace(/\s\S*$/, "") + "…" : p.blurb) + '</p><div class="mono muted" style="font-size:12.5px;margin-bottom:12px">' + (p.stage ? "Stage " + p.stage + " · km " + Math.round(n.km) + " · " : "Coda · ") + (n.off < 1 ? "on the trail" : kmFmt(n.off) + " off the trail") + '</div><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn small" href="#place/' + p.id + '">Read more</a><a class="btn ghost small" href="#thread/' + threadFor(p).id + '">Talk about it</a></div></div>';
    $(".x", sh).onclick = function () { sh.hidden = true; };
  };

  // ---------- router ----------
  var current = "", subMap = null;
  function render() {
    var h = (location.hash || "#home").slice(1) || "home"; current = h;
    var parts = h.split("/"), key = parts[0], arg = parts.slice(1).join("/");
    setNav(h); $("#sheet").hidden = true;
    if (subMap) { subMap.remove(); subMap = null; }
    if (pickMap) { pickMap.remove(); pickMap = null; }
    if (key === "map") { showMap(arg === "" ? null : +arg); document.title = "Map · The Spaghetti Western Trail"; return; }
    mapview.hidden = true; view.hidden = false; $("footer.site").hidden = false;
    var fn = pages[key] || notFound;
    view.innerHTML = fn(arg);
    var titles = { home: "", guide: "Guide", area: SWT.areas[arg] ? SWT.areas[arg].name : "", stage: "Stage " + arg, places: "Places", place: place(arg) ? place(arg).name : "", shop: "Trading Post", checkout: "Checkout", saloon: "The Saloon", thread: "The Saloon", board: "The Saloon", suggest: "Suggest a place", moderate: "Moderator queue", app: "Get the app", faq: "FAQ", about: "About this demo" };
    document.title = (titles[key] ? titles[key] + " · " : "") + "The Spaghetti Western Trail";
    window.scrollTo(0, 0);
    if (key === "places") wirePlaces(arg);
    if (key === "shop") wireShop();
    if (key === "checkout") { var fp = $("#fake-pay"); if (fp) fp.onclick = function () { store("basket", []); updateBasketCount(); view.innerHTML = '<div class="wrap page-head"><div class="eyebrow">Trading Post</div><h1>Demo order placed</h1><p>Nothing was charged. In the real shop you\'d get an email with tracking.</p><p><a class="btn" href="#home">Back to the trail</a></p></div>'; }; }
    if (key === "thread") wireThread(arg);
    if (key === "suggest") wireSuggest();
    if (key === "moderate") wireModerate();
    if (key === "app") wireApp();
    if (key === "place") { var p = place(arg); if (p) SWT.map.create($("#placemap"), { center: [p.lon, p.lat], zoom: 12.2, controls: false, cooperative: true }).then(function (m) { subMap = m; m.on("load", function () { new maplibregl.Marker({ color: SWT.cats[p.cat].color }).setLngLat([p.lon, p.lat]).addTo(m); }); }); }
    if (key === "stage") { var s = stageOf(+arg); if (s) SWT.map.create($("#stagemap"), { controls: false, cooperative: true }).then(function (m) { subMap = m; m.on("load", function () { m.fitBounds(SWT.map.bounds(+arg), { padding: 24, duration: 0 }); }); }); }
  }
  function updateBasketCount() { var n = basket().reduce(function (s, l) { return s + l.qty; }, 0); $$(".basket-count").forEach(function (e) { e.textContent = n ? " (" + n + ")" : ""; }); }
  SWT.offline.onChange(function () { netBadge(); if (current === "app") drawSaveBox(); if (current.split("/")[0] === "map") drawMapStatus(); });

  // ---------- boot ----------
  fetch("data/route.json").then(function (r) { return r.json(); }).then(function (route) {
    SWT.route = route; prepRoute();
    netBadge(); updateBasketCount();
    SWT.offline.mapSaved().then(function (s) { SWT._mapSaved = s; window.addEventListener("hashchange", render); render(); });
  }).catch(function () { view.innerHTML = '<div class="wrap page-head"><h1>Couldn\'t load the trail</h1><p>Check your connection and reload. If you saved the trail before, open it from its icon on your home screen.</p></div>'; });
})();
