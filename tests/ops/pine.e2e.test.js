// tests/ops/pine.e2e.test.js
// Requires a live TradingView with the Pine Editor open. Run manually:
//   node --test tests/ops/pine.e2e.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSession } from '../../src/connection.js';
import * as pineOps from '../../src/ops/pine.js';

const LIVE = process.env.TV_E2E === '1';

describe('pine ops over live bridge', { skip: !LIVE && 'set TV_E2E=1 with TradingView running' }, () => {
  let tab;
  let original;
  before(async () => {
    tab = await getSession().activeTab();
    original = (await pineOps.getSource(tab, undefined)).source;
  });
  after(async () => {
    if (original !== undefined) await pineOps.setSource(tab, undefined, original);
  });

  it('listEditors returns at least one editor with an index', async () => {
    const { getSource } = pineOps;
    const r = await getSource(tab, undefined);
    assert.equal(typeof r.source, 'string');
    assert.equal(typeof r.editorIndex, 'number');
  });

  it('an out-of-range editor errors with the open list (never index 0)', async () => {
    await assert.rejects(pineOps.getSource(tab, 999), /out of range \(open:/);
  });

  it('set then get round-trips on the active editor', async () => {
    const marker = '//tvmcp-e2e ' + Date.now();
    await pineOps.setSource(tab, undefined, marker + '\nindicator("x")');
    const { source } = await pineOps.getSource(tab, undefined);
    assert.match(source, new RegExp(marker));
  });
});

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
