/* Pictograms on a 24 x 24 grid, drawn as strokes. Used in the page as SVG and on the map as canvas images. */
window.SWT = window.SWT || {};
SWT.icons = {
  cross: "M12 3v18M6.5 8.5h11",
  church: "M5 20V11l7-5 7 5v9zM12 2.5v4M10 4.5h4M10 20v-4a2 2 0 0 1 4 0v4",
  train: "M5 16V6h9v10zM14 9h4l1 3v4h-5M5 10h9M3 19h18M8 16v3M16 16v3",
  castle: "M5 20V9h3V6h2v3h4V6h2v3h3v11zM10 20v-4h4v4M5 13h14",
  saloon: "M3 20V9h4V5h10v4h4v11zM10 20v-5h4v5M7 12h2M15 12h2M3 9h18",
  tower: "M7 20q2-8 0-15h10q-2 7 0 15zM9.5 2.5q1 1 0 2M13.5 1.5q1 1 0 2M5 20h14",
  face: "M12 4a8 8 0 1 0 .01 0zM9 10v1M15 10v1M8.5 14.5q3.5 3 7 0",
  block: "M4 20V10h6V5h10v15zM7 13h1M7 16h1M13 8h4M13 12h4M13 16h4",
  pit: "M3 8h18M5 8l3 4h8l3-4M8 12l2 4h4l2-4M10 16l1 3h2l1-3",
  dome: "M3 19h18M5 19a7 7 0 0 1 14 0M12 12l5-6M16 5l2 2",
  solar: "M12 21V4M9.5 4h5M3 21l4-6M21 21l-4-6M5 15h4M15 15h4",
  canyon: "M3 5l4 14M21 5l-4 14M7 19h10M10 9q2 4 4 0",
  peak: "M2.5 19l6.5-11 3.5 6 3-4 6 9z",
  fall: "M4 5h9M13 5v14M9.5 8v11M5 19h15M16.5 12q1.2 2 0 4",
  dolmen: "M3.5 9h17M6.5 9v10M17.5 9v10M2.5 19h19",
  cave: "M3 19q1-12 9-12t9 12zM9 19q0-5 3-5t3 5",
  bed: "M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M6.5 10.5a1.5 1.5 0 1 0 .01 0",
  eat: "M7 3v18M5 3v5a2 2 0 0 0 4 0V3M16 21V3q3.5 2 3.5 8H16",
  coffee: "M5 9h11v5a5.5 5.5 0 0 1-11 0zM16 10.5h1.5a2 2 0 0 1 0 4H16M8.5 3q1.2 2 0 4M12 3q1.2 2 0 4M4 21h14",
  wc: "M4 10h8a3 3 0 0 1 3 3v2M4 7v6M15 17q2 2.5 0 4q-2-1.5 0-4",
  fuel: "M5 20V5h8v15M3 20h12M7 9h4M13 9l3 3v6a1.5 1.5 0 0 0 3 0v-8l-3-3",
  star: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6L12 16.4 6.6 19.4l1.3-6L3.4 9.3l6-.7z",
  sun: "M12 7a5 5 0 1 0 .01 0zM12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8",
  cactus: "M10 21V4a2 2 0 0 1 4 0v17M10 13H7a2 2 0 0 1-2-2V8M14 11h3a2 2 0 0 0 2-2V6M7 21h10",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  book: "M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-5a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h5z",
  talk: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  download: "M12 3v12M7 10l5 5 5-5M4 20h16",
  phone: "M7 2h10v20H7zM11 18h2",
  home: "M3 11l9-8 9 8M5 9v12h14V9M10 21v-6h4v6"
};
SWT.svgIcon = function (name, opts) {
  opts = opts || {};
  var c = opts.color || "currentColor", sw = opts.stroke || 1.8, s = opts.size || 24;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (SWT.icons[name] || SWT.icons.star) + '"/></svg>';
};
/* A round badge: white disc, category-coloured ring and pictogram. */
SWT.badgeSvg = function (name, color, size) {
  size = size || 36;
  return '<svg viewBox="0 0 36 36" width="' + size + '" height="' + size + '" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="var(--card)" stroke="' + color + '" stroke-width="2.4"/><g transform="translate(7.2 7.2) scale(.9)" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + (SWT.icons[name] || SWT.icons.star) + '"/></g></svg>';
};
/* Canvas version for MapLibre: returns ImageData-like object at 2x pixel ratio. */
SWT.badgeImage = function (name, color, square) {
  var px = 2, S = 36 * px, cv = document.createElement("canvas"); cv.width = cv.height = S;
  var g = cv.getContext("2d"); g.scale(px, px);
  g.fillStyle = "#ffffff"; g.strokeStyle = color; g.lineWidth = 2.4;
  if (square) { g.beginPath(); g.rect(3, 3, 30, 30); } else { g.beginPath(); g.arc(18, 18, 15.5, 0, Math.PI * 2); }
  g.fill(); g.stroke();
  g.save(); g.translate(7.2, 7.2); g.scale(.9, .9);
  g.lineWidth = 2.1; g.lineCap = "round"; g.lineJoin = "round"; g.stroke(new Path2D(SWT.icons[name] || SWT.icons.star));
  g.restore();
  return g.getImageData(0, 0, S, S);
};
