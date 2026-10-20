const test = require('node:test');
const assert = require('node:assert/strict');
const { planMove } = require('../js/optical.js');

const pt = (x, y) => ({ anchor: [x, y], left: [x, y], right: [x, y] });
const poly = (coords) => ({ closed: true, polarity: 1, points: coords.map(([x, y]) => pt(x, y)) });
const shape = (paths, evenodd = false) => ({ evenodd, paths });
const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not within ${eps} of ${expected}`);

// Same fixture as the moveDelta tests, but arriving as raw read data:
// square container 0..200 (optical point 100,100) and the triangle (50,50) (50,150) (130,100).
// At bias 0.6 the triangle's optical x is 82 (see optical.test.js), so the container-mode dx is 18.
const container = {
  label: 'container', isKey: false, fingerprint: 'c', warnings: [],
  shapes: [shape([poly([[0, 0], [200, 0], [200, 200], [0, 200]])])],
};
const triangle = {
  label: 'play', isKey: false, fingerprint: 't', warnings: [],
  shapes: [shape([poly([[50, 50], [130, 100], [50, 150]])])],
};
const read = (items, extra = {}) => ({ items, artboards: [[0, 400, 600, 0]], activeArtboard: 0, ...extra });

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

test('planMove key: the keyed triangle stays and the container moves 18 left', () => {
  const keyed = { ...triangle, isKey: true };
  const plan = planMove(read([container, keyed]), { mode: 'key', bias: 0.6, axis: 'both' });
  close(plan.deltas[0].dx, -18); // triangle optical x 82 minus container optical x 100
  close(plan.deltas[0].dy, 0);
  assert.deepEqual(plan.deltas[1], { dx: 0, dy: 0 });
  assert.equal(plan.warnings.length, 0);
});

test('planMove key: with no key it uses the topmost object and says so', () => {
  const plan = planMove(read([container, triangle]), { mode: 'key', bias: 0.6, axis: 'both' });
  close(plan.deltas[1].dx, 18);
  assert.match(plan.warnings.join(' '), /No key/);
});

test('planMove artboard: uses the artboard that holds the object, else the active one', () => {
  const two = { artboards: [[0, 400, 600, 0], [700, 400, 1300, 0]], activeArtboard: 0 };
  // Shifted 700 right: optical point (782, 100). Artboard 2 center is (1000, 200).
  const inside = planMove(read([shifted(triangle, 700)], two), { mode: 'artboard', bias: 0.6, axis: 'both' });
  close(inside.deltas[0].dx, 218);
  close(inside.deltas[0].dy, 100);
  // Shifted 2000 right: held by no artboard, so the active one (center 300, 200) is used.
  const outside = planMove(read([shifted(triangle, 2000)], two), { mode: 'artboard', bias: 0.6, axis: 'both' });
  close(outside.deltas[0].dx, 300 - 2082);
});

test('planMove: container and key modes need a second object', () => {
  const plan = planMove(read([triangle]), { mode: 'container', bias: 0.6, axis: 'both' });
  assert.match(plan.error, /container/i);
  assert.equal(plan.deltas, undefined);
});

test('planMove: a zero-area object falls back to its box center with a warning', () => {
  const line = {
    label: 'rule', isKey: false, fingerprint: 'l', warnings: [],
    shapes: [shape([{ closed: false, polarity: 1, points: [pt(0, 0), pt(100, 0)] }])],
  };
  const plan = planMove(read([line]), { mode: 'artboard', bias: 1, axis: 'both' });
  close(plan.deltas[0].dx, 250); // box center (50, 0) to artboard center (300, 200)
  close(plan.deltas[0].dy, 200);
  assert.match(plan.warnings.join(' '), /rule.*no area/i);
});

test('planMove: crossing paths produce a warning naming the object', () => {
  const a = poly([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const b = poly([[50, 50], [150, 50], [150, 150], [50, 150]]);
  const knot = { label: 'knot', isKey: false, fingerprint: 'k', warnings: [], shapes: [shape([a, b])] };
  const plan = planMove(read([container, knot]), { mode: 'container', bias: 0.6, axis: 'both' });
  assert.match(plan.warnings.join(' '), /knot.*cross/i);
});

test("planMove: the engine's own warnings are kept, prefixed with the object", () => {
  const noisy = { ...triangle, warnings: ['A clipping group is measured by its clip shape.'] };
  const plan = planMove(read([container, noisy]), { mode: 'container', bias: 0.6, axis: 'both' });
  assert.ok(plan.warnings.includes('play: A clipping group is measured by its clip shape.'));
});

test('planMove: preview points are a box point per object, an optical point per mover, one target', () => {
  const plan = planMove(read([container, triangle]), { mode: 'container', bias: 0.6, axis: 'both' });
  const kinds = plan.points.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['box', 'box', 'optical', 'target']);
  const target = plan.points.find((p) => p.kind === 'target');
  close(target.x, 100);
  close(target.y, 100);
  const optical = plan.points.find((p) => p.kind === 'optical');
  close(optical.x, 82);
  close(optical.y, 100);
});

test('planMove container: the triangle moves 18 right, the container stays', () => {
  const plan = planMove(read([container, triangle]), { mode: 'container', bias: 0.6, axis: 'both' });
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.fingerprints, ['c', 't']);
  assert.deepEqual(plan.deltas[0], { dx: 0, dy: 0 });
  close(plan.deltas[1].dx, 18);
  close(plan.deltas[1].dy, 0);
});
