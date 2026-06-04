# Multi-Context Redesign — Phases 0–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the transport spine (Session/Tab + serialized queue), then prove it with a resident page bridge and a fully migrated Pine vertical slice that addresses chart tabs and Pine editor tabs explicitly — with no silent `index[0]` fallback.

**Architecture:** Node-side thin handles (`Session` → `Tab`; `Editor` selector handle) own *where* code runs; a single resident page bridge (`window.__tvmcp`) owns *what* runs, re-deriving TradingView internals per call. Pure context-resolution and dispatch logic are unit-tested with injected fakes; the live fiber-walk is e2e-only. `core/*` stays working as compat shims throughout.

**Tech Stack:** Node 24 ESM, `node:test` + `node:assert/strict`, `chrome-remote-interface` (CDP), `zod`, `@modelcontextprotocol/sdk`.

**Spec:** `docs/superpowers/specs/2026-06-04-multi-context-redesign-design.md`

**Scope:** Phases 0–2 only (transport spine + bridge + Pine slice, ending at the value-proof gate). Phases 3–5 are a separate plan decided after this gate.

---

## File Structure

**Created:**
- `src/session/context.js` — pure ref-resolution (tab/pane/editor) + error messages. No I/O.
- `src/session/queue.js` — per-Session serialization queue. Pure.
- `src/session/tab.js` — `Tab`: owns one CDP client, `evaluate`, `callBridge`. DI via injected connector.
- `src/session/session.js` — `Session`: tab pool, `activeTabId`, queue, `listTabs`/`resolveTab`/`switchTab`.
- `src/session/editor.js` — `Editor` thin handle (index|name → bridge selector).
- `src/bridge/internals.js` — pure dispatch/index/validation over an injected internals object.
- `src/bridge/bridge.source.js` — the resident bridge authored as a real module; exports `BRIDGE_SOURCE` string + the installer for testing.
- `src/bridge/inject.js` — read bridge source, inject into a Tab, version-check.
- `src/ops/pine.js` — Pine operations as bridge calls, taking an `Editor` handle.
- `src/tools/_context.js` — shared zod fragments + compact `ctx` formatter.
- Test files mirroring each (`tests/session/*.test.js`, `tests/bridge/*.test.js`, `tests/ops/pine.e2e.test.js`).

**Modified:**
- `src/connection.js` — internals re-implemented over a singleton `Session`; all existing exports kept as shims.
- `src/core/pine.js` — `getSource/setSource/compile/getErrors` delegate to `ops/pine.js` against the active context (CLI/test compat).
- `src/tools/pine.js` — add `tab`/`editor` params to the slice tools; echo `ctx`.
- `package.json` — add `test:unit` paths for new tests.

---

## Phase 0 — Pure foundations (context + queue)

### Task 1: Context ref resolution (tab/pane/editor)

**Files:**
- Create: `src/session/context.js`
- Test: `tests/session/context.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session/context.test.js`
Expected: FAIL — `Cannot find module '../../src/session/context.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/session/context.js
/**
 * Pure context-reference resolution. No I/O.
 * Rule: a number — or an all-digit string — means an index; any other string
 * means a chart_id (tabs) or script name (editors). Unresolvable refs throw
 * with the list of what IS available; they NEVER fall back to index 0.
 */
function isIndexRef(ref) {
  return typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref));
}
function describeTabs(tabs) {
  return tabs.map((t, i) => `${i}=${t.chartId}`).join(', ');
}
function describeEditors(editors) {
  return editors.map((e) => `${e.index}=${e.name}`).join(', ');
}

/** @returns the matched tab meta, or null meaning "use active". */
export function resolveTabRef(ref, tabs) {
  if (ref === undefined || ref === 'active') return null;
  if (isIndexRef(ref)) {
    const i = Number(ref);
    const t = tabs[i];
    if (!t) throw new Error(`tab ${i} out of range (have ${tabs.length} tabs: ${describeTabs(tabs)})`);
    return t;
  }
  const t = tabs.find((x) => x.chartId === ref);
  if (!t) throw new Error(`no tab with chart_id "${ref}" (have: ${describeTabs(tabs)})`);
  return t;
}

/** @returns the matched editor meta, or null meaning "use active". */
export function resolveEditorRef(ref, editors) {
  if (ref === undefined || ref === 'active') return null;
  if (isIndexRef(ref)) {
    const i = Number(ref);
    const e = editors.find((x) => x.index === i);
    if (!e) throw new Error(`editor ${i} out of range (open: ${describeEditors(editors)})`);
    return e;
  }
  const lower = String(ref).toLowerCase();
  const e = editors.find((x) => String(x.name).toLowerCase() === lower);
  if (!e) throw new Error(`no Pine editor named "${ref}" (open: ${describeEditors(editors)})`);
  return e;
}

/** @returns the pane index, or null meaning "use active". */
export function resolvePaneRef(ref, count) {
  if (ref === undefined || ref === 'active') return null;
  const i = Number(ref);
  if (!Number.isInteger(i) || i < 0 || i >= count) {
    throw new Error(`pane ${ref} out of range (layout has ${count} chart${count === 1 ? '' : 's'})`);
  }
  return i;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session/context.test.js`
