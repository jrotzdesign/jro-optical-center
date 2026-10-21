# Optical Center: handoff

State as of 2026-10-21: version 0.2.2 (commit `4687378`, tag `v0.2.2`). Work is paused. The README
covers install and use; this file is for whoever picks the code up next.

- 48 unit tests pass.
- `tools/panel-e2e.js` passes all 44 checks in Illustrator 30.4.0 on macOS.
- `/code-review` was run on 0.2.1, and all 10 findings were fixed in 0.2.2.
- Undo has been tested with Edit → Undo only. A real Cmd+Z keystroke hasn't been automated
  (see "Testing").

## Architecture

Three pieces, and one button press is one script call.

```
index.html + js/main.js        CEP panel (Chromium, Node enabled, mixed context)
        │  evalScript("OC_act(...)")          one call per press
        ▼
jsx/engine.jsx                 ExtendScript in Illustrator's shared engine
        │  $.evalFile(js/optical.js) once, cached in $.global.OC_optical
        ▼
js/optical.js                  pure geometry, no Illustrator or DOM code
```

### Panel (`index.html`, `js/main.js`, `css/panel.css`)

- **Live line:** polls `OC_peek` every 800 ms to write what a press will do. `OC_peek` caches by
  selection signature and expires every 3 s, because restacking doesn't change any bounds.
- **A press:** calls `OC_clearMarkers` in a separate call, so one undo reverts only the move. Then
  it calls `OC_act(action, axis, bias, keyUuid, keyDoc, root)`. `action` is `"move"`,
  `"preview"` or `"plan"`. `"plan"` is used by the e2e only.
- **Engine reload on open:** the panel reloads `engine.jsx` itself with a top-level
  `try{$.evalFile(...);'loaded'}catch(e){...}`, then calls `OC_ping(root)`.
  - The engine version (`OC_ENGINE` in the engine, `VERSION` in `main.js`) must match.
  - If the reload fails, the panel keeps using the engine Illustrator loaded at startup and shows
    a plain message.
- **`root`:** the extension folder. CEP reports it as a `file://` URL; the panel converts it with
  Node's `url.fileURLToPath`, with a guarded `decodeURIComponent` fallback.
- **Messages:** errors come back as `{ok:false, code, error}`, and `MESSAGES` maps each code to
  plain English. Codes `plan` and `cleanup` show the engine's own text. Raw script errors go to
  `console.info` only.
- **Slow replies:** see "The panel freezes during scripts" below. A reply slower than 20 s adds
  "Illustrator took N seconds to answer." Clicks made during the freeze are dropped.
- **Presets:** JSON at `~/Library/Application Support/JRO/optical-center/presets.json`, written
  through the panel's Node access. Writes are atomic (tmp file then rename). A damaged file is
  kept as `.bak` and the defaults come back.
- **`js/CSInterface.js`:** a minimal shim, not Adobe's full file.

### Engine (`jsx/engine.jsx`)

- **Entry points:** every one returns a JSON string built by `OC_json`, because ExtendScript has
  no `JSON`. `OC_run` wraps each call:
  - sets `DONTDISPLAYALERTS` and the document coordinate system (y up), and restores both after;
  - turns thrown errors into `{ok:false, code}`.
- **Selection order:** `OC_selectionSorted` returns the selection topmost first. The back-most
  selected object is the container, unless a key object is set. One object centers on its
  artboard.
- **Geometry reading (`OC_collect`, `OC_pushPiece`):** reads geometry straight from the live
  paths and changes nothing.
  - A piece is `{fill, stroke:{width, join, cap, miterLimit}|null, evenodd, paths}`.
  - Strokes are sent as their style and turned into mass by `optical.js`. Outline Stroke is never
    used.
  - Clipping groups use their clip path.
  - Images, symbols and other non-path objects use their box, with a warning.
  - An object with no fill and no stroke uses its box, with a warning.
- **Live text (`OC_readTexts`):**
  - Each text frame is duplicated in place (`duplicate(tf, PLACEBEFORE)`).
  - The copy is named `Optical Center measuring copy`, unlocked and shown, then outlined, read and
    removed, all inside the same call.
  - `OC_checkClean` then checks that the item count is back and that no named copy is left.
  - Failures fall back to the text's box, with a warning. A copy that can't be removed becomes a
    `cleanup` warning that names the text.
