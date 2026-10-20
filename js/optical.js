/* Optical Center: pure geometry. Plain math coordinates; the host side converts. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Optical = factory();
})(this, function () {
  // Signed area (x2) and centroid numerators of one closed polygon (shoelace).
  function polyMoments(p) {
    var a2 = 0, cx = 0, cy = 0, n = p.length;
    for (var i = 0; i < n; i++) {
      var x0 = p[i].anchor[0], y0 = p[i].anchor[1];
      var x1 = p[(i + 1) % n].anchor[0], y1 = p[(i + 1) % n].anchor[1];
      var cross = x0 * y1 - x1 * y0;
      a2 += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    return { a2: a2, cx: cx, cy: cy };
  }

  function contains(poly, x, y) {
    var inside = false, n = poly.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = poly[i].anchor[0], yi = poly[i].anchor[1];
      var xj = poly[j].anchor[0], yj = poly[j].anchor[1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function distToChord(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return Math.sqrt(Math.pow(p[0] - a[0], 2) + Math.pow(p[1] - a[1], 2));
    return Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / len;
  }

  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

  // Adaptive de Casteljau: split until both handles lie within `tol` of the chord.
  function flattenSegment(p0, p1, p2, p3, tol, depth, out) {
    if (depth >= 16 || Math.max(distToChord(p1, p0, p3), distToChord(p2, p0, p3)) <= tol) return;
    var p01 = mid(p0, p1), p12 = mid(p1, p2), p23 = mid(p2, p3);
    var p012 = mid(p01, p12), p123 = mid(p12, p23), m = mid(p012, p123);
    flattenSegment(p0, p01, p012, m, tol, depth + 1, out);
    out.push(m);
    flattenSegment(m, p123, p23, p3, tol, depth + 1, out);
  }

  // Path (anchors + handles) in, polygon vertices [[x, y], ...] out. Open paths are
  // closed by a straight line, which is how Illustrator fills them.
  function flatten(path, tol) {
    var pts = path.points, n = pts.length, out = [];
    for (var i = 0; i < n; i++) {
      out.push(pts[i].anchor);
      var next = pts[(i + 1) % n];
      if (i === n - 1 && !path.closed) break;
      flattenSegment(pts[i].anchor, pts[i].right, next.left, next.anchor, tol, 0, out);
    }
    return out;
  }

  var DEFAULT_TOLERANCE = 0.05;

  // Subpaths are assumed nested or disjoint (no crossing). Each region is the path
  // minus its direct children, so a path contributes (filled(self) - filled(parent)).
  function areaCentroid(shape, tol) {
    var paths = shape.paths.map(function (p) {
      return { points: flatten(p, tol || DEFAULT_TOLERANCE).map(function (v) { return { anchor: v }; }) };
    }), n = paths.length;
    var m = paths.map(function (p) {
      var raw = polyMoments(p.points), o = raw.a2 < 0 ? -1 : 1;
      return { a2: o * raw.a2, cx: o * raw.cx, cy: o * raw.cy, orient: o };
    });
    var parents = paths.map(function (p, i) {
      var probe = p.points[0].anchor, list = [];
      for (var j = 0; j < n; j++) {
        if (j !== i && contains(paths[j].points, probe[0], probe[1])) list.push(j);
      }
      return list;
    });
    var filled = paths.map(function (p, i) {
      if (shape.evenodd) return parents[i].length % 2 === 0;
      var w = m[i].orient;
      parents[i].forEach(function (j) { w += m[j].orient; });
      return w !== 0;
    });
    var a2 = 0, cx = 0, cy = 0;
    paths.forEach(function (p, i) {
      var parent = -1;
      parents[i].forEach(function (j) { if (parent < 0 || m[j].a2 < m[parent].a2) parent = j; });
      var c = (filled[i] ? 1 : 0) - (parent >= 0 && filled[parent] ? 1 : 0);
      a2 += c * m[i].a2;
      cx += c * m[i].cx;
      cy += c * m[i].cy;
    });
    return { x: cx / (3 * a2), y: cy / (3 * a2), area: a2 / 2 };
  }

  // Known limit: overlapping members are summed, so overlaps count twice.
  function groupCentroid(shapes) {
    var area = 0, mx = 0, my = 0;
    shapes.forEach(function (s) {
      var r = areaCentroid(s);
      area += r.area;
      mx += r.x * r.area;
      my += r.y * r.area;
    });
    return { x: mx / area, y: my / area, area: area };
  }

  // lerp(bbox center, centroid, bias). bias is 0..1. An excluded axis returns null.
  function opticalPoint(bbox, centroid, bias, axis) {
    var cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
    return {
      x: axis === 'v' ? null : cx + (centroid.x - cx) * bias,
      y: axis === 'h' ? null : cy + (centroid.y - cy) * bias
    };
  }

  // opts: { mode: 'container'|'key'|'artboard', items: [{bbox, centroid}] topmost first,
  // keyIndex?, artboard?, bias (0..1), axis: 'both'|'h'|'v' }. Returns [{dx, dy}] per item.
  function moveDelta(opts) {
    var items = opts.items, axis = opts.axis, anchor = -1, target;
    if (opts.mode === 'container') anchor = 0;
    else if (opts.mode === 'key') anchor = opts.keyIndex >= 0 && opts.keyIndex < items.length ? opts.keyIndex : 0;

    if (anchor >= 0) target = opticalPoint(items[anchor].bbox, items[anchor].centroid, opts.bias, 'both');
    else target = { x: (opts.artboard.minX + opts.artboard.maxX) / 2, y: (opts.artboard.minY + opts.artboard.maxY) / 2 };

    return items.map(function (item, i) {
      if (i === anchor) return { dx: 0, dy: 0 };
      var o = opticalPoint(item.bbox, item.centroid, opts.bias, axis);
      return { dx: o.x === null ? 0 : target.x - o.x, dy: o.y === null ? 0 : target.y - o.y };
    });
  }

  return {
    areaCentroid: areaCentroid,
    groupCentroid: groupCentroid,
    flatten: flatten,
    opticalPoint: opticalPoint,
    moveDelta: moveDelta
  };
});
