// tests/bridge/internals.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../../src/bridge/internals.js';

// Fake internals: two editors, a getValue/setValue per editor.
function fakeInternals() {
  const editors = [
    { name: '내전략', value: 'a', markers: [] },
    { name: '무제', value: 'b', markers: [{ message: 'oops', startLineNumber: 3, severity: 8 }] },
  ];
  return {
    listEditors: () => editors.map((e, i) => ({ index: i, name: e.name })),
    editorAt: (i) => {
      const e = editors[i];
      if (!e) return null;
      return {
        getSource: () => e.value,
        setSource: (v) => { e.value = v; return true; },
        getMarkers: () => e.markers,
      };
    },
  };
}

describe('bridge dispatch', () => {
  it('listEditors', () => {
    assert.deepEqual(dispatch(fakeInternals(), { method: 'listEditors', args: {} }),
      { ok: true, value: [{ index: 0, name: '내전략' }, { index: 1, name: '무제' }] });
  });
  it('editor.getSource by index', () => {
    assert.deepEqual(dispatch(fakeInternals(), { method: 'editor.getSource', args: { editor: 0 } }),
      { ok: true, value: 'a' });
  });
  it('editor.setSource mutates', () => {
    const int = fakeInternals();
    assert.deepEqual(dispatch(int, { method: 'editor.setSource', args: { editor: 1, source: 'z' } }), { ok: true, value: true });
    assert.equal(dispatch(int, { method: 'editor.getSource', args: { editor: 1 } }).value, 'z');
  });
  it('out-of-range editor returns ok:false with the open list', () => {
    const res = dispatch(fakeInternals(), { method: 'editor.getSource', args: { editor: 5 } });
    assert.equal(res.ok, false);
    assert.match(res.error, /editor 5 out of range \(open: 0=내전략, 1=무제\)/);
  });
  it('unknown method returns ok:false', () => {
    const res = dispatch(fakeInternals(), { method: 'nope', args: {} });
    assert.equal(res.ok, false);
    assert.match(res.error, /unknown bridge method "nope"/);
  });
});
