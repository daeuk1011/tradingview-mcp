// src/bridge/inject.js
import { BRIDGE_SOURCE, BRIDGE_VERSION } from './bridge.source.js';

const PROBE = `(function(){ return (window.__tvmcp && window.__tvmcp.version) || null; })()`;

/** Ensure the resident bridge is installed at the expected version. */
async function ensureBridge(tab) {
  const v = await tab.evaluate(PROBE);
  if (v === BRIDGE_VERSION) return;
  await tab.evaluate(BRIDGE_SOURCE); // idempotent overwrite of window.__tvmcp
}

/**
 * Make a structured bridge call on a Tab, injecting/upgrading the bridge first.
 * Uses awaitPromise so async bridge methods resolve. Returns the bridge's
 * { ok, value } | { ok:false, error } envelope.
 */
export async function callBridge(tab, payload) {
  await ensureBridge(tab);
  const expr = `window.__tvmcp.call(${JSON.stringify(payload)})`;
  return tab.evaluate(expr, { awaitPromise: true });
}
