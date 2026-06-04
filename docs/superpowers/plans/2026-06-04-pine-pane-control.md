# Pine Multi-Editor + Pane-Targeted Compile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the remaining Pine tools addressable by `{tab, editor}`, and let `pine_compile`/`pine_smart_compile` apply the editor's script to a specific multichart **pane** (`{pane, mode}`), replacing only the same-titled study.

**Architecture:** Extends the Phase 2 resident bridge (`window.__tvmcp`, bumped to version 2) with editor-activation/compile/save/console and pane (listPanes/focusPane/studies/removeStudyByName) methods. Pure dispatch logic is unit-tested with injected fakes; the live fiber-walk / chartWidgetCollection access is e2e-only. Ops orchestrate; `core/pine.js` keeps shims; tools gain additive params.

**Tech Stack:** Node 24 ESM, `node:test` + `node:assert/strict`, `chrome-remote-interface`, `zod`, MCP SDK.

**Spec:** `docs/superpowers/specs/2026-06-04-pine-pane-control-design.md`

**Scope:** Slices 0–3 (risk gate, pane primitives, remaining Pine tools, pane-targeted compile). Slice 4 (ctx on `pane_*` tools + `CLAUDE.md`) is a brief follow-up after this lands.

**Live API facts (verified read-only on the running app):**
- Active chart: `window.TradingViewApi._activeChartWidgetWV.value()`.
- `chart.getAllStudies()` → array of `{ id, name }` (plain values). Removal: `chart.removeEntity(id)`. Lookup: `chart.getStudyById(id)`.
- Multichart: `window.TradingViewApi._chartWidgetCollection.getAll()` → chart widgets; existing `core/pane.js` focuses a pane via `widget._mainDiv.click()`.
- Monaco editors: `env.editor.getEditors()` (from the Phase 2 fiber-walk in `bridge.source.js`).

---

## File Structure

**Created:**
- `src/session/pane.js` — `resolvePaneIndex(tab, ref)` thin handle (wires existing `resolvePaneRef`).
- `src/ops/pane.js` — `listPanes(tab)`, `focusPane(tab, ref)`, `paneStudies(tab, ref)`.
- `tests/ops/pane.test.js`, `tests/session/pane.test.js`.

**Modified:**
- `src/bridge/bridge.source.js` — add editor + pane methods; `BRIDGE_VERSION` → 2.
- `src/bridge/internals.js` — add pure dispatch for the new methods.
- `tests/bridge/internals.test.js` — add dispatch tests.
- `src/ops/pine.js` — add `compile`/`save`/`getConsole`/`smartCompile`/`newScript`/`openScript`/`applyToPane`.
- `tests/ops/pine.test.js` — add ops tests (fake Tab).
- `src/core/pine.js` — remaining functions delegate to ops.
- `src/tools/pine.js` — remaining tools gain `{tab, editor}` (+ `pane`, `mode` on compile/smart_compile).
- `src/tools/_context.js` — add `modeParam`.
- `tests/ops/pine.e2e.test.js` — add pane-targeted live scenarios.
- `package.json` — add new unit test files to `test:unit`.

---

## Slice 0 — Risk-validation GATE (live)

**This slice is a hard gate.** It validates the two design assumptions live, restore-safe. If either fails, STOP and report for redesign — do not start Slice 1+.

### Task 1: Live spike — editor activation drives compile + per-pane study removal

**Files:**
- Create: `scripts/spike-pine-pane.mjs` (throwaway probe; committed so results are reproducible, removed in Slice 3)

- [ ] **Step 1: Write the spike script**

```js
// scripts/spike-pine-pane.mjs
// Restore-safe live spike. Requires TradingView running with the Pine Editor open.
// Run: node scripts/spike-pine-pane.mjs
import { evaluate, evaluateAsync, getClient, disconnect } from '../src/connection.js';
import { ensurePineEditorOpen } from '../src/core/pine.js';

const ev = (s) => evaluate(s);
const log = (...a) => console.log(...a);

async function main() {
  await ensurePineEditorOpen();

  // --- RISK 2: study list + remove-by-name on the active chart ---
  const studies = await ev(`(function(){
    var c = window.TradingViewApi._activeChartWidgetWV.value();
    return JSON.stringify(c.getAllStudies().map(function(s){ return { id:s.id, name:s.name }; }));
  })()`);
  log('RISK2 studies on active chart:', studies);
  log('RISK2 has removeEntity:', await ev(`typeof window.TradingViewApi._activeChartWidgetWV.value().removeEntity === 'function'`));

  // --- RISK 1: enumerate editors + does an "activate" exist? ---
  const editors = await ev(`(function(){
    var cont = document.querySelector('.monaco-editor.pine-editor-monaco'); if(!cont) return '[]';
    var el=cont,key; for(var i=0;i<20&&el;i++){ key=Object.keys(el).find(function(k){return k.startsWith('__reactFiber$');}); if(key)break; el=el.parentElement; }
    var cur=el&&el[key];
    for(var d=0;d<15&&cur;d++){ var p=cur.memoizedProps; if(p&&p.value&&p.value.monacoEnv&&p.value.monacoEnv.editor&&p.value.monacoEnv.editor.getEditors){ var eds=p.value.monacoEnv.editor.getEditors();
      return JSON.stringify(eds.map(function(e,i){ var m=e.getModel&&e.getModel(); return { index:i, hasFocus: typeof e.focus==='function', uri:(m&&String(m.uri.path||''))||'' }; })); } cur=cur.return; }
    return '[]';
  })()`);
  log('RISK1 editors:', editors);

  // Pine editor script tabs in the DOM (the activation surface if focus() is not enough)
  const tabs = await ev(`(function(){
    var ts = document.querySelectorAll('[class*="tab"][data-name], [class*="editorTab"], [class*="scriptTab"]');
    return JSON.stringify(Array.prototype.slice.call(ts, 0, 10).map(function(t){ return { cls:t.className.slice(0,40), txt:t.textContent.trim().slice(0,30) }; }));
  })()`);
  log('RISK1 candidate script-tab DOM:', tabs);

  await disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{ console.error('SPIKE ERR', e); process.exit(1); });
```

