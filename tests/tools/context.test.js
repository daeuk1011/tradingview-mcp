// tests/tools/context.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fmtCtx } from '../../src/tools/_context.js';

describe('fmtCtx', () => {
  it('formats tab + editor compactly', () => {
    assert.equal(fmtCtx({ tab: 1, editor: 0 }), 'tab1/editor0');
  });
  it('formats tab + pane compactly', () => {
    assert.equal(fmtCtx({ tab: 0, pane: 2 }), 'tab0/pane2');
  });
  it('omits absent parts', () => {
    assert.equal(fmtCtx({ tab: 0 }), 'tab0');
  });
});
