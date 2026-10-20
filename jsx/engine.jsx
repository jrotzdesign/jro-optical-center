/* Optical Center: ExtendScript engine.
   Every entry point returns a JSON string: {ok:true, ...} or {ok:false, error}.
   The user's document is never touched except by OC_move and the marker layer.
   Strokes are expanded on copies inside a scratch document that is always closed unsaved. */

var OC_MARKER_LAYER = "__optical_center_markers__";
var OC_MAX_DEPTH = 8;

// ---------- plumbing ----------

function OC_json(v) {
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(Math.round(v * 10000) / 10000) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") {
    return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
  }
  var out = [], i;
  if (v instanceof Array) {
    for (i = 0; i < v.length; i++) out.push(OC_json(v[i]));
    return "[" + out.join(",") + "]";
  }
  for (var k in v) if (v.hasOwnProperty(k)) out.push(OC_json(k) + ":" + OC_json(v[k]));
  return "{" + out.join(",") + "}";
}

function OC_parse(s) {
  if (!/^[\s\w\[\]{},:."+\-]*$/.test(s)) throw new Error("Unexpected characters in panel payload.");
  return eval("(" + s + ")");
}

// Alert suppression and the document coordinate system (y up) wrap every call.
function OC_run(fn) {
  var oldLevel = app.userInteractionLevel, oldCS = app.coordinateSystem, res;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    res = fn();
    if (!res) res = {};
    res.ok = true;
  } catch (e) {
    res = { ok: false, error: String(e.message || e) };
  }
  try { app.coordinateSystem = oldCS; } catch (e2) {}
  try { app.userInteractionLevel = oldLevel; } catch (e3) {}
  return OC_json(res);
}

function OC_doc() {
  if (app.documents.length === 0) throw new Error("Open a document first.");
  return app.activeDocument;
}

// ---------- selection order (topmost first) ----------

function OC_layerRank(layer) {
  var sibs = layer.parent.layers, i;
  for (i = 0; i < sibs.length; i++) if (sibs[i] === layer) return sibs.length - i;
  return 0;
}

// Stacking rank inside the parent: higher is nearer the top. pageItems[0] is the topmost item.
// zOrderPosition is not used first because it is wrong for text frames (it can repeat another item's value).
function OC_stackRank(item, cache) {
  var parent = item.parent, entry = null, i, list, map;
  for (i = 0; i < cache.length; i++) if (cache[i].parent === parent) { entry = cache[i]; break; }
  if (!entry) {
    map = {};
    try {
      list = parent.pageItems;
      for (i = 0; i < list.length; i++) map[String(list[i].uuid)] = list.length - i;
    } catch (e) {}
    entry = { parent: parent, map: map };
    cache.push(entry);
  }
  return entry.map[String(item.uuid)] || item.zOrderPosition;
}

function OC_zKey(item, cache) {
  var key = [], cur = item;
  while (cur && cur.typename !== "Document") {
    key.unshift(cur.typename === "Layer" ? OC_layerRank(cur) : OC_stackRank(cur, cache));
    cur = cur.parent;
  }
  return key;
}

function OC_zCompare(a, b) {
  var n = Math.min(a.length, b.length), i;
  for (i = 0; i < n; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return b.length - a.length;
}

function OC_selectionSorted(doc) {
  var sel = doc.selection, list = [], cache = [], i;
  if (!sel || !sel.length || sel.typename === "TextRange") return list;
  for (i = 0; i < sel.length; i++) list.push({ item: sel[i], key: OC_zKey(sel[i], cache) });
  list.sort(function (p, q) { return OC_zCompare(p.key, q.key); });
  return list;
}

function OC_fingerprint(item) {
  return item.geometricBounds.join(",");
}

// ---------- geometry extraction (runs on scratch copies only) ----------

function OC_pathData(p, st) {
  var pts = [], pp = p.pathPoints, i, q;
  for (i = 0; i < pp.length; i++) {
    q = pp[i];
    pts.push({
      anchor: [q.anchor[0] + st.dx, q.anchor[1] + st.dy],
      left: [q.leftDirection[0] + st.dx, q.leftDirection[1] + st.dy],
      right: [q.rightDirection[0] + st.dx, q.rightDirection[1] + st.dy]
    });
  }
  return { closed: p.closed, polarity: String(p.polarity) === "PolarityValues.NEGATIVE" ? -1 : 1, points: pts };
}

function OC_pathsOf(item) {
  var list = [], i;
  if (item.typename === "CompoundPathItem") for (i = 0; i < item.pathItems.length; i++) list.push(item.pathItems[i]);
  else list.push(item);
  return list;
}

function OC_pushShape(item, st) {
  var list = OC_pathsOf(item), paths = [], i, evenodd = false;
  for (i = 0; i < list.length; i++) paths.push(OC_pathData(list[i], st));
  try { evenodd = list[0].evenodd; } catch (e) {}
  st.shapes.push({ evenodd: evenodd, paths: paths });
}

function OC_pushBoxShape(item, st, why) {
  var b = item.geometricBounds, x0 = b[0] + st.dx, y0 = b[1] + st.dy, x1 = b[2] + st.dx, y1 = b[3] + st.dy;
  function pt(x, y) { return { anchor: [x, y], left: [x, y], right: [x, y] }; }
  st.shapes.push({ evenodd: false, paths: [{ closed: true, polarity: 1, points: [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)] }] });
  st.warnings.push(why);
}

function OC_isClipPath(it) {
  try {
    if (it.typename === "PathItem") return it.clipping;
    if (it.typename === "CompoundPathItem") return it.pathItems[0].clipping;
  } catch (e) {}
  return false;
}

// Object > Path > Outline Stroke on the scratch copy; returns what the selection became.
function OC_outline(item, st) {
  st.doc.selection = null;
  item.selected = true;
  app.executeMenuCommand("OffsetPath v22");
  var res = [], sel = st.doc.selection, i;
  for (i = 0; i < sel.length; i++) res.push(sel[i]);
  return res;
}

function OC_setFilled(item, value) {
  var list = OC_pathsOf(item), i;
  for (i = 0; i < list.length; i++) list[i].filled = value;
}

function OC_area(it) {
  var b = it.geometricBounds;
  return Math.abs((b[2] - b[0]) * (b[1] - b[3]));
}

function OC_collectPaths(item, st, depth) {
  var first = OC_pathsOf(item)[0], filled, stroked, simple, ring, i, best, leaves;
  if (!first) return;
  if (first.guides) return;
  filled = first.filled;
  stroked = first.stroked && first.strokeWidth > 0;
  if (!filled && !stroked) { st.warnings.push("Skipped an object with no fill or stroke."); return; }
  if (!stroked) { OC_pushShape(item, st); return; }

  simple = item.typename === "PathItem" && item.closed;
  if (filled && !simple) {
    OC_pushShape(item, st);
    st.warnings.push("A filled and stroked compound shape counts its stroke overlap twice.");
  }
  if (filled) OC_setFilled(item, false);
  ring = OC_outline(item, st);

  if (filled && simple) {
    // fill + centered stroke = the region inside the stroke's outer contour
    leaves = [];
    for (i = 0; i < ring.length; i++) OC_leaves(ring[i], leaves);
    best = null;
    for (i = 0; i < leaves.length; i++) if (!best || OC_area(leaves[i]) > OC_area(best)) best = leaves[i];
    if (best) {
      st.shapes.push({ evenodd: false, paths: [OC_pathData(best, st)] });
      return;
    }
  }
  for (i = 0; i < ring.length; i++) OC_collect(ring[i], st, depth + 1);
}

function OC_leaves(item, out) {
  var t = item.typename, i, kids = [];
  if (t === "PathItem") out.push(item);
  else if (t === "CompoundPathItem") for (i = 0; i < item.pathItems.length; i++) out.push(item.pathItems[i]);
  else if (t === "GroupItem") {
    for (i = 0; i < item.pageItems.length; i++) kids.push(item.pageItems[i]);
    for (i = 0; i < kids.length; i++) OC_leaves(kids[i], out);
  }
}

function OC_collect(item, st, depth) {
  var t = item.typename, kids = [], i, g;
  if (depth > OC_MAX_DEPTH) return;
  try { if (item.hidden) return; } catch (e) {}

  if (t === "GroupItem") {
    if (item.clipped) {
      for (i = 0; i < item.pageItems.length; i++) {
        if (OC_isClipPath(item.pageItems[i])) { OC_pushShape(item.pageItems[i], st); break; }
      }
      st.warnings.push("A clipping group is measured by its clip shape, not the clipped artwork.");
      return;
    }
    for (i = 0; i < item.pageItems.length; i++) kids.push(item.pageItems[i]);
    for (i = 0; i < kids.length; i++) OC_collect(kids[i], st, depth + 1);
    return;
  }
  if (t === "TextFrame") {
    try { g = item.createOutline(); } catch (e2) { g = null; }
    if (g) OC_collect(g, st, depth + 1);
    else OC_pushBoxShape(item, st, "Text could not be outlined, so its box was used.");
    return;
  }
  if (t === "PathItem" || t === "CompoundPathItem") { OC_collectPaths(item, st, depth); return; }
  OC_pushBoxShape(item, st, "A " + t + " was measured by its bounding box.");
}

// Copies an item into the scratch document. duplicate() sometimes returns undefined across
// documents, so the copy is found at the back of the scratch layer when the return value is empty.
function OC_copyTo(item, scratch) {
  var copy = item.duplicate(scratch, ElementPlacement.PLACEATEND), list;
  if (!copy) {
    list = scratch.layers[0].pageItems;
    copy = list[list.length - 1];
  }
  if (!copy || copy.typename !== item.typename) throw new Error("Could not copy " + (item.name || item.typename) + " for measuring.");
  return copy;
}

// ---------- entry points ----------

function OC_ping() {
  return OC_run(function () { return { version: app.version, docs: app.documents.length }; });
}

// The selected item's uuid, for the panel to hold as the key for this session.
function OC_peekKey() {
  return OC_run(function () {
    var doc = OC_doc(), sel = doc.selection;
    if (!sel || sel.length !== 1) throw new Error("Select exactly one object to set as the key.");
    return { uuid: sel[0].uuid, doc: doc.name, label: sel[0].name || sel[0].typename };
  });
}

// Reads the selection (topmost first) as flattenable shapes. Works on copies in a scratch doc.
function OC_read(keyUuid, keyDoc) {
  return OC_run(function () {
    var doc = OC_doc(), list = OC_selectionSorted(doc), items = [], boards = [], i, scratch = null;
    if (!list.length) throw new Error("Select at least one object.");

    for (i = 0; i < doc.artboards.length; i++) boards.push(doc.artboards[i].artboardRect);
    var activeBoard = doc.artboards.getActiveArtboardIndex();

    try {
      // Originals are deselected while we work. A selected item duplicates to another document as
      // undefined, and with nothing selected here a stray menu command has nothing of yours to hit.
      doc.selection = null;
      scratch = app.documents.add(DocumentColorSpace.RGB, 200, 200);
      for (i = 0; i < list.length; i++) {
        var it = list[i].item, gb = it.geometricBounds, copy = OC_copyTo(it, scratch);
        var cb = copy.geometricBounds;
        var st = { doc: scratch, dx: gb[0] - cb[0], dy: gb[1] - cb[1], shapes: [], warnings: [] };
        OC_collect(copy, st, 0);
        items.push({
          label: it.name || it.typename,
          isKey: keyUuid !== undefined && keyUuid !== "" && String(it.uuid) === String(keyUuid) && doc.name === keyDoc,
          fingerprint: OC_fingerprint(it),
          shapes: st.shapes,
          warnings: st.warnings
        });
      }
    } finally {
      if (scratch) { try { scratch.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
      try { app.activeDocument = doc; } catch (e2) {}
      try {
        doc.selection = null;
        for (i = 0; i < list.length; i++) list[i].item.selected = true;
      } catch (e3) {}
    }
    return { doc: doc.name, items: items, artboards: boards, activeArtboard: activeBoard };
  });
}

function OC_markerLayer(doc) {
  var i;
  for (i = 0; i < doc.layers.length; i++) if (doc.layers[i].name === OC_MARKER_LAYER) return doc.layers[i];
  return null;
}

function OC_clearMarkers() {
  return OC_run(function () {
    if (app.documents.length === 0) return { removed: 0 };
    var doc = app.activeDocument, layer = OC_markerLayer(doc), n = 0;
    while (layer) {
      layer.locked = false;
      layer.visible = true;
      layer.remove();
      n++;
      layer = OC_markerLayer(doc);
    }
    return { removed: n };
  });
}

// payload: {points:[{x, y, kind: "box"|"optical"|"target"}]}. Drawn once, on a locked non-printing layer.
function OC_preview(payload) {
  return OC_run(function () {
    var doc = OC_doc(), data = OC_parse(payload), prev = doc.activeLayer, layer, i, p, arm, c;
    var colors = {
      box: OC_rgb(228, 0, 124),
      optical: OC_rgb(41, 161, 145),
      target: OC_rgb(41, 161, 145)
    };
    while (OC_markerLayer(doc)) { var old = OC_markerLayer(doc); old.locked = false; old.remove(); }
    layer = doc.layers.add();
    layer.name = OC_MARKER_LAYER;
    layer.printable = false;
    for (i = 0; i < data.points.length; i++) {
      p = data.points[i];
      c = colors[p.kind] || colors.optical;
      arm = p.kind === "target" ? 9 : 6;
      OC_line(layer, [[p.x - arm, p.y], [p.x + arm, p.y]], c);
      OC_line(layer, [[p.x, p.y - arm], [p.x, p.y + arm]], c);
      if (p.kind !== "box") {
        var ring = layer.pathItems.ellipse(p.y + 3, p.x - 3, 6, 6);
        ring.filled = false; ring.stroked = true; ring.strokeWidth = 1; ring.strokeColor = c;
      }
    }
    layer.locked = true;
    try { doc.activeLayer = prev; } catch (e) {}
    return { drawn: data.points.length };
  });
}

function OC_rgb(r, g, b) { var c = new RGBColor(); c.red = r; c.green = g; c.blue = b; return c; }

function OC_line(layer, pts, color) {
  var l = layer.pathItems.add();
  l.setEntirePath(pts);
  l.filled = false; l.stroked = true; l.strokeWidth = 1; l.strokeColor = color;
}

// payload: {fingerprints:[...], deltas:[{dx, dy}]} in the same topmost-first order OC_read used.
// One script run, so one undo step.
function OC_move(payload) {
  return OC_run(function () {
    var doc = OC_doc(), data = OC_parse(payload), list = OC_selectionSorted(doc), i, d, moved = 0;
    if (list.length !== data.deltas.length) throw new Error("The selection changed. Run it again.");
    for (i = 0; i < list.length; i++) {
      if (OC_fingerprint(list[i].item) !== data.fingerprints[i]) throw new Error("The selection changed. Run it again.");
    }
    for (i = 0; i < list.length; i++) {
      d = data.deltas[i];
      if (Math.abs(d.dx) < 1e-9 && Math.abs(d.dy) < 1e-9) continue;
      list[i].item.translate(d.dx, d.dy);
      moved++;
    }
    return { moved: moved };
  });
}
