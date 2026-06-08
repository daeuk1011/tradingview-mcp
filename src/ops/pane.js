// Pane-data primitives (bridge-backed). Validated working but not yet exposed
// via a dedicated MCP tool — retained as infrastructure for a future
// multi-editor / pane-aware feature. No current tool/CLI consumer.
import { resolvePaneIndex } from '../session/pane.js';
import { callBridge } from '../bridge/inject.js';

function unwrap(res) { if (!res.ok) throw new Error(res.error); return res.value; }

/** @returns {Promise<Array<{index:number,symbol:string,resolution:string}>>} */
export async function listPanes(tab) {
  return unwrap(await callBridge(tab, { method: 'listPanes', args: {} }));
}

/** Focus a pane; @returns {Promise<number>} the focused index. */
export async function focusPane(tab, paneRef) {
  const pane = await resolvePaneIndex(tab, paneRef);
  unwrap(await callBridge(tab, { method: 'focusPane', args: { pane } }));
  return pane;
}

/** @returns {Promise<Array<{id:string,title:string}>>} */
export async function paneStudies(tab, paneRef) {
  const pane = await resolvePaneIndex(tab, paneRef);
  return unwrap(await callBridge(tab, { method: 'pane.studies', args: { pane } }));
}
