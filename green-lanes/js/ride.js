/* ---------- Ride this route: a light riding view ----------
   Where you are on the route, the next lane and how far to it, the next stop and fuel, what's ridden and what's left,
   and a warning when you leave the route. It is a help, not a sat nav: a web page only follows you while the screen is
   on and the page is open, and it gives no spoken directions. The GPX in a sat nav or GPS app stays the main way to
   follow the route; the ride screen says so when it opens.
   Until you're on the route (you open it at home, or on the way there) it shows the whole route and where you are,
   with the distance to the route, instead of zooming to you and losing the route off the screen. */
const Ride = (() => {
  const OFF_M = 60, OFF_S = 10, AHEAD_M = 6000, BEHIND_M = 400, JOIN_M = 150, WAY_KM = 80;
  let toStartSaid = false;
  let peak = 0, wrongSaid = 0;   // the furthest along you've been, and when the wrong-way warning was last given
  let on = false, line = [], cum = [], lanes = [], places = [], planned = [], total = 0, along = 0, watch = null, lock = null, follow = true, joined = false;
  let offSince = null, lastFix = null, heading = null, practice = null, backLine = null, zoomBefore = null, msgTimer = null, toStartShown = false;
  const layer = L.layerGroup(), me = L.marker([0, 0], { interactive: false, zIndexOffset: 2000, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="ride-me"><i></i></div>` }) });
  const ridden = L.polyline([], { color: "#6b6b6b", weight: 7, opacity: .85, interactive: false, renderer: routeRenderer });

  // the route as one line, with the distance along it at every point (the same measure the stops list uses)
  // a lane's name as the ride screen shows it: council records lose the council's name (the number is what
  // differs), and an unnamed lane says what it is and how long
  const rideName = it => { const n = it?.name || "Lane";
    if (/^Unnamed/.test(n)) return `${it.kind || "Lane"}, ${kmTxt(lineLen(it.coords) / (it.there ? 2 : 1))}${it.there ? " each way" : ""}`;
    return n.replace(/^[A-Z][A-Za-z' -]+? byway (?=\S)/, "Byway "); };
  function prepare(b, t){
    line = []; cum = []; lanes = []; let d = 0;
    for (const s of b.segs) {
      if (s.type === "lane") lanes.push({ at: d, name: rideName(t.items[s.i]), kind: t.items[s.i]?.kind || "", len: lineLen(s.coords) });
      else if (s.lanes && lineLen(s.coords) > 200) lanes.push({ at: d, name: "Lanes joining up", kind: "", len: lineLen(s.coords) });   // a join along other lanes is lane riding too
      for (const p of s.coords) { if (line.length) d += hav(line.at(-1), p); line.push(p); cum.push(d); }
    }
    total = d;
    // a road ride (Scotland) has no lanes: its named waypoints (passes, glens, villages) are what the screen counts down to
    places = []; let from = 0;
    for (const it of t.items) if (it.via && it.name && it.name !== "Via point") { const [, at] = nearest(it.coords[0], from); places.push({ at, name: it.name }); from = at; }
    if (!t.loop && t.finish) places.push({ at: total, name: "the finish" });
    // the stops you chose (a café, a campsite): these come before any other stop the route happens to pass
    planned = []; from = 0;
    for (const it of t.items) if (it.stop) { const [, at] = nearest(it.coords[0], from); planned.push({ at, name: it.name, code: it.stop.code }); from = at; }
  }
  // nearest point on the line to p, searching only between two distances along it: [metres off, distance along, point].
  // With `near` set, a match further from where you were costs a little, so where a route comes back along the same
  // road (a loop's last miles, an out-and-back to a lane) the dot stays on the pass you're riding, not the later one.
  function nearest(p, from = 0, to = Infinity, near = null, moved = 0){
    const k = Math.cos(p[0] * Math.PI / 180) * 111320; let best = [Infinity, 0, line[0]], bestScore = Infinity;
    for (let i = 1; i < line.length; i++) {
      if (cum[i] < from) continue; if (cum[i - 1] > to) break;
      const a = line[i - 1], b = line[i];
      const ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * 111320, dx = (b[1] - a[1]) * k, dy = (b[0] - a[0]) * 111320;
      const L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const off = Math.hypot(ax + t * dx, ay + t * dy), at = cum[i - 1] + t * (cum[i] - cum[i - 1]);
      const score = near == null ? off : off + 0.05 * Math.max(0, Math.abs(at - near) - 50) + 0.15 * Math.max(0, near - moved - at);
      if (score < bestScore) { bestScore = score; best = [off, at, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]]; }
    }
    return best;
  }
  const pointAt = d => { let i = cum.findIndex(c => c >= d); if (i <= 0) return line[Math.max(0, i)]; const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]; };
  const kmTxt = m => m < 950 ? `${Math.round(m / 50) * 50}\u00a0m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)}\u00a0km`;   // the number never splits from its unit

  // the name and distance stay on one line, so the bar never changes height: a long name gets smaller type first
  function fitName(){
    const el = $("#rideNextName"), row = el.parentElement; el.style.fontSize = "";
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (row.scrollWidth > row.clientWidth + 1 && size > 18) { size -= 2; el.style.fontSize = size + "px"; }
  }
  // one line of text under the lane name, for whatever matters now; `go` adds a button
  function msg(text, go, ms){
    clearTimeout(msgTimer);
    $("#rideMsg").hidden = !text; $("#rideMsgText").textContent = text || "";
    const b = $("#rideMsgGo"); b.hidden = !go; if (go) { b.textContent = go.label; b.onclick = go.run; }
    if (text && ms) msgTimer = setTimeout(() => msg(""), ms);
    layoutChrome();
  }
  // the map's credit line sits in the bottom-left of the map you can see: above the bottom panel in portrait, beside the panels in landscape
  function layoutChrome(){
    requestAnimationFrame(() => { if (!on) return; const v = visibleBox(), m = map.getSize(), el = map.getContainer().querySelector(".leaflet-bottom.leaflet-left");
      if (el) { el.style.bottom = Math.max(0, m.y - v.y1) + "px"; el.style.left = Math.max(0, v.x0) + "px"; } });
  }
  function gpsIcon(acc){
    const el = $("#rideGpsIco"); el.classList.remove("good", "weak", "bad");
    el.classList.add(acc == null ? "bad" : acc <= 25 ? "good" : acc <= 60 ? "weak" : "bad");
    el.dataset.acc = acc == null ? "" : Math.round(acc);
  }
  $("#rideGpsIco").onclick = () => { const a = $("#rideGpsIco").dataset.acc; msg(a ? `GPS is good to about ${a} m.${+a > 60 ? " That's weak: the dot may wander until the sky is clearer." : ""}` : "No GPS position yet. Outdoors with a clear view of the sky works best.", null, 6000); };
  $("#rideMsg").onclick = e => { if (!e.target.closest("button")) msg(""); };   // tap a message to put it away
  $("#rideSignal").onclick = () => msg("No signal. The map picture needs one, so this is a plain map drawn from the roads saved on this phone. The route and your position still work.", null, 8000);

  function fix(p, acc, hdg, speed){
    if (!on || !line.length) return;   // a late GPS reading after End
    // where along the route you should be now: as far on from the last match as you've moved since the last fix
    const moved = lastFix && offSince == null ? Math.min(2000, hav(lastFix.p, p)) : 0;
    lastFix = { p, acc, t: Date.now() }; gpsIcon(acc);
    if (gpsWaiting) { gpsWaiting = false; if (/GPS|Finding where you are/.test($("#rideMsgText").textContent)) msg(""); }
    if (hdg != null && !isNaN(hdg) && (speed == null || speed > 1.5)) heading = hdg;
    me.setLatLng(p).addTo(layer);
    const arrow = me.getElement()?.querySelector("i"); if (arrow) { arrow.style.display = heading == null ? "none" : ""; arrow.parentElement.style.transform = heading == null ? "" : `rotate(${heading}deg)`; }
    if (!joined) {   // not on the route yet: show the route and you, and how far it is
      // the earliest part of the route that's close: on a loop the start and the finish are the same place
      let [off, a, q] = nearest(p, 0, Infinity, 0);
      // not near the early part: anywhere on it will do (joining a loop in its last few km, say)
      if (off > JOIN_M) { const g = nearest(p); if (g[0] <= JOIN_M) [off, a, q] = g; }
      if (off <= JOIN_M) { joined = true; along = a; peak = a; follow = true; followBtn(); clearBack(); msg(""); }
      else { toStart(p, off, q); return; }
    }
    // match to the stretch just ahead first, so a loop or an out-and-back doesn't jump to the wrong side
    let [off, a] = nearest(p, along - BEHIND_M, along + AHEAD_M, along + moved, moved);
    if (off > OFF_M) { const g = nearest(p); if (g[0] < OFF_M) [off, a] = g; }
    const tol = Math.max(OFF_M, (acc || 0) * 1.5);
    if (off <= tol) {
      if (!$("#rideOff").hidden || backLine) { follow = true; followBtn(); msg("Back on the route.", null, 4000); }   // after a way back, the map follows you again
      along = Math.max(0, a); offSince = null; $("#rideOff").hidden = true; clearBack();
      // going the wrong way along it: the distance along keeps falling
      if (along > peak) peak = along;
      else if (peak - along > 250 && Date.now() - wrongSaid > 120000) { wrongSaid = Date.now(); navigator.vibrate?.([150, 100, 150]); msg("You're riding the route the wrong way round.", null, 15000); }
      if (peak - along > 1500) peak = along + 250;   // accepted: count from here
    }
    else if (!offSince) offSince = Date.now();
    else if (Date.now() - offSince > OFF_S * 1000) { $("#rideOff").hidden = false; if (!backLine) $("#rideOffDist").textContent = `${kmTxt(off)} from it`; navigator.vibrate?.(200); }
    ridden.setLatLngs(line.filter((_, i) => cum[i] <= along).concat([pointAt(along)])).bringToFront();   // the route is redrawn on zoom: keep this over it
    if (follow) centre(p);
    panel();
  }
  // before you reach the route: the whole route and you on the map, the distance to the nearest point of it, and a
  // way there if it's within reach of the phone's router
  function toStart(p, off, q){
    $("#rideNextLabel").textContent = "Not on the route yet";
    $("#rideNextName").textContent = off < 2000 ? "Nearly there" : "To the route";
    $("#rideNextDist").textContent = kmTxt(off);
    const near = off / 1000 <= WAY_KM;
    if (!backLine && !toStartSaid) msg(near ? "The map follows you once you reach the route." : "The map follows you once you reach the route. Tap Preview to see how the screen works.",
      near ? { label: "Show the way there", run: () => { $("#rideMsgGo").textContent = "Finding it…"; wayTo(p, q).then(r => msg(r?.road ? `${kmTxt(r.len)} by road to the route.` : r ? `No road found: the route is ${kmTxt(r.len)} away in a straight line.` : "No way found from here on the roads saved on this phone.", null, 10000)); } } : null, 12000);
    toStartSaid = true;
    panel(true);
    // fit once the panel has its final height, so none of the route ends up under it
    if (!toStartShown) { toStartShown = true; follow = false; followBtn(); requestAnimationFrame(() => fitVisible(L.latLngBounds(line).extend(p).pad(0.12))); }
  }
  function panel(beforeStart){
    if (!beforeStart && !lanes.length && places.length) {
      const nx = places.find(q => q.at > along + 50), i = places.indexOf(nx);
      if (!nx) { $("#rideNextLabel").textContent = "Nearly there"; $("#rideNextName").textContent = trip.loop ? "Back to the start" : "The finish"; $("#rideNextDist").textContent = kmTxt(Math.max(0, total - along)); }
      else { $("#rideNextLabel").textContent = `Next · ${i + 1} of ${places.length}`; $("#rideNextName").textContent = nx.name; $("#rideNextDist").textContent = `in ${kmTxt(nx.at - along)}`; }
    } else if (!beforeStart) {
      const lane = lanes.find(l => along < l.at + l.len);
      if (!lane) { $("#rideNextLabel").textContent = "No more lanes"; $("#rideNextName").textContent = "Roads to the finish"; $("#rideNextDist").textContent = ""; }
      else if (along >= lane.at) { $("#rideNextLabel").textContent = "On the lane"; $("#rideNextName").textContent = lane.name; $("#rideNextDist").textContent = `${kmTxt(lane.at + lane.len - along)} to go`; }
      else { $("#rideNextLabel").textContent = `Next · ${lanes.indexOf(lane) + 1} of ${lanes.length}`; $("#rideNextName").textContent = lane.name; $("#rideNextDist").textContent = `in ${kmTxt(lane.at - along)}`; }
    }
    const left = Math.max(0, total - along);
    $("#rideDone").textContent = (along / 1000).toFixed(1); $("#rideLeft").textContent = (left / 1000).toFixed(left < 9950 ? 1 : 0);
    $("#rideTime").textContent = built ? hm(built.hours * left / (total || 1)) : "–";
    const ahead = (routeStops || []).filter(r => r.along > along && stops?.[r.i]);
    const mine = planned.find(p => p.at > along - 100 && p.code !== "fuel");
    // a café, pub or beauty spot before toilets: a nameless WC shouldn't hide the next café
    const stop = mine ? null : ahead.find(r => !["fuel", "toilet"].includes(stops[r.i].code) && groupOn(stops[r.i].code)) || ahead.find(r => stops[r.i].code === "toilet" && groupOn("toilet")), fuel = ahead.find(r => stops[r.i].code === "fuel");
    const icon = { cafe: "☕", pub: "🍺", restaurant: "🍴", toilet: "🚻", view: "⛰", water: "💧", castle: "🏰", picnic: "🧺", hotel: "🛏", guest: "🛏", hostel: "🛏", camp: "⛺" };
    // the distance first, so a long name is what gets cut short; before you reach the route they count from its start
    // before you reach the route they say where on it they are ("at 25 km"); on it, how far ahead
    const dist = r => beforeStart ? `at ${kmTxt(r.along)}` : kmTxt(r.along - along);
    $("#rideStop").textContent = mine ? `${icon[mine.code] || "•"} ${dist(mine)} · ${mine.name}` : stop ? `${icon[stops[stop.i].code] || "•"} ${dist(stop)} · ${stops[stop.i].name || CODE[stops[stop.i].code]?.one || "Stop"}` : "";
    $("#rideFuel").textContent = fuel ? `⛽ ${dist(fuel)} · ${stops[fuel.i].name || "Fuel"}` : (routeStops?.length ? "⛽ No more fuel near the route" : "");
    fitName();
  }

  // a way on the roads, drawn dashed: back to the route when you've left it, or to it before you start
  function clearBack(){ if (backLine) { layer.removeLayer(backLine); backLine = null; } }
  async function wayTo(from, target, nearestPt){
    const r = await localRouter.route(from, target, 0);
    clearBack();
    // no usable road (you're off the roads, or both ends land on the same point): say so and draw a straight guide line
    const road = r?.coords?.length && r.len > 20 && r.snapA < 300;
    backLine = road ? L.polyline([from, ...r.coords, target], { color: "#1a73e8", weight: 6, dashArray: "10 8", interactive: false, renderer: routeRenderer }).addTo(layer)
      : L.polyline([from, nearestPt || target], { color: "#1a73e8", weight: 3, dashArray: "2 8", opacity: .8, interactive: false, renderer: routeRenderer }).addTo(layer);
    follow = false; followBtn(); fitVisible(backLine.getBounds().extend(from));
    return road ? { ...r, road: true } : { len: hav(from, nearestPt || target), road: false };   // straight: to the nearest point of the route
  }
  $("#rideBackTo").onclick = async () => {
    if (!lastFix) return;
    const [, a, q0] = nearest(lastFix.p, along - BEHIND_M, along + AHEAD_M), target = pointAt(Math.min(total, a + 300));
    $("#rideBackTo").disabled = true; $("#rideBackTo").textContent = "Finding it…";
    const r = await wayTo(lastFix.p, target, q0);
    $("#rideBackTo").disabled = false; $("#rideBackTo").textContent = "Way back";
    $("#rideOffDist").textContent = r.road ? `${kmTxt(r.len)} by road to rejoin` : `No road found: ${kmTxt(r.len)} in a straight line to the route`;
  };

  // keep the screen on while riding, and take the lock back when the phone wakes the page again
  async function wake(){ try { if (on && document.visibilityState === "visible" && "wakeLock" in navigator) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch { lock = null; } }
  document.addEventListener("visibilitychange", () => { if (on && document.visibilityState === "visible") wake(); });

  let gpsWaiting = false;
  function gpsError(e){
    gpsIcon(null); gpsWaiting = true;
    msg(e.code === 1 ? "Location is off for this page. Turn it on in the phone's settings (Location, then your browser) to see where you are." : "Looking for GPS… Outdoors with a clear view of the sky works best.");
  }

  function start(){
    if (!built || built.provisional || on) return;
    if (typeof navPush === "function") navPush();   // the phone's Back ends the ride screen rather than leaving the planner
    prepare(built, trip); on = true; along = 0; follow = true; joined = false; followZoom = null; toStartSaid = false; toStartShown = false; offSince = null; heading = null; lastFix = null;
    zoomBefore = { c: map.getCenter(), z: map.getZoom() };
    if (typeof drawRoute === "function") drawRoute();   // without the planning handles
    if (typeof tourLayer !== "undefined") map.removeLayer(tourLayer);   // riding one day of a tour: only that day on the map
    document.body.classList.add("riding"); $("#ride").hidden = false; $("#rideOff").hidden = true;
    $("#rideSignal").hidden = !(typeof Offline !== "undefined" && Offline.showingRoads);
    layer.addTo(map); ridden.addTo(layer); map.invalidateSize();
    fitVisible(L.latLngBounds(line)); layoutChrome();
    $("#rideNextLabel").textContent = "Ride this route"; $("#rideNextName").textContent = trip.name || "Your route"; $("#rideNextDist").textContent = "";
    panel(true); gpsIcon(null); followBtn();
    gpsWaiting = true; msg("Finding where you are. This screen helps alongside the GPX in your sat nav or GPS app, not instead of it.");
    if ("geolocation" in navigator) watch = navigator.geolocation.watchPosition(pos => { if (!practice) fix([pos.coords.latitude, pos.coords.longitude], pos.coords.accuracy, pos.coords.heading, pos.coords.speed); }, gpsError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    else msg("This browser can't read the phone's location. Tap Preview to see how the ride screen works.");
    // what can go wrong later is said once, a few seconds in, when nothing more urgent is showing
    wake().then(() => setTimeout(() => { if (on && !lock && $("#rideMsg").hidden) msg("wakeLock" in navigator ? "The screen may turn off: turn auto-lock off in Settings while riding." : "This phone won't let a web page keep the screen on. Turn auto-lock off in Settings while riding.", null, 8000); }, 4000));
    if (typeof Offline !== "undefined") Offline.covered(built).then(ok => { if (ok === false) setTimeout(() => { if (on && $("#rideMsg").hidden) msg("This route isn't saved for no signal: if the signal drops, the map may go blank.", null, 8000); }, 9000); });
  }
  // the part of the map you can see: between the panels, which are above and below in portrait, left and right in landscape
  function visibleBox(){
    const m = map.getContainer().getBoundingClientRect(), side = matchMedia("(orientation:landscape) and (max-height:560px)").matches;
    const top = $("#rideTop").getBoundingClientRect(), bot = $("#rideBottom").getBoundingClientRect(), act = $("#rideActions").getBoundingClientRect();
    const fl = [...$("#rideFloat").children].filter(e => !e.hidden).map(e => e.getBoundingClientRect().bottom), below = Math.max(top.bottom, ...fl);   // under any message or warning too
    return side ? { x0: top.right - m.left, x1: act.left - m.left, y0: 0, y1: m.height }
                : { x0: 0, x1: m.width, y0: below - m.top, y1: Math.min(bot.top, act.top) - m.top };
  }
  function fitVisible(bounds){
    const v = visibleBox(), m = map.getSize();
    map.fitBounds(bounds, { paddingTopLeft: [v.x0 + 24, v.y0 + 24], paddingBottomRight: [m.x - v.x1 + 24, m.y - v.y1 + 24], animate: false, maxZoom: 15 });
  }
  // put you in the middle of the map you can see, not the middle of the screen
  let followZoom = null;   // set when following starts; In and Out change it, so the next GPS reading keeps the rider's zoom
  function centre(p){
    if (followZoom == null) followZoom = Math.max(map.getZoom(), 14);
    const z = followZoom, s = map.getSize(), v = visibleBox();
    const dx = s.x / 2 - (v.x0 + v.x1) / 2, dy = s.y / 2 - (v.y0 + v.y1) / 2;
    map.setView(map.unproject(map.project(p, z).add([dx, dy]), z), z, { animate: false });
  }
  function followBtn(){ $("#rideRecentre").classList.toggle("on", follow); $("#rideRecentre").setAttribute("aria-pressed", follow); }
  addEventListener("resize", () => { if (!on) return; map.invalidateSize(); layoutChrome(); if (follow && lastFix && joined) centre(lastFix.p); else if (!joined) fitVisible(lastFix ? L.latLngBounds(line).extend(lastFix.p) : L.latLngBounds(line)); });
  function end(){
    if (!on) return; on = false;
    if (watch != null) navigator.geolocation.clearWatch(watch); watch = null;
    stopPractice(); lock?.release().catch(() => {}); lock = null; msg("");
    layer.clearLayers(); map.removeLayer(layer); clearBack();
    if (typeof drawRoute === "function") drawRoute();
    if (typeof tourLayer !== "undefined") tourLayer.addTo(map);
    document.body.classList.remove("riding"); $("#ride").hidden = true; map.invalidateSize();
    const cr = map.getContainer().querySelector(".leaflet-bottom.leaflet-left"); if (cr) cr.style.bottom = cr.style.left = "";
    if (zoomBefore) map.setView(zoomBefore.c, zoomBefore.z, { animate: false });
  }
  // Preview: the dot rides the route at 60 km/h, ten times faster than real, so you can see how the screen works
  let beforePreview = null;
  function stopPractice(){ clearInterval(practice); practice = null;
    if (beforePreview && !beforePreview.joined) { heading = null; joined = false; along = 0; toStartShown = false; toStartSaid = false; offSince = null; $("#rideOff").hidden = true; ridden.setLatLngs([]); if (on && beforePreview.fix) fix(beforePreview.fix.p, beforePreview.fix.acc); }
    beforePreview = null; const b = $("#ridePractice"); b.classList.remove("on"); b.querySelector("span").textContent = "▶"; b.querySelector("small").textContent = "Preview"; }
  $("#ridePractice").onclick = () => {
    if (practice) { stopPractice(); msg("Preview stopped. Your own position takes over again.", null, 4000); return; }
    beforePreview = { joined, fix: lastFix };
    if (!joined) { joined = true; along = 0; clearBack(); }
    let d = along; follow = true; followBtn(); $("#ridePractice").classList.add("on"); $("#ridePractice").querySelector("span").textContent = "❚❚"; $("#ridePractice").querySelector("small").textContent = "Stop";
    msg("Preview: the dot rides the route at ten times speed, so you can see how this screen works.", null, 6000);
    practice = setInterval(() => {
      d += 60 / 3.6 * 10 * 0.5; if (d >= total) { d = total; stopPractice(); }
      const p = pointAt(d), q = pointAt(Math.min(total, d + 30));
      fix(p, 8, (Math.atan2((q[1] - p[1]) * Math.cos(p[0] * Math.PI / 180), q[0] - p[0]) * 180 / Math.PI + 360) % 360, 17);
    }, 500);
  };
  // End takes two taps (a glove brushing it shouldn't lose the ride)
  $("#rideEnd").onclick = () => {
    const b = $("#rideEnd"), lab = b.querySelector("small");
    if (b.dataset.armed) { delete b.dataset.armed; lab.textContent = "End"; end(); return; }
    b.dataset.armed = 1; lab.textContent = "Sure?"; setTimeout(() => { delete b.dataset.armed; lab.textContent = "End"; }, 3000);
  };
  $("#rideZoomIn").onclick = () => { map.zoomIn(); if (follow) followZoom = Math.min(18, (followZoom ?? map.getZoom()) + 1); };
  $("#rideZoomOut").onclick = () => { map.zoomOut(); if (follow) followZoom = Math.max(8, (followZoom ?? map.getZoom()) - 1); };
  $("#rideRecentre").onclick = () => { follow = true; followZoom = null; followBtn(); if (lastFix && joined) centre(lastFix.p); else if (lastFix) { toStartShown = false; fix(lastFix.p, lastFix.acc); follow = true; followBtn(); } };
  map.on("dragstart", () => { if (on) { follow = false; followBtn(); } });
  $("#rideBtn").onclick = start;
  return { start, end, fix, get on(){ return on; }, get along(){ return along; }, get joined(){ return joined; }, get locked(){ return !!lock; } };
})();
