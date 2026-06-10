// tests/bridge/locale.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALE } from '../../src/bridge/locale.js';
import { BRIDGE_SOURCE } from '../../src/bridge/bridge.source.js';

const re = (p) => new RegExp(p, 'i');

describe('bridge LOCALE patterns', () => {
  it('copy matches EN + KO "make a copy" labels', () => {
    assert.ok(re(LOCALE.copy).test('Make a copy…'));
    assert.ok(re(LOCALE.copy).test('카피 만들기…'));
    assert.ok(re(LOCALE.copy).test('사본 만들기'));
    assert.ok(!re(LOCALE.copy).test('Rename…'));
  });

  it('createNew matches EN + KO "create new"', () => {
    assert.ok(re(LOCALE.createNew).test('Create new'));
    assert.ok(re(LOCALE.createNew).test('새로 만들기'));
    assert.ok(!re(LOCALE.createNew).test('Open script…'));
  });

  it('confirm matches whole-label confirm verbs but NOT "Save script"', () => {
    for (const ok of ['OK', '확인', '저장', '만들기', 'Copy', '복사', 'Create']) {
      assert.ok(re(LOCALE.confirm).test(ok), `should match ${ok}`);
    }
    // Anchored so it never fires on the menu's "Save script" / "스크립트 저장".
    assert.ok(!re(LOCALE.confirm).test('Save script'));
    assert.ok(!re(LOCALE.confirm).test('스크립트 저장'));
    assert.ok(!re(LOCALE.confirm).test('카피 만들기…'));
  });

  it('type submenu patterns match EN + KO', () => {
    assert.ok(re(LOCALE.type.indicator).test('Indicator'));
    assert.ok(re(LOCALE.type.indicator).test('지표'));
    assert.ok(re(LOCALE.type.strategy).test('전략'));
    assert.ok(re(LOCALE.type.library).test('라이브러리'));
  });

  it('LOCALE is injected into the stringified bridge source', () => {
    // The bridge runs as stringified JS in the page, so LOCALE must be embedded.
    assert.ok(BRIDGE_SOURCE.includes('카피 만들기'));
    assert.ok(BRIDGE_SOURCE.includes('editor.makeCopy'));
    assert.ok(BRIDGE_SOURCE.includes('editor.createNew'));
  });
});
