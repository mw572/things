/* ---------- Ride this route: a light riding view ----------
   Where you are on the route, the next lane and how far to it, the next stop and fuel, what's ridden and what's left,
   and a warning when you leave the route. It is a help, not a sat nav: a web page only follows you while the screen is
   on and the page is open, and it gives no spoken directions. The GPX in a sat nav or GPS app stays the main way to
   follow the route; the ride screen says so. */
const Ride = (() => {
  const OFF_M = 60, OFF_S = 10, AHEAD_M = 6000, BEHIND_M = 400;
  let on = false, line = [], cum = [], lanes = [], total = 0, along = 0, watch = null, lock = null, follow = true;
  let offSince = null, lastFix = null, heading = null, practice = null, backLine = null, zoomBefore = null;
  const layer = L.layerGroup(), me = L.marker([0, 0], { interactive: false, zIndexOffset: 2000, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="ride-me"><i></i></div>` }) });
  const ridden = L.polyline([], { color: "#6b6b6b", weight: 7, opacity: .85, interactive: false, renderer: routeRenderer });

  // the route as one line, with the distance along it at every point (the same measure the stops list uses)
  function prepare(b, t){
    line = []; cum = []; lanes = []; let d = 0;
    for (const s of b.segs) {
      if (s.type === "lane") lanes.push({ at: d, name: t.items[s.i]?.name || "Lane", kind: t.items[s.i]?.kind || "", len: lineLen(s.coords) });
      for (const p of s.coords) { if (line.length) d += hav(line.at(-1), p); line.push(p); cum.push(d); }
    }
    total = d;
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
  const kmTxt = m => m < 950 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`;

  function fix(p, acc, hdg, speed){
    // where along the route you should be now: as far on from the last match as you've moved since the last fix
    const moved = lastFix && offSince == null ? Math.min(2000, hav(lastFix.p, p)) : 0;
    lastFix = { p, acc, t: Date.now() };
    if (hdg != null && !isNaN(hdg) && (speed == null || speed > 1.5)) heading = hdg;
    me.setLatLng(p).addTo(layer);
    const arrow = me.getElement()?.querySelector("i"); if (arrow) { arrow.style.display = heading == null ? "none" : ""; arrow.parentElement.style.transform = heading == null ? "" : `rotate(${heading}deg)`; }
    // match to the stretch just ahead first, so a loop or an out-and-back doesn't jump to the wrong side
    let [off, a] = nearest(p, along - BEHIND_M, along + AHEAD_M, along + moved, moved);
    if (off > OFF_M) { const g = nearest(p); if (g[0] < OFF_M) [off, a] = g; }
    const tol = Math.max(OFF_M, (acc || 0) * 1.5);
    if (off <= tol) { along = Math.max(0, a); offSince = null; $("#rideOff").hidden = true; clearBack(); }
    else if (!offSince) offSince = Date.now();
    else if (Date.now() - offSince > OFF_S * 1000) { $("#rideOff").hidden = false; $("#rideOffDist").textContent = `${kmTxt(off)} from it`; navigator.vibrate?.(200); }
    ridden.setLatLngs(line.filter((_, i) => cum[i] <= along).concat([pointAt(along)])).bringToFront();   // the route is redrawn on zoom: keep this over it
    if (follow) centre(p);
    panel(); fitChrome();
    $("#rideGps").textContent = acc ? `GPS within ${Math.round(acc)} m${acc > 50 ? ": weak, the position may wander" : ""}` : "";
  }
  function panel(){
    const lane = lanes.find(l => along < l.at + l.len);
    if (!lane) { $("#rideNextLabel").textContent = "No more lanes"; $("#rideNextName").textContent = "Roads to the finish"; $("#rideNextDist").textContent = ""; }
    else if (along >= lane.at) { $("#rideNextLabel").textContent = "On the lane"; $("#rideNextName").textContent = lane.name; $("#rideNextDist").textContent = `${kmTxt(lane.at + lane.len - along)} to its end`; }
    else { $("#rideNextLabel").textContent = `Next lane (${lanes.indexOf(lane) + 1} of ${lanes.length})`; $("#rideNextName").textContent = lane.name; $("#rideNextDist").textContent = `in ${kmTxt(lane.at - along)}`; }
    const left = Math.max(0, total - along);
    $("#rideDone").textContent = (along / 1000).toFixed(1); $("#rideLeft").textContent = (left / 1000).toFixed(left < 9950 ? 1 : 0);
    $("#rideTime").textContent = built ? hm(built.hours * left / (total || 1)) : "–";
    const ahead = (routeStops || []).filter(r => r.along > along && stops?.[r.i]);
    const stop = ahead.find(r => stops[r.i].code !== "fuel" && groupOn(stops[r.i].code)), fuel = ahead.find(r => stops[r.i].code === "fuel");
    $("#rideStop").textContent = stop ? `Next stop: ${stops[stop.i].name || CODE[stops[stop.i].code]?.one || "stop"}, in ${kmTxt(stop.along - along)}` : "";
    $("#rideFuel").textContent = fuel ? `Fuel: ${stops[fuel.i].name || "filling station"}, in ${kmTxt(fuel.along - along)}` : (routeStops?.length ? "No more fuel near the route" : "");
  }

  // the way back: the phone's router from here to the route a little ahead, drawn dashed
  function clearBack(){ if (backLine) { layer.removeLayer(backLine); backLine = null; } }
  $("#rideBackTo").onclick = async () => {
    if (!lastFix) return;
    const [, a] = nearest(lastFix.p, along - BEHIND_M, along + AHEAD_M), target = pointAt(Math.min(total, a + 300));
    $("#rideBackTo").disabled = true; $("#rideBackTo").textContent = "Finding it…";
    const r = await localRouter.route(lastFix.p, target, 0);
    $("#rideBackTo").disabled = false; $("#rideBackTo").textContent = "Show the way back";
    clearBack();
    if (!r?.coords?.length) { $("#rideOffDist").textContent += ". No way back found from here: head for the nearest road."; return; }
    backLine = L.polyline([lastFix.p, ...r.coords, target], { color: "#1a73e8", weight: 6, dashArray: "10 8", interactive: false, renderer: routeRenderer }).addTo(layer);
    follow = false; $("#rideRecentre").hidden = false; map.fitBounds(backLine.getBounds().pad(0.2), { animate: false });
    $("#rideOffDist").textContent = `${kmTxt(r.len)} by road to rejoin`;
  };

  // keep the screen on while riding, and take the lock back when the phone wakes the page again
  async function wake(){ try { if (on && document.visibilityState === "visible" && "wakeLock" in navigator) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch { lock = null; } awakeNote(); }
  function awakeNote(){ $("#rideAwake").textContent = "wakeLock" in navigator ? (lock ? "" : "The screen may turn off: tap the map now and then, or turn auto-lock off.") : "This phone won't let a web page keep the screen on. Turn auto-lock off in Settings while riding."; }
  document.addEventListener("visibilitychange", () => { if (on && document.visibilityState === "visible") { wake(); } });

  function gpsError(e){
    $("#rideGps").textContent = e.code === 1 ? "Location is off for this page. Turn it on in the phone's settings (Location, then your browser) to see where you are."
      : "Looking for GPS… Outdoors with a clear sky works best.";
  }

  function start(){
    if (!built || built.provisional || on) return;
    prepare(built, trip); on = true; along = 0; follow = true; offSince = null; heading = null; lastFix = null;
    zoomBefore = { c: map.getCenter(), z: map.getZoom() };
    document.body.classList.add("riding"); $("#ride").hidden = false; $("#rideOff").hidden = true; $("#rideRecentre").hidden = true;
    layer.addTo(map); ridden.addTo(layer); map.invalidateSize();
    map.fitBounds(L.latLngBounds(line).pad(0.05), { animate: false });
    panel(); $("#rideGps").textContent = "Waiting for GPS… This screen helps alongside the GPX in your sat nav or GPS app, not instead of it.";
    if ("geolocation" in navigator) watch = navigator.geolocation.watchPosition(pos => { if (!practice) fix([pos.coords.latitude, pos.coords.longitude], pos.coords.accuracy, pos.coords.heading, pos.coords.speed); }, gpsError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    else $("#rideGps").textContent = "This browser can't read the phone's location.";
    wake();
    $("#rideSaved").hidden = true;
    if (typeof Offline !== "undefined") Offline.covered(built).then(ok => { $("#rideSaved").hidden = ok !== false; fitChrome(); });
    fitChrome();
  }
  // put you in the middle of the map you can see, between the two panels, not the middle of the screen
  function centre(p){
    const z = Math.max(map.getZoom(), 14), h = map.getSize().y;
    const top = $("#rideTop").getBoundingClientRect().bottom, bottom = $("#rideBottom").getBoundingClientRect().top;
    const dy = h / 2 - (top + bottom) / 2;
    map.setView(map.unproject(map.project(p, z).add([0, dy]), z), z, { animate: false });
  }
  // keep the map's own controls and credits clear of the bottom panel, whose height changes with what it shows
  function fitChrome(){ requestAnimationFrame(() => document.documentElement.style.setProperty("--ride-bottom", $("#rideBottom").offsetHeight + 14 + "px")); }
  function end(){
    if (!on) return; on = false;
    if (watch != null) navigator.geolocation.clearWatch(watch); watch = null;
    stopPractice(); lock?.release().catch(() => {}); lock = null;
    layer.clearLayers(); map.removeLayer(layer); clearBack();
    document.body.classList.remove("riding"); $("#ride").hidden = true; map.invalidateSize();
    if (zoomBefore) map.setView(zoomBefore.c, zoomBefore.z, { animate: false });
  }
  // a practice run moves the dot along the route at 60 km/h, ten times faster than real, to see how it works
  function stopPractice(){ clearInterval(practice); practice = null; $("#ridePractice").textContent = "Practice run"; }
  $("#ridePractice").onclick = () => {
    if (practice) return stopPractice();
    let d = along; $("#ridePractice").textContent = "Stop practice";
    practice = setInterval(() => {
      d += 60 / 3.6 * 10 * 0.5; if (d >= total) { d = total; stopPractice(); }
      const p = pointAt(d), q = pointAt(Math.min(total, d + 30));
      fix(p, 8, (Math.atan2((q[1] - p[1]) * Math.cos(p[0] * Math.PI / 180), q[0] - p[0]) * 180 / Math.PI + 360) % 360, 17);
    }, 500);
  };
  $("#rideEnd").onclick = end;
  $("#rideZoomIn").onclick = () => map.zoomIn();
  $("#rideZoomOut").onclick = () => map.zoomOut();
  $("#rideRecentre").onclick = () => { follow = true; $("#rideRecentre").hidden = true; if (lastFix) centre(lastFix.p); };
  map.on("dragstart", () => { if (on) { follow = false; $("#rideRecentre").hidden = false; } });
  $("#rideBtn").onclick = start;
  return { start, end, fix, get on(){ return on; }, get along(){ return along; }, get locked(){ return !!lock; } };
})();
