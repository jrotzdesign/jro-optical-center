// End-to-end check of the installed panel inside real Illustrator, through the CEP debug port.
// Needs: Illustrator running with the Optical Center panel open. The script opens a temporary copy
// of test/fixtures/optical-center-test.ai (the committed fixture is never modified, and your open
// files are not touched) and closes it unsaved at the end. Run: node tools/panel-e2e.js [screenshotDir]
// It clicks the real buttons and fails on any console error. Any host call that takes over 20 s
// stops the run. Undo is a real Cmd+Z keystroke when
// macOS allows it (Accessibility permission for the terminal), otherwise Illustrator's Edit > Undo.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SHOTS = process.argv[2] || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const targets = await (await fetch('http://localhost:8733/json')).json();
  const t = targets.find((x) => x.type === 'page');
  if (!t) throw new Error('Optical Center panel is not open (no target on port 8733)');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const problems = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) problems.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push('log.error: ' + msg.params.entry.text);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Log.enable');
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result.exceptionDetails) throw new Error('panel eval failed: ' + (res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text));
    return res.result.result.value;
  };
  return { ws, send, evaluate, problems };
}

(async () => {
  const p = await connect();
  const host = (jsx) => Promise.race([
    p.evaluate(`new Promise(r => window.__adobe_cep__.evalScript(${JSON.stringify(jsx)}, r))`),
    sleep(20000).then(() => { throw new Error('host call took over 20 s, stopping: ' + jsx.slice(0, 80)); }),
  ]);
  const hostJSON = async (jsx) => JSON.parse(await host(jsx));
  const panel = () => p.evaluate(`JSON.stringify({ live: document.getElementById('live').innerText, status: document.getElementById('status').innerText, disabled: document.getElementById('goBoth').disabled })`).then(JSON.parse);
  const click = (id) => p.evaluate(`document.getElementById('${id}').click(); true`);
  // An action clears the status line when it starts and writes it when it ends.
  const waitIdle = async () => { for (let i = 0; i < 80; i++) { await sleep(150); if (await p.evaluate('document.getElementById("status").innerText.trim() !== ""')) break; } await sleep(300); };
  const select = (names) => host(`(function(){var d=app.activeDocument;d.selection=null;${names.map((n) => `d.pageItems.getByName(${JSON.stringify(n)}).selected=true;`).join('')}return d.selection.length;})()`);
  const bounds = (name) => hostJSON(`(function(){var b=app.activeDocument.pageItems.getByName(${JSON.stringify(name)}).geometricBounds;return '['+b.join(',')+']';})()`);
  const docs = () => host('app.documents.length + ""').then(Number);
  const itemCount = () => host('app.activeDocument.pageItems.length + ""').then(Number);
  const root = path.join(require('node:os').homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', 'com.jro.opticalcenter');
  const version = require('../package.json').version;
  const strays = () => host('(function(){try{app.activeDocument.pageItems.getByName("Optical Center measuring copy");return "yes";}catch(e){return "no";}})()').then((r) => r === 'yes');
  const plan = (axis) => hostJSON(`OC_act("plan", ${JSON.stringify(axis)}, 0.6, "", "", ${JSON.stringify(root)})`);
  let undoMethod = null;
  const cmdZ = async () => {
    try {
      execFileSync('osascript', ['-e', 'tell application "Adobe Illustrator" to activate', '-e', 'delay 0.4', '-e', 'tell application "System Events" to keystroke "z" using command down'], { stdio: 'pipe' });
      undoMethod = undoMethod || 'Cmd+Z keystroke';
    } catch (e) {
      await host('app.executeMenuCommand("undo"); "ok"');
      undoMethod = 'Edit > Undo menu command (keystrokes not allowed for this terminal)';
    }
  };
  const shot = (name) => {
    if (!SHOTS) return null;
    execFileSync('osascript', ['-e', 'tell application "Adobe Illustrator" to activate', '-e', 'delay 0.6']);
    const f = path.join(SHOTS, name + '.png');
    execFileSync('screencapture', ['-x', f]);
    return f;
  };
  const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };

  // Setup: open a temporary copy of the committed fixture; everything below runs on it.
  const userDoc = await host('app.documents.length ? app.activeDocument.name : ""');
  const repo = path.resolve(__dirname, '..');
  const tmpDir = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'optical-center-e2e-'));
  const copyPath = path.join(tmpDir, 'optical-center-e2e.ai');
  require('node:fs').copyFileSync(path.join(repo, 'test', 'fixtures', 'optical-center-test.ai'), copyPath);
  const testDoc = await host(`app.open(new File(${JSON.stringify(copyPath)})).name`);
  const missing = await host('(function(){var m=[],n=["play","star","J","hole","stroke-L","container-1","container-2","container-3","container-4","container-5"];for(var i=0;i<n.length;i++){try{app.activeDocument.pageItems.getByName(n[i]);}catch(e){m.push(n[i]);}}return m.join(",");})()');
  if (missing) throw new Error('fixture copy is missing: ' + missing);
  await sleep(800);

  // 0. Loaded properly: this version's engine, optical.js exporting planMove, no ES5 helpers left over
  await select([]);
  const ping = await hostJSON(`OC_ping(${JSON.stringify(root)})`);
  check('engine ' + version + ' is loaded and optical.js exports planMove', ping.ok && ping.engine === version && ping.optical === true, ping);
  check('no ES5 helpers left on Array.prototype', (await host('typeof Array.prototype.forEach')) === 'undefined');

  // 1. Layout fits without scrolling: at the panel's current size and at the manifest default 268 x 340
  const cur = await p.evaluate('JSON.stringify({ h: innerHeight, w: innerWidth, content: document.documentElement.scrollHeight })').then(JSON.parse);
  check('fits at current size ' + cur.w + 'x' + cur.h, cur.content <= cur.h, cur);
  await p.send('Emulation.setDeviceMetricsOverride', { width: 268, height: 340, deviceScaleFactor: 0, mobile: false });
  await sleep(200);
  const def = await p.evaluate('JSON.stringify({ h: innerHeight, w: innerWidth, content: document.documentElement.scrollHeight, buttonBottom: document.getElementById("goV").getBoundingClientRect().bottom })').then(JSON.parse);
  check('fits at default 268x340 (Advanced closed)', def.content <= def.h, def);
  await p.send('Emulation.clearDeviceMetricsOverride');

  // 2. Nothing selected: buttons disabled, plain instruction
  await select([]);
  await sleep(1800);
  let s = await panel();
  check('nothing selected: buttons off and a plain instruction', s.disabled && /Select a shape and the shape to center it in/.test(s.live), s.live);

  // 3. Triangle + circle (circle behind): the triangle moves right, one Cmd+Z reverts it
  const docsBefore = await docs();
  const triBefore = await bounds('play'), circBefore = await bounds('container-1');
  await select(['container-1', 'play']);
  await sleep(1800);
  s = await panel();
  check('live line names what will happen', /play centers inside container-1/i.test(s.live) && !s.disabled, s.live);
  const before = shot('1-before');
  await click('goBoth');
  await waitIdle();
  s = await panel();
  const triAfter = await bounds('play'), circAfter = await bounds('container-1');
  const dx = triAfter[0] - triBefore[0];
  // The triangle starts box-centered; at 60% bias its optical point sits 8 pt left of the box center.
  check('one click moves the triangle 8 pt right', near(dx, 8, 0.01) && near(triAfter[1], triBefore[1]), { dx: dx.toFixed(3), status: s.status });
  check('the circle (back-most) stays put', circAfter.every((v, i) => near(v, circBefore[i])), circAfter);
  check('no new document appeared', (await docs()) === docsBefore);
  const after = shot('2-after');
  await cmdZ();
  await sleep(1200);
  const triUndo = await bounds('play');
  check('one Cmd+Z reverts the move', triUndo.every((v, i) => near(v, triBefore[i])), { triUndo, triBefore });

  // 4. Container above the subject: the back-most (now the triangle) stays, the circle moves
  await host('app.activeDocument.pageItems.getByName("container-1").zOrder(ZOrderMethod.BRINGTOFRONT); "ok"');
  await select(['container-1', 'play']);
  await sleep(3500); // the peek cache expires every 3 s after a restack
  s = await panel();
  check('container above: live line says the circle moves into the triangle', /container-1 centers inside play/i.test(s.live), s.live);
  const c2 = await bounds('container-1'), t2 = await bounds('play');
  await click('goBoth');
  await waitIdle();
  const c3 = await bounds('container-1'), t3 = await bounds('play');
  check('container above: the back-most triangle stays, the circle moves', t3.every((v, i) => near(v, t2[i])) && Math.abs(c3[0] - c2[0]) > 0.5, { circleDx: (c3[0] - c2[0]).toFixed(3) });
  await cmdZ(); await sleep(1000);
  const c4 = await bounds('container-1');
  check('container above: one Cmd+Z reverts', c4.every((v, i) => near(v, c2[i])));
  await cmdZ(); await sleep(1000); // undo the restack too

  // 5. Single object centers on its artboard
  await select(['star']);
  await sleep(1800);
  s = await panel();
  check('one object: live line says artboard', /star centers on the artboard/i.test(s.live), s.live);
  const starBefore = await bounds('star');
  await click('goBoth');
  await waitIdle();
  const again = await plan('both');
  check('one object: its optical point now sits on the artboard center', again.deltas.every((d) => near(d.dx, 0, 0.01) && near(d.dy, 0, 0.01)), again.deltas);
  await cmdZ(); await sleep(1000);
  const starUndo = await bounds('star');
  check('one object: one Cmd+Z reverts', starUndo.every((v, i) => near(v, starBefore[i])));

  // 6. Live text: outlined on a copy inside this document, no new tab, one undo step, no leftovers
  await select(['container-3', 'J']);
  await sleep(1800);
  const jBefore = await bounds('J'), itemsBefore = await itemCount(), jDocs = await docs();
  const jPlan = await plan('both');
  await click('goBoth');
  await waitIdle();
  s = await panel();
  const jAfter = await bounds('J');
  const jdx = jAfter[0] - jBefore[0], jdy = jAfter[1] - jBefore[1];
  check('text: no new document during the move', (await docs()) === jDocs, { before: jDocs });
  check('text: the J moves by the planned amount', near(jdx, jPlan.deltas[0].dx, 0.01) && near(jdy, jPlan.deltas[0].dy, 0.01) && Math.abs(jPlan.deltas[0].dx) + Math.abs(jPlan.deltas[0].dy) > 0.1, { jdx: jdx.toFixed(3), jdy: jdy.toFixed(3), planned: jPlan.deltas[0], status: s.status });
  check('text: no leftover items after the move', (await itemCount()) === itemsBefore, { before: itemsBefore });
  check('text: the J is still live text', (await host('app.activeDocument.pageItems.getByName("J").typename')) === 'TextFrame');
  await click('goBoth');
  await waitIdle();
  s = await panel();
  check('text: a second press says already centered and does not move', s.status.trim() === 'Already centered.' && (await bounds('J')).every((v, i) => near(v, jAfter[i], 0.001)), s.status);
  await cmdZ(); await sleep(1000);
  check('text: one undo reverts, even after the second press', (await bounds('J')).every((v, i) => near(v, jBefore[i])));
  check('text: no leftover items after undo', (await itemCount()) === itemsBefore);

  // 7. Errors read as plain English
  await select(['container-1', 'play']);
  await click('setKey');
  await sleep(800);
  s = await panel();
  check('Set key with two selected: plain English', /Select just one object, then press Set key\./.test(s.status), s.status);

  // 8. Locked text inside a selected group: measured on an unlocked copy, nothing left behind.
  // Illustrator won't select locked art. It drops locked text, text on a locked layer, and a group
  // whose children are all locked from the selection. The case a press can reach is a group with
  // locked text and something unlocked, locked after selecting.
  const grpSetup = await host('(function(){var d=app.activeDocument,J=d.pageItems.getByName("J"),K=d.pageItems.getByName("container-3");' +
    'var g=d.activeLayer.groupItems.add();g.name="grp-locked";var t=J.duplicate();t.move(g,ElementPlacement.PLACEATEND);' +
    'var r=d.activeLayer.pathItems.rectangle(J.geometricBounds[1],J.geometricBounds[0],4,4);r.move(g,ElementPlacement.PLACEATEND);' +
    'd.selection=null;g.selected=true;K.selected=true;t.locked=true;return d.selection.length+"";})()');
  await sleep(1800);
  const gBefore = await bounds('grp-locked'), gItems = await itemCount(), gDocs = await docs();
  await click('goBoth');
  await waitIdle();
  s = await panel();
  const gAfter = await bounds('grp-locked');
  check('locked text in a group: group and container stay selected', (await host('app.activeDocument.selection.length+""')) === '2');
  check('locked text in a group: moves, no new document', grpSetup === '2' && Math.abs(gAfter[0] - gBefore[0]) > 0.1 && (await docs()) === gDocs, { status: s.status });
  check('locked text in a group: no copy left, item count unchanged', !(await strays()) && (await itemCount()) === gItems && !/measuring copy/.test(s.status), { status: s.status });
  await cmdZ(); await sleep(1000);
  check('locked text in a group: one undo reverts', (await bounds('grp-locked')).every((v, i) => near(v, gBefore[i])));
  check('locked text in a group: the original text stays locked', (await host('app.activeDocument.pageItems.getByName("grp-locked").textFrames[0].locked+""')) === 'true');
  await host('(function(){var g=app.activeDocument.pageItems.getByName("grp-locked");g.textFrames[0].locked=false;g.remove();return "ok";})()');

  // 9. Every failure in the text read, injected through the engine's test hook
  const fault = async (name) => {
    await select(['container-3', 'J']);
    await host(`$.global.OC_testFault = ${JSON.stringify(name)}; "ok"`);
    const before = await bounds('J'), items = await itemCount();
    try { await click('goBoth'); await waitIdle(); } finally { await host('$.global.OC_testFault = null; "ok"'); }
    const st = await panel(), after = await bounds('J');
    return { status: st.status, moved: !after.every((v, i) => near(v, before[i])), before, after, items, itemsAfter: await itemCount(), stray: await strays() };
  };
  const undoTo = async (b) => { await cmdZ(); await sleep(1000); return (await bounds('J')).every((v, i) => near(v, b[i])); };
  let f = await fault('dup-undefined');
  check('fault dup-undefined: copy found and removed, J moves as normal', f.moved && near(f.after[0] - f.before[0], jPlan.deltas[0].dx, 0.01) && !f.stray && f.itemsAfter === f.items, f);
  check('fault dup-undefined: one undo reverts', await undoTo(f.before));
  f = await fault('dup-throws');
  check('fault dup-throws: box used with a warning, nothing left', /copied for measuring, so its box was used/.test(f.status) && !f.stray && f.itemsAfter === f.items, f);
  if (f.moved) check('fault dup-throws: one undo reverts', await undoTo(f.before));
  f = await fault('outline');
  check('fault outline: box used with a warning, copy removed', /outlined for measuring, so its box was used/.test(f.status) && !f.stray && f.itemsAfter === f.items, f);
  if (f.moved) check('fault outline: one undo reverts', await undoTo(f.before));
  f = await fault('remove');
  check('fault remove: plain warning names the J and the copy', /A measuring copy of J couldn.t be removed\. Delete .Optical Center measuring copy. in the Layers panel\./.test(f.status), f.status);
  check('fault remove: the leftover is findable by name', f.stray && f.itemsAfter > f.items, f);
  await host('app.activeDocument.pageItems.getByName("Optical Center measuring copy").remove(); "ok"');
  check('fault remove: item count back after deleting the leftover', (await itemCount()) === f.items);

  // 10. "Already centered" re-measures after edits its old key missed (bounds and contents unchanged)
  const edited = async (label, editJsx) => {
    await select(['container-3', 'J']);
    await click('goBoth'); await waitIdle(); // centers (or is centered); the result is remembered
    await click('goBoth'); await waitIdle();
    const centered = (await panel()).status.trim() === 'Already centered.';
    const vb = () => host('(function(){var d=app.activeDocument;return d.pageItems.getByName("J").visibleBounds.join(",")+"|"+d.pageItems.getByName("container-3").visibleBounds.join(",");})()');
    const vb0 = await vb();
    await host(editJsx);
    const sameBounds = (await vb()) === vb0;
    const j0 = await bounds('J');
    await click('goBoth'); await waitIdle();
    const st = await panel(), j1 = await bounds('J');
    check(`edit then press (${label}): re-measured and moved`, centered && sameBounds && st.status.trim() !== 'Already centered.' && !j1.every((v, i) => near(v, j0[i], 0.001)), { centered, sameBounds, status: st.status });
  };
  // Pull in the handles of the circle's top anchor: the curve flattens, the bounds stay.
  await edited('path handles', '(function(){var c=app.activeDocument.pageItems.getByName("container-3"),pp=c.pathPoints,t=0,i;' +
    'for(i=1;i<pp.length;i++)if(pp[i].anchor[1]>pp[t].anchor[1])t=i;var a=pp[t].anchor,l=pp[t].leftDirection,r=pp[t].rightDirection;' +
    'pp[t].leftDirection=[(a[0]+l[0])/2,(a[1]+l[1])/2];pp[t].rightDirection=[(a[0]+r[0])/2,(a[1]+r[1])/2];return "ok";})()');
  // Turn the J's fill off: no mass left, so its box center is used instead.
  await edited('text fill off', '(function(){app.activeDocument.pageItems.getByName("J").textRange.characterAttributes.fillColor=new NoColor();return "ok";})()');

  // 11. A reply slower than 20 s. Illustrator freezes the panel while the script runs, so the checks
  // read the panel after the reply. A click sent mid-call is queued and delivered after the reply;
  // it must not start a second press. Only a click() from a second debugger connection queues like
  // that; a CDP mouse event or a click() on this connection lands while the panel is still busy.
  await select(['container-4', 'hole']);
  await sleep(1800);
  const holeBefore = await bounds('hole');
  const p2 = await connect();
  await host('$.global.OC_testFault = "slow"; "ok"');
  await click('goBoth');
  await sleep(5000);
  p2.send('Runtime.evaluate', { expression: 'document.getElementById("goBoth").click()' });
  let late = await panel(); // answers once the panel unfreezes
  for (let i = 0; i < 40 && !/^Moved hole/.test(late.status); i++) { await sleep(250); late = await panel(); }
  await sleep(2500); // a second press, if one started, would have replaced the status by now
  late = await panel();
  const holeAfter = await bounds('hole');
  p2.ws.close();
  check('slow reply: the real result is shown with how long it took', /^Moved hole .*\nIllustrator took 2\d seconds to answer\./.test(late.status) && !late.disabled && !holeAfter.every((v, i) => near(v, holeBefore[i])), late);
  check('slow reply: a click made during the call is dropped', !/Already centered/.test(late.status), late.status);
  check('slow reply: the test delay was one-shot', (await host('String($.global.OC_testFault)')) === 'null');

  await select([]);
  await sleep(1200);
  check('no console errors during the run', p.problems.length === 0, p.problems);

  // Teardown: close the setup document unsaved and go back to the user's file.
  await host(`(function(){var d=app.documents.getByName(${JSON.stringify(testDoc)});d.close(SaveOptions.DONOTSAVECHANGES);${userDoc ? `try{app.activeDocument=app.documents.getByName(${JSON.stringify(userDoc)});}catch(e){}` : ''}return "ok";})()`);

  console.log(JSON.stringify({ testDoc, undoMethod, results, screenshots: [before, after].filter(Boolean) }, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FAILED ${failed.length} of ${results.length}` : `ALL ${results.length} PASSED`);
  p.ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR', e); process.exit(2); });
