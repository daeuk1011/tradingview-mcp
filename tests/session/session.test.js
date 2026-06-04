// tests/session/session.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../../src/session/session.js';

function makeFetch(pagesByCall) {
  let call = 0;
  const activated = [];
  const fetchImpl = async (url) => {
    if (url.endsWith('/json/list')) {
      const pages = pagesByCall[Math.min(call, pagesByCall.length - 1)];
      call++;
      return { json: async () => pages };
    }
    if (url.includes('/json/activate/')) { activated.push(url.split('/').pop()); return { text: async () => 'ok' }; }
    throw new Error('unexpected url ' + url);
  };
  return { fetchImpl, activated };
}
const page = (id, chartId) => ({ type: 'page', id, url: `https://kr.tradingview.com/chart/${chartId}/` });

describe('Session', () => {
  it('listTabs maps chart-tab targets with index + chartId', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0'), page('B', 'c1'), { type: 'page', url: 'about:blank' }]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    const tabs = await s.listTabs();
    assert.deepEqual(tabs.map((t) => [t.index, t.id, t.chartId]), [[0, 'A', 'c0'], [1, 'B', 'c1']]);
  });

  it('activeTab defaults to first tab and caches Tab instances', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0'), page('B', 'c1')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    const t1 = await s.activeTab();
    const t2 = await s.activeTab();
    assert.equal(t1.id, 'A');
    assert.equal(t1, t2); // same cached instance
  });

  it('resolveTab(undefined) is active; resolveTab(1) is explicit', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0'), page('B', 'c1')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    assert.equal((await s.resolveTab(undefined)).id, 'A');
    assert.equal((await s.resolveTab(1)).id, 'B');
    assert.equal((await s.resolveTab('c1')).id, 'B');
  });

  it('switchTab activates the tab and updates active', async () => {
    const { fetchImpl, activated } = makeFetch([[page('A', 'c0'), page('B', 'c1')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    await s.switchTab(1);
    assert.deepEqual(activated, ['B']);
    assert.equal((await s.activeTab()).id, 'B');
  });

  it('drops active + pooled tab when it disappears from the list', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0'), page('B', 'c1')], [page('B', 'c1')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    await s.switchTab(0);            // active = A (uses call 0)
    const t = await s.activeTab();   // call 1: A is gone -> falls back to B
    assert.equal(t.id, 'B');
  });

  it('run() serializes operations', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    const order = [];
    await Promise.all([
      s.run(async () => { await new Promise((r) => setTimeout(r, 10)); order.push(1); }),
      s.run(async () => { order.push(2); }),
    ]);
    assert.deepEqual(order, [1, 2]);
  });
});
