/* Optical Center panel logic. Geometry lives in optical.js; the document work lives in jsx/engine.jsx. */
(function () {
  var cs = new CSInterface();
  var $ = function (id) { return document.getElementById(id); };

  var SEED = [{ name: "Play icon", bias: 70 }, { name: "Logomark", bias: 50 }];
  var POLL_MS = 800;

  // Everything the user can see in the status line. Raw script errors never reach it.
  var MESSAGES = {
    "no-document": "Open a document first.",
    "no-selection": "Select a shape first.",
    "selection-changed": "The selection changed while measuring. Try again.",
    "key-needs-one": "Select just one object, then press Set key.",
    "copy-failed": "Some text couldn't be measured. Outline it and try again.",
    "no-answer": "Illustrator didn't answer. Close any open dialog and try again.",
    "internal": "Something went wrong. Try again, or close and reopen the panel."
  };

  var state = { bias: 60, key: null, presets: [], busy: false, peek: null };

  // ---------- host calls ----------

  function PanelError(code, detail) { this.code = code; this.detail = detail; }

  function host(fn) {
    var args = Array.prototype.slice.call(arguments, 1).map(function (a) { return JSON.stringify(a); });
    return new Promise(function (resolve, reject) {
      cs.evalScript(fn + "(" + args.join(",") + ")", function (raw) {
        if (typeof raw !== "string" || raw.charAt(0) !== "{") { reject(new PanelError("no-answer", raw)); return; }
        var res;
        try { res = JSON.parse(raw); } catch (e) { reject(new PanelError("internal", "unparseable reply: " + raw.slice(0, 120))); return; }
        if (!res.ok) reject(new PanelError(res.code || "internal", res.error)); else resolve(res);
      });
    });
  }

  function plain(e) {
    if (e instanceof PanelError) {
      if (e.code === "internal" || e.code === "no-answer") console.info("[Optical Center] " + e.code + ": " + e.detail);
      return MESSAGES[e.code] || MESSAGES.internal;
    }
    if (e && e.planMessage) return e.planMessage;
    console.info("[Optical Center] " + (e && e.stack ? e.stack : e));
    return MESSAGES.internal;
  }

  // ---------- wording ----------

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function pt(n) { var r = Math.round(Math.abs(n) * 10) / 10; return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + " pt"; }

  // The live line: what a press of the button will do with the current selection.
  function describe(p) {
    if (!p || !p.doc) return "Open a document to start.";
    if (p.editingText) return "Finish editing the text first.";
    if (!p.count) return "Select a shape and the shape to center it in.";
    if (p.count === 1) return cap(p.labels[0] || "the object") + " centers on the artboard.";
    if (!p.labels.length) return cap((p.count - 1) + " objects center inside the back-most one.");
    var anchor = p.labels[p.labels.length - 1], movers = p.labels.slice(0, -1);
    if (p.keyInSelection && state.key) {
      var others = p.count - 1;
      return cap(others === 1 ? "one object moves" : others + " objects move") + " to " + state.key.label + ", the key object.";
    }
    return cap(movers.length === 1 ? movers[0] : movers.length + " objects") + " center" + (movers.length === 1 ? "s" : "") + " inside " + anchor + ".";
  }

  function movedLine(plan, res, axis) {
    if (!res.moved) return "Already centered.";
    var moving = [];
    plan.deltas.forEach(function (d, i) { if (Math.abs(d.dx) > 1e-9 || Math.abs(d.dy) > 1e-9) moving.push(i); });
    if (moving.length !== 1) return "Moved " + res.moved + " objects" + (axis === "h" ? " horizontally." : axis === "v" ? " vertically." : ".");
    var d = plan.deltas[moving[0]], parts = [];
    if (Math.abs(d.dx) >= 0.05) parts.push(pt(d.dx) + (d.dx > 0 ? " right" : " left"));
    if (Math.abs(d.dy) >= 0.05) parts.push(pt(d.dy) + (d.dy > 0 ? " up" : " down"));
    return parts.length ? "Moved " + plan.labels[moving[0]] + " " + parts.join(" and ") + "." : "Already centered.";
  }

  // ---------- status and controls ----------

  function setStatus(kind, head, warnings) {
    var box = $("status");
    box.className = "status " + (kind || "");
    var html = head ? "<b>" + esc(head) + "</b>" : "";
    if (warnings && warnings.length) {
      html += "<ul>" + warnings.slice(0, 2).map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>";
      if (warnings.length > 2) html += "<div>and " + (warnings.length - 2) + " more</div>";
    }
    box.innerHTML = html;
  }

  function renderPeek() {
    var p = state.peek, can = !!(p && p.count && !p.editingText) && !state.busy;
    $("live").textContent = describe(p);
    $("textHint").classList.toggle("hidden", !(p && p.hasText));
    ["goBoth", "goH", "goV", "preview"].forEach(function (id) { $(id).disabled = !can; });
  }

  function setBusy(b) { state.busy = b; renderPeek(); }

  // ---------- presets (JSON on disk, through the panel's Node access) ----------

  var fs = null, presetFile = null, presetDir = null, presetNote = "";
  try {
    var req = (window.cep_node && window.cep_node.require) || window.require;
    fs = req("fs");
    var nodePath = req("path");
    presetDir = nodePath.join(req("os").homedir(), "Library", "Application Support", "JRO", "optical-center");
    presetFile = nodePath.join(presetDir, "presets.json");
  } catch (e) {
    fs = null;
    presetNote = "Presets can't be saved on this computer, so they last until the panel closes.";
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
      console.info("[Optical Center] presets write failed: " + e.message);
      setStatus("err", "Presets couldn't be saved. Check that your Library folder is writable.");
    }
  }

  function loadPresets() {
    state.presets = SEED.slice();
    if (!fs) return;
    if (!fs.existsSync(presetFile)) { writePresets(); return; }
    try {
      var data = JSON.parse(fs.readFileSync(presetFile, "utf8"));
      if (!data || !Array.isArray(data.presets)) throw new Error("no presets array");
      state.presets = sanitize(data.presets);
    } catch (e) {
      try { fs.renameSync(presetFile, presetFile + ".bak"); } catch (e2) {}
      presetNote = "The presets file was damaged, so the defaults are back. The old file is kept as presets.json.bak.";
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

  function renderKey() {
    $("keyState").textContent = state.key
      ? "Key: " + state.key.label + ". It stays put and the rest move to it."
      : "No key. The back-most object stays put.";
  }

  // ---------- live selection ----------

  function poll() {
    if (state.busy) { setTimeout(poll, POLL_MS); return; }
    host("OC_peek", state.key ? state.key.uuid : "", state.key ? state.key.doc : "")
      .then(function (p) { state.peek = p; renderPeek(); })
      .catch(function (e) { if (!(e instanceof PanelError && e.code === "no-answer")) console.info("[Optical Center] peek: " + (e.detail || e)); })
      .then(function () { setTimeout(poll, POLL_MS); });
  }

  // ---------- actions ----------

  function readAndPlan(axis) {
    return host("OC_read", state.key ? state.key.uuid : "", state.key ? state.key.doc : "").then(function (read) {
      var plan = Optical.planMove(read, { bias: state.bias / 100, axis: axis });
      if (plan.error) { var err = new Error(plan.error); err.planMessage = plan.error; throw err; }
      return plan;
    });
  }

  function act(axis) {
    if (state.busy) return;
    setBusy(true);
    setStatus("", "");
    readAndPlan(axis)
      .then(function (plan) {
        // Markers are cleared in their own call so one undo reverts only the move.
        return host("OC_clearMarkers").then(function () {
          return host("OC_move", JSON.stringify({ fingerprints: plan.fingerprints, deltas: plan.deltas }));
        }).then(function (res) { setStatus("ok", movedLine(plan, res, axis), plan.warnings); });
      })
      .catch(function (e) { setStatus("err", plain(e)); })
      .then(function () { setBusy(false); });
  }

  function preview() {
    if (state.busy) return;
    setBusy(true);
    readAndPlan("both")
      .then(function (plan) {
        return host("OC_preview", JSON.stringify({ points: plan.points })).then(function () {
          setStatus("ok", "Markers drawn. They clear on the next move.", plan.warnings);
        });
      })
      .catch(function (e) { setStatus("err", plain(e)); })
      .then(function () { setBusy(false); });
  }

  function setKey() {
    if (state.busy) return;
    host("OC_peekKey")
      .then(function (res) { state.key = { uuid: res.uuid, doc: res.doc, label: res.label }; renderKey(); setStatus("ok", cap(res.label) + " is the key."); })
      .catch(function (e) { setStatus("err", plain(e)); });
  }

  // ---------- wiring ----------

  function init() {
    loadPresets();
    setBias(60);
    renderKey();
    renderPeek();

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
      if (!name) { setStatus("err", "Give the preset a name first."); return; }
      var hit = state.presets.filter(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })[0];
      if (hit) hit.bias = state.bias; else state.presets.push({ name: name.slice(0, 40), bias: state.bias });
      writePresets();
      renderPresets();
      $("presetName").value = "";
      setStatus("ok", "Saved " + name + " at " + state.bias + "%.");
    });

    // A marker layer left behind by a crash or a closed panel should not survive a reopen.
    host("OC_clearMarkers")
      .then(function (res) { if (res.removed) setStatus("", "Removed leftover markers."); })
      .catch(function () {})
      .then(function () { if (presetNote) setStatus("err", presetNote); poll(); });
  }

  init();
})();
