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
