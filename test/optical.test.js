const test = require('node:test');
const assert = require('node:assert/strict');
const { areaCentroid } = require('../js/optical.js');

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

test('square centroid equals its bbox center', () => {
  const square = shape([poly([[0, 0], [100, 0], [100, 100], [0, 100]])]);
  const { x, y, area } = areaCentroid(square);
  assert.equal(x, 50);
  assert.equal(y, 50);
  assert.equal(area, 10000);
});
