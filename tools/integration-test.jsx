/* Integration test for the engine plus optical.js, run inside Illustrator on the test document
   built by make-test-doc.jsx. Load order: engine.jsx, make-test-doc.jsx (or open the saved .ai),
   then this file. Entry point: OCT_runSubject(name, cell) returns report lines.

   ExtendScript is ES3, so the few ES5 array helpers optical.js uses are polyfilled here only. */

var OCT_ROOT = "/Users/jose/jro-optical-center";

function OCT_load() {
  if (!Array.prototype.forEach) Array.prototype.forEach = function (f, t) { for (var i = 0; i < this.length; i++) f.call(t, this[i], i, this); };
  if (!Array.prototype.map) Array.prototype.map = function (f, t) { var r = []; for (var i = 0; i < this.length; i++) r.push(f.call(t, this[i], i, this)); return r; };
  if (!Array.prototype.filter) Array.prototype.filter = function (f, t) { var r = []; for (var i = 0; i < this.length; i++) if (f.call(t, this[i], i, this)) r.push(this[i]); return r; };
  if (!Array.prototype.some) Array.prototype.some = function (f, t) { for (var i = 0; i < this.length; i++) if (f.call(t, this[i], i, this)) return true; return false; };
  if (!Object.keys) Object.keys = function (o) { var r = []; for (var k in o) if (o.hasOwnProperty(k)) r.push(k); return r; };
  $.evalFile(new File(OCT_ROOT + "/js/optical.js"));
}

function OCT_parse(s) { return eval("(" + s + ")"); }

function OCT_select(doc, names) {
  doc.selection = null;
  for (var i = 0; i < names.length; i++) doc.pageItems.getByName(names[i]).selected = true;
}

function OCT_opticalOf(read, index, bias) {
  var it = read.items[index], g = Optical.groupCentroid(it.shapes), b = Optical.bounds(it.shapes);
  return Optical.opticalPoint(b, { x: g.x, y: g.y }, bias, "both");
}

function OCT_dist(p, q) { return Math.sqrt(Math.pow(p.x - q.x, 2) + Math.pow(p.y - q.y, 2)); }
function OCT_f(n) { return Math.round(n * 1000) / 1000; }

// One subject, all three modes. cell is 1-5 (which container it sits in).
function OCT_runSubject(subject, cell) {
  var oldLevel = app.userInteractionLevel, lines = [], bias = 0.6;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    OCT_load();
    var doc = app.activeDocument, container = "container-" + cell, subj = doc.pageItems.getByName(subject);
    var modes = ["container", "key", "artboard"], m, t0 = new Date().getTime();

    for (m = 0; m < modes.length; m++) {
      var mode = modes[m], names, boardCenter = { x: 625, y: 150 };
      var before = subj.geometricBounds.slice(0), cBefore = doc.pageItems.getByName(container).geometricBounds.slice(0);
      if (mode === "container") { doc.pageItems.getByName(container).zOrder(ZOrderMethod.BRINGTOFRONT); names = [container, subject]; }
      else if (mode === "key") names = [container, subject];
      else names = [subject];
      OCT_select(doc, names);

      var read = OCT_parse(OC_read(mode === "key" ? String(subj.uuid) : "", doc.name));
      if (!read.ok) { lines.push(subject + "/" + mode + ": READ FAILED " + read.error); continue; }
      var plan = Optical.planMove(read, { mode: mode, bias: bias, axis: "both" });
      if (plan.error) { lines.push(subject + "/" + mode + ": PLAN ERROR " + plan.error); continue; }

      var clr = OCT_parse(OC_clearMarkers());
      var mv = OCT_parse(OC_move(OC_json({ fingerprints: plan.fingerprints, deltas: plan.deltas })));
      if (!mv.ok) { lines.push(subject + "/" + mode + ": MOVE FAILED " + mv.error); continue; }

      // verify: re-read after the move and compare optical points
      var after = OCT_parse(OC_read(mode === "key" ? String(subj.uuid) : "", doc.name));
      var resid, desc = "";
      var si = -1, ci = -1, i;
      for (i = 0; i < after.items.length; i++) { if (after.items[i].label === subject) si = i; if (after.items[i].label === container) ci = i; }
      if (mode === "artboard") resid = OCT_dist(OCT_opticalOf(after, si, bias), boardCenter);
      else resid = OCT_dist(OCT_opticalOf(after, si, bias), OCT_opticalOf(after, ci, bias));

      var sd = plan.deltas[0];
      for (i = 0; i < read.items.length; i++) if (read.items[i].label === subject) sd = plan.deltas[i];
      desc = "subject delta=(" + OCT_f(sd.dx) + "," + OCT_f(sd.dy) + ")";
      if (mode === "key") { for (i = 0; i < read.items.length; i++) if (read.items[i].label === container) desc = "container delta=(" + OCT_f(plan.deltas[i].dx) + "," + OCT_f(plan.deltas[i].dy) + ")"; }
      lines.push(subject + "/" + mode + ": " + desc + " residual=" + OCT_f(resid) + (plan.warnings.length ? " warn=" + plan.warnings.join(" | ") : "") + (resid < 0.1 ? " PASS" : " FAIL"));

      // restore
      var nowS = subj.geometricBounds, nowC = doc.pageItems.getByName(container).geometricBounds;
      subj.translate(before[0] - nowS[0], before[1] - nowS[1]);
      doc.pageItems.getByName(container).translate(cBefore[0] - nowC[0], cBefore[1] - nowC[1]);
      if (mode === "container") doc.pageItems.getByName(container).zOrder(ZOrderMethod.SENDTOBACK);
    }
    doc.selection = null;
    lines.push("elapsed ms=" + (new Date().getTime() - t0) + " docs=" + app.documents.length + " layers=" + doc.layers.length + " items=" + doc.pageItems.length);
  } catch (e) {
    lines.push("ERR " + e.message + " line " + e.line);
  }
  app.userInteractionLevel = oldLevel;
  return lines.join("\n");
}
