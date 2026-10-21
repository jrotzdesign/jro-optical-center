/* Shared ExtendScript test helpers. Load jsx/engine.jsx first: optical.js is loaded through its
   OC_lib, and callers wrap optical.js calls in its OC_withES5, so no ES5 helper outlives a call.
   Used by tools/stroke-compare.jsx. The end-to-end panel test is tools/panel-e2e.js. */

var OCT_ROOT = "/Users/jose/jro-optical-center";

function OCT_load() {
  return OC_lib(OCT_ROOT);
}

function OCT_parse(s) { return eval("(" + s + ")"); }
function OCT_f(n) { return Math.round(n * 1000) / 1000; }
