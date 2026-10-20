/* Optical Center: ExtendScript engine.
   Every entry point returns a JSON string: {ok:true, ...} or {ok:false, error}.
   Geometry is read straight from the live document: reading changes nothing and adds no undo
   steps. Strokes are sent as their style (width, join, cap) and turned into mass by optical.js.
   Live text is the one exception: it is outlined on a copy in a scratch document that is opened
   and closed within the same call. Only OC_move and the marker layer change the document. */

var OC_MARKER_LAYER = "__optical_center_markers__";
var OC_MAX_DEPTH = 12;

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
// Errors carry a code the panel turns into plain English.
function OC_run(fn) {
  var oldLevel = app.userInteractionLevel, oldCS = app.coordinateSystem, res;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    res = fn();
    if (!res) res = {};
    res.ok = true;
  } catch (e) {
    res = { ok: false, code: e.ocCode || "internal", error: String(e.message || e) };
  }
  try { app.coordinateSystem = oldCS; } catch (e2) {}
  try { app.userInteractionLevel = oldLevel; } catch (e3) {}
  return OC_json(res);
}

function OC_fail(code, message) {
  var e = new Error(message);
  e.ocCode = code;
  throw e;
}

function OC_doc() {
  if (app.documents.length === 0) OC_fail("no-document", "No document is open.");
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

// ---------- plain names for the live line ----------

function OC_near(a, b, tol) { return Math.abs(a - b) <= tol; }

function OC_isCorner(p) {
  return OC_near(p.anchor[0], p.leftDirection[0], 1e-6) && OC_near(p.anchor[1], p.leftDirection[1], 1e-6) &&
         OC_near(p.anchor[0], p.rightDirection[0], 1e-6) && OC_near(p.anchor[1], p.rightDirection[1], 1e-6);
}

function OC_pathKind(p) {
  var pts = p.pathPoints, n = pts.length, i, corners = 0, b = p.geometricBounds, w = b[2] - b[0], h = b[1] - b[3];
  var square = OC_near(w, h, Math.max(w, h) * 0.02);
  if (!p.closed) return "line";
  for (i = 0; i < n; i++) if (OC_isCorner(pts[i])) corners++;
  if (corners === n) {
    if (n === 3) return "triangle";
    if (n === 4) {
      var axis = true;
      for (i = 0; i < 4; i++) {
        var a = pts[i].anchor, c = pts[(i + 1) % 4].anchor;
        if (!OC_near(a[0], c[0], 1e-6) && !OC_near(a[1], c[1], 1e-6)) axis = false;
      }
      if (axis) return square ? "square" : "rectangle";
    }
    if (n >= 10 && n % 2 === 0) return "star";
    return "shape";
  }
  if (corners === 0 && n === 4) return square ? "circle" : "ellipse";
  return "shape";
}

// "the triangle", "the text “J”", or the layer name the user gave it.
function OC_describe(item) {
  var t = item.typename, s;
  if (item.name) return item.name;
  if (t === "TextFrame") {
    s = String(item.contents).replace(/[\r\n]+/g, " ");
    return "the text “" + (s.length > 14 ? s.slice(0, 13) + "…" : s) + "”";
  }
  if (t === "PathItem") return "the " + OC_pathKind(item);
  if (t === "CompoundPathItem") return "the compound shape";
  if (t === "GroupItem") return item.clipped ? "the clipping group" : "the group";
  if (t === "PlacedItem" || t === "RasterItem") return "the image";
  if (t === "SymbolItem") return "the symbol";
  return "the object";
}

function OC_hasText(item, depth) {
  var i;
  if (depth > 4) return false;
  if (item.typename === "TextFrame") return true;
  if (item.typename === "GroupItem") {
    for (i = 0; i < item.pageItems.length && i < 200; i++) if (OC_hasText(item.pageItems[i], depth + 1)) return true;
  }
  return false;
}

// ---------- geometry extraction (read-only) ----------

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

function OC_strokeStyle(p) {
  var join = String(p.strokeJoin), cap = String(p.strokeCap);
  return {
    width: p.strokeWidth,
    join: join.indexOf("ROUND") >= 0 ? "round" : (join.indexOf("BEVEL") >= 0 ? "bevel" : "miter"),
    cap: cap.indexOf("ROUND") >= 0 ? "round" : (cap.indexOf("PROJECTING") >= 0 ? "projecting" : "butt"),
    miterLimit: p.strokeMiterLimit
  };
}

function OC_pushPiece(item, st, forceFillOnly) {
  var list = OC_pathsOf(item), first = list[0], paths = [], i, evenodd = false, filled, stroked;
  if (!first || first.guides) return;
  filled = forceFillOnly ? true : first.filled;
  stroked = !forceFillOnly && first.stroked && first.strokeWidth > 0;
  if (!filled && !stroked) { st.warnings.push("An object with no fill or stroke was skipped."); return; }
  for (i = 0; i < list.length; i++) paths.push(OC_pathData(list[i], st));
  try { evenodd = first.evenodd; } catch (e) {}
  try { if (stroked && first.strokeDashes && first.strokeDashes.length) st.warnings.push("Dashed strokes are measured as solid."); } catch (e2) {}
  st.pieces.push({ fill: filled, stroke: stroked ? OC_strokeStyle(first) : null, evenodd: evenodd, paths: paths });
}

function OC_pushBoxPiece(item, st, why) {
  var b = item.geometricBounds, x0 = b[0] + st.dx, y0 = b[1] + st.dy, x1 = b[2] + st.dx, y1 = b[3] + st.dy;
  function pt(x, y) { return { anchor: [x, y], left: [x, y], right: [x, y] }; }
  st.pieces.push({ fill: true, stroke: null, evenodd: false, paths: [{ closed: true, polarity: 1, points: [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)] }] });
  st.warnings.push(why);
}

