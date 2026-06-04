/**
 * Tests for CDP configuration resolution and debug logging utilities.
 * Pure functions — no live chart required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCdpHost, resolveCdpPort } from '../src/config.js';
import { isDebugEnabled, createDebugLogger } from '../src/debug.js';

// ── resolveCdpHost() ──────────────────────────────────────────────────────

describe('resolveCdpHost()', () => {
  it('defaults to localhost when env is empty', () => {
    assert.equal(resolveCdpHost({}), 'localhost');
  });

  it('uses TV_CDP_HOST when set', () => {
    assert.equal(resolveCdpHost({ TV_CDP_HOST: '127.0.0.1' }), '127.0.0.1');
  });

  it('ignores empty TV_CDP_HOST', () => {
    assert.equal(resolveCdpHost({ TV_CDP_HOST: '' }), 'localhost');
  });
});

// ── resolveCdpPort() ──────────────────────────────────────────────────────

describe('resolveCdpPort()', () => {
  it('defaults to 9222 when env is empty', () => {
    assert.equal(resolveCdpPort({}), 9222);
  });

  it('uses TV_CDP_PORT when set to a valid port', () => {
    assert.equal(resolveCdpPort({ TV_CDP_PORT: '9333' }), 9333);
  });

  it('falls back to 9222 on non-numeric value', () => {
    assert.equal(resolveCdpPort({ TV_CDP_PORT: 'abc' }), 9222);
  });

  it('falls back to 9222 on out-of-range port', () => {
    assert.equal(resolveCdpPort({ TV_CDP_PORT: '70000' }), 9222);
    assert.equal(resolveCdpPort({ TV_CDP_PORT: '0' }), 9222);
    assert.equal(resolveCdpPort({ TV_CDP_PORT: '-5' }), 9222);
  });

  it('rejects non-integer ports', () => {
    assert.equal(resolveCdpPort({ TV_CDP_PORT: '92.5' }), 9222);
  });
});

// ── isDebugEnabled() ──────────────────────────────────────────────────────

describe('isDebugEnabled()', () => {
  it('is off by default', () => {
    assert.equal(isDebugEnabled('cdp', {}), false);
  });

  it('enables a specific namespace via TV_DEBUG', () => {
    assert.equal(isDebugEnabled('cdp', { TV_DEBUG: 'cdp' }), true);
  });

  it('does not enable an unlisted namespace', () => {
    assert.equal(isDebugEnabled('pine', { TV_DEBUG: 'cdp' }), false);
  });

  it('supports wildcard "*"', () => {
    assert.equal(isDebugEnabled('anything', { TV_DEBUG: '*' }), true);
  });

  it('supports comma-separated namespaces', () => {
    assert.equal(isDebugEnabled('pine', { TV_DEBUG: 'cdp,pine' }), true);
    assert.equal(isDebugEnabled('cdp', { TV_DEBUG: 'cdp, pine' }), true);
  });

  it('trims whitespace around namespaces', () => {
    assert.equal(isDebugEnabled('cdp', { TV_DEBUG: '  cdp  ' }), true);
  });
});

// ── createDebugLogger() ───────────────────────────────────────────────────

describe('createDebugLogger()', () => {
  it('returns a no-op that writes nothing when disabled', () => {
    const writes = [];
    const log = createDebugLogger('cdp', { env: {}, sink: (s) => writes.push(s) });
    log('hello');
    assert.equal(writes.length, 0);
  });

  it('writes a namespaced line when enabled', () => {
    const writes = [];
    const log = createDebugLogger('cdp', { env: { TV_DEBUG: 'cdp' }, sink: (s) => writes.push(s) });
    log('hello');
    assert.equal(writes.length, 1);
    assert.match(writes[0], /\[tv:cdp\] hello/);
  });
});