Expected: PASS (all assertions)

- [ ] **Step 5: Commit**

```bash
git add src/session/context.js tests/session/context.test.js
git commit -m "feat(session): pure context-ref resolution with explicit errors"
```

### Task 2: Serialization queue

**Files:**
- Create: `src/session/queue.js`
- Test: `tests/session/queue.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session/queue.test.js`
Expected: FAIL — `Cannot find module '../../src/session/queue.js'`

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session/queue.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/queue.js tests/session/queue.test.js
git commit -m "feat(session): serialization queue for sequential determinism"
```

---

## Phase 1 — Transport spine (Tab, Session, connection shim)

### Task 3: Tab handle

**Files:**
- Create: `src/session/tab.js`
- Test: `tests/session/tab.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/session/tab.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Tab } from '../../src/session/tab.js';

function fakeClient(evalImpl) {
  const handlers = {};
  return {
    on(ev, cb) { handlers[ev] = cb; },
    _fire(ev) { handlers[ev]?.(); },
    Runtime: { evaluate: evalImpl },
  };
}

describe('Tab', () => {
  it('connects lazily and caches the client', async () => {
    let connects = 0;
    const tab = new Tab({
      id: 'AAA', chartId: 'c', url: 'u',
      connect: async () => { connects++; return fakeClient(async () => ({ result: { value: 1 } })); },
    });
    assert.equal(connects, 0);
    await tab.evaluate('1');
    await tab.evaluate('1');
    assert.equal(connects, 1);
  });

  it('returns the evaluated value', async () => {
    const tab = new Tab({
      id: 'AAA', chartId: 'c', url: 'u',
      connect: async () => fakeClient(async ({ expression }) => ({ result: { value: `got:${expression}` } })),
    });
    assert.equal(await tab.evaluate('2+2'), 'got:2+2');
  });

  it('throws on exceptionDetails', async () => {
    const tab = new Tab({
      id: 'AAA', chartId: 'c', url: 'u',
      connect: async () => fakeClient(async () => ({ exceptionDetails: { exception: { description: 'ReferenceError: x' } } })),
    });
    await assert.rejects(tab.evaluate('x'), /ReferenceError: x/);
  });

  it('drops the cached client on disconnect, reconnecting next call', async () => {
    let connects = 0;
    let client;
    const tab = new Tab({
      id: 'AAA', chartId: 'c', url: 'u',
      connect: async () => { connects++; client = fakeClient(async () => ({ result: { value: 1 } })); return client; },
    });
    await tab.evaluate('1');
    client._fire('disconnect');
    await tab.evaluate('1');
    assert.equal(connects, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session/tab.test.js`
Expected: FAIL — `Cannot find module '../../src/session/tab.js'`

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session/tab.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/tab.js tests/session/tab.test.js
git commit -m "feat(session): Tab handle owning one CDP client with disconnect invalidation"
```

### Task 4: Session pool + active + resolution

**Files:**
- Create: `src/session/session.js`
- Test: `tests/session/session.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/session/session.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../../src/session/session.js';

function makeFetch(pagesByCall) {
  let call = 0;
  const activated = [];
  const fetchImpl = async (url) => {
    if (url.endsWith('/json/list')) {
      const pages = pagesByCall[Math.min(call, pagesByCall.length - 1)];
      call++;
      return { json: async () => pages };
    }
    if (url.includes('/json/activate/')) { activated.push(url.split('/').pop()); return { text: async () => 'ok' }; }
    throw new Error('unexpected url ' + url);
  };
  return { fetchImpl, activated };
}
const page = (id, chartId) => ({ type: 'page', id, url: `https://kr.tradingview.com/chart/${chartId}/` });

describe('Session', () => {
  it('listTabs maps chart-tab targets with index + chartId', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0'), page('B', 'c1'), { type: 'page', url: 'about:blank' }]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    const tabs = await s.listTabs();
    assert.deepEqual(tabs.map((t) => [t.index, t.id, t.chartId]), [[0, 'A', 'c0'], [1, 'B', 'c1']]);
  });

  it('activeTab defaults to first tab and caches Tab instances', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0'), page('B', 'c1')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    const t1 = await s.activeTab();
    const t2 = await s.activeTab();
    assert.equal(t1.id, 'A');
    assert.equal(t1, t2); // same cached instance
  });

  it('resolveTab(undefined) is active; resolveTab(1) is explicit', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0'), page('B', 'c1')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    assert.equal((await s.resolveTab(undefined)).id, 'A');
    assert.equal((await s.resolveTab(1)).id, 'B');
    assert.equal((await s.resolveTab('c1')).id, 'B');
  });

  it('switchTab activates the tab and updates active', async () => {
    const { fetchImpl, activated } = makeFetch([[page('A', 'c0'), page('B', 'c1')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    await s.switchTab(1);
    assert.deepEqual(activated, ['B']);
    assert.equal((await s.activeTab()).id, 'B');
  });

  it('drops active + pooled tab when it disappears from the list', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0'), page('B', 'c1')], [page('B', 'c1')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    await s.switchTab(0);            // active = A (uses call 0)
    const t = await s.activeTab();   // call 1: A is gone -> falls back to B
    assert.equal(t.id, 'B');
  });

  it('run() serializes operations', async () => {
    const { fetchImpl } = makeFetch([[page('A', 'c0')]]);
    const s = new Session({ baseUrl: 'http://x', connect: async () => ({}), fetchImpl });
    const order = [];
    await Promise.all([
      s.run(async () => { await new Promise((r) => setTimeout(r, 10)); order.push(1); }),
      s.run(async () => { order.push(2); }),
    ]);
    assert.deepEqual(order, [1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session/session.test.js`
Expected: FAIL — `Cannot find module '../../src/session/session.js'`

- [ ] **Step 3: Write minimal implementation**

```js
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

  async activeTab() {
    const pages = await this.listTabs();
    if (pages.length === 0) throw new Error('No TradingView chart tab found. Is TradingView open with a chart?');
    const meta = pages.find((p) => p.id === this._activeTabId) || pages[0];
    this._activeTabId = meta.id;
    return this._tabFor(meta);
  }

  async resolveTab(ref) {
    const pages = await this.listTabs();
    const meta = resolveTabRef(ref, pages); // throws on bad ref; null => active
    if (!meta) return this.activeTab();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session/session.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/session.js tests/session/session.test.js
git commit -m "feat(session): Session pool, active-tab tracking, resolve/switch, queue"
```

### Task 5: Re-implement connection.js over Session (keep all exports)

**Files:**
- Modify: `src/connection.js` (replace internals; keep every existing export)
- Test: `tests/e2e.test.js` (existing — must still pass against live TV)

- [ ] **Step 1: Replace the connection internals, preserving the public surface**

Replace the top of `src/connection.js` (the `client`/`targetInfo`/`connect`/`findChartTarget`/`getClient`/`evaluate`/`reconnectToTarget`/`disconnect` block, lines ~7–137) with the version below. **Keep** `KNOWN_PATHS`, `safeString`, `requireFinite`, and the `getChartApi`/`getChartCollection`/`getBottomBar`/`getReplayApi`/`getMainSeriesBars`/`verifyAndReturn` helpers exactly as they are.

```js
// src/connection.js  (internals section)
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
```

> Note: `connect()` (the old exported function) is removed. Confirm nothing imports it.

- [ ] **Step 2: Verify no remaining importers of removed `connect`**

Run: `grep -rn "import .*\bconnect\b.*from .*connection" src && grep -rn "\.connect(" src/core src/cli || echo "no importers of connect()"`
Expected: `no importers of connect()` (only `getClient`/`evaluate`/etc. are imported)

- [ ] **Step 3: Run the full unit suite to confirm the surface is intact**

Run: `node --test tests/config.test.js tests/cli.test.js tests/sanitization.test.js tests/session/`
Expected: PASS (existing 95 + new session tests)

- [ ] **Step 4: Smoke-test against live TradingView**

Pre-req: TradingView running (`tv_launch`). Run:
`node --test tests/e2e.test.js`
Expected: PASS (same as before this task — connection behavior unchanged for the active tab)

- [ ] **Step 5: Commit**

```bash
git add src/connection.js
git commit -m "refactor(connection): re-implement over Session singleton, keep public exports"
```

### Task 6: Wire tab_switch to Session (remove the bespoke reconnect)

**Files:**
- Modify: `src/core/tab.js`

- [ ] **Step 1: Replace `switchTab` to delegate to the Session**

In `src/core/tab.js`, change the import and `switchTab`:

```js
// src/core/tab.js  (replace the import line)
import { getSession } from '../connection.js';
import { CDP_BASE_URL } from '../config.js';
```

```js
// src/core/tab.js  (replace the whole switchTab function)
export async function switchTab({ index }) {
  const s = getSession();
  const tabs = await s.listTabs();
  const idx = Number(index);
  if (idx >= tabs.length) {
    throw new Error(`Tab index ${idx} out of range (have ${tabs.length} tabs)`);
  }
  const tab = await s.switchTab(idx);
  return { success: true, action: 'switched', index: idx, tab_id: tab.id, chart_id: tab.chartId };
}
```

Leave `list`, `newTab`, `closeTab` as-is (they use `getClient()`, still valid).

- [ ] **Step 2: Verify the sanitization audit still passes for tab.js**

Run: `node --test tests/sanitization.test.js`
Expected: PASS

- [ ] **Step 3: Smoke-test tab switching against live TradingView**

Pre-req: two chart tabs open. Run this ad-hoc script from the repo root:

```bash
node --input-type=module -e '
import { list, switchTab } from "./src/core/tab.js";
import { evaluate } from "./src/connection.js";
const sym = "(function(){try{return window.TradingViewApi.activeChart().symbol();}catch(e){return String(e);}})()";
const tabs = await list();
console.log("tabs:", tabs.tabs.map(t=>t.chart_id).join(", "));
for (const t of tabs.tabs) { await switchTab({ index: t.index }); console.log(t.index, "->", await evaluate(sym)); }
process.exit(0);
'
```

Expected: each tab index prints its OWN symbol (not all the same). This is the regression we are locking.

- [ ] **Step 4: Commit**

```bash
git add src/core/tab.js
git commit -m "refactor(tab): drive tab_switch through Session"
```

---

## Phase 2 — Bridge + Pine vertical slice (value-proof gate)

### Task 7: Bridge dispatch core (pure, testable)

**Files:**
- Create: `src/bridge/internals.js`
- Test: `tests/bridge/internals.test.js`

This module is the bridge's **pure** logic: given an `internals` object (the live
TradingView wrappers in production, a fake in tests), it dispatches structured
`{method,args}` calls, does index/name resolution, and returns `{ok,...}`. The
brittle fiber-walk that PRODUCES `internals` lives in Task 8 and is e2e-only.

- [ ] **Step 1: Write the failing test**

```js
// tests/bridge/internals.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../../src/bridge/internals.js';

// Fake internals: two editors, a getValue/setValue per editor.
function fakeInternals() {
  const editors = [
    { name: '내전략', value: 'a', markers: [] },
    { name: '무제', value: 'b', markers: [{ message: 'oops', startLineNumber: 3, severity: 8 }] },
  ];
  return {
    listEditors: () => editors.map((e, i) => ({ index: i, name: e.name })),
    editorAt: (i) => {
      const e = editors[i];
      if (!e) return null;
      return {
        getSource: () => e.value,
        setSource: (v) => { e.value = v; return true; },
        getMarkers: () => e.markers,
      };
    },
  };
}

describe('bridge dispatch', () => {
  it('listEditors', () => {
    assert.deepEqual(dispatch(fakeInternals(), { method: 'listEditors', args: {} }),
      { ok: true, value: [{ index: 0, name: '내전략' }, { index: 1, name: '무제' }] });
  });
  it('editor.getSource by index', () => {
    assert.deepEqual(dispatch(fakeInternals(), { method: 'editor.getSource', args: { editor: 0 } }),
      { ok: true, value: 'a' });
  });
  it('editor.setSource mutates', () => {
    const int = fakeInternals();
    assert.deepEqual(dispatch(int, { method: 'editor.setSource', args: { editor: 1, source: 'z' } }), { ok: true, value: true });
    assert.equal(dispatch(int, { method: 'editor.getSource', args: { editor: 1 } }).value, 'z');
  });
  it('out-of-range editor returns ok:false with the open list', () => {
    const res = dispatch(fakeInternals(), { method: 'editor.getSource', args: { editor: 5 } });
    assert.equal(res.ok, false);
    assert.match(res.error, /editor 5 out of range \(open: 0=내전략, 1=무제\)/);
  });
  it('unknown method returns ok:false', () => {
    const res = dispatch(fakeInternals(), { method: 'nope', args: {} });
    assert.equal(res.ok, false);
    assert.match(res.error, /unknown bridge method "nope"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bridge/internals.test.js`
Expected: FAIL — `Cannot find module '../../src/bridge/internals.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/bridge/internals.js
/**
 * Pure bridge dispatch. `internals` supplies live accessors (real TradingView
 * wrappers in the page; a fake in tests). Returns { ok, value } or { ok:false,
 * error }. Never throws for caller errors — only structured results.
 */
function editorOr(internals, ref) {
  const list = internals.listEditors();
  const i = Number(ref);
  const acc = Number.isInteger(i) ? internals.editorAt(i) : null;
  if (!acc) {
    const open = list.map((e) => `${e.index}=${e.name}`).join(', ');
    return { err: `editor ${ref} out of range (open: ${open})` };
  }
  return { acc };
}

export function dispatch(internals, { method, args = {} }) {
  try {
    switch (method) {
      case 'listEditors':
        return { ok: true, value: internals.listEditors() };
      case 'editor.getSource': {
        const r = editorOr(internals, args.editor);
        return r.err ? { ok: false, error: r.err } : { ok: true, value: r.acc.getSource() };
      }
      case 'editor.setSource': {
        const r = editorOr(internals, args.editor);
        return r.err ? { ok: false, error: r.err } : { ok: true, value: r.acc.setSource(args.source) };
      }
      case 'editor.getMarkers': {
        const r = editorOr(internals, args.editor);
        return r.err ? { ok: false, error: r.err } : { ok: true, value: r.acc.getMarkers() };
      }
      default:
        return { ok: false, error: `unknown bridge method "${method}"` };
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bridge/internals.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bridge/internals.js tests/bridge/internals.test.js
git commit -m "feat(bridge): pure structured dispatch over injected internals"
```

### Task 8: Resident bridge source (live internals + install)

**Files:**
- Create: `src/bridge/bridge.source.js`

This file exports `BRIDGE_VERSION` and `BRIDGE_SOURCE` — a self-contained string
that, when evaluated in the page, installs `window.__tvmcp`. It reuses the
**same** `dispatch` shape as Task 7 but provides the live `internals` via the
fiber-walk (ported verbatim from `core/pine.js`'s `FIND_MONACO`, generalized to
return ALL editors). It holds **no cached references** — `_resolveMonaco()` runs
on every call.

- [ ] **Step 1: Create the bridge source**

```js
// src/bridge/bridge.source.js
export const BRIDGE_VERSION = 1;

// The body installs window.__tvmcp. Authored as a normal function so it stays
// readable/lintable; we inject `fn.toString()` wrapped in an IIFE.
function INSTALL(version) {
  function resolveMonaco() {
    var container = document.querySelector('.monaco-editor.pine-editor-monaco');
    if (!container) return null;
    var el = container, fiberKey;
    for (var i = 0; i < 20 && el; i++) {
      fiberKey = Object.keys(el).find(function (k) { return k.startsWith('__reactFiber$'); });
      if (fiberKey) break;
      el = el.parentElement;
    }
    if (!fiberKey) return null;
    var cur = el[fiberKey];
    for (var d = 0; d < 15 && cur; d++) {
      var p = cur.memoizedProps;
      if (p && p.value && p.value.monacoEnv && p.value.monacoEnv.editor
          && typeof p.value.monacoEnv.editor.getEditors === 'function') {
        return p.value.monacoEnv;
      }
      cur = cur.return;
    }
    return null;
  }

  function internals() {
    return {
      listEditors: function () {
        var env = resolveMonaco();
        if (!env) return [];
        return env.editor.getEditors().map(function (ed, i) {
          var model = ed.getModel && ed.getModel();
          var name = (model && model.uri && String(model.uri.path || '').split('/').pop()) || ('editor' + i);
          return { index: i, name: name };
        });
      },
      editorAt: function (i) {
        var env = resolveMonaco();
        if (!env) return null;
        var eds = env.editor.getEditors();
        var ed = eds[i];
        if (!ed) return null;
        return {
          getSource: function () { return ed.getValue(); },
          setSource: function (v) { ed.setValue(v); return true; },
          getMarkers: function () {
            var model = ed.getModel();
            if (!model) return [];
            return env.editor.getModelMarkers({ resource: model.uri }).map(function (m) {
              return { message: m.message, line: m.startLineNumber, severity: m.severity };
            });
          },
        };
      },
    };
  }

  function editorOr(ref) {
    var list = internals().listEditors();
    var i = Number(ref);
    var acc = Number.isInteger(i) ? internals().editorAt(i) : null;
    if (!acc) return { err: 'editor ' + ref + ' out of range (open: ' + list.map(function (e) { return e.index + '=' + e.name; }).join(', ') + ')' };
    return { acc: acc };
  }

  window.__tvmcp = {
    version: version,
    call: function (payload) {
      try {
        var method = payload.method, args = payload.args || {};
        switch (method) {
          case 'listEditors': return { ok: true, value: internals().listEditors() };
          case 'editor.getSource': { var a = editorOr(args.editor); return a.err ? { ok: false, error: a.err } : { ok: true, value: a.acc.getSource() }; }
          case 'editor.setSource': { var b = editorOr(args.editor); return b.err ? { ok: false, error: b.err } : { ok: true, value: b.acc.setSource(args.source) }; }
          case 'editor.getMarkers': { var c = editorOr(args.editor); return c.err ? { ok: false, error: c.err } : { ok: true, value: c.acc.getMarkers() }; }
          default: return { ok: false, error: 'unknown bridge method "' + method + '"' };
        }
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  };
  return version;
}

export const BRIDGE_SOURCE = `(${INSTALL.toString()})(${BRIDGE_VERSION})`;
```

- [ ] **Step 2: Sanity-check the source string builds and is syntactically valid**

Run:
```bash
node --input-type=module -e '
import { BRIDGE_SOURCE, BRIDGE_VERSION } from "./src/bridge/bridge.source.js";
import vm from "node:vm";
const sandbox = { window: {}, document: { querySelector: () => null } };
vm.createContext(sandbox);
const v = vm.runInContext(BRIDGE_SOURCE, sandbox);
if (v !== BRIDGE_VERSION) throw new Error("version mismatch");
if (typeof sandbox.window.__tvmcp.call !== "function") throw new Error("no call()");
// with no Monaco present, listEditors must be a clean empty list (no throw)
const r = sandbox.window.__tvmcp.call({ method: "listEditors", args: {} });
if (!r.ok || r.value.length !== 0) throw new Error("expected empty editors");
console.log("bridge source OK, version", v);
'
```
Expected: `bridge source OK, version 1`

- [ ] **Step 3: Commit**

```bash
git add src/bridge/bridge.source.js
git commit -m "feat(bridge): resident window.__tvmcp source (fiber-walk internals, no caching)"
```

### Task 9: Bridge injection + version check

**Files:**
- Create: `src/bridge/inject.js`
- Test: `tests/bridge/inject.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/bridge/inject.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callBridge } from '../../src/bridge/inject.js';
import { BRIDGE_VERSION } from '../../src/bridge/bridge.source.js';

// Fake Tab: simulates a page where the bridge may or may not be present.
// Stores the FULL expression so substring checks below are unambiguous.
function fakeTab({ installed = false } = {}) {
  let present = installed;
  const log = [];
  return {
    log,
    async evaluate(expr, opts) {
      log.push({ expr, opts });
      if (expr.includes('window.__tvmcp && window.__tvmcp.version')) return present ? BRIDGE_VERSION : null;
      if (expr.includes('function INSTALL')) { present = true; return BRIDGE_VERSION; } // bridge source inject
      if (expr.includes('__tvmcp.call')) return { ok: true, value: 'RESULT' };
      throw new Error('unexpected expr ' + expr);
    },
  };
}

describe('callBridge', () => {
  it('injects the bridge when absent, then calls', async () => {
    const tab = fakeTab({ installed: false });
    const res = await callBridge(tab, { method: 'listEditors', args: {} });
    assert.deepEqual(res, { ok: true, value: 'RESULT' });
    assert.match(tab.log[0].expr, /window\.__tvmcp && window\.__tvmcp\.version/); // probe runs first
    assert.ok(tab.log.some((l) => l.expr.includes('function INSTALL')));          // then injection
  });

  it('skips injection when bridge already present at the right version', async () => {
    const tab = fakeTab({ installed: true });
    await callBridge(tab, { method: 'listEditors', args: {} });
    assert.equal(tab.log.some((l) => l.expr.includes('function INSTALL')), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bridge/inject.test.js`
Expected: FAIL — `Cannot find module '../../src/bridge/inject.js'`

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bridge/inject.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bridge/inject.js tests/bridge/inject.test.js
git commit -m "feat(bridge): inject + version-check + structured callBridge"
```

### Task 10: Editor handle + Pine ops

**Files:**
- Create: `src/session/editor.js`
- Create: `src/ops/pine.js`
- Test: `tests/ops/pine.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/ops/pine.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSource, setSource, getErrors } from '../../src/ops/pine.js';

// Fake Tab whose evaluate emulates window.__tvmcp.call() over two editors.
function fakeTab() {
  const editors = [{ name: '내전략', value: 'a', markers: [] }, { name: '무제', value: 'b', markers: [] }];
  return {
    async evaluate(expr) {
      if (expr.includes('version')) return 1;                 // bridge present
      const m = expr.match(/__tvmcp\.call\((.*)\)$/s);
      if (!m) throw new Error('unexpected ' + expr);
      const { method, args } = JSON.parse(m[1]);
      if (method === 'listEditors') return { ok: true, value: editors.map((e, i) => ({ index: i, name: e.name })) };
      const e = editors[args.editor];
      if (!e) return { ok: false, error: `editor ${args.editor} out of range (open: 0=내전략, 1=무제)` };
      if (method === 'editor.getSource') return { ok: true, value: e.value };
      if (method === 'editor.setSource') { e.value = args.source; return { ok: true, value: true }; }
      if (method === 'editor.getMarkers') return { ok: true, value: e.markers };
      return { ok: false, error: 'unknown' };
    },
  };
}

describe('ops/pine', () => {
  it('getSource on active editor (index 0)', async () => {
    assert.deepEqual(await getSource(fakeTab(), undefined), { source: 'a', editorIndex: 0 });
  });
  it('getSource on a named editor', async () => {
    assert.deepEqual(await getSource(fakeTab(), '무제'), { source: 'b', editorIndex: 1 });
  });
  it('setSource writes to the chosen editor', async () => {
    const tab = fakeTab();
    await setSource(tab, 1, 'z');
    assert.deepEqual(await getSource(tab, 1), { source: 'z', editorIndex: 1 });
  });
  it('unknown editor name throws with the open list', async () => {
    await assert.rejects(getSource(fakeTab(), 'X'), /no Pine editor named "X" \(open: 0=내전략, 1=무제\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ops/pine.test.js`
Expected: FAIL — `Cannot find module '../../src/ops/pine.js'`

- [ ] **Step 3: Write minimal implementations**

```js
// src/session/editor.js
import { resolveEditorRef } from './context.js';
import { callBridge } from '../bridge/inject.js';

/**
 * Resolve a Pine-editor ref to a concrete index on a given Tab, using the live
 * editor list from the bridge. Throws (never falls back to 0) on a bad ref.
 * @returns {Promise<number>} the editor index.
 */
export async function resolveEditorIndex(tab, ref) {
  const res = await callBridge(tab, { method: 'listEditors', args: {} });
  if (!res.ok) throw new Error(res.error);
  const editors = res.value; // [{index,name}]
  if (editors.length === 0) throw new Error('No Pine editor is open.');
  const match = resolveEditorRef(ref, editors); // null => active
  return match ? match.index : editors[0].index;
}
```

```js
// src/ops/pine.js
import { resolveEditorIndex } from '../session/editor.js';
import { callBridge } from '../bridge/inject.js';

function unwrap(res) {
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

/** @returns {Promise<{source:string, editorIndex:number}>} */
export async function getSource(tab, editorRef) {
  const editor = await resolveEditorIndex(tab, editorRef);
  const source = unwrap(await callBridge(tab, { method: 'editor.getSource', args: { editor } }));
  return { source, editorIndex: editor };
}

/** @returns {Promise<{lines_set:number, editorIndex:number}>} */
export async function setSource(tab, editorRef, source) {
  const editor = await resolveEditorIndex(tab, editorRef);
  unwrap(await callBridge(tab, { method: 'editor.setSource', args: { editor, source } }));
  return { lines_set: source.split('\n').length, editorIndex: editor };
}

/** @returns {Promise<{errors:Array, editorIndex:number}>} */
export async function getErrors(tab, editorRef) {
  const editor = await resolveEditorIndex(tab, editorRef);
  const markers = unwrap(await callBridge(tab, { method: 'editor.getMarkers', args: { editor } }));
  return { errors: markers.filter((m) => m.severity >= 8), editorIndex: editor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ops/pine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/editor.js src/ops/pine.js tests/ops/pine.test.js
git commit -m "feat(ops): Pine editor handle + getSource/setSource/getErrors via bridge"
```

### Task 11: Shared tool context params + ctx formatter

**Files:**
- Create: `src/tools/_context.js`
- Test: `tests/tools/context.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/tools/context.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fmtCtx } from '../../src/tools/_context.js';

describe('fmtCtx', () => {
  it('formats tab + editor compactly', () => {
    assert.equal(fmtCtx({ tab: 1, editor: 0 }), 'tab1/editor0');
  });
  it('formats tab + pane compactly', () => {
    assert.equal(fmtCtx({ tab: 0, pane: 2 }), 'tab0/pane2');
  });
  it('omits absent parts', () => {
    assert.equal(fmtCtx({ tab: 0 }), 'tab0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tools/context.test.js`
Expected: FAIL — `Cannot find module '../../src/tools/_context.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/tools/_context.js
import { z } from 'zod';

export const tabParam = z.union([z.number(), z.string()]).optional()
  .describe('Chart tab: index or chart_id. Omit = active tab.');
export const paneParam = z.number().int().optional()
  .describe('Multichart pane index. Omit = active pane.');
export const editorParam = z.union([z.number(), z.string()]).optional()
  .describe('Pine editor: index or script name. Omit = active editor.');

/** Compact "where this ran" string, e.g. "tab1/editor0". */
export function fmtCtx({ tab, pane, editor } = {}) {
  const parts = [];
  if (tab !== undefined && tab !== null) parts.push(`tab${tab}`);
  if (pane !== undefined && pane !== null) parts.push(`pane${pane}`);
  if (editor !== undefined && editor !== null) parts.push(`editor${editor}`);
  return parts.join('/');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tools/context.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/_context.js tests/tools/context.test.js
git commit -m "feat(tools): shared context zod params + compact ctx formatter"
```

### Task 12: Migrate the Pine slice tools + core shim

**Files:**
- Modify: `src/tools/pine.js` (the four sliced tools)
- Modify: `src/core/pine.js` (`getSource`/`setSource`/`getErrors` become shims)

- [ ] **Step 1: Point `core/pine.js` slice functions at the new ops (active context)**

In `src/core/pine.js`, add an import and replace the bodies of `getSource`,
`setSource`, and `getErrors` (keep `compile`, `save`, `getConsole`,
`smartCompile`, `newScript`, `openScript`, `listScripts`, `ensurePineEditorOpen`,
`FIND_MONACO` unchanged for now — they migrate in a later phase):

```js
// src/core/pine.js  (add near the top imports)
import { getSession } from '../connection.js';
import * as pineOps from '../ops/pine.js';
```

```js
// src/core/pine.js  (replace getSource)
export async function getSource(opts = {}) {
  const tab = await getSession().resolveTab(opts.tab);
  const { source, editorIndex } = await pineOps.getSource(tab, opts.editor);
  return { success: true, source, line_count: source.split('\n').length, char_count: source.length, ctx: `tab/editor${editorIndex}` };
}
```

```js
// src/core/pine.js  (replace setSource)
export async function setSource({ source, tab, editor } = {}) {
  const t = await getSession().resolveTab(tab);
  const { lines_set, editorIndex } = await pineOps.setSource(t, editor, source);
  return { success: true, lines_set, ctx: `tab/editor${editorIndex}` };
}
```

```js
// src/core/pine.js  (replace getErrors)
export async function getErrors(opts = {}) {
  const tab = await getSession().resolveTab(opts.tab);
  const { errors, editorIndex } = await pineOps.getErrors(tab, opts.editor);
  return { success: true, error_count: errors.length, errors, ctx: `tab/editor${editorIndex}` };
}
```

- [ ] **Step 2: Add the context params to the four sliced tools**

In `src/tools/pine.js`, update the import and the four tools:

```js
// src/tools/pine.js  (replace the import block at the top)
import { z } from 'zod';
import { jsonResult } from './_format.js';
import { tabParam, editorParam } from './_context.js';
import * as core from '../core/pine.js';
```

```js
// src/tools/pine.js  (replace pine_get_source)
  server.tool('pine_get_source', 'Get Pine Script source from the editor (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.getSource({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
```

```js
// src/tools/pine.js  (replace pine_set_source)
  server.tool('pine_set_source', 'Set Pine Script source in the editor (optionally a specific tab/editor)', {
    source: z.string().describe('Pine Script source code to inject'),
    tab: tabParam, editor: editorParam,
  }, async ({ source, tab, editor }) => {
    try { return jsonResult(await core.setSource({ source, tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
```

```js
// src/tools/pine.js  (replace pine_get_errors)
  server.tool('pine_get_errors', 'Get Pine Script compilation errors (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.getErrors({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
```

- [ ] **Step 3: Run the full unit suite (no live TV)**

Run: `node --test tests/config.test.js tests/cli.test.js tests/sanitization.test.js tests/session/ tests/bridge/ tests/ops/ tests/tools/`
Expected: PASS (existing + all new unit tests)

- [ ] **Step 4: Commit**

```bash
git add src/core/pine.js src/tools/pine.js
git commit -m "feat(pine): tab/editor addressing on get/set source + get errors, ctx echo"
```

### Task 13: e2e — multi-tab / multi-editor Pine addressing (value-proof gate)

**Files:**
- Create: `tests/ops/pine.e2e.test.js`
- Modify: `package.json` (register new unit tests under `test:unit`)

- [ ] **Step 1: Add an e2e test that locks the regression**

```js
// tests/ops/pine.e2e.test.js
// Requires a live TradingView with the Pine Editor open. Run manually:
//   node --test tests/ops/pine.e2e.test.js
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getSession } from '../../src/connection.js';
import * as pineOps from '../../src/ops/pine.js';

const LIVE = process.env.TV_E2E === '1';

describe('pine ops over live bridge', { skip: !LIVE && 'set TV_E2E=1 with TradingView running' }, () => {
  let tab;
  before(async () => { tab = await getSession().activeTab(); });

  it('listEditors returns at least one editor with an index', async () => {
    const { getSource } = pineOps;
    const r = await getSource(tab, undefined);
    assert.equal(typeof r.source, 'string');
    assert.equal(typeof r.editorIndex, 'number');
  });

  it('an out-of-range editor errors with the open list (never index 0)', async () => {
    await assert.rejects(pineOps.getSource(tab, 999), /out of range \(open:/);
  });

  it('set then get round-trips on the active editor', async () => {
    const marker = '//tvmcp-e2e ' + Date.now();
    await pineOps.setSource(tab, undefined, marker + '\nindicator("x")');
    const { source } = await pineOps.getSource(tab, undefined);
    assert.match(source, new RegExp(marker));
  });
});
```

- [ ] **Step 2: Wire new unit tests into package.json**

Replace the `test:unit` script in `package.json` with:

```json
"test:unit": "node --test tests/pine_analyze.test.js tests/cli.test.js tests/sanitization.test.js tests/config.test.js tests/health_selftest.test.js tests/session/ tests/bridge/ tests/ops/pine.test.js tests/tools/",
```

- [ ] **Step 3: Run the unit suite**

Run: `npm run test:unit`
Expected: PASS (all unit tests, no live TV needed)

- [ ] **Step 4: Run the e2e gate against live TradingView**

Pre-req: TradingView running, Pine Editor open, ideally two chart tabs. Run:
`TV_E2E=1 node --test tests/ops/pine.e2e.test.js`
Expected: PASS — confirms live bridge injection, editor enumeration, explicit
out-of-range error, and source round-trip.

- [ ] **Step 5: Commit**

```bash
git add tests/ops/pine.e2e.test.js package.json
git commit -m "test(pine): e2e gate for multi-tab/editor addressing + unit wiring"
```

---

## Value-Proof Gate

After Task 13, **stop and actually use it**: open two chart tabs and (where
possible) two Pine editors, then exercise `pine_get_source`/`pine_set_source`
with explicit `tab`/`editor` and confirm:

1. `tab:1` reads the *other* tab (not the active one) — the original bug.
2. `editor:"<name>"` targets the right script; a wrong name returns a clear
   "no Pine editor named …" error, never silently editing editor 0.
3. Omitting `tab`/`editor` behaves exactly as before (active context).

Only after this gate passes do Phases 3–5 (pane slice, remaining domains,
cleanup, CLI flags, CLAUDE.md) get planned.

---

## Self-Review Notes

- **Spec coverage (Phases 0–2):** transport spine (Tasks 3–5), operation queue
  (Task 2), no-`[0]` explicit errors (Tasks 1, 7, 10), resident bridge with no
  cached refs + awaitPromise (Tasks 8–9), thin handles + ops-as-functions
  (Tasks 3, 10), additive tool params + ctx echo (Tasks 11–12), single-app
  Session (Task 5), bridge tests via fakes / fiber-walk e2e-only (Tasks 7 vs 8,
  13), compat shims for CLI/tests (Task 12). Phases 3–5 intentionally deferred.
- **Type consistency:** bridge methods (`listEditors`, `editor.getSource`,
  `editor.setSource`, `editor.getMarkers`) and the `{ok,value}|{ok,error}`
  envelope are identical across Tasks 7, 8, 9, 10. `resolveEditorIndex(tab, ref)`
  and ops signatures `(tab, editorRef[, source])` are consistent across Tasks 10
  and 12.
- **Compat:** `core/pine.js` keeps its existing return keys (`success`, `source`,
  `line_count`, `char_count`, `lines_set`, `errors`) so existing CLI/tests and
  the MCP contract stay stable; new `ctx`/`editorIndex` are additive.
