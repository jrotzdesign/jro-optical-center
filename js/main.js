/* Optical Center panel logic. Geometry lives in optical.js; the document work lives in jsx/engine.jsx. */
(function () {
  var cs = new CSInterface();
  var $ = function (id) { return document.getElementById(id); };

  var SEED = [{ name: "Play icon", bias: 70 }, { name: "Logomark", bias: 50 }];
  var MODE_HINTS = {
    container: "The topmost selected object stays put. The rest move into it.",
    key: "The key object stays put. The rest move to it. Select it and press Set key.",
    artboard: "Each selected object moves to the center of the artboard it sits on."
  };

  var state = { mode: "container", bias: 60, key: null, presets: [], busy: false };

  // ---------- host calls ----------

  function host(fn) {
    var args = Array.prototype.slice.call(arguments, 1).map(function (a) { return JSON.stringify(a); });
    return new Promise(function (resolve, reject) {
      cs.evalScript(fn + "(" + args.join(",") + ")", function (raw) {
        if (typeof raw !== "string" || raw.indexOf("{") !== 0) { reject(new Error("Illustrator did not answer (" + String(raw).slice(0, 80) + ")")); return; }
        var res;
        try { res = JSON.parse(raw); } catch (e) { reject(new Error("Could not read Illustrator's reply.")); return; }
        if (!res.ok) reject(new Error(res.error || "Illustrator reported an error.")); else resolve(res);
      });
    });
  }

  // ---------- status ----------

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  function setStatus(kind, head, warnings) {
    var box = $("status");
    box.className = "status " + (kind || "");
    var html = "<b>" + esc(head) + "</b>";
    if (warnings && warnings.length) {
      html += "<ul>" + warnings.slice(0, 3).map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>";
      if (warnings.length > 3) html += "<div>and " + (warnings.length - 3) + " more</div>";
    }
    box.innerHTML = html;
  }

  function setBusy(b) {
    state.busy = b;
    ["goBoth", "goH", "goV", "preview", "setKey"].forEach(function (id) { $(id).disabled = b; });
  }

  // ---------- presets (JSON on disk, through the panel's Node access) ----------

  var fs = null, nodePath = null, presetFile = null, presetDir = null, presetNote = "";
  try {
    var req = (window.cep_node && window.cep_node.require) || window.require;
    fs = req("fs");
    nodePath = req("path");
    var home = req("os").homedir();
    presetDir = nodePath.join(home, "Library", "Application Support", "JRO", "optical-center");
    presetFile = nodePath.join(presetDir, "presets.json");
  } catch (e) {
    fs = null;
    presetNote = "Presets can't be saved because Node access is off. They last until the panel closes.";
  }

  function sanitize(list) {
    return (Array.isArray(list) ? list : []).filter(function (p) {
      return p && typeof p.name === "string" && p.name.trim() && typeof p.bias === "number" && isFinite(p.bias);
    }).map(function (p) { return { name: p.name.trim().slice(0, 40), bias: Math.max(0, Math.min(100, Math.round(p.bias))) }; });
  }

  function writePresets() {
    if (!fs) return;
    try {
      fs.mkdirSync(presetDir, { recursive: true });
      var tmp = presetFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ presets: state.presets }, null, 2) + "\n");
      fs.renameSync(tmp, presetFile);
    } catch (e) {
      setStatus("err", "Could not save presets: " + e.message);
    }
  }

  function loadPresets() {
    state.presets = SEED.slice();
    if (!fs) return;
    if (!fs.existsSync(presetFile)) { writePresets(); return; }
    try {
      var data = JSON.parse(fs.readFileSync(presetFile, "utf8"));
      var list = sanitize(data && data.presets);
      if (list.length || (data && Array.isArray(data.presets))) state.presets = list;
      else throw new Error("no presets array");
    } catch (e) {
      try { fs.renameSync(presetFile, presetFile + ".bak"); } catch (e2) {}
      presetNote = "presets.json was unreadable, so it was kept as presets.json.bak and the defaults were restored.";
      writePresets();
    }
  }

  function renderPresets() {
    var box = $("chips");
    box.innerHTML = "";
    state.presets.forEach(function (p, i) {
      var chip = document.createElement("div");
      chip.className = "chip" + (p.bias === state.bias ? " on" : "");
      chip.innerHTML = esc(p.name) + " " + p.bias + "%<span class='x' title='Delete preset'>×</span>";
      chip.addEventListener("click", function (ev) {
        if (ev.target.className === "x") { state.presets.splice(i, 1); writePresets(); renderPresets(); return; }
        setBias(p.bias);
      });
      box.appendChild(chip);
    });
  }

  // ---------- controls ----------

  function setBias(v) {
    v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    state.bias = v;
    $("bias").value = v;
    $("biasNum").value = v;
    $("biasText").textContent = v;
    $("fill").style.width = v + "%";
    $("thumb").style.left = v + "%";
    renderPresets();
  }

  function setMode(mode) {
    state.mode = mode;
    Array.prototype.forEach.call($("modeSeg").children, function (b) { b.classList.toggle("on", b.getAttribute("data-mode") === mode); });
    $("modeHint").textContent = MODE_HINTS[mode];
    $("keyRow").classList.toggle("hidden", mode !== "key");
  }

  function renderKey() {
    $("keyState").textContent = state.key ? "Key: " + state.key.label : "No key set. The topmost object is used.";
  }

  // ---------- actions ----------

  function readAndPlan(axis) {
    return host("OC_read", state.key ? state.key.uuid : "", state.key ? state.key.doc : "").then(function (read) {
      var plan = Optical.planMove(read, { mode: state.mode, bias: state.bias / 100, axis: axis });
      if (plan.error) throw new Error(plan.error);
      if (state.mode === "key" && state.key && !read.items.some(function (it) { return it.isKey; })) {
        plan.warnings = plan.warnings.filter(function (w) { return w.indexOf("No key is set") !== 0; });
        plan.warnings.unshift("The key object is not in the selection, so the topmost object is the key.");
      }
      return plan;
    });
  }

  function act(axis) {
    if (state.busy) return;
    setBusy(true);
    setStatus("", "Working…");
    readAndPlan(axis)
      .then(function (plan) {
        // Markers are cleared in their own call so one undo reverts only the move.
        return host("OC_clearMarkers").then(function () {
          return host("OC_move", JSON.stringify({ fingerprints: plan.fingerprints, deltas: plan.deltas }));
        }).then(function (res) {
          var label = axis === "both" ? "" : (axis === "h" ? " horizontally" : " vertically");
          setStatus("ok", res.moved ? "Moved " + res.moved + (res.moved === 1 ? " object" : " objects") + label + "." : "Already centered.", plan.warnings);
        });
      })
      .catch(function (e) { setStatus("err", e.message); })
      .then(function () { setBusy(false); });
  }

  function preview() {
    if (state.busy) return;
    setBusy(true);
    setStatus("", "Working…");
    readAndPlan("both")
      .then(function (plan) {
        return host("OC_preview", JSON.stringify({ points: plan.points })).then(function () {
          setStatus("ok", "Markers drawn. The next move clears them.", plan.warnings);
        });
      })
      .catch(function (e) { setStatus("err", e.message); })
      .then(function () { setBusy(false); });
  }

  function setKey() {
    if (state.busy) return;
    host("OC_peekKey")
      .then(function (res) { state.key = { uuid: res.uuid, doc: res.doc, label: res.label }; renderKey(); setStatus("ok", "Key set to " + res.label + "."); })
      .catch(function (e) { setStatus("err", e.message); });
  }

  // ---------- wiring ----------

  function init() {
    loadPresets();
    setBias(60);
    setMode("container");
    renderKey();

    Array.prototype.forEach.call($("modeSeg").children, function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); });
    });
    $("bias").addEventListener("input", function () { setBias(this.value); });
    $("biasNum").addEventListener("change", function () { setBias(this.value); });
    $("goBoth").addEventListener("click", function () { act("both"); });
    $("goH").addEventListener("click", function () { act("h"); });
    $("goV").addEventListener("click", function () { act("v"); });
    $("preview").addEventListener("click", preview);
    $("setKey").addEventListener("click", setKey);
    $("clearKey").addEventListener("click", function () { state.key = null; renderKey(); setStatus("", "Key cleared."); });
    $("savePreset").addEventListener("click", function () {
      var name = $("presetName").value.trim();
      if (!name) { setStatus("err", "Name the preset first."); return; }
      var hit = state.presets.filter(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })[0];
      if (hit) hit.bias = state.bias; else state.presets.push({ name: name.slice(0, 40), bias: state.bias });
      writePresets();
      renderPresets();
      $("presetName").value = "";
      setStatus("ok", "Saved " + name + " at " + state.bias + "%.");
    });

    // A marker layer left behind by a crash or a closed panel should not survive a reopen.
    host("OC_clearMarkers").then(function (res) {
      setStatus("", res.removed ? "Removed leftover markers." : "Select objects, then pick a button.");
      if (presetNote) setStatus("err", presetNote);
    }).catch(function (e) { setStatus("err", e.message); });
  }

  init();
})();
