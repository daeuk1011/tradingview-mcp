// src/session/session.js
import { Tab } from './tab.js';
import { createQueue } from './queue.js';
import { resolveTabRef } from './context.js';

const CHART_RE = /tradingview\.com\/chart/i;
const CHART_ID_RE = /\/chart\/([^/?]+)/;

/**
 * One connection to the single TradingView app. Owns the tab pool, the
 * MCP-side `activeTabId` (decoupled from desktop foreground), and the
 * serialization queue. Pure I/O is injected (fetch + connect) for testability.
 */
export class Session {
  constructor({ baseUrl, connect, fetchImpl = fetch }) {
    this._baseUrl = baseUrl;
    this._connect = connect;
    this._fetch = fetchImpl;
    this._tabs = new Map(); // id -> Tab
    this._activeTabId = null;
    this._enqueue = createQueue();
  }

  async listTabs() {
    const resp = await this._fetch(`${this._baseUrl}/json/list`);
    const targets = await resp.json();
    const pages = targets
      .filter((t) => t.type === 'page' && CHART_RE.test(t.url || ''))
      .map((t, index) => ({ index, id: t.id, chartId: (t.url.match(CHART_ID_RE) || [])[1] || null, url: t.url }));
    const live = new Set(pages.map((p) => p.id));
    for (const id of [...this._tabs.keys()]) if (!live.has(id)) this._tabs.delete(id);
    if (this._activeTabId && !live.has(this._activeTabId)) this._activeTabId = null;
    return pages;
  }

  _tabFor(meta) {
    let tab = this._tabs.get(meta.id);
    if (!tab) { tab = new Tab({ id: meta.id, chartId: meta.chartId, url: meta.url, connect: this._connect }); this._tabs.set(meta.id, tab); }
    return tab;
  }

  // private: pick the active Tab from an already-fetched pages array
  _activeFrom(pages) {
    if (pages.length === 0) throw new Error('No TradingView chart tab found. Is TradingView open with a chart?');
    const meta = pages.find((p) => p.id === this._activeTabId) || pages[0];
    this._activeTabId = meta.id;
    return this._tabFor(meta);
  }

  async activeTab() {
    return this._activeFrom(await this.listTabs());
  }

  async resolveTab(ref) {
    const pages = await this.listTabs();
    const meta = resolveTabRef(ref, pages); // throws on bad ref; null => active
    if (!meta) return this._activeFrom(pages); // reuse already-fetched pages
    return this._tabFor(meta);
  }

  async switchTab(ref) {
    const tab = await this.resolveTab(ref);
    await this._fetch(`${this._baseUrl}/json/activate/${tab.id}`);
    this._activeTabId = tab.id;
    return tab;
  }

  run(fn) {
    return this._enqueue(fn);
  }
}
