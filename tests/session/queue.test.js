// tests/session/queue.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../../src/session/queue.js';

describe('createQueue()', () => {
  it('runs tasks strictly in order, never overlapping', async () => {
    const enqueue = createQueue();
    const order = [];
    let active = 0, maxActive = 0;
    const task = (id) => async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, id === 'a' ? 20 : 1));
      order.push(id);
      active--;
    };
    await Promise.all([enqueue(task('a')), enqueue(task('b')), enqueue(task('c'))]);
    assert.deepEqual(order, ['a', 'b', 'c']);
    assert.equal(maxActive, 1);
  });

  it('a rejected task does not break the chain', async () => {
    const enqueue = createQueue();
    await assert.rejects(enqueue(async () => { throw new Error('boom'); }), /boom/);
    const v = await enqueue(async () => 42);
    assert.equal(v, 42);
  });
});
