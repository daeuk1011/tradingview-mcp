import { resolvePaneRef } from './context.js';
import { callBridge } from '../bridge/inject.js';

/**
 * Resolve a pane ref to a concrete index on a Tab using the live pane list.
 * Throws (never falls back to 0) on a bad ref.
 * @returns {Promise<number>} the pane index.
 */
export async function resolvePaneIndex(tab, ref) {
  const res = await callBridge(tab, { method: 'listPanes', args: {} });
  if (!res.ok) throw new Error(res.error);
  const panes = res.value;
  const match = resolvePaneRef(ref, panes.length); // null => active (pane 0 convention)
  return match === null ? 0 : match;
}
