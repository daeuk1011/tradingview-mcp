import CDP from 'chrome-remote-interface';
import { CDP_HOST, CDP_PORT, CDP_BASE_URL } from './config.js';
import { createDebugLogger } from './debug.js';
import { Session } from './session/session.js';

const debug = createDebugLogger('cdp');

let session = null;

/** The process-wide Session singleton (one TradingView app). */
export function getSession() {
  if (!session) {
    session = new Session({
      baseUrl: CDP_BASE_URL,
      connect: async (targetId) => {
        const c = await CDP({ host: CDP_HOST, port: CDP_PORT, target: targetId });
        await c.Runtime.enable();
        await c.Page.enable();
        await c.DOM.enable();
        return c;
      },
    });
  }
  return session;
}

/** Back-compat: the active tab's CDP client. */
export async function getClient() {
  const s = getSession();
  return s.run(async () => (await s.activeTab()).client());
}

/** Back-compat: target metadata of the active tab. */
export async function getTargetInfo() {
  const s = getSession();
  const tab = await s.activeTab();
  return { id: tab.id, url: tab.url, chartId: tab.chartId };
}

export async function evaluate(expression, opts = {}) {
  const s = getSession();
  debug('evaluate', expression.length > 200 ? expression.slice(0, 200) + `…(${expression.length} chars)` : expression);
  return s.run(async () => {
    const tab = await s.activeTab();
    return tab.evaluate(expression, { awaitPromise: opts.awaitPromise ?? false });
  });
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

/**
 * Deprecated since the Session re-points by addressing the active tab directly.
 * Kept so the interim tab_switch path still resolves; now just switches active.
 */
export async function reconnectToTarget(targetId) {
  const s = getSession();
  await s.switchTab(targetId === undefined ? undefined : (s._tabs.get(targetId)?.chartId ?? targetId));
  return getClient();
}

export async function disconnect() {
  session = null;
}

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

/**
 * Sanitize a string for safe interpolation into JavaScript code evaluated via CDP.
 * Uses JSON.stringify to produce a properly escaped JS string literal (with quotes).
 * Prevents injection via quotes, backticks, template literals, or control chars.
 */
export function safeString(str) {
  return JSON.stringify(String(str));
}

/**
 * Validate that a value is a finite number. Throws if NaN, Infinity, or non-numeric.
 * Prevents corrupt values from reaching TradingView APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${value}`);
  return n;
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