function OC_isClipPath(it) {
  try {
    if (it.typename === "PathItem") return it.clipping;
    if (it.typename === "CompoundPathItem") return it.pathItems[0].clipping;
  } catch (e) {}
  return false;
}

// Walks an item. Text frames are not read here; they are queued in st.texts for outlining.
function OC_collect(item, st, depth) {
  var t = item.typename, i;
  if (depth > OC_MAX_DEPTH) return;
  try { if (item.hidden) return; } catch (e) {}

  if (t === "GroupItem") {
    if (item.clipped) {
      for (i = 0; i < item.pageItems.length; i++) {
        if (OC_isClipPath(item.pageItems[i])) { OC_pushPiece(item.pageItems[i], st, true); break; }
      }
      st.warnings.push("A clipping group is measured by its clipping shape.");
      return;
    }
    for (i = 0; i < item.pageItems.length; i++) OC_collect(item.pageItems[i], st, depth + 1);
    return;
  }
  if (t === "TextFrame") { st.texts.push(item); return; }
  if (t === "PathItem" || t === "CompoundPathItem") { OC_pushPiece(item, st, false); return; }
  OC_pushBoxPiece(item, st, OC_describe(item).replace(/^the /, "The ") + " is measured by its bounding box.");
}

// Copies an item into the scratch document. duplicate() returns undefined when the original is
// selected, so callers deselect first; the copy is also looked up at the back of the layer.
function OC_copyTo(item, scratch) {
  var copy = item.duplicate(scratch, ElementPlacement.PLACEATEND), list;
  if (!copy) {
    list = scratch.layers[0].pageItems;
    copy = list[list.length - 1];
  }
  if (!copy || copy.typename !== item.typename) OC_fail("copy-failed", "Could not copy " + OC_describe(item) + " for measuring.");
  return copy;
}