- **"Already centered" memory:** after a text move, `$.global.OC_centered` holds a read-only
  signature from `OC_selectionSig`. It covers:
  - every path point and fill and stroke setting;
  - text contents, font, size, fill and stroke type for frames up to 64 characters;
  - the artboards, bias, axis, key and stacking order.

  A matching repeat press answers "Already centered." without reading the text again, so it adds
  no undo step.
- **Small moves:** moves under 0.001 pt are skipped.
- **Test hook:** `$.global.OC_testFault` can be `dup-undefined`, `dup-throws`, `outline`,
  `remove` or `slow`. It makes that step fail (or take 21 s) for the next `OC_act` only, then
  clears itself. It is null in normal use.

### optical.js, loaded in both places

`js/optical.js` is a UMD-style file. It sets `module.exports` when `module` exists, and also sets
`window.Optical` or `root.Optical`.

- **In Node** (the unit tests): it's loaded with `require`.
- **In ExtendScript** (the real work): `OC_lib(root)` loads it with `$.evalFile`, checks that
  `planMove` is a function, keeps it in `$.global.OC_optical`, and deletes the global `Optical`.
  - ExtendScript is ES3, so `optical.js` runs inside `OC_withES5`. That adds `forEach`, `map`,
    `filter`, `every`, `some` and `Object.keys` for the length of one call and deletes them after.
  - Every panel in Illustrator shares this engine. A leftover `Array.prototype` method would show
    up in other scripts' `for-in` loops.
- **The panel page** no longer loads `optical.js`. `test/loading.test.js` still checks all three
  environments, including the CEP mixed-context case that broke 0.1.0.

Main exports:

- **Planning:** `planMove(read, {bias, axis})` returns
  `{deltas, labels, warnings, points, summary}` or `{error}`.
- **Geometry:** `piecesToShapes`, `areaCentroid`, `groupCentroid`, `flatten`, `bounds`,
  `opticalPoint`, `moveDelta`.

The math, briefly:

- **Optical point:** `lerp(box center, area centroid, bias)`, with the default bias at 60%.
- **Holes:** worked out by nesting depth under the even-odd rule, or by the summed winding of the
  enclosing paths under non-zero.
- **Strokes:** an offset band with real joins (miter with limit, round, bevel) and caps (butt,
  round, projecting). Checked against Illustrator's Outline Stroke: the L matches exactly; the
  curved stroke is 0.085% off in area and 0.035% off in optical offset.

## Illustrator quirks we learned

Each of these cost time. All were seen in Illustrator 30.4.0 on macOS.

### Dialogs and alerts

- **A modal dialog stops scripting.** While one is open, every `evalScript` waits. That's how the
  session froze twice: a save dialog, and a probe of `executeMenuCommand("Expand3")`, which opens
  the Expand dialog.
- **Never use Expand or Expand Appearance menu commands.** If you need Outline Stroke, it's
  `executeMenuCommand("OffsetPath v22")`, which opens no dialog. The engine doesn't use it; only
  `tools/stroke-compare.jsx` does.
- **Wrap menu commands and document work** in
  `app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS`, restored in `finally`.
  `OC_run` does this for every engine call.
- **Close scratch documents in the same script** with `doc.close(SaveOptions.DONOTSAVECHANGES)`.
  A scratch document left open gets a save prompt later. The engine no longer opens any;
  `stroke-compare.jsx` still uses one.
- **If a probe hangs, stop.** Sending more scripts only queues them behind the dialog.

### Selection and undo

- **One script call is one undo step.** Reading geometry adds none.
  `app.executeMenuCommand("undo")` is Edit → Undo.
- **Don't touch the selection in a call that changes the document.** Clearing it
  (`doc.selection = null`) and reselecting, inside a call that also duplicates, outlines and
  removes, makes Edit → Undo revert nothing at all, even after three tries. Duplicating with the
  original still selected works, so the engine leaves the selection alone.
