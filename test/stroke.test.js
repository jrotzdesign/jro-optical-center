const test = require('node:test');
const assert = require('node:assert/strict');
const { piecesToShapes, groupCentroid, bounds } = require('../js/optical.js');

const pt = (x, y) => ({ anchor: [x, y], left: [x, y], right: [x, y] });
const path = (coords, closed = true) => ({ closed, polarity: 1, points: coords.map(([x, y]) => pt(x, y)) });
const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not within ${eps} of ${expected}`);
const stroke = (width, extra = {}) => ({ width, join: 'miter', cap: 'butt', miterLimit: 10, ...extra });
const measure = (pieces) => groupCentroid(piecesToShapes(pieces));

const square = path([[0, 0], [100, 0], [100, 100], [0, 100]]);
// The stroke-only L from the test document, in local coordinates (cell center at 0, 0).
const L = path([[-35, 50], [-35, -50], [35, -50]], false);

test('stroke only, closed square: the band between the 5 pt offsets', () => {
  const g = measure([{ fill: false, stroke: stroke(10), evenodd: false, paths: [square] }]);
  close(g.area, 110 * 110 - 90 * 90); // 4000
  close(g.x, 50);
  close(g.y, 50);
});

test('fill and stroke, closed square: the fill grows by half the stroke', () => {
  const pieces = [{ fill: true, stroke: stroke(10), evenodd: false, paths: [square] }];
  close(measure(pieces).area, 110 * 110); // 12100
  const b = bounds(piecesToShapes(pieces));
  assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY], [-5, -5, 105, 105]);
});

// Hand arithmetic for the L, 16 pt, miter join, butt caps:
//   vertical bar x -43..-27, y -58..50  = 16 * 108 = 1728, center (-35, -4)
//   foot         x -27..35,  y -58..-42 = 62 * 16  =  992, center (4, -50)
//   area 2720; x = (-35*1728 + 4*992) / 2720 = -56512 / 2720; y = (-4*1728 - 50*992) / 2720 = -56512 / 2720
test('stroke only, open L with a miter corner: matches the outlined region', () => {
  const g = measure([{ fill: false, stroke: stroke(16), evenodd: false, paths: [L] }]);
  close(g.area, 2720);
  close(g.x, -56512 / 2720);
  close(g.y, -56512 / 2720);
});

test('bevel join cuts the 8 x 8 corner square in half', () => {
  const g = measure([{ fill: false, stroke: stroke(16, { join: 'bevel' }), evenodd: false, paths: [L] }]);
  close(g.area, 2720 - 32);
});

test('a miter over the limit becomes a bevel (90 degrees needs 1.414)', () => {
  const g = measure([{ fill: false, stroke: stroke(16, { miterLimit: 1 }), evenodd: false, paths: [L] }]);
  close(g.area, 2720 - 32);
});

test('round join swaps the corner square for a quarter circle of radius 8', () => {
  const g = measure([{ fill: false, stroke: stroke(16, { join: 'round' }), evenodd: false, paths: [L] }]);
  close(g.area, 2720 - 64 + Math.PI * 64 / 4, 0.5);
});

test('round caps add a half disc at each end', () => {
  const line = path([[0, 0], [100, 0]], false);
  const g = measure([{ fill: false, stroke: stroke(10, { cap: 'round' }), evenodd: false, paths: [line] }]);
  close(g.area, 100 * 10 + Math.PI * 25, 0.5);
  close(g.x, 50, 1e-3);
  close(g.y, 0, 1e-3);
});

test('projecting caps extend each end by half the stroke', () => {
  const line = path([[0, 0], [100, 0]], false);
  const g = measure([{ fill: false, stroke: stroke(10, { cap: 'projecting' }), evenodd: false, paths: [line] }]);
  close(g.area, 110 * 10);
  close(g.x, 50);
});

// Outer 0..100 x 0..80, hole 20..50 x 20..60 wound the other way, 4 pt stroke:
//   outer grows by 2: 104 * 84 = 8736, center (50, 40)
//   hole shrinks by 2: 26 * 36 = 936, center (35, 40)
//   area 7800; x = (50*8736 - 35*936) / 7800 = 404040 / 7800 = 51.8
test('fill and stroke on a compound path: the outer grows and the hole shrinks', () => {
  const outer = path([[0, 0], [100, 0], [100, 80], [0, 80]]);
  const hole = path([[20, 20], [20, 60], [50, 60], [50, 20]]);
  const g = measure([{ fill: true, stroke: stroke(4), evenodd: false, paths: [outer, hole] }]);
  close(g.area, 7800);
  close(g.x, 51.8);
  close(g.y, 40);
});

test('stroke only, bezier circle: the ring is about 2 pi r w', () => {
  const K = 0.5522847498, r = 100;
  const circle = {
    closed: true, polarity: 1,
    points: [
      { anchor: [r, 0], left: [r, -K * r], right: [r, K * r] },
      { anchor: [0, r], left: [K * r, r], right: [-K * r, r] },
      { anchor: [-r, 0], left: [-r, K * r], right: [-r, -K * r] },
      { anchor: [0, -r], left: [-K * r, -r], right: [K * r, -r] },
    ],
  };
  const g = measure([{ fill: false, stroke: stroke(10), evenodd: false, paths: [circle] }]);
  close(g.area / (2 * Math.PI * r * 10), 1, 0.005);
  close(g.x, 0, 0.05);
  close(g.y, 0, 0.05);
});

test('fill only passes straight through', () => {
  const g = measure([{ fill: true, stroke: null, evenodd: false, paths: [square] }]);
  close(g.area, 10000);
});
