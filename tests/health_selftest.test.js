/**
 * Tests for health.selfTest() — verifies liveness of reverse-engineered
 * TradingView internal API paths (KNOWN_PATHS). Uses a mock evaluate, no live chart.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selfTest } from '../src/core/health.js';

// evaluate stub: decides liveness from a set of "dead" path substrings.
function mockEvaluate(deadSubstrings = []) {
  const calls = [];
  const fn = async (expr) => {
    calls.push(expr);
    const isDead = deadSubstrings.some((d) => expr.includes(d));
    return !isDead;
  };
  fn.calls = calls;
  return fn;
}

describe('health.selfTest()', () => {
  it('reports all_healthy=true when every window path is alive', async () => {
    const evaluate = mockEvaluate([]);
    const result = await selfTest({ _deps: { evaluate } });
    assert.equal(result.success, true);
    assert.equal(result.all_healthy, true);
    assert.equal(result.alive, result.total);
    assert.ok(result.total > 0, 'should check at least one path');
    assert.deepEqual(result.broken, []);
  });

  it('only probes window.* paths (skips http/non-window entries)', async () => {
    const evaluate = mockEvaluate([]);
    await selfTest({ _deps: { evaluate } });
    assert.ok(evaluate.calls.length > 0);
    assert.ok(evaluate.calls.every((e) => e.includes('window.')),
      'every probe expression should target a window.* path');
  });

  it('flags a broken path and lists it in broken[]', async () => {
    const evaluate = mockEvaluate(['_replayApi']);
    const result = await selfTest({ _deps: { evaluate } });
    assert.equal(result.all_healthy, false);
    assert.ok(result.broken.includes('replayApi'),
      `expected replayApi in broken, got ${JSON.stringify(result.broken)}`);
    assert.equal(result.alive, result.total - 1);
  });

  it('treats an evaluate throw as a dead path, not a crash', async () => {
    const evaluate = async () => { throw new Error('CDP gone'); };
    const result = await selfTest({ _deps: { evaluate } });
    assert.equal(result.success, true);
    assert.equal(result.all_healthy, false);
    assert.equal(result.alive, 0);
  });
});