- **Duplicate into another document** returns `undefined` when the original is selected, even
  though the copy is made. In the same document it returns the copy. The engine still looks for
  the copy just above the original if it ever gets `undefined`.
- **Illustrator drops locked art from the selection:** locked text, text on a locked layer, and
  any group whose members are all locked. A group with locked text plus something unlocked stays
  selected, which is the one locked case a press can reach.
- **Duplicates of locked items:** a duplicate of a locked item is locked, but `createOutline()`
  and `remove()` still work on it.
- **Live text that's already centered** before the first press leaves one empty undo step,
  because outlining the copy counts as a change.
- **Stacking order:** `zOrderPosition` is wrong for text frames; it can repeat another item's
  value. Stacking order comes from the index in `parent.pageItems`, where 0 is the topmost.
- **`PageItem.tags.add()`** throws an MNGT error. The key object is held by `PageItem.uuid` in
  panel memory and lasts for the session only.

### Compound paths

- **Fill, stroke and fill rule live on the member paths.** The engine reads them from
  `pathItems[0]` and treats the whole compound as one piece.
- **Holes come from nesting, not from a path's own winding.** Hole and outer can be wound the same
  way. Polarity is read from `PolarityValues.NEGATIVE`, but the fill rule and nesting decide
  holes.
- **New paths pick up the default 1 pt stroke.** A compound path built by script got a 1 pt stroke
  that skewed the stroke mass. `make-test-doc.jsx` sets `stroked = false` on it.
- **Crossing or self-intersecting paths** get a warning. Their centroid may be off.

### `$.evalFile` scope

- **Inside a function, `$.evalFile` defines the file's functions in that function's scope.** The
  0.2.1 panel reloaded `engine.jsx` from inside an IIFE, which reported success and replaced
  nothing. Call it at the top level. A top-level `try` statement's value is what `evalScript`
  returns.
- **ScriptPath runs only once.** The manifest's ScriptPath loads `engine.jsx` once per Illustrator
  session. Reloading the panel (`location.reload()`) doesn't re-run it, which is why the panel
  reloads the engine itself.
- **`$.evalFile` at the top level runs `optical.js` with `this` as the global object,** so its
  wrapper sets `Optical` there.
- **Overriding DOM methods has no effect.** For example, `TextFrame.prototype.createOutline =
  ...` changes nothing. That's why the engine has the `OC_testFault` hook.

### The panel freezes during scripts

- **While an ExtendScript call runs, the CEP panel's JavaScript is frozen too.** No `setTimeout`
  fires and nothing repaints until the reply. A "still waiting" message can only appear when
  Illustrator hasn't started the script yet, for example because a dialog is open.
- **The old 20 s timeout would have misfired.** Its timer and the reply can only fire once the
  panel unfreezes, so for a slow call 0.2.1 would likely have reported a timeout for a move that
  had in fact happened. This is inferred from the freeze, not observed.
- **A click made during the freeze is delivered after the reply.** It started a second press whose
  "Already centered." replaced the real result. The panel now drops clicks stamped before it went
  idle, and any click in the first second after a slow reply.
  - Only `click()` from a second debugger connection reproduced this. A CDP mouse event, or a
    `click()` on the same connection, didn't start a second press even with the guard turned off.
  - A real mouse click from macOS couldn't be tested (no Accessibility permission).
- **Illustrator is noticeably slower when it isn't the frontmost app.** The e2e brings it to the
  front with `osascript -e 'tell application "Adobe Illustrator" to activate'`.

### CEP

- **With `--enable-nodejs --mixed-context`, `module` exists in the panel.** A wrapper that only
  sets `module.exports` leaves `window.X` undefined. That shipped as "Optical is not defined" in
  0.1.0. `test/loading.test.js` reproduces it with a vm context that has both `module` and
  `window`.
- **Unsigned panels need `PlayerDebugMode`.** The installer sets it for CSXS 9–14. The debug port
  is 8733 (`.debug`).
- **The installer waits for a key.** It ends with `read -n 1`. Run it from a script as
  `echo x | bash "Install Optical Center (Mac).command"`, or it hangs.

## Known limits

The README's "Known limits" section is the user-facing list. In short:

