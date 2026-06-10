// tests/ops/pine_saveas.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeCopy, createNew } from '../../src/ops/pine.js';

// Fake Tab recording bridge calls; emulates window.__tvmcp.call() over one editor.
function fakeTab() {
  const calls = [];
  const tab = {
    calls,
    async evaluate(expr) {
      if (expr.includes('version')) return 1; // bridge present
      const m = expr.match(/__tvmcp\.call\((.*)\)$/s);
      if (!m) throw new Error('unexpected ' + expr);
      const { method, args } = JSON.parse(m[1]);
      calls.push({ method, args });
      if (method === 'listEditors') return { ok: true, value: [{ index: 0, name: 'MTV_V1 (port)' }] };
      if (method === 'editor.activate') return { ok: true, value: true };
      if (method === 'editor.makeCopy') return { ok: true, value: args.name };
      if (method === 'editor.createNew') return { ok: true, value: args.type };
      return { ok: false, error: 'unknown ' + method };
    },
  };
  return tab;
}

describe('ops/pine save-as + create', () => {
  it('makeCopy activates the editor then forwards name to the bridge', async () => {
    const tab = fakeTab();
    const res = await makeCopy(tab, undefined, { name: 'MTV_V1 Engine Viz' });
    assert.deepEqual(res, { success: true, name: 'MTV_V1 Engine Viz', editorIndex: 0 });
    const methods = tab.calls.map((c) => c.method);
    assert.ok(methods.includes('editor.activate'));
    const copy = tab.calls.find((c) => c.method === 'editor.makeCopy');
    assert.equal(copy.args.name, 'MTV_V1 Engine Viz');
  });

  it('createNew forwards the script type to the bridge', async () => {
    const tab = fakeTab();
    const res = await createNew(tab, undefined, { type: 'strategy' });
    assert.deepEqual(res, { success: true, type: 'strategy', editorIndex: 0 });
    const c = tab.calls.find((x) => x.method === 'editor.createNew');
    assert.equal(c.args.type, 'strategy');
  });

  it('a bridge error surfaces as a thrown error', async () => {
    const tab = fakeTab();
    tab.evaluate = async (expr) => {
      if (expr.includes('version')) return 1;
      const { method } = JSON.parse(expr.match(/__tvmcp\.call\((.*)\)$/s)[1]);
      if (method === 'listEditors') return { ok: true, value: [{ index: 0, name: 'x' }] };
      if (method === 'editor.activate') return { ok: true, value: true };
      return { ok: false, error: 'Make-a-copy menu item not found (locale?)' };
    };
    await assert.rejects(() => makeCopy(tab, undefined, { name: 'X' }), /Make-a-copy menu item not found/);
  });
});
