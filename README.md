# Optical Center

An Illustrator panel that centers objects by where their visual weight sits, not by their bounding box. A play triangle in a circle looks off-center when its box is centered, because most of the triangle's weight is on the left. Optical Center moves it right until the weight sits in the middle.

Works in Illustrator 2024, 2025 and 2026 (tested on 30.4.0). Version 0.2.1.

## Install

1. Double-click `Install Optical Center (Mac).command`. If macOS blocks it, right-click and choose Open.
2. Quit and reopen Illustrator.
3. Open **Window → Extensions → Optical Center**.

The installer copies the panel to `~/Library/Application Support/Adobe/CEP/extensions/com.jro.opticalcenter` and turns on `PlayerDebugMode` for CSXS 9–14, which unsigned panels need. To remove it, run `Uninstall Optical Center (Mac).command`. Your saved presets stay where they are.

## Use

Select, then press **Optical center**. The line at the top of the panel says what will happen before you press.

- **One object** centers on the artboard it sits on.
- **Two or more** center inside the back-most selected object, which stays put.

**Horizontal only** and **Vertical only** move along one axis.

**Advanced** (collapsed by default):

- **Bias**, 0 to 100%, default 60%. At 0% the box center is used, at 100% the center of mass, and anything between is a blend.
- **Presets** save a bias under a name. Defaults are Play icon (70%) and Logomark (50%). They live in `~/Library/Application Support/JRO/optical-center/presets.json`. If that file is damaged, the panel keeps it as `presets.json.bak` and restores the defaults.
- **Preview markers** draws a pink crosshair at each box center and a teal one at each optical point, on a locked, non-printing layer called `__optical_center_markers__`.
- **Set key** makes one object stay put while the rest move to it, instead of the back-most one. The key lasts until the panel closes.

## Undo

A move is one undo step, live text included. Pressing again on something already centered does nothing and adds no undo step. Markers are cleared in their own step just before a move, so one undo reverts only the move. A second undo brings the markers back, because it undoes the clear. Any leftover marker layer is removed when the panel opens.

## How it measures

Fills are read straight from the paths. Strokes are turned into mass with math: each stroke is the band within half its width of the path, with its real join (miter with limit, round, bevel) and cap (butt, round, projecting). Compared with Illustrator's own Outline Stroke, this matches exactly on the test L and is within 0.035% on a curved stroke.

Live text is outlined on a copy inside your document, measured, and removed again, all within the same click. No other document opens and your text stays live. The measuring and the move happen in one script call, which is what keeps the move to one undo step.

## Tests

```
npm test
```

47 unit tests cover `js/optical.js`: loading in all three hosts (Node, the CEP panel with Node enabled, ExtendScript), centroids, holes under even-odd and non-zero rules, bezier flattening, stroke bands, bounds, crossing detection and `planMove`.

In Illustrator, with the panel open:

- `node tools/panel-e2e.js [screenshotDir]` drives the real panel through its debug port (`localhost:8733`). It opens a temporary copy of `test/fixtures/optical-center-test.ai`, clicks the buttons, and checks moves, undo, live text, layout fit and console errors. Any host call over 20 seconds stops the run. macOS only allows a real Cmd+Z keystroke if the terminal has Accessibility permission; otherwise the script uses Illustrator's Edit → Undo.
- `tools/stroke-compare.jsx` compares the stroke math with Outline Stroke on throwaway shapes in a scratch document.

`test/fixtures/optical-center-test.ai` has five circle containers, each holding one subject centered by its box: a play triangle, a star, a live-text J, a compound path with a hole, and a stroke-only L. `tools/make-test-doc.jsx` rebuilds it if it is ever lost.

## Known limits

- **Clipping groups** are measured by the clipping shape, not the clipped artwork.
- **Live effects, extra appearance fills and strokes, dashes, stroke alignment and variable-width strokes** are not modelled. Dashed strokes count as solid, and the panel says so.
- **Groups** sum their members, so overlapping members count twice.
- **Crossing or self-intersecting paths** get a warning. The center may be off.
- **Very wide strokes on tight curves**: the inner edge of the band can fold over itself. The crossing warning shows when that happens.
- **Images, symbols, meshes and plug-in objects** are measured by their bounding box, with a warning.
- **Live text that's already centered** before the first press leaves one empty undo step, because outlining the copy counts as a change. After a move the panel remembers the result, so pressing again doesn't add one.
- **Illustrator quirks the engine works around:** clearing and restoring the selection inside the move call stops Edit → Undo from reverting the move, so the engine never touches the selection. `zOrderPosition` is wrong for text frames, so stacking order comes from `pageItems`. ExtendScript has no `Array.prototype.forEach` and friends; the engine adds them only for the length of one call, because every panel shares that engine.

## Fonts and license

The panel uses Bricolage Grotesque, Figtree and DM Mono, bundled in `fonts/` under the SIL Open Font License. The license texts sit next to the font files.