- [ ] **Step 2: Run the spike against live TradingView**

Run: `node scripts/spike-pine-pane.mjs`
Expected: prints the study list with `{id,name}`, `RISK2 has removeEntity: true`, the editors array with `hasFocus`, and any script-tab DOM candidates.

- [ ] **Step 3: Decide the editor-activation mechanism and record it**

Inspect the output. The activation mechanism for `editor.activate(i)` is one of, in priority order:
1. If editors expose `focus()` and a follow-up `editor.compile()` (on a 2-tab setup) compiles the focused script → use `getEditors()[i].focus()`.
2. Else use the script-tab DOM element click (the candidate tabs printed) indexed to `i`.

Append a short comment block to `scripts/spike-pine-pane.mjs` recording which mechanism was confirmed (this is the input to Task 6's `editor.activate`).

- [ ] **Step 4: GATE checkpoint**

If `removeEntity` is not a function, OR no viable editor-activation mechanism exists, STOP: report BLOCKED with the spike output so the design can be revised. Otherwise continue.

- [ ] **Step 5: Commit**

```bash
git add scripts/spike-pine-pane.mjs
git commit -m "spike(pine-pane): validate study removal + editor activation mechanics"
```

---

## Slice 1 — Pane primitives (bridge methods + handle + ops)

### Task 2: Bridge dispatch — pane methods (pure)

**Files:**
- Modify: `src/bridge/internals.js`
- Test: `tests/bridge/internals.test.js`

- [ ] **Step 1: Add the failing dispatch tests**

Append to `tests/bridge/internals.test.js` (keep all existing tests; `dispatch` and `assert` are already imported at the top of the file):

```js
// tests/bridge/internals.test.js  — append (pane dispatch tests)
function fakePaneInternals() {
  const panes = [
    { symbol: 'A', resolution: '60', studies: [{ id: 's1', name: 'RSI' }, { id: 's2', name: 'MyX' }] },
    { symbol: 'B', resolution: '5', studies: [] },
  ];
  let focused = 0;
  return {
    _panes: panes,
    get focused() { return focused; },
    listEditors: () => [],
    editorAt: () => null,
    listPanes: () => panes.map((p, i) => ({ index: i, symbol: p.symbol, resolution: p.resolution })),
    focusPane: (i) => { if (!panes[i]) return null; focused = i; return true; },
    paneStudies: (i) => panes[i] ? panes[i].studies.map((s) => ({ id: s.id, title: s.name })) : null,
    removeStudyByName: (i, title, exceptId) => {
      if (!panes[i]) return null;
      const before = panes[i].studies.length;
      panes[i].studies = panes[i].studies.filter((s) => !(s.name === title && s.id !== exceptId));
      return before - panes[i].studies.length;
    },
  };
}

describe('bridge dispatch — panes', () => {
  it('listPanes returns index/symbol/resolution', () => {
    assert.deepEqual(dispatch(fakePaneInternals(), { method: 'listPanes', args: {} }),
      { ok: true, value: [{ index: 0, symbol: 'A', resolution: '60' }, { index: 1, symbol: 'B', resolution: '5' }] });
  });
  it('focusPane in range', () => {
    assert.deepEqual(dispatch(fakePaneInternals(), { method: 'focusPane', args: { pane: 1 } }), { ok: true, value: true });
  });
  it('focusPane out of range -> ok:false with count', () => {
    const r = dispatch(fakePaneInternals(), { method: 'focusPane', args: { pane: 5 } });
    assert.equal(r.ok, false);
    assert.match(r.error, /pane 5 out of range \(layout has 2 charts\)/);
  });
  it('pane.studies lists {id,title}', () => {
    assert.deepEqual(dispatch(fakePaneInternals(), { method: 'pane.studies', args: { pane: 0 } }),
      { ok: true, value: [{ id: 's1', title: 'RSI' }, { id: 's2', title: 'MyX' }] });
  });
  it('pane.removeStudyByName removes same title except the kept id', () => {
    const int = fakePaneInternals();
    // add a duplicate-titled study to pane 0
    int._panes[0].studies.push({ id: 's3', name: 'RSI' });
    const r = dispatch(int, { method: 'pane.removeStudyByName', args: { pane: 0, title: 'RSI', exceptId: 's3' } });
    assert.deepEqual(r, { ok: true, value: 1 });
    assert.deepEqual(int.paneStudies(0).map((s) => s.id), ['s2', 's3']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bridge/internals.test.js`
Expected: FAIL — `unknown bridge method "listPanes"` (dispatch has no pane cases yet).

- [ ] **Step 3: Add pane cases to `dispatch`**

In `src/bridge/internals.js`, add a `paneOr` helper above `dispatch` and new cases inside the switch (before `default`):

```js
// src/bridge/internals.js — add helper above dispatch()
function paneOr(internals, ref) {
  const panes = internals.listPanes();
  const i = Number(ref);
  if (!Number.isInteger(i) || i < 0 || i >= panes.length) {
    return { err: `pane ${ref} out of range (layout has ${panes.length} chart${panes.length === 1 ? '' : 's'})` };
  }
  return { i };
}
```

```js
// src/bridge/internals.js — add cases inside the switch, before `default:`
      case 'listPanes':
        return { ok: true, value: internals.listPanes() };
      case 'focusPane': {
        const r = paneOr(internals, args.pane);
        return r.err ? { ok: false, error: r.err } : { ok: true, value: internals.focusPane(r.i) };
      }
      case 'pane.studies': {
        const r = paneOr(internals, args.pane);
        return r.err ? { ok: false, error: r.err } : { ok: true, value: internals.paneStudies(r.i) };
      }
      case 'pane.removeStudyByName': {
        const r = paneOr(internals, args.pane);
        return r.err ? { ok: false, error: r.err } : { ok: true, value: internals.removeStudyByName(r.i, args.title, args.exceptId) };
      }
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bridge/internals.test.js`
Expected: PASS (existing + new pane tests).

- [ ] **Step 5: Commit**

```bash
git add src/bridge/internals.js tests/bridge/internals.test.js
git commit -m "feat(bridge): pure dispatch for pane methods (list/focus/studies/removeByName)"
```

### Task 3: Bridge source — live pane methods + version 2

**Files:**
- Modify: `src/bridge/bridge.source.js`

- [ ] **Step 1: Bump version and add live pane internals + dispatch cases**

In `src/bridge/bridge.source.js`: change `export const BRIDGE_VERSION = 1;` to `= 2;`.

Inside `INSTALL`, extend the `internals()` return object with pane accessors (add these properties alongside `listEditors`/`editorAt`):

```js
// inside internals() return {...}, add:
      listPanes: function () {
        var cwc = window.TradingViewApi._chartWidgetCollection;
        return cwc.getAll().map(function (c, i) {
          var sym = '', res = null;
          try { var ms = c.model().mainSeries(); sym = ms.symbol(); res = ms.interval(); } catch (e) {}
          return { index: i, symbol: sym, resolution: res };
        });
      },
      focusPane: function (i) {
        var cwc = window.TradingViewApi._chartWidgetCollection;
        var c = cwc.getAll()[i];
        if (!c) return null;
        if (c._mainDiv) c._mainDiv.click();
        return true;
      },
      paneStudies: function (i) {
        var cwc = window.TradingViewApi._chartWidgetCollection;
        var c = cwc.getAll()[i];
        if (!c) return null;
        return c.getAllStudies().map(function (s) { return { id: s.id, title: s.name }; });
      },
      removeStudyByName: function (i, title, exceptId) {
        var cwc = window.TradingViewApi._chartWidgetCollection;
        var c = cwc.getAll()[i];
        if (!c) return null;
        var removed = 0;
        c.getAllStudies().forEach(function (s) {
          if (s.name === title && s.id !== exceptId) { c.removeEntity(s.id); removed++; }
        });
        return removed;
      },
```

Add the same `paneOr` helper used by the pure module, and the four new dispatch cases, inside `window.__tvmcp.call`'s switch (mirroring `src/bridge/internals.js` exactly — same method names, same error text):

```js
// inside INSTALL, add above window.__tvmcp:
  function paneOr(ref) {
    var panes = internals().listPanes();
    var i = Number(ref);
    if (!Number.isInteger(i) || i < 0 || i >= panes.length) {
      return { err: 'pane ' + ref + ' out of range (layout has ' + panes.length + ' chart' + (panes.length === 1 ? '' : 's') + ')' };
    }
    return { i: i };
  }
```

```js
// inside the call switch, before default::
          case 'listPanes': return { ok: true, value: internals().listPanes() };
          case 'focusPane': { var fp = paneOr(args.pane); return fp.err ? { ok: false, error: fp.err } : { ok: true, value: internals().focusPane(fp.i) }; }
          case 'pane.studies': { var ps = paneOr(args.pane); return ps.err ? { ok: false, error: ps.err } : { ok: true, value: internals().paneStudies(ps.i) }; }
          case 'pane.removeStudyByName': { var rp = paneOr(args.pane); return rp.err ? { ok: false, error: rp.err } : { ok: true, value: internals().removeStudyByName(rp.i, args.title, args.exceptId) }; }
```

- [ ] **Step 2: Syntax + vm sanity check (no Monaco/CWC present → graceful)**

Run:
```bash
node --check src/bridge/bridge.source.js
node --input-type=module -e '
import { BRIDGE_SOURCE, BRIDGE_VERSION } from "./src/bridge/bridge.source.js";
import vm from "node:vm";
const sandbox = { window: {}, document: { querySelector: () => null } };
vm.createContext(sandbox);
const v = vm.runInContext(BRIDGE_SOURCE, sandbox);
if (v !== BRIDGE_VERSION || BRIDGE_VERSION !== 2) throw new Error("version");
if (typeof sandbox.window.__tvmcp.call !== "function") throw new Error("no call");
console.log("bridge v2 source OK");
'
```
Expected: `bridge v2 source OK`.

- [ ] **Step 3: Live check against TradingView**

Run:
```bash
node --input-type=module -e '
import { BRIDGE_SOURCE } from "./src/bridge/bridge.source.js";
import { evaluate, disconnect } from "./src/connection.js";
await evaluate(BRIDGE_SOURCE);
console.log("listPanes:", await evaluate("JSON.stringify(window.__tvmcp.call({method:\"listPanes\",args:{}}))"));
console.log("studies p0:", await evaluate("JSON.stringify(window.__tvmcp.call({method:\"pane.studies\",args:{pane:0}}))"));
await disconnect(); process.exit(0);
'
```
Expected: `listPanes` returns `{ok:true,value:[{index:0,symbol:...}]}`, `pane.studies` returns the active chart's studies as `{id,title}`.

- [ ] **Step 4: Commit**

```bash
git add src/bridge/bridge.source.js
git commit -m "feat(bridge): live pane methods + BRIDGE_VERSION 2"
```

### Task 4: Pane handle + pane ops

**Files:**
- Create: `src/session/pane.js`
- Create: `src/ops/pane.js`
- Test: `tests/ops/pane.test.js`

- [ ] **Step 1: Write the failing ops test**

```js
// tests/ops/pane.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listPanes, focusPane, paneStudies } from '../../src/ops/pane.js';

function fakeTab() {
  const panes = [{ index: 0, symbol: 'A', resolution: '60' }, { index: 1, symbol: 'B', resolution: '5' }];
  const studies = { 0: [{ id: 's1', title: 'RSI' }], 1: [] };
  return {
    async evaluate(expr) {
      if (expr.includes('version')) return 2;
      const { method, args } = JSON.parse(expr.match(/__tvmcp\.call\((.*)\)$/s)[1]);
      if (method === 'listPanes') return { ok: true, value: panes };
      if (method === 'focusPane') return panes[args.pane] ? { ok: true, value: true } : { ok: false, error: `pane ${args.pane} out of range (layout has 2 charts)` };
      if (method === 'pane.studies') return { ok: true, value: studies[args.pane] || [] };
      return { ok: false, error: 'unknown' };
    },
  };
}

describe('ops/pane', () => {
  it('listPanes returns the pane list', async () => {
    assert.deepEqual(await listPanes(fakeTab()), [{ index: 0, symbol: 'A', resolution: '60' }, { index: 1, symbol: 'B', resolution: '5' }]);
  });
  it('focusPane resolves an index and returns it', async () => {
    assert.equal(await focusPane(fakeTab(), 1), 1);
  });
  it('focusPane out of range throws with the layout count', async () => {
    await assert.rejects(focusPane(fakeTab(), 5), /pane 5 out of range \(layout has 2 charts\)/);
  });
  it('paneStudies returns studies for a pane', async () => {
    assert.deepEqual(await paneStudies(fakeTab(), 0), [{ id: 's1', title: 'RSI' }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/ops/pane.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handle + ops**

```js
// src/session/pane.js
import { resolvePaneRef } from './context.js';
import { callBridge } from '../bridge/inject.js';

/**
 * Resolve a pane ref to a concrete index on a Tab using the live pane list.
 * Throws (never falls back to 0) on a bad ref.
 * @returns {Promise<number>} the pane index.
 */
export async function resolvePaneIndex(tab, ref) {
  const res = await callBridge(tab, { method: 'listPanes', args: {} });
  if (!res.ok) throw new Error(res.error);
  const panes = res.value;
  const match = resolvePaneRef(ref, panes.length); // null => active (pane 0 convention)
  return match === null ? 0 : match;
}
```

```js
// src/ops/pane.js
import { resolvePaneIndex } from '../session/pane.js';
import { callBridge } from '../bridge/inject.js';

function unwrap(res) { if (!res.ok) throw new Error(res.error); return res.value; }

/** @returns {Promise<Array<{index:number,symbol:string,resolution:string}>>} */
export async function listPanes(tab) {
  return unwrap(await callBridge(tab, { method: 'listPanes', args: {} }));
}

/** Focus a pane; @returns {Promise<number>} the focused index. */
export async function focusPane(tab, paneRef) {
  const pane = await resolvePaneIndex(tab, paneRef);
  unwrap(await callBridge(tab, { method: 'focusPane', args: { pane } }));
  return pane;
}

/** @returns {Promise<Array<{id:string,title:string}>>} */
export async function paneStudies(tab, paneRef) {
  const pane = await resolvePaneIndex(tab, paneRef);
  return unwrap(await callBridge(tab, { method: 'pane.studies', args: { pane } }));
}
```

> Note: `resolvePaneIndex` uses the live `listPanes` count to bound-check. `focusPane`'s test passes a numeric ref so resolution returns it directly; the bridge still validates and the op throws on the bridge error.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/ops/pane.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/pane.js src/ops/pane.js tests/ops/pane.test.js
git commit -m "feat(ops): pane handle + listPanes/focusPane/paneStudies via bridge"
```

---

## Slice 2 — Remaining Pine tools → bridge + addressing

### Task 5: Bridge source — editor activate/compile/save/console

**Files:**
- Modify: `src/bridge/bridge.source.js`
- Modify: `src/bridge/internals.js`
- Test: `tests/bridge/internals.test.js`

- [ ] **Step 1: Add failing dispatch tests for editor.activate**

Append to `tests/bridge/internals.test.js`. Extend the editor fake to support `activate`:

```js
// tests/bridge/internals.test.js — append
describe('bridge dispatch — editor.activate', () => {
  function fakeEditorInternals() {
    let active = 0;
    return {
      listEditors: () => [{ index: 0, name: 'a' }, { index: 1, name: 'b' }],
      editorAt: (i) => (i === 0 || i === 1) ? { activate: () => { active = i; return true; } } : null,
      get active() { return active; },
    };
  }
  it('editor.activate in range', () => {
    assert.deepEqual(dispatch(fakeEditorInternals(), { method: 'editor.activate', args: { editor: 1 } }), { ok: true, value: true });
  });
  it('editor.activate out of range -> ok:false', () => {
    const r = dispatch(fakeEditorInternals(), { method: 'editor.activate', args: { editor: 9 } });
    assert.equal(r.ok, false);
    assert.match(r.error, /editor 9 out of range \(open: 0=a, 1=b\)/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bridge/internals.test.js`
Expected: FAIL — `unknown bridge method "editor.activate"`.

- [ ] **Step 3: Add the editor.activate case to the pure dispatch**

In `src/bridge/internals.js`, add inside the switch (before `default:`):

```js
      case 'editor.activate': {
        const r = editorOr(internals, args.editor);
        return r.err ? { ok: false, error: r.err } : { ok: true, value: r.acc.activate() };
      }
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bridge/internals.test.js`
Expected: PASS.

- [ ] **Step 5: Implement the live editor methods in bridge.source.js**

In `src/bridge/bridge.source.js`, extend the object returned by `editorAt(i)` (alongside `getSource`/`setSource`/`getMarkers`) with `activate`, and add `compile`/`save`/`console` as top-level internals. Use the mechanism confirmed in Slice 0 Task 1 Step 3 for `activate` — the code below uses `ed.focus()` with a DOM script-tab-click fallback; **replace the fallback selector with the one confirmed in the spike if `focus()` alone is insufficient.**

```js
// in editorAt(i) return {...}, add:
          activate: function () {
            try { ed.focus(); } catch (e) {}
            // Fallback (only if Slice 0 showed focus() is insufficient): click the i-th script tab.
            try {
              var tabs = document.querySelectorAll('[class*="scriptTab"], [class*="editorTab"]');
              if (tabs[i]) tabs[i].click();
            } catch (e) {}
            return true;
          },
```

```js
// add as top-level functions inside INSTALL (near internals()):
  function clickCompile() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var t = btns[i].textContent.trim();
      if (/save and add to chart/i.test(t)) { btns[i].click(); return 'Save and add to chart'; }
    }
    for (var j = 0; j < btns.length; j++) {
      var t2 = btns[j].textContent.trim();
      if (/^(add to chart|update on chart)$/i.test(t2)) { btns[j].click(); return t2; }
    }
    return null;
  }
  function clickSave() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) { btns[i].click(); return true; }
    }
    return false;
  }
  function readConsole() {
    var out = [];
    var rows = document.querySelectorAll('[class*="consoleRow"], [class*="consoleLine"]');
    for (var i = 0; i < rows.length; i++) { var x = rows[i].textContent.trim(); if (x) out.push(x); }
    return out;
  }
```

Add their dispatch cases inside the `call` switch (before `default:`):

```js
          case 'editor.activate': { var ea = editorOr(args.editor); return ea.err ? { ok: false, error: ea.err } : { ok: true, value: ea.acc.activate() }; }
          case 'editor.compile': return { ok: true, value: clickCompile() };
          case 'editor.save': return { ok: true, value: clickSave() };
          case 'editor.console': return { ok: true, value: readConsole() };
```

- [ ] **Step 6: Syntax + vm sanity + live smoke**

Run:
```bash
node --check src/bridge/bridge.source.js
node --input-type=module -e '
import { BRIDGE_SOURCE } from "./src/bridge/bridge.source.js";
import { evaluate, disconnect } from "./src/connection.js";
import { ensurePineEditorOpen } from "./src/core/pine.js";
await ensurePineEditorOpen();
await evaluate(BRIDGE_SOURCE);
console.log("activate:", await evaluate("JSON.stringify(window.__tvmcp.call({method:\"editor.activate\",args:{editor:0}}))"));
console.log("console:", await evaluate("JSON.stringify(window.__tvmcp.call({method:\"editor.console\",args:{}}))"));
await disconnect(); process.exit(0);
'
```
Expected: `activate` → `{ok:true,value:true}`; `console` → `{ok:true,value:[...]}` (possibly empty array).

- [ ] **Step 7: Commit**

```bash
git add src/bridge/internals.js src/bridge/bridge.source.js tests/bridge/internals.test.js
git commit -m "feat(bridge): editor activate/compile/save/console"
```

### Task 6: Pine ops — compile/save/getConsole/smartCompile + new/open

**Files:**
- Modify: `src/ops/pine.js`
- Test: `tests/ops/pine.test.js`

- [ ] **Step 1: Add failing ops tests**

Append to `tests/ops/pine.test.js`. Extend the fake Tab to handle the new bridge methods + an injectable CDP keyboard fallback:

```js
// tests/ops/pine.test.js — append
import { compile, save, getConsole } from '../../src/ops/pine.js';

function fakeCompileTab({ compileReturns = 'Save and add to chart' } = {}) {
  const calls = [];
  return {
    calls,
    async evaluate(expr) {
      if (expr.includes('version')) return 2;
      const m = expr.match(/__tvmcp\.call\((.*)\)$/s);
      if (!m) throw new Error('unexpected ' + expr);
      const { method, args } = JSON.parse(m[1]);
      calls.push(method);
      if (method === 'listEditors') return { ok: true, value: [{ index: 0, name: 'a' }] };
      if (method === 'editor.activate') return { ok: true, value: true };
      if (method === 'editor.compile') return { ok: true, value: compileReturns };
      if (method === 'editor.save') return { ok: true, value: true };
      if (method === 'editor.console') return { ok: true, value: ['12:00:00 compiled'] };
      return { ok: false, error: 'unknown' };
    },
    async client() { return { Input: { dispatchKeyEvent: async () => {} } }; },
  };
}

describe('ops/pine compile/save/console', () => {
  it('compile activates the editor then clicks compile', async () => {
    const tab = fakeCompileTab();
    const r = await compile(tab, 0);
    assert.equal(r.button, 'Save and add to chart');
    assert.deepEqual(tab.calls, ['listEditors', 'editor.activate', 'editor.compile']);
  });
  it('compile falls back to keyboard when no button found', async () => {
    const tab = fakeCompileTab({ compileReturns: null });
    const r = await compile(tab, 0);
    assert.equal(r.button, 'keyboard_shortcut');
  });
  it('save activates then saves', async () => {
    assert.equal((await save(fakeCompileTab(), 0)).success, true);
  });
  it('getConsole returns entries', async () => {
    assert.deepEqual((await getConsole(fakeCompileTab(), 0)).entries, ['12:00:00 compiled']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/ops/pine.test.js`
Expected: FAIL — `compile`/`save`/`getConsole` not exported.

- [ ] **Step 3: Implement the ops**

Append to `src/ops/pine.js` (keep the existing `getSource`/`setSource`/`getErrors`):

```js
// src/ops/pine.js — append
async function activate(tab, editorRef) {
  const editor = await resolveEditorIndex(tab, editorRef);
  unwrap(await callBridge(tab, { method: 'editor.activate', args: { editor } }));
  return editor;
}

/** @returns {Promise<{success:true, button:string, editorIndex:number}>} */
export async function compile(tab, editorRef) {
  const editor = await activate(tab, editorRef);
  let button = unwrap(await callBridge(tab, { method: 'editor.compile', args: {} }));
  if (!button) {
    const c = await tab.client();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
    button = 'keyboard_shortcut';
  }
  return { success: true, button, editorIndex: editor };
}

/** @returns {Promise<{success:true, editorIndex:number}>} */
export async function save(tab, editorRef) {
  const editor = await activate(tab, editorRef);
  unwrap(await callBridge(tab, { method: 'editor.save', args: {} }));
  return { success: true, editorIndex: editor };
}

/** @returns {Promise<{entries:string[], editorIndex:number}>} */
export async function getConsole(tab, editorRef) {
  const editor = await activate(tab, editorRef);
  const entries = unwrap(await callBridge(tab, { method: 'editor.console', args: {} }));
  return { entries, editorIndex: editor };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/ops/pine.test.js`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/ops/pine.js tests/ops/pine.test.js
git commit -m "feat(ops): pine compile/save/getConsole with editor activation + kbd fallback"
```

### Task 7: Migrate core/pine.js + tools for the remaining ops

**Files:**
- Modify: `src/core/pine.js`
- Modify: `src/tools/pine.js`

- [ ] **Step 1: Delegate core compile/save/getConsole to ops (run through the queue)**

In `src/core/pine.js`, replace the bodies of `compile`, `save`, `getConsole` (keep `smartCompile`, `newScript`, `openScript`, `listScripts`, `ensurePineEditorOpen`, `FIND_MONACO` unchanged for now):

```js
export async function compile(opts = {}) {
  const s = getSession();
  return s.run(async () => {
    const tab = await s.resolveTab(opts.tab);
    const { button, editorIndex } = await pineOps.compile(tab, opts.editor);
    return { success: true, button_clicked: button, ctx: fmtCtx({ tab: tab.chartId, editor: editorIndex }) };
  });
}
```

```js
export async function save(opts = {}) {
  const s = getSession();
  return s.run(async () => {
    const tab = await s.resolveTab(opts.tab);
    const { editorIndex } = await pineOps.save(tab, opts.editor);
    return { success: true, action: 'saved', ctx: fmtCtx({ tab: tab.chartId, editor: editorIndex }) };
  });
}
```

```js
export async function getConsole(opts = {}) {
  const s = getSession();
  return s.run(async () => {
    const tab = await s.resolveTab(opts.tab);
    const { entries, editorIndex } = await pineOps.getConsole(tab, opts.editor);
    return { success: true, entries, entry_count: entries.length, ctx: fmtCtx({ tab: tab.chartId, editor: editorIndex }) };
  });
}
```

- [ ] **Step 2: Add params to the tools**

In `src/tools/pine.js`, update `pine_save`, `pine_get_console` to accept `tab`/`editor` and pass them through (mirroring the Phase 2 `pine_get_source` pattern):

```js
  server.tool('pine_save', 'Save the current Pine Script (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.save({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
```

```js
  server.tool('pine_get_console', 'Read Pine Script console/log output (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.getConsole({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
```

For `pine_compile`, add `tab`/`editor` now (pane/mode arrive in Slice 3):

```js
  server.tool('pine_compile', 'Compile / add the current Pine Script to the chart (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.compile({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
```

- [ ] **Step 3: Verify**

Run:
```bash
node --check src/core/pine.js && node --check src/tools/pine.js
node -e "import('./src/tools/pine.js').then(m=>console.log('ok', typeof m.registerPineTools))"
node --test tests/config.test.js tests/cli.test.js tests/sanitization.test.js tests/session/ tests/bridge/ tests/ops/pine.test.js tests/ops/pane.test.js tests/tools/
```
Expected: `ok function`; all tests pass.

> Reminder: `node --test <dir>` does not work in this Node; the session/bridge dirs above are passed for convenience — if it errors, enumerate the files (see `package.json` `test:unit`).

- [ ] **Step 4: Commit**

```bash
git add src/core/pine.js src/tools/pine.js
git commit -m "feat(pine): compile/save/get_console addressable by tab/editor, ctx echo"
```

---

## Slice 3 — Pane-targeted compile

### Task 8: `applyToPane` orchestration op

**Files:**
- Modify: `src/ops/pine.js`
- Test: `tests/ops/pine.test.js`

- [ ] **Step 1: Add failing tests for applyToPane (replace + add + failed-compile)**

Append to `tests/ops/pine.test.js`. A fake Tab that models snapshot → compile-adds-a-study → studies query:

```js
// tests/ops/pine.test.js — append
import { applyToPane } from '../../src/ops/pine.js';

function fakeApplyTab({ addsStudy = true, title = 'MyInd' } = {}) {
  // pane 0 starts with an existing same-titled study s_old and a different one s_keep
  let studies = [{ id: 's_old', title }, { id: 's_keep', title: 'Other' }];
  let nextId = 1;
  const calls = [];
  return {
    calls,
    async evaluate(expr) {
      if (expr.includes('version')) return 2;
      const { method, args } = JSON.parse(expr.match(/__tvmcp\.call\((.*)\)$/s)[1]);
      calls.push(method);
      if (method === 'listEditors') return { ok: true, value: [{ index: 0, name: 'a' }] };
      if (method === 'listPanes') return { ok: true, value: [{ index: 0, symbol: 'A', resolution: '60' }] };
      if (method === 'editor.activate' || method === 'focusPane') return { ok: true, value: true };
      if (method === 'pane.studies') return { ok: true, value: studies.map((s) => ({ id: s.id, title: s.title })) };
      if (method === 'editor.compile') {
        if (addsStudy) studies.push({ id: 'new' + (nextId++), title });
        return { ok: true, value: 'Save and add to chart' };
      }
      if (method === 'editor.console') return { ok: true, value: addsStudy ? [] : ['line 3: error'] };
      if (method === 'pane.removeStudyByName') {
        const before = studies.length;
        studies = studies.filter((s) => !(s.title === args.title && s.id !== args.exceptId));
        return { ok: true, value: before - studies.length };
      }
      return { ok: false, error: 'unknown' };
    },
    async client() { return { Input: { dispatchKeyEvent: async () => {} } }; },
    _studies: () => studies,
  };
}

describe('ops/pine applyToPane', () => {
  it('replace removes the same-titled old study, keeps the new + differently-named', async () => {
    const tab = fakeApplyTab();
    const r = await applyToPane(tab, { editor: 0, pane: 0, mode: 'replace' });
    assert.equal(r.applied, 'MyInd');
    assert.equal(r.removed, 1);
    const ids = tab._studies().map((s) => s.id).sort();
    assert.deepEqual(ids, ['new1', 's_keep']); // s_old removed, new kept, Other kept
  });
  it('add mode skips removal (stacks)', async () => {
    const tab = fakeApplyTab();
    const r = await applyToPane(tab, { editor: 0, pane: 0, mode: 'add' });
    assert.equal(r.removed, 0);
    assert.ok(tab._studies().some((s) => s.id === 's_old'));
  });
  it('failed compile (no new study) skips removal and surfaces error', async () => {
    const tab = fakeApplyTab({ addsStudy: false });
    const r = await applyToPane(tab, { editor: 0, pane: 0, mode: 'replace' });
    assert.equal(r.applied, null);
    assert.equal(r.removed, 0);
    assert.match(r.error || '', /error/);
    assert.ok(tab._studies().some((s) => s.id === 's_old')); // untouched
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/ops/pine.test.js`
Expected: FAIL — `applyToPane` not exported.

- [ ] **Step 3: Implement applyToPane**

Append to `src/ops/pine.js`:

```js
// src/ops/pine.js — append
import { focusPane, paneStudies } from './pane.js';
import { resolvePaneIndex } from '../session/pane.js';

/**
 * Apply the editor's current script to a specific pane as a study.
 * mode 'replace' (default): after adding, remove same-titled older studies on
 * the pane (preserving differently-named ones). mode 'add': stack.
 * If the script fails to compile (no new study appears), skip removal and
 * surface the console error — never delete the user's studies on failure.
 * @returns {Promise<{success:boolean, applied:string|null, removed:number, paneIndex:number, editorIndex:number, error?:string}>}
 */
export async function applyToPane(tab, { editor, pane, mode = 'replace' } = {}) {
  const editorIndex = await activate(tab, editor);
  const paneIndex = await resolvePaneIndex(tab, pane);
  unwrap(await callBridge(tab, { method: 'focusPane', args: { pane: paneIndex } }));

  const before = unwrap(await callBridge(tab, { method: 'pane.studies', args: { pane: paneIndex } }));
  const beforeIds = new Set(before.map((s) => s.id));

  unwrap(await callBridge(tab, { method: 'editor.compile', args: {} }));

  const after = unwrap(await callBridge(tab, { method: 'pane.studies', args: { pane: paneIndex } }));
  const added = after.find((s) => !beforeIds.has(s.id));

  if (!added) {
    const entries = unwrap(await callBridge(tab, { method: 'editor.console', args: {} }));
    const err = entries.find((e) => /error/i.test(e)) || 'compile produced no new study';
    return { success: false, applied: null, removed: 0, paneIndex, editorIndex, error: err };
  }

  let removed = 0;
  if (mode === 'replace') {
    removed = unwrap(await callBridge(tab, { method: 'pane.removeStudyByName', args: { pane: paneIndex, title: added.title, exceptId: added.id } }));
  }
  return { success: true, applied: added.title, removed, paneIndex, editorIndex };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/ops/pine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ops/pine.js tests/ops/pine.test.js
git commit -m "feat(ops): applyToPane — pane-targeted compile with replace/add semantics"
```

### Task 9: Wire pane/mode into pine_compile + pine_smart_compile

**Files:**
- Modify: `src/tools/_context.js`
- Modify: `src/core/pine.js`
- Modify: `src/tools/pine.js`

- [ ] **Step 1: Add `modeParam`**

In `src/tools/_context.js`, add:

```js
export const modeParam = z.enum(['replace', 'add']).optional()
  .describe("How to apply to a pane: 'replace' (default, swap same-named study) or 'add' (stack).");
```

- [ ] **Step 2: Add pane-aware compile in core**

In `src/core/pine.js`, change `compile` to branch on `pane`:

```js
export async function compile(opts = {}) {
  const s = getSession();
  return s.run(async () => {
    const tab = await s.resolveTab(opts.tab);
    if (opts.pane !== undefined && opts.pane !== null) {
      const r = await pineOps.applyToPane(tab, { editor: opts.editor, pane: opts.pane, mode: opts.mode });
      return { ...r, ctx: fmtCtx({ tab: tab.chartId, pane: r.paneIndex, editor: r.editorIndex }) };
    }
    const { button, editorIndex } = await pineOps.compile(tab, opts.editor);
    return { success: true, button_clicked: button, ctx: fmtCtx({ tab: tab.chartId, editor: editorIndex }) };
  });
}
```

Add a `smartCompile` wrapper that reuses the same pane-aware path (replace the existing `smartCompile` body, keeping `ensurePineEditorOpen`/`FIND_MONACO` for nothing else? — they are still used by `newScript`/`openScript`, so keep them):

```js
export async function smartCompile(opts = {}) {
  // smart_compile shares the pane-aware compile path; the bridge compile already
  // detects the right button and applyToPane verifies a study was added.
  return compile(opts);
}
```

- [ ] **Step 3: Add params to the tools**

In `src/tools/pine.js`, import `modeParam` and update both tools:

```js
import { tabParam, editorParam, paneParam, modeParam } from './_context.js';
```

```js
  server.tool('pine_compile', 'Compile the Pine Script; optionally target a specific tab/editor and apply to a pane', {
    tab: tabParam, editor: editorParam, pane: paneParam, mode: modeParam,
  }, async ({ tab, editor, pane, mode }) => {
    try { return jsonResult(await core.compile({ tab, editor, pane, mode })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
```

```js
  server.tool('pine_smart_compile', 'Compile + report; optionally target a specific tab/editor and apply to a pane', {
    tab: tabParam, editor: editorParam, pane: paneParam, mode: modeParam,
  }, async ({ tab, editor, pane, mode }) => {
    try { return jsonResult(await core.smartCompile({ tab, editor, pane, mode })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
```

- [ ] **Step 4: Verify unit suite**

Run:
```bash
node --check src/core/pine.js && node --check src/tools/pine.js && node --check src/tools/_context.js
node --test tests/config.test.js tests/cli.test.js tests/sanitization.test.js tests/bridge/internals.test.js tests/bridge/inject.test.js tests/ops/pine.test.js tests/ops/pane.test.js tests/tools/context.test.js tests/session/context.test.js tests/session/queue.test.js tests/session/session.test.js tests/session/tab.test.js
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/_context.js src/core/pine.js src/tools/pine.js
git commit -m "feat(pine): pane-targeted compile/smart_compile via {pane, mode}"
```

### Task 10: e2e — two-pane apply (live, restore-safe) + test wiring + spike cleanup

**Files:**
- Modify: `tests/ops/pine.e2e.test.js`
- Modify: `package.json`
- Delete: `scripts/spike-pine-pane.mjs`

- [ ] **Step 1: Add the two-pane e2e (restore-safe)**

Append to `tests/ops/pine.e2e.test.js`:

```js
// tests/ops/pine.e2e.test.js — append
import * as paneOps from '../../src/ops/pane.js';

describe('pane-targeted apply (live, restore-safe)', { skip: !LIVE && 'set TV_E2E=1 with TradingView running' }, () => {
  let tab, origSource, origLayout;
  before(async () => {
    tab = await getSession().activeTab();
    origSource = (await pineOps.getSource(tab, undefined)).source;
    origLayout = await tab.evaluate(`(function(){var l=window.TradingViewApi._chartWidgetCollection._layoutType; return (l&&l.value&&l.value())||l;})()`);
    await tab.evaluate(`(function(){window.TradingViewApi._chartWidgetCollection.setLayout('2h');})()`);
    await new Promise((r) => setTimeout(r, 800));
  });
  after(async () => {
    await tab.evaluate(`(function(){window.TradingViewApi._chartWidgetCollection.setLayout(${JSON.stringify(origLayout || 's')});})()`);
    await new Promise((r) => setTimeout(r, 500));
    if (origSource !== undefined) await pineOps.setSource(tab, undefined, origSource);
  });

  it('applies distinct scripts to pane 0 and pane 1', async () => {
    const panes = await paneOps.listPanes(tab);
    assert.ok(panes.length >= 2, 'need a 2-pane layout');

    await pineOps.setSource(tab, undefined, '//@version=6\nindicator("E2E_A")\nplot(close)');
    const a = await pineOps.applyToPane(tab, { editor: 0, pane: 0, mode: 'replace' });
    assert.equal(a.applied, 'E2E_A');

    await pineOps.setSource(tab, undefined, '//@version=6\nindicator("E2E_B")\nplot(open)');
    const b = await pineOps.applyToPane(tab, { editor: 0, pane: 1, mode: 'replace' });
    assert.equal(b.applied, 'E2E_B');

    const p0 = (await paneOps.paneStudies(tab, 0)).map((s) => s.title);
    const p1 = (await paneOps.paneStudies(tab, 1)).map((s) => s.title);
    assert.ok(p0.includes('E2E_A'));
    assert.ok(p1.includes('E2E_B'));
  });
});
```

- [ ] **Step 2: Wire new unit tests into package.json**

Replace the `test:unit` script value in `package.json` with (one line):

```
node --test tests/pine_analyze.test.js tests/cli.test.js tests/sanitization.test.js tests/config.test.js tests/health_selftest.test.js tests/session/context.test.js tests/session/queue.test.js tests/session/session.test.js tests/session/tab.test.js tests/session/pane.test.js tests/bridge/inject.test.js tests/bridge/internals.test.js tests/ops/pine.test.js tests/ops/pane.test.js tests/tools/context.test.js
```

> If `tests/session/pane.test.js` was not created (no Task added one), omit it. Task 4 creates `src/session/pane.js` but its behavior is covered via `tests/ops/pane.test.js`; add a dedicated `tests/session/pane.test.js` only if you wrote one.

- [ ] **Step 3: Remove the spike script**

```bash
git rm scripts/spike-pine-pane.mjs
```

- [ ] **Step 4: Run unit suite + live e2e**

Run: `npm run test:unit` → all pass.
Run (live): `TV_E2E=1 node --test tests/ops/pine.e2e.test.js` → the existing Pine e2e + the new two-pane scenario pass, and the chart layout + editor source are restored afterward.

- [ ] **Step 5: Commit**

```bash
git add tests/ops/pine.e2e.test.js package.json
git commit -m "test(pine): two-pane apply e2e + unit wiring; remove spike"
```

---

## Value-Proof Gate (after Task 10)

Manually confirm in a live session: `pine_compile({ pane: 0 })` applies the editor's
script to pane 0; switch the editor source and `pine_compile({ pane: 1 })` applies
to pane 1; re-running on the same pane with `mode:'replace'` keeps one copy;
`mode:'add'` stacks; a deliberately-broken script returns `applied:null` with the
console error and leaves existing studies untouched.

## Deferred — Slice 4 (separate short follow-up)

- `pane_list`/`focus`/`set_layout`/`set_symbol` echo `ctx` and delegate to the new
  bridge `listPanes`/`focusPane` (dedupe `core/pane.js`).
- `pine_new`/`pine_open` return `editor_index`.
- `CLAUDE.md`: document `{tab, editor, pane, mode}` and pane-targeted compile.

---

## Self-Review Notes

- **Spec coverage:** pane primitives (Tasks 2–4), remaining Pine tools addressable
  (Tasks 5–7: compile/save/console; smart_compile via Task 9; new/open deferred to
  Slice 4 per the spec's "returns editor_index" polish), pane-targeted compile with
  replace/add + same-title-by-new-study + failed-compile safety (Tasks 8–9), no-`[0]`
  errors (Tasks 2/4/8 via `resolvePaneRef`/`paneOr`), bridge v2 + auto re-inject
  (Task 3), unit-via-fakes + restore-safe two-pane e2e (Tasks 2/8/10). Slice 0 gates
  the editor-activation assumption.
- **Type consistency:** bridge methods (`listPanes`,`focusPane`,`pane.studies`,
  `pane.removeStudyByName`,`editor.activate`,`editor.compile`,`editor.save`,
  `editor.console`) and the `{ok,value}|{ok,error}` envelope are identical across
  `internals.js`, `bridge.source.js`, and the ops fakes. Study objects are
  `{id, title}` at the bridge boundary (mapped from TV's `{id, name}` inside
  `bridge.source.js`). Ops signatures: `compile(tab, editorRef)`,
  `applyToPane(tab, {editor, pane, mode})`, `focusPane(tab, paneRef)`.
- **Known dependency:** Task 5's `editor.activate` uses the mechanism confirmed in
  the Slice 0 spike. If `focus()` alone proves insufficient, the spike identifies the
  script-tab DOM selector to substitute in Step 5 before proceeding.
