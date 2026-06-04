// tests/ops/pine.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSource, setSource } from '../../src/ops/pine.js';
import { compile, save, getConsole } from '../../src/ops/pine.js';

// Fake Tab whose evaluate emulates window.__tvmcp.call() over two editors.
function fakeTab() {
  const editors = [{ name: '내전략', value: 'a', markers: [] }, { name: '무제', value: 'b', markers: [] }];
  return {
    async evaluate(expr) {
      if (expr.includes('version')) return 1;                 // bridge present
      const m = expr.match(/__tvmcp\.call\((.*)\)$/s);
      if (!m) throw new Error('unexpected ' + expr);
      const { method, args } = JSON.parse(m[1]);
      if (method === 'listEditors') return { ok: true, value: editors.map((e, i) => ({ index: i, name: e.name })) };
      const e = editors[args.editor];
      if (!e) return { ok: false, error: `editor ${args.editor} out of range (open: 0=내전략, 1=무제)` };
      if (method === 'editor.getSource') return { ok: true, value: e.value };
      if (method === 'editor.setSource') { e.value = args.source; return { ok: true, value: true }; }
      if (method === 'editor.getMarkers') return { ok: true, value: e.markers };
      return { ok: false, error: 'unknown' };
    },
  };
}

describe('ops/pine', () => {
  it('getSource on active editor (index 0)', async () => {
    assert.deepEqual(await getSource(fakeTab(), undefined), { source: 'a', editorIndex: 0 });
  });
  it('getSource on a named editor', async () => {
    assert.deepEqual(await getSource(fakeTab(), '무제'), { source: 'b', editorIndex: 1 });
  });
  it('setSource writes to the chosen editor', async () => {
    const tab = fakeTab();
    await setSource(tab, 1, 'z');
    assert.deepEqual(await getSource(tab, 1), { source: 'z', editorIndex: 1 });
  });
  it('unknown editor name throws with the open list', async () => {
    await assert.rejects(getSource(fakeTab(), 'X'), /no Pine editor named "X" \(open: 0=내전략, 1=무제\)/);
  });
});

function fakeCompileTab({ compileReturns = 'Save and add to chart' } = {}) {
  const calls = [];
  return {
    calls,
    async evaluate(expr) {
      if (expr.includes('version')) return 2;
      const m = expr.match(/__tvmcp\.call\((.*)\)$/s);
      if (!m) throw new Error('unexpected ' + expr);
      const { method } = JSON.parse(m[1]);
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

import { applyToPane } from '../../src/ops/pine.js';

function fakeApplyTab({ addsStudy = true, title = 'MyInd' } = {}) {
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
    const r = await applyToPane(tab, { editor: 0, pane: 0, mode: 'replace', settleMs: 0 });
    assert.equal(r.applied, 'MyInd');
    assert.equal(r.removed, 1);
    const ids = tab._studies().map((s) => s.id).sort();
    assert.deepEqual(ids, ['new1', 's_keep']);
  });
  it('add mode skips removal (stacks)', async () => {
    const tab = fakeApplyTab();
    const r = await applyToPane(tab, { editor: 0, pane: 0, mode: 'add', settleMs: 0 });
    assert.equal(r.removed, 0);
    assert.ok(tab._studies().some((s) => s.id === 's_old'));
  });
  it('failed compile (no new study) skips removal and surfaces error', async () => {
    const tab = fakeApplyTab({ addsStudy: false });
    const r = await applyToPane(tab, { editor: 0, pane: 0, mode: 'replace', settleMs: 0 });
    assert.equal(r.applied, null);
    assert.equal(r.removed, 0);
    assert.match(r.error || '', /error/);
    assert.ok(tab._studies().some((s) => s.id === 's_old'));
  });
});
