// src/session/queue.js
/**
 * Returns an `enqueue(fn)` that runs async tasks one at a time, in call order.
 * Enforces the "sequential A" guarantee: evaluates never overlap. A rejecting
 * task surfaces its error to its own caller but does not break the chain.
 */
export function createQueue() {
  let tail = Promise.resolve();
  return function enqueue(fn) {
    const run = tail.then(() => fn());
    tail = run.then(() => {}, () => {});
    return run;
  };
}
