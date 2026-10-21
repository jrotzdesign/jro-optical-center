/* Optical Center panel logic. The document work and the geometry (js/optical.js, loaded into the
   host) both run inside jsx/engine.jsx, so one button press is one script call and one undo step. */
(function () {
  var cs = new CSInterface();
  var $ = function (id) { return document.getElementById(id); };

  var SEED = [{ name: "Play icon", bias: 70 }, { name: "Logomark", bias: 50 }];
  var VERSION = "0.2.2"; // must match OC_ENGINE in jsx/engine.jsx
  var POLL_MS = 800;
  var SLOW_MS = 20000;
  var DROP_MS = 1000;

  // The extension folder, for the host to load its files from. CEP reports it as a file:// URL.
  var ROOT = (function (raw) {
    raw = String(raw);
    try { return (window.cep_node ? window.cep_node.require : window.require)("url").fileURLToPath(raw); } catch (e) {}
    try { return decodeURIComponent(raw.replace(/^file:\/\//, "")); } catch (e2) {}
    return raw.replace(/^file:\/\//, "");
  })(cs.getExtensionPath());

  // Everything the user can see in the status line. Raw script errors never reach it.
  var MESSAGES = {
    "no-document": "Open a document first.",
    "no-selection": "Select a shape first.",
    "key-needs-one": "Select just one object, then press Set key.",
    "no-answer": "Illustrator didn't answer. Close any open dialog and try again.",
    "slow": "Illustrator is taking longer than 20 seconds. If a dialog is open, close it. The buttons unlock when it answers.",
    "optical-missing": "Some of the panel's files are missing. Reinstall Optical Center.",
    "engine-reload": "The panel's script couldn't be reloaded, so it's using the copy Illustrator loaded at startup. If something looks wrong, quit and reopen Illustrator.",
    "engine-missing": "The panel's script couldn't be loaded. Quit and reopen Illustrator. If that doesn't help, reinstall Optical Center.",
    "internal": "Something went wrong. Try again, or close and reopen the panel."
  };

  var state = { bias: 60, key: null, presets: [], busy: false, peek: null, idleAt: 0, dropUntil: 0 };

  // ---------- host calls ----------

  function PanelError(code, detail) { this.code = code; this.detail = detail; }

  // A slow call can't be cancelled, so the panel waits for the real answer with the buttons locked.
  // While a script runs, Illustrator freezes this panel too, so the 20 s note can only show when
  // Illustrator is held up before the script starts (an open dialog). The reply carries ms, and a
  // reply that took longer than 20 s says so next to the result.
  function evalHost(script, quiet) {
    var started = Date.now();
    return new Promise(function (resolve) {
      var slow = setTimeout(function () {
        console.info("[Optical Center] still waiting after " + SLOW_MS + " ms: " + script.slice(0, 80));
        if (!quiet) setStatus("err", MESSAGES.slow);
      }, SLOW_MS);
      cs.evalScript(script, function (raw) {
        var ms = Date.now() - started;
        clearTimeout(slow);
        if (ms > SLOW_MS) state.dropUntil = performance.now() + DROP_MS;
        resolve({ raw: raw, ms: ms });
      });
    });
  }

  function tookNote(res) {
    return res.ms > SLOW_MS ? ["Illustrator took " + Math.round(res.ms / 1000) + " seconds to answer."] : [];
  }

  function host(fn) {
    var args = Array.prototype.slice.call(arguments, 1).map(function (a) { return JSON.stringify(a); });
    return evalHost(fn + "(" + args.join(",") + ")", fn === "OC_peek").then(function (reply) {
      var raw = reply.raw, res;
      if (typeof raw !== "string" || raw.charAt(0) !== "{") throw new PanelError("no-answer", raw);
      try { res = JSON.parse(raw); } catch (e) { throw new PanelError("internal", "unparseable reply: " + raw.slice(0, 120)); }
      if (!res.ok) throw new PanelError(res.code || "internal", res.error);
      res.ms = reply.ms;
      return res;
    });
  }

  function plain(e) {
    if (e instanceof PanelError) {
      if (e.code === "plan" || e.code === "cleanup") return e.detail;
      if (e.code === "internal" || e.code === "no-answer" || e.code === "optical-missing") console.info("[Optical Center] " + e.code + ": " + e.detail);
      return MESSAGES[e.code] || MESSAGES.internal;
    }
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

  // Uses the engine's own list of what it moved.
  function movedLine(res, axis) {
    var n = res.movedIdx.length;
    if (!n) return "Already centered.";
    if (n > 1) return "Moved " + n + " objects" + (axis === "h" ? " horizontally." : axis === "v" ? " vertically." : ".");
    var i = res.movedIdx[0], d = res.deltas[i], parts = [];
    if (Math.abs(d.dx) >= 0.05) parts.push(pt(d.dx) + (d.dx > 0 ? " right" : " left"));
    if (Math.abs(d.dy) >= 0.05) parts.push(pt(d.dy) + (d.dy > 0 ? " up" : " down"));
    return "Moved " + res.labels[i] + " " + (parts.length ? parts.join(" and ") : "less than 0.1 pt") + ".";
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
    ["goBoth", "goH", "goV", "preview"].forEach(function (id) { $(id).disabled = !can; });
  }

  function setBusy(b) {
    state.busy = b;
    if (!b) state.idleAt = performance.now();
    renderPeek();
  }

  // Clicks made while Illustrator had the panel frozen are delivered after the reply. Anything
  // stamped before the panel went idle again is dropped, and so is any click in the first second
  // after a slow reply, in case a queued click is stamped with its delivery time instead.
  function fresh(handler) {
    return function (ev) {
      if (ev && ev.timeStamp < state.idleAt) return;
      if (performance.now() < state.dropUntil) return;
      handler();
    };
  }

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

  function hostAct(action, axis) {
    return host("OC_act", action, axis, state.bias / 100, state.key ? state.key.uuid : "", state.key ? state.key.doc : "", ROOT);
  }

  function act(axis) {
    if (state.busy) return;
    setBusy(true);
    setStatus("", "");
    // Markers are cleared in their own call so one undo reverts only the move.
    host("OC_clearMarkers")
      .then(function () { return hostAct("move", axis); })
      .then(function (res) { setStatus("ok", movedLine(res, axis), tookNote(res).concat(res.warnings)); })
      .catch(function (e) { setStatus("err", plain(e)); })
      .then(function () { setBusy(false); });
  }

  function preview() {
    if (state.busy) return;
    setBusy(true);
    hostAct("preview", "both")
      .then(function (res) { setStatus("ok", "Markers drawn. They clear on the next move.", tookNote(res).concat(res.warnings)); })
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
    $("goBoth").addEventListener("click", fresh(function () { act("both"); }));
    $("goH").addEventListener("click", fresh(function () { act("h"); }));
    $("goV").addEventListener("click", fresh(function () { act("v"); }));
    $("preview").addEventListener("click", fresh(preview));
    $("setKey").addEventListener("click", fresh(setKey));
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

    var note = presetNote;
    loadEngine()
      .then(function (engineNote) { if (engineNote) note = engineNote; })
      // A marker layer left behind by a crash or a closed panel should not survive a reopen.
      .then(function () { return host("OC_clearMarkers"); })
      .then(function (res) { if (res.removed && !note) setStatus("", "Removed leftover markers."); })
      .catch(function () {})
      .then(function () { if (note) setStatus("err", note); poll(); });
  }

  // Illustrator loads engine.jsx once per session; loading it again here keeps the host code in step
  // with this panel after a reinstall or reload. If that fails, the copy loaded at startup is used.
  // Resolves to a message for the status line, or "" when all is well.
  function loadEngine() {
    var file = JSON.stringify(ROOT + "/jsx/engine.jsx");
    // Top level on purpose: $.evalFile inside a function defines the file's functions in that
    // function's scope, so nothing would be replaced. The try statement's value is the reply.
    var script = "try{$.evalFile(new File(" + file + "));'loaded';}" +
      "catch(e){'failed: '+e.message+(e.line?' (line '+e.line+')':'');}";
    var reloaded = false;
    return evalHost(script)
      .then(function (reply) {
        reloaded = reply.raw === "loaded";
        if (!reloaded) console.info("[Optical Center] engine reload " + reply.raw);
        return host("OC_ping", ROOT);
      })
      .then(function (p) {
        if (p.engine !== VERSION) { console.info("[Optical Center] engine " + p.engine + ", panel " + VERSION); return MESSAGES["engine-reload"]; }
        return reloaded ? "" : MESSAGES["engine-reload"];
      })
      .catch(function (e) {
        console.info("[Optical Center] engine check: " + (e.detail || e));
        return e instanceof PanelError && e.code === "optical-missing" ? MESSAGES["optical-missing"] : MESSAGES["engine-missing"];
      });
  }

  init();
})();
