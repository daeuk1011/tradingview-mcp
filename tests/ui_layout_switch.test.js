// tests/ui_layout_switch.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSwitch } from '../src/core/ui.js';

// Build mocked deps that emulate the page-side TradingView API. `savedChart`
// is the record getSavedCharts would return for the match; `landsAs` is the
// layoutName the chart reports after the load (defaults to the matched name).
function makeDeps({ savedChart, landsAs, loadThrows } = {}) {
  const calls = { loadArgs: [], evalAsync: [], eval: [] };
  const landedName = landsAs ?? savedChart?.name;

  const evaluateAsync = async (src) => {
    calls.evalAsync.push(src);
    if (src.includes('getSavedCharts')) {
      return savedChart
        ? { url: savedChart.url, id: savedChart.id, name: savedChart.name, symbol: savedChart.symbol, resolution: savedChart.resolution }
        : { error: 'Layout not found.' };
    }
    if (src.includes('loadLayoutFromServerByLayoutId')) {
      // Capture the url literal the loader was handed.
      const m = src.match(/loadLayoutFromServerByLayoutId\((".*?")\)/);
      if (m) calls.loadArgs.push(JSON.parse(m[1]));
      if (loadThrows) return { error: 'load failed' };
      return { ok: true };
    }
    return {};
  };

  const evaluate = async (src) => {
    calls.eval.push(src);
    if (src.includes('layoutName')) {
      return { layoutName: landedName, symbol: savedChart?.symbol, resolution: savedChart?.resolution };
    }
    return false; // unsaved-changes dialog: nothing to dismiss
  };

  return { _deps: { evaluate, evaluateAsync, sleep: async () => {} }, calls };
}

describe('layoutSwitch', () => {
  const dae = { url: 'L6kity6U', id: 191941061, name: '대욱', symbol: 'GATE:BTCUSDT.P', resolution: '30' };

  it('loads via the url (not the numeric id) and verifies the switch', async () => {
    const { _deps, calls } = makeDeps({ savedChart: dae });
    const res = await layoutSwitch({ name: '대욱', _deps });

    assert.equal(res.success, true);
    assert.equal(res.verified, true);
    assert.equal(res.layout, '대욱');
    assert.equal(res.layout_url, 'L6kity6U');
    assert.equal(res.symbol, 'GATE:BTCUSDT.P');
    // The loader must receive the short url, never the numeric record id.
    assert.deepEqual(calls.loadArgs, ['L6kity6U']);
    assert.ok(!calls.loadArgs.includes(191941061));
  });

  it('throws when the layout cannot be found', async () => {
    const { _deps } = makeDeps({ savedChart: null });
    await assert.rejects(() => layoutSwitch({ name: 'nope', _deps }), /not found/i);
  });

  it('throws when the matched record has no url', async () => {
    const { _deps } = makeDeps({ savedChart: { ...dae, url: undefined } });
    await assert.rejects(() => layoutSwitch({ name: '대욱', _deps }), /no loadable url/i);
  });

  it('throws (does not report success) when the switch never lands', async () => {
    const { _deps } = makeDeps({ savedChart: dae, landsAs: '티모시' });
    await assert.rejects(() => layoutSwitch({ name: '대욱', _deps }), /did not take effect/i);
  });
});
