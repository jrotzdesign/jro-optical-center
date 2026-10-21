/* Compares stroke mass computed by optical.js (offset bands) with Illustrator's own Outline Stroke,
   on throwaway shapes in a scratch document that this script closes unsaved.
   Load order: jsx/engine.jsx, tools/integration-test.jsx (for OCT_load), then this file.
   optical.js runs inside OC_withES5, so its ES5 helpers are gone again when this returns.
   Entry point: OCS_compare() returns report lines. */

function OCS_measure(st, bias) {
  var Optical = OCT_load(), shapes = Optical.piecesToShapes(st.pieces), g = Optical.groupCentroid(shapes), b = Optical.bounds(shapes);
  var o = Optical.opticalPoint(b, { x: g.x, y: g.y }, bias, "both");
  return { area: g.area, ox: o.x, oy: o.y };
}

function OCS_compare() {
  return OC_withES5(OCS_compareAll);
}

function OCS_compareAll() {
  var lines = [], scratch = null, oldLevel = app.userInteractionLevel, oldCS = app.coordinateSystem, back = app.documents.length ? app.activeDocument : null;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    OCT_load();
    scratch = app.documents.add(DocumentColorSpace.RGB, 600, 400);
    var teal = new RGBColor(); teal.red = 41; teal.green = 161; teal.blue = 145;

    function stroked(item, w, join, capStyle) {
      item.filled = false; item.stroked = true; item.strokeWidth = w; item.strokeColor = teal;
      item.strokeJoin = join; item.strokeCap = capStyle;
      return item;
    }
    var cases = [];

    var L = scratch.pathItems.add();
    L.setEntirePath([[100, 250], [100, 150], [170, 150]]);
    L.closed = false;
    cases.push({ name: "L, 16 pt, miter, butt", item: stroked(L, 16, StrokeJoin.MITERENDJOIN, StrokeCap.BUTTENDCAP) });

    // Open semicircle-like arc: two bezier segments, radius 60, opening down.
    var K = 0.5522847498, r = 60, cx = 400, cy = 150;
    var arc = scratch.pathItems.add();
    arc.setEntirePath([[cx - r, cy], [cx, cy + r], [cx + r, cy]]);
    arc.closed = false;
    arc.pathPoints[0].rightDirection = [cx - r, cy + K * r];
    arc.pathPoints[1].leftDirection = [cx - K * r, cy + r];
    arc.pathPoints[1].rightDirection = [cx + K * r, cy + r];
    arc.pathPoints[2].leftDirection = [cx + r, cy + K * r];
    cases.push({ name: "arc r60, 12 pt, round caps", item: stroked(arc, 12, StrokeJoin.ROUNDENDJOIN, StrokeCap.ROUNDENDCAP) });

    for (var i = 0; i < cases.length; i++) {
      var it = cases[i].item, gb = it.geometricBounds, gcx = (gb[0] + gb[2]) / 2, gcy = (gb[1] + gb[3]) / 2;
      // math: read the live stroked path
      var stM = { dx: 0, dy: 0, pieces: [], warnings: [], texts: [] };
      OC_collect(it, stM, 0);
      var m = OCS_measure(stM, 0.6);
      // reference: Illustrator's Outline Stroke on a copy
      var copy = it.duplicate();
      scratch.selection = null; copy.selected = true;
      app.executeMenuCommand("OffsetPath v22");
      var stO = { dx: 0, dy: 0, pieces: [], warnings: [], texts: [] }, sel = scratch.selection, k;
      for (k = 0; k < sel.length; k++) OC_collect(sel[k], stO, 0);
      var o = OCS_measure(stO, 0.6);
      var offM = [m.ox - gcx, m.oy - gcy], offO = [o.ox - gcx, o.oy - gcy];
      var mag = Math.sqrt(offO[0] * offO[0] + offO[1] * offO[1]);
      var diff = Math.sqrt(Math.pow(offM[0] - offO[0], 2) + Math.pow(offM[1] - offO[1], 2));
      lines.push(cases[i].name + ": area math=" + OCT_f(m.area) + " outline=" + OCT_f(o.area) +
        " (" + OCT_f(100 * (m.area - o.area) / o.area) + "%) | optical offset math=(" + OCT_f(offM[0]) + "," + OCT_f(offM[1]) +
        ") outline=(" + OCT_f(offO[0]) + "," + OCT_f(offO[1]) + ") diff=" + OCT_f(diff) + " pt = " + OCT_f(100 * diff / mag) + "% " +
        (diff / mag <= 0.01 ? "PASS" : "FAIL"));
    }
  } catch (e) {
    lines.push("ERR " + e.message + " line " + e.line);
  } finally {
    if (scratch) { try { scratch.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) { lines.push("close err " + e2.message); } }
    if (back) { try { app.activeDocument = back; } catch (e3) {} }
    app.coordinateSystem = oldCS;
    app.userInteractionLevel = oldLevel;
  }
  return lines.join("\n");
}
