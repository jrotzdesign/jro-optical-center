const test = require('node:test');
const assert = require('node:assert/strict');
const { planMove } = require('../js/optical.js');

const pt = (x, y) => ({ anchor: [x, y], left: [x, y], right: [x, y] });
const poly = (coords) => ({ closed: true, polarity: 1, points: coords.map(([x, y]) => pt(x, y)) });
const shape = (paths, evenodd = false) => ({ evenodd, paths });
const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not within ${eps} of ${expected}`);

// Square container 0..200 (optical point 100,100) and the triangle (50,50) (50,150) (130,100).
// At bias 0.6 the triangle's optical x is 82 (see optical.test.js), so moving it into the
// container is dx = 18, and moving the container onto it is dx = -18.
const container = {
  label: 'container', isKey: false, warnings: [],
  shapes: [shape([poly([[0, 0], [200, 0], [200, 200], [0, 200]])])],
};
const triangle = {
  label: 'play', isKey: false, warnings: [],
  shapes: [shape([poly([[50, 50], [130, 100], [50, 150]])])],
};
// items are topmost first, as the engine sends them
const read = (items, extra = {}) => ({ items, artboards: [[0, 400, 600, 0]], activeArtboard: 0, ...extra });
const opts = { bias: 0.6, axis: 'both' };

const shifted = (item, dx) => ({
  ...item,
  shapes: item.shapes.map((s) => ({
    ...s,
    paths: s.paths.map((p) => ({
      ...p,
      points: p.points.map((q) => ({
        anchor: [q.anchor[0] + dx, q.anchor[1]],
        left: [q.left[0] + dx, q.left[1]],
        right: [q.right[0] + dx, q.right[1]],
      })),
    })),
  })),
});

test('two objects: the back-most is the container, the triangle moves 18 right', () => {
  const plan = planMove(read([triangle, container]), opts);
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.labels, ['play', 'container']);
  close(plan.deltas[0].dx, 18);
  close(plan.deltas[0].dy, 0);
  assert.deepEqual(plan.deltas[1], { dx: 0, dy: 0 });
  assert.deepEqual(plan.summary, { mode: 'container', anchor: 'container', movers: ['play'] });
});

test('two objects with the container in front: the back-most triangle stays, the container moves', () => {
  const plan = planMove(read([container, triangle]), opts);
  close(plan.deltas[0].dx, -18);
  assert.deepEqual(plan.deltas[1], { dx: 0, dy: 0 });
  assert.deepEqual(plan.summary, { mode: 'container', anchor: 'play', movers: ['container'] });
});

test('a keyed object overrides the back-most rule', () => {
  const keyed = { ...triangle, isKey: true };
  const plan = planMove(read([keyed, container]), opts);
  assert.deepEqual(plan.deltas[0], { dx: 0, dy: 0 });
  close(plan.deltas[1].dx, -18);
  assert.deepEqual(plan.summary, { mode: 'key', anchor: 'play', movers: ['container'] });
  assert.equal(plan.warnings.length, 0);
});

test('one object: centers on the artboard that holds it, else the active one', () => {
  const two = { artboards: [[0, 400, 600, 0], [700, 400, 1300, 0]], activeArtboard: 0 };
  // Shifted 700 right: optical point (782, 100). Artboard 2 center is (1000, 200).
  const inside = planMove(read([shifted(triangle, 700)], two), opts);
  close(inside.deltas[0].dx, 218);
  close(inside.deltas[0].dy, 100);
  assert.deepEqual(inside.summary, { mode: 'artboard', anchor: null, movers: ['play'] });
  // Shifted 2000 right: held by no artboard, so the active one (center 300, 200) is used.
  const outside = planMove(read([shifted(triangle, 2000)], two), opts);
  close(outside.deltas[0].dx, 300 - 2082);
});

test('nothing selected: a plain-English error and no deltas', () => {
  const plan = planMove(read([]), opts);
  assert.match(plan.error, /select/i);
  assert.equal(plan.deltas, undefined);
});

test('a zero-area object falls back to its box center with a warning', () => {
  const line = {
    label: 'rule', isKey: false, warnings: [],
    shapes: [shape([{ closed: false, polarity: 1, points: [pt(0, 0), pt(100, 0)] }])],
  };
  const plan = planMove(read([line]), { bias: 1, axis: 'both' });
  close(plan.deltas[0].dx, 250); // box center (50, 0) to artboard center (300, 200)
  close(plan.deltas[0].dy, 200);
  assert.match(plan.warnings.join(' '), /rule.*no area/i);
});

test('crossing paths produce a warning naming the object', () => {
  const a = poly([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const b = poly([[50, 50], [150, 50], [150, 150], [50, 150]]);
  const knot = { label: 'knot', isKey: false, warnings: [], shapes: [shape([a, b])] };
  const plan = planMove(read([knot, container]), opts);
  assert.match(plan.warnings.join(' '), /knot.*cross/i);
});

test("the engine's own warnings are kept, prefixed with the object", () => {
  const noisy = { ...triangle, warnings: ['measured by its clip shape.'] };
  const plan = planMove(read([noisy, container]), opts);
  assert.ok(plan.warnings.includes('play: measured by its clip shape.'));
});

test('preview points: a box point per object, an optical point per mover, one target', () => {
  const plan = planMove(read([triangle, container]), opts);
  const kinds = plan.points.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['box', 'box', 'optical', 'target']);
  const target = plan.points.find((p) => p.kind === 'target');
  close(target.x, 100);
  close(target.y, 100);
  const optical = plan.points.find((p) => p.kind === 'optical');
  close(optical.x, 82);
  close(optical.y, 100);
});

// An object with no fill and no stroke reaches planMove with no shapes at all. Its bounds are
// infinite, which used to turn into NaN deltas and a failed translate() in Illustrator.
test('an object with nothing to measure gives a plain error, never NaN', () => {
  const empty = { label: 'J', isKey: false, warnings: [], pieces: [] };
  assert.deepEqual(planMove(read([empty, container]), opts), { error: 'J has no fill or stroke, so there is nothing to measure.' });
  assert.deepEqual(planMove(read([triangle, { ...empty, label: 'circle' }]), opts), { error: 'circle has no fill or stroke, so there is nothing to measure.' });
});
