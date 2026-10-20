const test = require('node:test');
const assert = require('node:assert/strict');
const { areaCentroid, groupCentroid, flatten, opticalPoint, moveDelta } = require('../js/optical.js');

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

test('negative coordinates: centroid is still the geometric center', () => {
  const sq = shape([poly([[-100, -50], [-20, -50], [-20, 30], [-100, 30]])]);
  const { x, y, area } = areaCentroid(sq);
  assert.equal(area, 6400);
  close(x, -60);
  close(y, -10);
});

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

// Right-pointing play triangle: bbox center (40, 50), area centroid (80/3, 50).
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

// Circle container (top of the z-order) with a play triangle inside it.
const circle = { bbox: { minX: 0, minY: 0, maxX: 200, maxY: 200 }, centroid: { x: 100, y: 100 } };
const triangle = { bbox: { minX: 50, minY: 50, maxX: 130, maxY: 150 }, centroid: { x: 230 / 3, y: 100 } };
const artboard = { minX: 0, minY: 0, maxX: 400, maxY: 400 };

test('moveDelta container: the rest move into the container, which stays put', () => {
  const d = moveDelta({ mode: 'container', items: [circle, triangle], bias: 0.6, axis: 'both' });
  assert.deepEqual(d[0], { dx: 0, dy: 0 });
  close(d[1].dx, 18);
  close(d[1].dy, 0);
});

test('moveDelta key: the key stays put and everything else moves to it', () => {
  const d = moveDelta({ mode: 'key', items: [circle, triangle], keyIndex: 1, bias: 0.6, axis: 'both' });
  assert.deepEqual(d[1], { dx: 0, dy: 0 });
  close(d[0].dx, -18);
  close(d[0].dy, 0);
});

test('moveDelta key: with no key it falls back to the topmost object', () => {
  const d = moveDelta({ mode: 'key', items: [circle, triangle], bias: 0.6, axis: 'both' });
  assert.deepEqual(d[0], { dx: 0, dy: 0 });
  close(d[1].dx, 18);
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

test('square centroid equals its bbox center', () => {
  const square = shape([poly([[0, 0], [100, 0], [100, 100], [0, 100]])]);
  const { x, y, area } = areaCentroid(square);
  assert.equal(x, 50);
  assert.equal(y, 50);
  assert.equal(area, 10000);
});
