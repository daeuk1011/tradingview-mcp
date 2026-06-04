// src/session/tab.js
/**
 * A thin handle over ONE CDP page target (a chart tab). Owns its CDP client and
 * is the single place page JS is executed for that tab. Pane/Editor handles
 * borrow this tab's evaluate; they never connect themselves.
 */
export class Tab {
  constructor({ id, chartId, url, connect }) {
    this.id = id;
    this.chartId = chartId;
    this.url = url;
    this._connect = connect; // async (targetId) => cdpClient
    this._client = null;
  }

  async client() {
    if (this._client) return this._client;
    const c = await this._connect(this.id);
    if (typeof c.on === 'function') c.on('disconnect', () => { this._client = null; });
    this._client = c;
    return c;
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const c = await this.client();
    const res = await c.Runtime.evaluate({ expression, returnByValue: true, awaitPromise });
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception?.description
        || res.exceptionDetails.text || 'Unknown evaluation error';
      throw new Error(`JS evaluation error: ${msg}`);
    }
    return res.result?.value;
  }
}
