// tests/session/tab.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Tab } from '../../src/session/tab.js';

function fakeClient(evalImpl) {
  const handlers = {};
  return {
    on(ev, cb) { handlers[ev] = cb; },
    _fire(ev) { handlers[ev]?.(); },
    Runtime: { evaluate: evalImpl },
  };
}

describe('Tab', () => {
  it('connects lazily and caches the client', async () => {
    let connects = 0;
    const tab = new Tab({
      id: 'AAA', chartId: 'c', url: 'u',
      connect: async () => { connects++; return fakeClient(async () => ({ result: { value: 1 } })); },
    });
    assert.equal(connects, 0);
    await tab.evaluate('1');
    await tab.evaluate('1');
    assert.equal(connects, 1);
  });

  it('returns the evaluated value', async () => {
    const tab = new Tab({
      id: 'AAA', chartId: 'c', url: 'u',
      connect: async () => fakeClient(async ({ expression }) => ({ result: { value: `got:${expression}` } })),
    });
    assert.equal(await tab.evaluate('2+2'), 'got:2+2');
  });

  it('throws on exceptionDetails', async () => {
    const tab = new Tab({
      id: 'AAA', chartId: 'c', url: 'u',
      connect: async () => fakeClient(async () => ({ exceptionDetails: { exception: { description: 'ReferenceError: x' } } })),
    });
    await assert.rejects(tab.evaluate('x'), /ReferenceError: x/);
  });

  it('drops the cached client on disconnect, reconnecting next call', async () => {
    let connects = 0;
    let client;
    const tab = new Tab({
      id: 'AAA', chartId: 'c', url: 'u',
      connect: async () => { connects++; client = fakeClient(async () => ({ result: { value: 1 } })); return client; },
    });
    await tab.evaluate('1');
    client._fire('disconnect');
    await tab.evaluate('1');
    assert.equal(connects, 2);
  });
});
