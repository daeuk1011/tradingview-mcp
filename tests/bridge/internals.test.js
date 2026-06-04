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
  it('pane.removeStudyByName removes same name except the kept id', () => {
    const int = fakePaneInternals();
    int._panes[0].studies.push({ id: 's3', name: 'RSI' });
    const r = dispatch(int, { method: 'pane.removeStudyByName', args: { pane: 0, title: 'RSI', exceptId: 's3' } });
    assert.deepEqual(r, { ok: true, value: 1 });
    assert.deepEqual(int.paneStudies(0).map((s) => s.id), ['s2', 's3']);
  });
});

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
