// tests/session/context.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTabRef, resolveEditorRef, resolvePaneRef } from '../../src/session/context.js';

const tabs = [
  { index: 0, id: 'AAA', chartId: 'L6kity6U', url: 'u0' },
  { index: 1, id: 'BBB', chartId: 'CImXXVx0', url: 'u1' },
];

describe('resolveTabRef()', () => {
  it('returns null for undefined or "active"', () => {
    assert.equal(resolveTabRef(undefined, tabs), null);
    assert.equal(resolveTabRef('active', tabs), null);
  });
  it('resolves a numeric index', () => {
    assert.equal(resolveTabRef(1, tabs).id, 'BBB');
  });
  it('resolves an all-digit string as index', () => {
    assert.equal(resolveTabRef('1', tabs).id, 'BBB');
  });
  it('resolves a chart_id string', () => {
    assert.equal(resolveTabRef('L6kity6U', tabs).id, 'AAA');
  });
  it('throws with the available list when index out of range', () => {
    assert.throws(() => resolveTabRef(3, tabs), /tab 3 out of range \(have 2 tabs: 0=L6kity6U, 1=CImXXVx0\)/);
  });
  it('throws with the available list when chart_id unknown', () => {
    assert.throws(() => resolveTabRef('ZZZ', tabs), /no tab with chart_id "ZZZ" \(have: 0=L6kity6U, 1=CImXXVx0\)/);
  });
});

describe('resolveEditorRef()', () => {
  const editors = [{ index: 0, name: '내전략' }, { index: 1, name: '무제' }];
  it('returns null for undefined/active', () => {
    assert.equal(resolveEditorRef(undefined, editors), null);
    assert.equal(resolveEditorRef('active', editors), null);
  });
  it('resolves index (number or digit string)', () => {
    assert.equal(resolveEditorRef(1, editors).name, '무제');
    assert.equal(resolveEditorRef('0', editors).name, '내전략');
  });
  it('resolves by name, case-insensitive', () => {
    assert.equal(resolveEditorRef('무제', editors).index, 1);
  });
  it('throws listing open editors when name not found', () => {
    assert.throws(() => resolveEditorRef('X', editors), /no Pine editor named "X" \(open: 0=내전략, 1=무제\)/);
  });
});

describe('resolvePaneRef()', () => {
  it('returns null for undefined/active', () => {
    assert.equal(resolvePaneRef(undefined, 2), null);
    assert.equal(resolvePaneRef('active', 2), null);
  });
  it('resolves a valid index', () => {
    assert.equal(resolvePaneRef(1, 2), 1);
  });
  it('throws on out-of-range', () => {
    assert.throws(() => resolvePaneRef(2, 1), /pane 2 out of range \(layout has 1 chart\)/);
  });
});
