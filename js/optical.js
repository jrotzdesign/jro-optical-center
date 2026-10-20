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

  function side(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }

  // Proper crossing only: touching endpoints and collinear overlaps do not count.
  function segmentsCross(a, b, c, d) {
    var d1 = side(a, b, c), d2 = side(a, b, d), d3 = side(c, d, a), d4 = side(c, d, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  // polys: arrays of {anchor}. True when any two non-neighbouring edges cross.
  function anyCrossing(polys) {
    var edges = [];
    polys.forEach(function (poly, pi) {
      var n = poly.length;
      for (var i = 0; i < n; i++) edges.push({ a: poly[i].anchor, b: poly[(i + 1) % n].anchor, p: pi, i: i, n: n });
    });
    for (var x = 0; x < edges.length; x++) {
      for (var y = x + 1; y < edges.length; y++) {
        var e = edges[x], f = edges[y];
        if (e.p === f.p && (f.i - e.i === 1 || (e.i === 0 && f.i === e.n - 1))) continue;
        if (segmentsCross(e.a, e.b, f.a, f.b)) return true;
      }
    }
    return false;
  }

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
    return {
      x: cx / (3 * a2),
      y: cy / (3 * a2),
      area: a2 / 2,
      crossing: anyCrossing(paths.map(function (p) { return p.points; }))
    };
  }

  // Known limit: overlapping members are summed, so overlaps count twice.
  function groupCentroid(shapes) {
    var area = 0, mx = 0, my = 0, crossing = false;
    shapes.forEach(function (s) {
      var r = areaCentroid(s);
      area += r.area;
      mx += r.x * r.area;
      my += r.y * r.area;
      crossing = crossing || r.crossing;
    });
    return { x: mx / area, y: my / area, area: area, crossing: crossing };
  }

  // Union bounds of the flattened outlines of every path in every shape.
  function bounds(shapes, tol) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    shapes.forEach(function (s) {
      s.paths.forEach(function (p) {
        flatten(p, tol || DEFAULT_TOLERANCE).forEach(function (v) {
          if (v[0] < b.minX) b.minX = v[0];
          if (v[0] > b.maxX) b.maxX = v[0];
          if (v[1] < b.minY) b.minY = v[1];
          if (v[1] > b.maxY) b.maxY = v[1];
        });
      });
    });
    return b;
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

  // read: the engine's OC_read result. opts: { mode, bias (0..1), axis }.
  // Returns { deltas, fingerprints, warnings, points } or { error }.
  function artboardFor(read, bbox) {
    var cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2, i, a, pick;
    for (i = 0; i < read.artboards.length; i++) {
      a = read.artboards[i]; // [left, top, right, bottom], y up
      if (cx >= a[0] && cx <= a[2] && cy >= a[3] && cy <= a[1]) { pick = a; break; }
    }
    pick = pick || read.artboards[read.activeArtboard];
    return { minX: pick[0], minY: pick[3], maxX: pick[2], maxY: pick[1] };
  }

  function planMove(read, opts) {
    var mode = opts.mode, n = read.items.length, warnings = [], points = [], keyIndex = -1, deltas, targets = {};
    if (n < 1) return { error: 'Select at least one object.' };
    if (mode === 'container' && n < 2) return { error: 'Select the container and at least one more object.' };
    if (mode === 'key' && n < 2) return { error: 'Select the key object and at least one more object.' };

    var measured = read.items.map(function (it, i) {
      var bb = bounds(it.shapes), g = groupCentroid(it.shapes);
      if (it.isKey) keyIndex = i;
      if (!isFinite(g.x) || !isFinite(g.y) || !(g.area > 1e-9)) {
        g = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2, crossing: false };
        warnings.push(it.label + ' has no area, so its box center was used.');
      } else if (g.crossing) {
        warnings.push(it.label + ' has crossing paths, so its center may be off.');
      }
      (it.warnings || []).forEach(function (w) { warnings.push(it.label + ': ' + w); });
      return { bbox: bb, centroid: { x: g.x, y: g.y } };
    });

    if (mode === 'key' && keyIndex < 0) warnings.push('No key is set, so the topmost object is the key.');
    var anchor = mode === 'container' ? 0 : (mode === 'key' ? Math.max(keyIndex, 0) : -1);

    if (mode === 'artboard') {
      deltas = measured.map(function (m) {
        var board = artboardFor(read, m.bbox);
        targets[board.minX + ',' + board.minY] = { x: (board.minX + board.maxX) / 2, y: (board.minY + board.maxY) / 2, kind: 'target' };
        return moveDelta({ mode: 'artboard', items: [m], artboard: board, bias: opts.bias, axis: opts.axis })[0];
      });
    } else {
      deltas = moveDelta({ mode: mode, items: measured, keyIndex: keyIndex, bias: opts.bias, axis: opts.axis });
    }

    measured.forEach(function (m, i) {
      var o = opticalPoint(m.bbox, m.centroid, opts.bias, 'both');
      points.push({ x: (m.bbox.minX + m.bbox.maxX) / 2, y: (m.bbox.minY + m.bbox.maxY) / 2, kind: 'box' });
      points.push({ x: o.x, y: o.y, kind: i === anchor ? 'target' : 'optical' });
    });
    Object.keys(targets).forEach(function (k) { points.push(targets[k]); });

    return {
      deltas: deltas,
      fingerprints: read.items.map(function (it) { return it.fingerprint; }),
      warnings: warnings,
      points: points
    };
  }

  return {
    planMove: planMove,
    areaCentroid: areaCentroid,
    groupCentroid: groupCentroid,
    flatten: flatten,
    bounds: bounds,
    opticalPoint: opticalPoint,
    moveDelta: moveDelta
  };
});
