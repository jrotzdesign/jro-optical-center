# Optical Center

An Illustrator panel that centers objects by where their visual mass sits, not by their bounding box. A play triangle in a circle looks off-center when its box is centered, because most of the triangle's weight is on the left. Optical Center moves it right until the weight sits at the middle.

Works in Illustrator 2024, 2025 and 2026 (tested on 30.4.0).

## Install

1. Double-click `Install Optical Center (Mac).command`. If macOS blocks it, right-click and choose Open.
2. Quit and reopen Illustrator.
3. Open **Window → Extensions → Optical Center**.

The installer copies the panel to `~/Library/Application Support/Adobe/CEP/extensions/com.jro.opticalcenter` and turns on `PlayerDebugMode` for CSXS 9–14, which unsigned panels need. To remove it, run `Uninstall Optical Center (Mac).command`. Your saved presets stay where they are.

## Use

Pick a mode, set the bias, select objects, press a button.

| Mode | What moves |
|---|---|
| Center in container | The topmost selected object stays put. The rest move into it. |
| Align to key object | The key stays put. Select it, press **Set key**, then select everything. With no key set, the topmost object is used. |
| Align to artboard | Each object moves to the center of the artboard it sits on. |

**Bias** runs from 0 to 100% and defaults to 60%. At 0% the optical point is the bounding-box center. At 100% it is the true center of mass. Anything between is a blend.

**Buttons:** Optical center (both axes), Horizontal only, Vertical only, and Preview markers. Preview draws a pink crosshair at each box center and a teal one at each optical point, on a locked, non-printing layer called `__optical_center_markers__`.

**Presets** are saved with a name and a bias. Defaults are Play icon (70%) and Logomark (50%). They live in `~/Library/Application Support/JRO/optical-center/presets.json`, which the panel reads and writes through Node. If that file is unreadable, the panel keeps it as `presets.json.bak` and restores the defaults.

## Undo

A move is one undo step. Reading your selection happens in a scratch document that is closed without saving, so it leaves nothing in your document and adds no undo steps. Markers are cleared in their own step just before the move, so one undo reverts only the move and the markers do not come back. A second undo restores the markers, because it undoes the clear. Preview itself is one undo step. Any leftover marker layer is deleted when the panel opens.

## Tests

```
npm test
```

32 unit tests cover the geometry in `js/optical.js` (centroids, holes by even-odd and non-zero rules, bezier flattening, bounds, crossing detection, the three modes) and `planMove`, which turns a read of the selection into moves and warnings.

`test/fixtures/optical-center-test.ai` has five containers, each holding one subject: a play triangle, a star, a live-text J, a compound path with a hole, and a stroke-only L. To check the engine against it, open the file in Illustrator, then run these in order from the ExtendScript console or any script runner:

```
$.evalFile(new File("<repo>/jsx/engine.jsx"));
$.evalFile(new File("<repo>/tools/integration-test.jsx"));
OCT_runSubject("play", 1);   // also: "star", 2 · "J", 3 · "hole", 4 · "stroke-L", 5
```

Each call runs all three modes and prints the delta and a PASS or FAIL. `tools/make-test-doc.jsx` rebuilds the document from scratch. `OCT_ROOT` at the top of `integration-test.jsx` is the repo path; change it if yours differs.

## Known limits

- **Clipping groups** are measured by the clip shape, not by the clipped artwork.
- **Live effects and extra appearance fills or strokes** are ignored. Only the geometry and the first fill and stroke count, and there is no warning for effects.
- **Groups** sum their members' areas, so overlapping members count twice. This is pinned by a test.
- **A filled and stroked compound shape** counts the overlap between fill and stroke twice, and the panel says so. A simple closed filled and stroked path is exact: the stroke's outer contour is used.
- **Crossing or self-intersecting paths** set a warning. The centroid may be off.
- **Open paths** are filled by a straight closing line when they have a fill. A stroke-only open path is measured by its outlined stroke.
- **Text** is outlined on a copy. If that fails (a missing font, for example) the text's box is used and the panel says so.
- **Images, symbols, meshes and plug-in objects** are measured by their bounding box, with a warning.
- **The key** is held in memory by object id for this session. Closing the panel, switching documents or reopening the file clears it.
- **Large selections** are slower because every item is copied into the scratch document. A few objects take about half a second.
- **Illustrator quirks the engine works around:** `duplicate()` into another document returns `undefined` when the original is selected (so the originals are deselected during the read and re-selected after), and `zOrderPosition` is wrong for text frames (so stacking order comes from `pageItems`).

## Fonts and license

The panel uses Bricolage Grotesque, Figtree and DM Mono, bundled in `fonts/` under the SIL Open Font License. The license texts are alongside the font files.
