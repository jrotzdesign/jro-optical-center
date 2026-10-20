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

  function nestingDepth(paths, index) {
    var probe = paths[index].points[0].anchor, depth = 0;
    for (var i = 0; i < paths.length; i++) {
      if (i !== index && contains(paths[i].points, probe[0], probe[1])) depth++;
    }
    return depth;
  }

  function areaCentroid(shape) {
    var a2 = 0, cx = 0, cy = 0;
    shape.paths.forEach(function (path, i) {
      var m = polyMoments(path.points);
      // A path's centroid weight is area-signed; flip it so its own winding drops out.
      var own = m.a2 < 0 ? -1 : 1;
      var sign = shape.evenodd ? (nestingDepth(shape.paths, i) % 2 === 0 ? 1 : -1) : own;
      a2 += sign * own * m.a2;
      cx += sign * own * m.cx;
      cy += sign * own * m.cy;
    });
    return { x: cx / (3 * a2), y: cy / (3 * a2), area: Math.abs(a2 / 2) };
  }

  return { areaCentroid: areaCentroid };
});
