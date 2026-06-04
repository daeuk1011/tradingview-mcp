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
