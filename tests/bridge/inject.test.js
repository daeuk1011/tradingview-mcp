// tests/bridge/inject.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callBridge } from '../../src/bridge/inject.js';
import { BRIDGE_VERSION } from '../../src/bridge/bridge.source.js';

// Fake Tab: simulates a page where the bridge may or may not be present.
// Stores the FULL expression so substring checks below are unambiguous.
function fakeTab({ installed = false } = {}) {
  let present = installed;
  const log = [];
  return {
    log,
    async evaluate(expr, opts) {
      log.push({ expr, opts });
      if (expr.includes('window.__tvmcp && window.__tvmcp.version')) return present ? BRIDGE_VERSION : null;
      if (expr.includes('function INSTALL')) { present = true; return BRIDGE_VERSION; } // bridge source inject
      if (expr.includes('__tvmcp.call')) return { ok: true, value: 'RESULT' };
      throw new Error('unexpected expr ' + expr);
    },
  };
}

describe('callBridge', () => {
  it('injects the bridge when absent, then calls', async () => {
    const tab = fakeTab({ installed: false });
    const res = await callBridge(tab, { method: 'listEditors', args: {} });
    assert.deepEqual(res, { ok: true, value: 'RESULT' });
    assert.match(tab.log[0].expr, /window\.__tvmcp && window\.__tvmcp\.version/); // probe runs first
    assert.ok(tab.log.some((l) => l.expr.includes('function INSTALL')));          // then injection
  });

  it('skips injection when bridge already present at the right version', async () => {
    const tab = fakeTab({ installed: true });
    await callBridge(tab, { method: 'listEditors', args: {} });
    assert.equal(tab.log.some((l) => l.expr.includes('function INSTALL')), false);
  });
});
