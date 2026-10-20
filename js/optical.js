/* Optical Center: pure geometry. Plain math coordinates; the host side converts. */
// Loads in three hosts: Node tests (module), the CEP panel (module AND window, because of
// --mixed-context), and ExtendScript (neither). Export to every one that exists.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Optical = api;
  else if (root) root.Optical = api;
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
  // polys: arrays of {anchor}. For each subpath: +1 if it is the outer edge of a filled region,
  // -1 if it is the edge of a hole, 0 if it separates two filled (or two empty) regions.
  function regionCoefficients(polys, evenodd) {
    var n = polys.length;
    var m = polys.map(function (p) {
      var raw = polyMoments(p), o = raw.a2 < 0 ? -1 : 1;
      return { a2: o * raw.a2, cx: o * raw.cx, cy: o * raw.cy, orient: o };
    });
    var parents = polys.map(function (p, i) {
      var probe = p[0].anchor, list = [];
      for (var j = 0; j < n; j++) {
        if (j !== i && contains(polys[j], probe[0], probe[1])) list.push(j);
      }
      return list;
    });
    var filled = polys.map(function (p, i) {
      if (evenodd) return parents[i].length % 2 === 0;
      var w = m[i].orient;
      parents[i].forEach(function (j) { w += m[j].orient; });
      return w !== 0;
    });
    return polys.map(function (p, i) {
      var parent = -1;
      parents[i].forEach(function (j) { if (parent < 0 || m[j].a2 < m[parent].a2) parent = j; });
      return { c: (filled[i] ? 1 : 0) - (parent >= 0 && filled[parent] ? 1 : 0), m: m[i] };
    });
  }

  function areaCentroid(shape, tol) {
    var paths = shape.paths.map(function (p) {
      return { points: flatten(p, tol || DEFAULT_TOLERANCE).map(function (v) { return { anchor: v }; }) };
    });
    var a2 = 0, cx = 0, cy = 0;
    regionCoefficients(paths.map(function (p) { return p.points; }), shape.evenodd).forEach(function (r) {
      a2 += r.c * r.m.a2;
      cx += r.c * r.m.cx;
      cy += r.c * r.m.cy;
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
  // The container is the back-most item (the last one); a missing key falls back to it.
  function moveDelta(opts) {
    var items = opts.items, axis = opts.axis, anchor = -1, target, back = items.length - 1;
    if (opts.mode === 'container') anchor = back;
    else if (opts.mode === 'key') anchor = opts.keyIndex >= 0 && opts.keyIndex < items.length ? opts.keyIndex : back;

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

  // The mode comes from the selection: one object centers on its artboard; with two or more,
  // a keyed object stays put if there is one, otherwise the back-most object is the container.
  function planMove(read, opts) {
    var n = read.items.length, warnings = [], points = [], keyIndex = -1, deltas, targets = {}, mode;
    if (n < 1) return { error: 'Select a shape first.' };
    read.items.forEach(function (it, i) { if (it.isKey) keyIndex = i; });
    mode = n === 1 ? 'artboard' : (keyIndex >= 0 ? 'key' : 'container');

    var measured = read.items.map(function (it) {
      var own = [], shapes = itemShapes(it, own), bb = bounds(shapes), g = groupCentroid(shapes);
      own.forEach(function (w) { warnings.push(it.label + ': ' + w); });
      if (!isFinite(g.x) || !isFinite(g.y) || !(g.area > 1e-9)) {
        g = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2, crossing: false };
        warnings.push(it.label + ' has no area, so its box center was used.');
      } else if (g.crossing) {
        warnings.push(it.label + ' has crossing paths, so its center may be off.');
      }
      (it.warnings || []).forEach(function (w) { warnings.push(it.label + ': ' + w); });
      return { bbox: bb, centroid: { x: g.x, y: g.y } };
    });

    var anchor = mode === 'container' ? n - 1 : (mode === 'key' ? keyIndex : -1);

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
      labels: read.items.map(function (it) { return it.label; }),
      warnings: warnings,
      points: points,
      summary: {
        mode: mode,
        anchor: anchor >= 0 ? read.items[anchor].label : null,
        movers: read.items.filter(function (it, i) { return i !== anchor; }).map(function (it) { return it.label; })
      }
    };
  }

  // An item arrives either as ready shapes (tests) or as the engine's pieces (fill and stroke).
  function itemShapes(item, warnings) {
    return item.shapes || piecesToShapes(item.pieces || [], warnings);
  }

  // ---------- strokes as offset bands ----------
  // A stroke of width w covers the band within w/2 of its path, so its mass is computed from the
  // path's offsets instead of outlining it in Illustrator. Joins: miter (with limit), round, bevel.
  // Caps: butt, round, projecting. Dashes, stroke alignment and variable widths are not modelled.

  function unit(v) { var l = Math.sqrt(v[0] * v[0] + v[1] * v[1]); return l ? [v[0] / l, v[1] / l] : [0, 0]; }
  function leftNormal(d) { return [-d[1], d[0]]; }
  function addScaled(p, v, s) { return [p[0] + v[0] * s, p[1] + v[1] * s]; }

  // Points on an arc around c, radius r, from angle a0 sweeping by `sweep`, endpoints excluded.
  // Arcs use a tenth of the curve tolerance: on small radii (thin strokes) the inscribed polygon
  // otherwise loses about 1% of a round cap's area.
  function arcPoints(c, r, a0, sweep, tol, out) {
    var step = 2 * Math.acos(Math.max(-1, 1 - tol / 10 / r)), n = Math.max(2, Math.ceil(Math.abs(sweep) / step));
    for (var k = 1; k < n; k++) {
      var a = a0 + sweep * k / n;
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
  }

  function dedupe(pts, closed) {
    var out = [];
    pts.forEach(function (p) {
      var q = out[out.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
    });
    if (closed && out.length > 1) {
      var f = out[0], l = out[out.length - 1];
      if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop();
    }
    return out;
  }

  // One side of a polyline offset by d (d > 0 is to the left of travel), with joins.
  function offsetSide(pts, d, closed, style, tol) {
    var n = pts.length, dirs = [], out = [], i, segs = closed ? n : n - 1;
    for (i = 0; i < segs; i++) dirs.push(unit([pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]]));
    for (i = 0; i < n; i++) {
      if (!closed && i === 0) { out.push(addScaled(pts[0], leftNormal(dirs[0]), d)); continue; }
      if (!closed && i === n - 1) { out.push(addScaled(pts[i], leftNormal(dirs[segs - 1]), d)); continue; }
      joinPoints(pts[i], dirs[(i - 1 + segs) % segs], dirs[i % segs], d, style, tol, out);
    }
    return out;
  }

  function joinPoints(p, a, b, d, style, tol, out) {
    var na = leftNormal(a), nb = leftNormal(b), cross = a[0] * b[1] - a[1] * b[0], cosA = na[0] * nb[0] + na[1] * nb[1];
    if (Math.abs(cross) < 1e-12 && cosA > 0) { out.push(addScaled(p, na, d)); return; }
    var outer = cross * d < 0;
    if (!outer && cosA > -0.999) {
      out.push([p[0] + (na[0] + nb[0]) * d / (1 + cosA), p[1] + (na[1] + nb[1]) * d / (1 + cosA)]);
      return;
    }
    var pa = addScaled(p, na, d), pb = addScaled(p, nb, d);
    if (outer && style.join === 'miter' && cosA > -0.999) {
      var ratio = 1 / Math.sqrt((1 + cosA) / 2);
      if (ratio <= (style.miterLimit || 10)) {
        out.push([p[0] + (na[0] + nb[0]) * d / (1 + cosA), p[1] + (na[1] + nb[1]) * d / (1 + cosA)]);
        return;
      }
    }
    out.push(pa);
    if (outer && style.join === 'round') {
      var ua = d > 0 ? na : [-na[0], -na[1]], ub = d > 0 ? nb : [-nb[0], -nb[1]];
      arcPoints(p, Math.abs(d), Math.atan2(ua[1], ua[0]), Math.atan2(ua[0] * ub[1] - ua[1] * ub[0], ua[0] * ub[0] + ua[1] * ub[1]), tol, out);
    }
    out.push(pb);
  }

  function signedArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  // Grows a closed polygon by h (shrinks if h < 0), whichever way it is wound.
  function grow(pts, h, style, tol) {
    return offsetSide(pts, signedArea(pts) > 0 ? -h : h, true, style, tol);
  }

  // The closed outline of an open path's stroke: left side, end cap, right side back, start cap.
  function openBand(pts, h, style, tol) {
    pts = pts.slice();
    var n = pts.length, s = unit([pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]]);
    var e = unit([pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]]);
    if (style.cap === 'projecting') {
      pts[0] = addScaled(pts[0], s, -h);
      pts[n - 1] = addScaled(pts[n - 1], e, h);
    }
    var left = offsetSide(pts, h, false, style, tol), right = offsetSide(pts, -h, false, style, tol).reverse(), out = left.slice();
    if (style.cap === 'round') { var ne = leftNormal(e); arcPoints(pts[n - 1], h, Math.atan2(ne[1], ne[0]), -Math.PI, tol, out); }
    out = out.concat(right);
    if (style.cap === 'round') { var ns = leftNormal(s); arcPoints(pts[0], h, Math.atan2(-ns[1], -ns[0]), -Math.PI, tol, out); }
    return out;
  }

  function toPath(verts) {
    return { closed: true, polarity: 1, points: verts.map(function (v) { return { anchor: v, left: v, right: v }; }) };
  }

  // Engine pieces (fill flag, stroke style, paths) to plain shapes. Warnings go into `warnings`.
  function piecesToShapes(pieces, warnings) {
    var out = [], tol = DEFAULT_TOLERANCE;
    pieces.forEach(function (pc) {
      var st = pc.stroke && pc.stroke.width > 0 ? pc.stroke : null;
      if (!st) { if (pc.fill) out.push({ evenodd: pc.evenodd, paths: pc.paths }); return; }
      var h = st.width / 2;
      var flat = pc.paths.map(function (p) { return { closed: p.closed, pts: dedupe(flatten(p, tol), p.closed) }; })
        .filter(function (f) { return f.pts.length >= 2; });
      var allClosed = flat.every(function (f) { return f.closed && f.pts.length >= 3; });

      if (pc.fill && allClosed) {
        // Fill plus a centered stroke: every edge moves outward from the fill by half the stroke.
        var roles = regionCoefficients(flat.map(function (f) { return f.pts.map(function (v) { return { anchor: v }; }); }), pc.evenodd);
        out.push({
          evenodd: pc.evenodd,
          paths: flat.map(function (f, i) { return toPath(roles[i].c === 0 ? f.pts : grow(f.pts, roles[i].c * h, st, tol)); })
        });
        return;
      }
      if (pc.fill) {
        out.push({ evenodd: pc.evenodd, paths: pc.paths });
        if (warnings) warnings.push('An open path with both fill and stroke counts their overlap twice.');
      }
      flat.forEach(function (f) {
        if (f.closed && f.pts.length >= 3) {
          out.push({ evenodd: true, paths: [toPath(grow(f.pts, h, st, tol)), toPath(grow(f.pts, -h, st, tol))] });
        } else {
          out.push({ evenodd: false, paths: [toPath(openBand(f.pts, h, st, tol))] });
        }
      });
    });
    return out;
  }

  return {
    planMove: planMove,
    piecesToShapes: piecesToShapes,
    areaCentroid: areaCentroid,
    groupCentroid: groupCentroid,
    flatten: flatten,
    bounds: bounds,
    opticalPoint: opticalPoint,
    moveDelta: moveDelta
  };
});
