/* Builds the Optical Center test document: five cells, each a circle container plus one subject
   centered by its bounding box (so every subject starts optically off-center).
   Cells (left to right): play triangle, star, live-text J, compound path with a hole, stroke-only L.
   Items are named container-N / play / star / J / hole / stroke-L. Coordinates are y-up. */

function OC_makeTestDoc() {
  var oldLevel = app.userInteractionLevel;
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  try {
    var doc = app.documents.add(DocumentColorSpace.RGB, 1250, 300);
    var ink = rgb(18, 19, 22), grey = rgb(216, 217, 214), teal = rgb(41, 161, 145);
    var cells = [], k, cx, cy = 150;

    for (k = 0; k < 5; k++) {
      cx = 125 + 250 * k;
      var c = doc.pathItems.ellipse(cy + 100, cx - 100, 200, 200);
      c.fillColor = grey; c.stroked = false; c.name = "container-" + (k + 1);
      cells.push(cx);
    }

    // 1. play triangle, pointing right
    var cx1 = cells[0];
    var tri = doc.pathItems.add();
    tri.setEntirePath([[cx1 - 40, cy - 50], [cx1 + 40, cy], [cx1 - 40, cy + 50]]);
    tri.closed = true; tri.fillColor = ink; tri.stroked = false; tri.name = "play";
    centerByBounds(tri, cx1, cy);

    // 2. five-point star
    var star = doc.pathItems.star(cells[1], cy, 60, 25, 5);
    star.fillColor = ink; star.stroked = false; star.name = "star";
    centerByBounds(star, cells[1], cy);

    // 3. live-text J
    var tf = doc.textFrames.add();
    tf.contents = "J";
    tf.textRange.characterAttributes.size = 130;
    try { tf.textRange.characterAttributes.textFont = app.textFonts.getByName("ArialMT"); } catch (e) {}
    tf.textRange.characterAttributes.fillColor = ink;
    tf.name = "J";
    var probe = tf.duplicate().createOutline();
    var pb = probe.geometricBounds;
    tf.translate(cells[2] - (pb[0] + pb[2]) / 2, cy - (pb[1] + pb[3]) / 2);
    probe.remove();

    // 4. compound path with a hole wound opposite to the outer (non-zero rule)
    var cp = doc.compoundPathItems.add();
    cp.pathItems.rectangle(cy + 40, cells[3] - 50, 100, 80, false);
    cp.pathItems.rectangle(cy + 20, cells[3] - 40, 30, 40, true);
    cp.pathItems[0].fillColor = ink;
    cp.name = "hole";
    centerByBounds(cp, cells[3], cy);

    // 5. stroke-only open L polyline
    var L = doc.pathItems.add();
    L.setEntirePath([[cells[4] - 30, cy + 50], [cells[4] - 30, cy - 50], [cells[4] + 40, cy - 50]]);
    L.closed = false; L.filled = false; L.stroked = true; L.strokeWidth = 16; L.strokeColor = teal;
    L.name = "stroke-L";
    // bounds exclude the stroke; the engine measures the outlined stroke, so this starts roughly centered
    centerByBounds(L, cells[4], cy);

    // subjects above containers
    var names = ["play", "star", "J", "hole", "stroke-L"], i;
    for (i = 0; i < names.length; i++) doc.pageItems.getByName(names[i]).zOrder(ZOrderMethod.BRINGTOFRONT);
    doc.selection = null;
    return doc.name;
  } finally {
    app.userInteractionLevel = oldLevel;
  }

  function rgb(r, g, b) { var c = new RGBColor(); c.red = r; c.green = g; c.blue = b; return c; }
  function centerByBounds(item, x, y) {
    var b = item.geometricBounds;
    item.translate(x - (b[0] + b[2]) / 2, y - (b[1] + b[3]) / 2);
  }
}