// Outlines queued text frames on copies in one scratch document, then closes it unsaved.
function OC_readTexts(doc, entries, list) {
  var scratch = null, i, j;
  try {
    doc.selection = null;
    scratch = app.documents.add(DocumentColorSpace.RGB, 200, 200);
    for (i = 0; i < entries.length; i++) {
      var st = entries[i].st;
      for (j = 0; j < st.texts.length; j++) {
        var tf = st.texts[j], gb = tf.geometricBounds, copy = OC_copyTo(tf, scratch), cb = copy.geometricBounds, g = null;
        try { g = copy.createOutline(); } catch (e) { g = null; }
        var sub = { dx: gb[0] - cb[0], dy: gb[1] - cb[1], pieces: st.pieces, warnings: st.warnings, texts: [] };
        if (g) OC_collect(g, sub, 0);
        else { sub.dx = 0; sub.dy = 0; OC_pushBoxPiece(tf, sub, "Text could not be outlined, so its box was used."); }
      }
    }
  } finally {
    if (scratch) { try { scratch.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {} }
    try { app.activeDocument = doc; } catch (e3) {}
    try {
      doc.selection = null;
      for (i = 0; i < list.length; i++) list[i].item.selected = true;
    } catch (e4) {}
  }
}

// ---------- entry points ----------

function OC_ping() {
  return OC_run(function () { return { version: app.version, docs: app.documents.length }; });
}

// Cheap description of the selection for the panel's live line. Cached by selection signature,
// so polling it costs one pass over the selected items when nothing has changed.
function OC_peek(keyUuid, keyDoc) {
  return OC_run(function () {
    if (app.documents.length === 0) return { doc: null, count: 0, labels: [], hasText: false, keyInSelection: false };
    var doc = app.activeDocument, sel = doc.selection, sig = doc.name, i, n;
    if (!sel || sel.typename === "TextRange") return { doc: doc.name, count: 0, labels: [], hasText: false, keyInSelection: false, editingText: !!sel };
    n = sel.length;
    for (i = 0; i < n && i < 400; i++) sig += "|" + sel[i].uuid + ":" + sel[i].geometricBounds.join(",");
    // A restack keeps every bound the same, so the cache also expires every 3 seconds.
    sig += "|" + keyUuid + "|" + Math.floor(new Date().getTime() / 3000);
    if ($.global.OC_peekCache && $.global.OC_peekCache.sig === sig) return $.global.OC_peekCache.res;

    var res = { doc: doc.name, count: n, labels: [], hasText: false, keyInSelection: false };
    if (n <= 40) {
      var list = OC_selectionSorted(doc);
      for (i = 0; i < list.length; i++) {
        res.labels.push(OC_describe(list[i].item));
        if (OC_hasText(list[i].item, 0)) res.hasText = true;
        if (keyUuid && String(list[i].item.uuid) === String(keyUuid) && doc.name === keyDoc) res.keyInSelection = true;
      }
    }
    $.global.OC_peekCache = { sig: sig, res: res };
    return res;
  });
}

// The selected item's uuid, for the panel to hold as the key for this session.
function OC_peekKey() {
  return OC_run(function () {
    var doc = OC_doc(), sel = doc.selection;
    if (!sel || sel.typename === "TextRange" || sel.length !== 1) OC_fail("key-needs-one", "Select exactly one object to set as the key.");
    return { uuid: sel[0].uuid, doc: doc.name, label: OC_describe(sel[0]) };
  });
}

// Reads the selection (topmost first) as pieces: fill flag, stroke style, bezier paths.
function OC_read(keyUuid, keyDoc) {
  return OC_run(function () {
    var doc = OC_doc(), list = OC_selectionSorted(doc), entries = [], boards = [], i, withText = false;
    if (!list.length) OC_fail("no-selection", "Nothing is selected.");

    for (i = 0; i < doc.artboards.length; i++) boards.push(doc.artboards[i].artboardRect);
    var activeBoard = doc.artboards.getActiveArtboardIndex();

    for (i = 0; i < list.length; i++) {
      var st = { dx: 0, dy: 0, pieces: [], warnings: [], texts: [] };
      OC_collect(list[i].item, st, 0);
      if (st.texts.length) withText = true;
      entries.push({ item: list[i].item, st: st });
    }
    if (withText) OC_readTexts(doc, entries, list);

    var items = [];
    for (i = 0; i < entries.length; i++) {
      var it = entries[i].item;
      items.push({
        label: OC_describe(it),
        isKey: !!keyUuid && String(it.uuid) === String(keyUuid) && doc.name === keyDoc,
        fingerprint: OC_fingerprint(it),
        pieces: entries[i].st.pieces,
        warnings: entries[i].st.warnings
      });
    }
    return { doc: doc.name, items: items, artboards: boards, activeArtboard: activeBoard, usedScratch: withText };
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
    var colors = { box: OC_rgb(228, 0, 124), optical: OC_rgb(41, 161, 145), target: OC_rgb(41, 161, 145) };
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
    if (list.length !== data.deltas.length) OC_fail("selection-changed", "The selection changed.");
    for (i = 0; i < list.length; i++) {
      if (OC_fingerprint(list[i].item) !== data.fingerprints[i]) OC_fail("selection-changed", "The selection changed.");
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
