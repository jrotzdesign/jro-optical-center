const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'optical.js'), 'utf8');

// The CEP panel runs with --enable-nodejs --mixed-context: `module` AND `window` both exist.
// This is the condition that left window.Optical undefined in the shipped 0.1.0 panel.
test('CEP with Node: sets window.Optical and module.exports', () => {
  const ctx = vm.createContext({ module: { exports: {} } });
  ctx.window = ctx;
  vm.runInContext(source, ctx);
  assert.equal(typeof ctx.window.Optical, 'object');
  assert.equal(typeof ctx.window.Optical.planMove, 'function');
  assert.equal(typeof ctx.module.exports.planMove, 'function');
});

test('plain browser: sets window.Optical', () => {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  vm.runInContext(source, ctx);
  assert.equal(typeof ctx.window.Optical.planMove, 'function');
});

test('ExtendScript-like global (no window, no module): sets Optical on the global', () => {
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx);
  assert.equal(typeof ctx.Optical.planMove, 'function');
});
