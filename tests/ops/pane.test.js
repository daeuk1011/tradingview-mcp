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