- **Clipping groups** are measured by their clipping shape, not the visible artwork.
- **Not modelled:** live effects, extra appearance fills and strokes, dashes, stroke alignment and
  variable-width strokes. Dashed strokes count as solid, with a warning.
- **Groups sum their members**, so overlapping members count twice.
- **Crossing paths**, and very wide strokes on tight curves, warn that the center may be off.
- **Box measurement with a warning:** images, symbols, meshes, plug-in objects, text that can't be
  copied or outlined, and objects with no fill or stroke.
- **Live text** costs one empty undo step if it's already centered on the first press.
- **Mid-call messages are impossible:** a call can't be cancelled or show progress, because the
  panel is frozen until Illustrator answers.
- **Cmd+Z:** undo is verified with Edit → Undo, not a real Cmd+Z.
- **Platform:** only macOS and Illustrator 30.4.0 were tested. Windows isn't covered, and there's
  no Windows installer.

## Testing

### Unit tests

```
npm test
```

Runs `node --test test/*.test.js`, which is 48 tests. `node --test test/` doesn't work on Node 24,
so keep the glob.

For coverage:

```
node --test --experimental-test-coverage test/*.test.js
```

`optical.js` was at 99.28% of lines and 93.64% of branches. Expected values in
`test/stroke.test.js` were worked out by hand, with the arithmetic in comments. Don't recompute
them with the code under test.

### End-to-end, in real Illustrator

1. Install: `echo x | bash "Install Optical Center (Mac).command"`.
2. Open Illustrator and the panel (Window → Extensions → Optical Center).
3. Run `node tools/panel-e2e.js`. It takes about three minutes.

What the e2e does:

- It talks to the panel over the debug port (`http://localhost:8733/json`, then WebSocket with
  Node 24's global `fetch` and `WebSocket`).
- It opens a temporary copy of `test/fixtures/optical-center-test.ai` and closes it unsaved at
  the end. Your open files are left alone.
- Any host call over 20 s stops the run. If that happens, check Illustrator for an open dialog
  before trying again.

What it covers:

- engine version and `optical.js` export
- layout fit at 268 × 340
- the live line
- container below and above
- artboard mode
- live text: no new document, no leftover items, one undo, second press
- locked text in a group
- every injected fault
- edit-then-press for the "Already centered" memory
- a 21 s reply with a queued click
- console errors

Rules for the fixture:

- **Never rebuild it through the panel.** That was slow and once came out missing items.
- If `test/fixtures/optical-center-test.ai` is ever lost, rebuild it once with
  `tools/make-test-doc.jsx` through a direct script call, check all 12 items, and commit it.
- **What's in it:** five circle containers, each holding one subject centered by its box: play,
  star, live-text J, a compound path with a hole, and a stroke-only L. Containers sit behind
  their subjects.
- **Expected move:** the triangle moves exactly 8 pt right at 60%.

### Other tools

- **`tools/stroke-compare.jsx`** compares the stroke math with Outline Stroke on throwaway shapes
  in a scratch document. Load `jsx/engine.jsx` (the panel already has), then at the top level run
  `$.evalFile` on `tools/integration-test.jsx` and `tools/stroke-compare.jsx`, then
  `OCS_compare()`.
- **`tools/integration-test.jsx`** holds the shared helpers (`OCT_load`, `OCT_parse`, `OCT_f`).
- **Driving the panel by hand:** connect to the page target on port 8733 and use
  `Runtime.evaluate` with `awaitPromise`. Host calls go through
  `window.__adobe_cep__.evalScript(script, callback)`.

### Before every push

Run gitleaks on the folder and on the history:

```
gitleaks dir . && gitleaks git .
```

## If you pick this up

- **Bumping the version:** update `CSXS/manifest.xml` (twice), `package.json`, `OC_ENGINE` in
  `jsx/engine.jsx`, `VERSION` in `js/main.js` and the README. The e2e checks that the engine
  version matches `package.json`.
- **Open ideas, none started:**
  - measuring clipping groups by their visible result;
  - modelling stroke alignment from the Appearance panel (it isn't readable from scripts today);
  - a Windows installer.
