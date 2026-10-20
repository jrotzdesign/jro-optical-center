/* Shared ExtendScript test helpers: loads optical.js into Illustrator's ExtendScript engine.
   ExtendScript is ES3, so the few ES5 array helpers optical.js uses are polyfilled here only.
   Used by tools/stroke-compare.jsx. The end-to-end panel test is tools/panel-e2e.js. */

var OCT_ROOT = "/Users/jose/jro-optical-center";

function OCT_load() {
  if (!Array.prototype.forEach) Array.prototype.forEach = function (f, t) { for (var i = 0; i < this.length; i++) f.call(t, this[i], i, this); };
  if (!Array.prototype.map) Array.prototype.map = function (f, t) { var r = []; for (var i = 0; i < this.length; i++) r.push(f.call(t, this[i], i, this)); return r; };
  if (!Array.prototype.filter) Array.prototype.filter = function (f, t) { var r = []; for (var i = 0; i < this.length; i++) if (f.call(t, this[i], i, this)) r.push(this[i]); return r; };
  if (!Array.prototype.every) Array.prototype.every = function (f, t) { for (var i = 0; i < this.length; i++) if (!f.call(t, this[i], i, this)) return false; return true; };
  if (!Array.prototype.some) Array.prototype.some = function (f, t) { for (var i = 0; i < this.length; i++) if (f.call(t, this[i], i, this)) return true; return false; };
  if (!Object.keys) Object.keys = function (o) { var r = []; for (var k in o) if (o.hasOwnProperty(k)) r.push(k); return r; };
  $.evalFile(new File(OCT_ROOT + "/js/optical.js"));
}

function OCT_parse(s) { return eval("(" + s + ")"); }
function OCT_f(n) { return Math.round(n * 1000) / 1000; }
