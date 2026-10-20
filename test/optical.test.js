const test = require('node:test');
const assert = require('node:assert/strict');
const { areaCentroid, groupCentroid, flatten, opticalPoint, moveDelta, bounds } = require('../js/optical.js');

// Straight-cornered point: handles sit on the anchor, as Illustrator reports them.
const pt = (x, y) => ({ anchor: [x, y], left: [x, y], right: [x, y] });
const poly = (coords, polarity = 1) => ({
  closed: true,
  polarity,
  points: coords.map(([x, y]) => pt(x, y)),
});
const shape = (paths, evenodd = false) => ({ evenodd, paths });

const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not within ${eps} of ${expected}`);

// Hand arithmetic for the 100x100 outer with a 20x30 hole at x 60-80, y 20-50:
//   area   = 10000 - 20*30 = 9400
//   x      = (50*10000 - 70*600) / 9400 = (500000 - 42000) / 9400 = 458000 / 9400
//   y      = (50*10000 - 35*600) / 9400 = (500000 - 21000) / 9400 = 479000 / 9400
test('even-odd hole with the SAME winding as the outer is still subtracted', () => {
  const outer = poly([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const hole = poly([[60, 20], [80, 20], [80, 50], [60, 50]]); // same CCW winding
  const { x, y, area } = areaCentroid(shape([outer, hole], true));
  assert.equal(area, 9400);
  close(x, 458000 / 9400);
  close(y, 479000 / 9400);
});

test('non-zero: inner subpath with the SAME winding is filled, not subtracted or double counted', () => {
  const outer = poly([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const inner = poly([[60, 20], [80, 20], [80, 50], [60, 50]]); // winding number 2: still filled
  const { x, y, area } = areaCentroid(shape([outer, inner], false));
  assert.equal(area, 10000); // the union is just the outer square
  close(x, 50);
  close(y, 50);
});

test('non-zero: inner subpath with the OPPOSITE winding is a hole', () => {
  const outer = poly([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const inner = poly([[60, 20], [60, 50], [80, 50], [80, 20]]); // CW inside CCW
  const { x, y, area } = areaCentroid(shape([outer, inner], false));
  assert.equal(area, 9400);
  close(x, 458000 / 9400);
  close(y, 479000 / 9400);
});

// x -100..-20 is 80 wide, y -50..30 is 80 tall: area 80*80 = 6400,
// center x = (-100 + -20) / 2 = -60, center y = (-50 + 30) / 2 = -10.
test('negative coordinates: centroid is still the geometric center', () => {
  const sq = shape([poly([[-100, -50], [-20, -50], [-20, 30], [-100, 30]])]);
  const { x, y, area } = areaCentroid(sq);
  assert.equal(area, 6400);
  close(x, -60);
  close(y, -10);
});

// Two 100x100 squares, centers x=50 and x=100, y=50 for both:
//   area = 10000 + 10000 = 20000, x = (50*10000 + 100*10000) / 20000 = 75, y = 50.
test('group: areas are summed and overlaps count twice (known limit)', () => {
  const a = shape([poly([[0, 0], [100, 0], [100, 100], [0, 100]])]);
  const b = shape([poly([[50, 0], [150, 0], [150, 100], [50, 100]])]);
  const { x, y, area } = groupCentroid([a, b]);
  assert.equal(area, 20000); // union would be 15000; the overlap is deliberately double counted
  close(x, 75);
  close(y, 50);
});

// Four-point circle, radius r, centered at the origin, standard kappa handles.
const K = 0.5522847498;
const circlePath = (r) => ({
  closed: true,
  polarity: 1,
  points: [
    { anchor: [r, 0], left: [r, -K * r], right: [r, K * r] },
    { anchor: [0, r], left: [K * r, r], right: [-K * r, r] },
    { anchor: [-r, 0], left: [-r, K * r], right: [-r, -K * r] },
    { anchor: [0, -r], left: [-K * r, -r], right: [K * r, -r] },
  ],
});

test('flatten: straight segments are not subdivided', () => {
  const sq = poly([[0, 0], [100, 0], [100, 100], [0, 100]]);
  assert.equal(flatten(sq, 0.01).length, 4);
});

test('flatten: a circle keeps its area within 0.2% of pi r^2', () => {
  const { area } = areaCentroid(shape([circlePath(100)]));
  close(area / (Math.PI * 100 * 100), 1, 0.002);
});

test('flatten: a looser tolerance yields fewer vertices', () => {
  const tight = flatten(circlePath(100), 0.01).length;
  const loose = flatten(circlePath(100), 1).length;
  assert.ok(loose < tight, `${loose} should be fewer than ${tight}`);
  assert.ok(loose >= 8, 'still more than the four anchors');
});

// Right-pointing play triangle (0,0) (0,100) (80,50):
//   bbox center = (80/2, 100/2) = (40, 50); centroid = ((0+0+80)/3, (0+100+50)/3) = (80/3, 50).
//   bias 0.6 on x: 40 + 0.6 * (80/3 - 40) = 40 + 0.6 * (-40/3) = 40 - 8 = 32.
const playBBox = { minX: 0, minY: 0, maxX: 80, maxY: 100 };
const playCentroid = { x: 80 / 3, y: 50 };

test('opticalPoint: bias 0 is the bbox center, bias 1 is the centroid', () => {
  const p0 = opticalPoint(playBBox, playCentroid, 0, 'both');
  const p1 = opticalPoint(playBBox, playCentroid, 1, 'both');
  assert.deepEqual(p0, { x: 40, y: 50 });
  close(p1.x, 80 / 3);
  close(p1.y, 50);
});

test('opticalPoint: bias 0.6 blends toward the centroid', () => {
  const p = opticalPoint(playBBox, playCentroid, 0.6, 'both');
  close(p.x, 32);
  close(p.y, 50);
});

test('opticalPoint: an excluded axis comes back null', () => {
  assert.equal(opticalPoint(playBBox, playCentroid, 0.6, 'h').y, null);
  assert.equal(opticalPoint(playBBox, playCentroid, 0.6, 'v').x, null);
  close(opticalPoint(playBBox, playCentroid, 0.6, 'h').x, 32);
});

// Play triangle in front of a circle container. Items are passed topmost first, so the
// circle (the back-most object) comes last and is the container.
// Triangle (50,50) (50,150) (130,100): bbox center = (90, 100), centroid = (230/3, 100).
//   optical x at bias 0.6 = 90 + 0.6 * (230/3 - 90) = 90 + 0.6 * (-40/3) = 90 - 8 = 82.
//   Circle optical point = (100, 100). Container mode: dx = 100 - 82 = 18, dy = 100 - 100 = 0.
//   Key mode on the triangle: the circle moves dx = 82 - 100 = -18.
//   Artboard center (200, 200): dx = 200 - 82 = 118, dy = 200 - 100 = 100.
const circle = { bbox: { minX: 0, minY: 0, maxX: 200, maxY: 200 }, centroid: { x: 100, y: 100 } };
const triangle = { bbox: { minX: 50, minY: 50, maxX: 130, maxY: 150 }, centroid: { x: 230 / 3, y: 100 } };
const artboard = { minX: 0, minY: 0, maxX: 400, maxY: 400 };

test('moveDelta container: the back-most object is the container and stays put', () => {
  const d = moveDelta({ mode: 'container', items: [triangle, circle], bias: 0.6, axis: 'both' });
  assert.deepEqual(d[1], { dx: 0, dy: 0 });
  close(d[0].dx, 18);
  close(d[0].dy, 0);
});

test('moveDelta container: when the circle is in front, the back-most triangle is the container', () => {
  const d = moveDelta({ mode: 'container', items: [circle, triangle], bias: 0.6, axis: 'both' });
  assert.deepEqual(d[1], { dx: 0, dy: 0 });
  close(d[0].dx, -18); // circle optical x 100 moves to triangle optical x 82
});

test('moveDelta key: the key stays put and everything else moves to it', () => {
  const d = moveDelta({ mode: 'key', items: [triangle, circle], keyIndex: 0, bias: 0.6, axis: 'both' });
  assert.deepEqual(d[0], { dx: 0, dy: 0 });
  close(d[1].dx, -18);
  close(d[1].dy, 0);
});

test('moveDelta key: with no key it falls back to the back-most object', () => {
  const d = moveDelta({ mode: 'key', items: [triangle, circle], bias: 0.6, axis: 'both' });
  assert.deepEqual(d[1], { dx: 0, dy: 0 });
  close(d[0].dx, 18);
});

test('moveDelta artboard: each item moves its optical point to the artboard center', () => {
  const d = moveDelta({ mode: 'artboard', items: [triangle], artboard, bias: 0.6, axis: 'both' });
  close(d[0].dx, 118); // 200 - 82
  close(d[0].dy, 100); // 200 - 100
});

test('moveDelta: H only and V only zero the other axis', () => {
  const h = moveDelta({ mode: 'artboard', items: [triangle], artboard, bias: 0.6, axis: 'h' });
  const v = moveDelta({ mode: 'artboard', items: [triangle], artboard, bias: 0.6, axis: 'v' });
  close(h[0].dx, 118);
  assert.equal(h[0].dy, 0);
  assert.equal(v[0].dx, 0);
  close(v[0].dy, 100);
});

test('crossing subpaths set the crossing flag', () => {
  const a = poly([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const b = poly([[50, 50], [150, 50], [150, 150], [50, 150]]); // edges cross a's edges
  assert.equal(areaCentroid(shape([a, b])).crossing, true);
});

test('nested or lone subpaths do not set the crossing flag', () => {
  const outer = poly([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const hole = poly([[60, 20], [80, 20], [80, 50], [60, 50]]);
  assert.equal(areaCentroid(shape([outer, hole], true)).crossing, false);
  assert.equal(areaCentroid(shape([outer])).crossing, false);
});

test('a self-intersecting bow-tie sets the crossing flag', () => {
  const bow = poly([[0, 0], [100, 100], [100, 0], [0, 100]]);
  assert.equal(areaCentroid(shape([bow])).crossing, true);
});

test('group: the crossing flag is set when any member crosses itself', () => {
  const clean = shape([poly([[0, 0], [100, 0], [100, 100], [0, 100]])]);
  const bow = shape([poly([[0, 0], [100, 100], [100, 0], [0, 100]])]);
  assert.equal(groupCentroid([clean, clean]).crossing, false);
  assert.equal(groupCentroid([clean, bow]).crossing, true);
});

test('bounds: a bezier circle spans its anchors, -100..100 on both axes', () => {
  const b = bounds([shape([circlePath(100)])]);
  close(b.minX, -100, 0.01);
  close(b.maxX, 100, 0.01);
  close(b.minY, -100, 0.01);
  close(b.maxY, 100, 0.01);
});

test('bounds: unions several shapes, negative coordinates included', () => {
  const a = shape([poly([[-100, -50], [-20, -50], [-20, 30], [-100, 30]])]);
  const b = shape([poly([[10, 40], [60, 40], [60, 90], [10, 90]])]);
  assert.deepEqual(bounds([a, b]), { minX: -100, minY: -50, maxX: 60, maxY: 90 });
});

test('square centroid equals its bbox center', () => {
  const square = shape([poly([[0, 0], [100, 0], [100, 100], [0, 100]])]);
  const { x, y, area } = areaCentroid(square);
  assert.equal(x, 50);
  assert.equal(y, 50);
  assert.equal(area, 10000);
});
