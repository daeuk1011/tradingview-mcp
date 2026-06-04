# Multi-Context Redesign — Design

**Date:** 2026-06-04
**Status:** Approved (design) — pending implementation plan
**Topic:** Make chart tabs, Pine editor tabs, and multichart panes first-class, explicitly-addressable contexts.

## Problem

The MCP server controls a live TradingView Desktop (Electron) app over CDP. It
assumes a **single implicit context** everywhere:

- `connection.js` caches one CDP client and pins to the first chart-tab target
  in `/json/list`. `tab_switch` only brought a tab to the foreground; it never
  re-pointed the cached client, so reads/commands silently stayed on the
  originally-connected tab. (Partially fixed in commit `e27e9e3` via
  `reconnectToTarget`, but only for chart tabs, and only sequentially.)
- `core/pine.js` always grabs `getEditors()[0]` — the first Monaco editor — with
  no way to target another Pine editor tab.
- Multichart panes are addressed only via "active chart"; non-active panes
  aren't individually addressable.

The recurring failure mode: a command "succeeds" but lands on (or reads) the
wrong context, with **no error** — it just silently uses index `[0]` / the
active one. With multiple chart tabs open this made tab switching appear to do
nothing.

## Goals

1. **Eliminate `index[0]` guessing structurally** — make it impossible to
   silently operate on the wrong context.
2. Treat **chart tabs, Pine editor tabs, and multichart panes** as first-class,
   explicitly-addressable contexts.
3. Reduce fragility of the page-side automation (undocumented TradingView
   internals re-derived in ~60 places).
4. Keep all 79 existing tools and the CLI working throughout the migration.

## Non-Goals (YAGNI)

- **Parallel / concurrent multi-context execution (fan-out across tabs).** The
  tool is driven sequentially by an LLM; the one "multi" workflow (`batch_run`)
  already iterates symbols in a single tab. The design must leave room for this
  ("B-ready") but does not build it now. TradingView also throttles background
  tabs, making parallel results unreliable.
- TypeScript migration of the whole codebase (separate decision; the resident
  bridge file is a natural place to apply `checkJs` typing).

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Concurrency level | **Explicit addressing, sequential** (room for parallel later) | Matches LLM-driven sequential use; avoids pool/concurrency fragility |
| First-class contexts | Chart tabs + Pine editor tabs + multichart panes | User-selected scope |
| `active` semantics | **= last tab the MCP targeted/switched; decoupled from desktop foreground** | Determinism; foreground also shown in `context_describe` to avoid confusion |
| Object shape | **Thin handles** (Tab/Pane/Editor = identity + evaluate routing + selector) + **operations as functions** | Avoids relocating god-objects; keeps units small; matches existing `core/*` split |
| Page-side access | **Single resident bridge** (`window.__tvmcp`) per tab | Centralizes brittle internals to one file; structured `{method,args}` calls reduce injection surface; one place to fix on TradingView updates |
| Missing/invalid ref | **Explicit error, never `[0]` fallback** | The core behavior change |
| Compatibility | Additive optional params; `core/*` kept as compat shims during migration | 79 tools + CLI stay green |

## Architecture

Two context levels, unified under one addressing model:

- **Chart tab** = a CDP **page target** (addressed at the connection layer by
  target id).
- **Pine editor tab / pane** = **JS objects inside a page** (addressed by a
  selector inside the injected script, not a separate CDP target).

### Node-side object model (thin handles)

```
Session                     // one desktop-app connection = entry point
 ├─ listTabs()              //   from /json/list
 ├─ tab(ref) → Tab          //   index | chart_id | "active"
 ├─ activeTabId             //   last MCP-targeted tab (in-memory)
 └─ resolve(ContextRef)     //   → concrete { tab, pane?, editor? } handles

Tab                         // wraps ONE CDP client bound to a chart-tab target
 ├─ evaluate(expr)          //   ALL page JS routes through here
 ├─ callBridge(method,args) //   structured call into window.__tvmcp
 ├─ id / chartId / url
 ├─ pane(ref) → Pane        //   selector handle (index)
 ├─ editor(ref) → Editor    //   selector handle (index | script name)
 └─ requiresForeground ops  //   keyboard input / "visible" screenshot

Pane    // thin handle: pane index → bridge selector. No evaluate of its own.
Editor  // thin handle: editor index/name → bridge selector. No evaluate of its own.
```

**Operations are functions, not methods.** Domain logic stays split like today
(`ops/chart.js`, `ops/data.js`, `ops/pine.js`, …). Each op takes a handle and
calls the bridge: e.g. `getSymbol(pane)`, `compile(editor)`. This preserves
Approach-2's wins (always hold a ref → `[0]` impossible; DI testability) without
turning `Tab`/`Editor` into 600-line god-objects.

### Page-side resident bridge

A single `bridge.js` injected into each tab wraps the brittle internals
(React-fiber walk for Monaco, `chartWidgetCollection`, `getEditors`) **once** and
exposes a stable API:

```js
window.__tvmcp.version
window.__tvmcp.listEditors()                 // [{index, name}]
window.__tvmcp.editor(indexOrName).setSource(code) / .getSource() / .compile() …
window.__tvmcp.listPanes()                   // [{index, symbol, resolution}]
window.__tvmcp.pane(index).symbol() / .setSymbol(s) / .studyValues() …
```

Tools send **structured `{method, args}`** calls instead of assembling ad-hoc JS
strings.

Benefits:
- TradingView updates → fix **one bridge file**, not ~60 evaluate strings.
- Pane/editor indexing lives naturally in the bridge.
- **CDP-injection surface shrinks** (structured args vs string concatenation;
  relevant given the recent "CDP injection vulnerabilities across 9 modules"
  fix).
- Bridge is one file → `checkJs` typing is actually effective there.

Bridge lifecycle: injected on first use; **re-injected on navigation/reload**;
version-checked (mismatch → re-inject once).

### ContextRef & resolution

```js
{
  tab?:    number | string | "active",  // index, chart_id, else active
  pane?:   number | "active",           // multichart pane index
  editor?: number | string | "active",  // Monaco index OR script name
}
```

Resolution rules:
1. **Omitted = active** → 100% backward-compatible with current calls.
2. **Specified = exactly that.** `number` → index; `string` → chart_id / script
   name lookup.
3. **Unresolvable = explicit error**, listing what *is* available; never `[0]`.
   - `"tab 3 out of range (have 2 tabs: 0=대욱/BTCUSDT.P, 1=티모시/RUNEUSDT)"`
   - `"no Pine editor named 'X' (open: 0=내전략, 1=무제)"`
4. **Active fallback on eviction:** if `activeTabId` points at a closed tab, fall
   back to the first available tab and flag it in the next result /
   `context_describe`. On fresh server start, active = first chart tab in
   `/json/list`.

## Connection Pool & Lifecycle

- **Lazy pool:** `Session.tabs: Map<targetId, Tab>`. Tab objects exist from
  `listTabs()` metadata; the CDP socket connects on **first evaluate** to that
  tab, then is cached.
- **Cache, don't churn:** reuse the cached client across calls (CDP allows
  multiple connections to one app — verified). Removes the reconnect churn the
  interim `reconnectToTarget` fix introduced.
- **Event-based invalidation:** subscribe to the CDP `disconnect` event to drop a
  dead client from the pool and reconnect on next use — **avoids a liveness ping
  on every call**.
- **Eviction:** a target missing from `/json/list` (tab closed) is removed from
  the pool.
- **Sequential now, B-ready:** one evaluate at a time. The pool is for
  *addressing*, not parallelism; B = a `Promise.all` fan-out layered on this pool
  later.
- **In-page objects (pane/editor) are not pooled** — they share the Tab's one
  client and differ only by bridge selector. Editors are **enumerated fresh each
  call** (the user can open/close editor tabs), not cached.
- **Foreground-dependent ops isolated:** keyboard input (`Input.dispatchKeyEvent`
  — new/close tab) and "visible" screenshots only work on the foreground tab.
  These are marked `requiresForeground` → auto-activate the target tab first, or
  warn clearly on a background call. (`Runtime.evaluate` and
  `Page.captureScreenshot` work regardless of foreground — verified.)

## Tool & CLI Surface

**Additive only — no existing tool signature breaks.**

- Shared zod fragments in `tools/_context.js`: `tabParam`, `paneParam`,
  `editorParam` (all optional). Each tool accepts only the ones meaningful to it
  (chart/data → `tab`,`pane`; pine → `tab`,`editor`).
- Omitting a param = current behavior (active) → existing workflows, skills, and
  the CLAUDE.md decision tree keep working.
- **New observation tool `context_describe`** — tabs + each tab's panes/editors +
  active marker + foreground marker. `tab_list` is kept but delegates to it.
- **Compact `ctx` echo in results:** short string like `"ctx":"tab1/pane0"` (not
  nested objects), honoring CLAUDE.md context-size rules. Surfaces "where this
  ran" so wrong-context bugs are visible.
- **Registration injects Session:** `registerXxxTools(server, session)` — removes
  global-singleton dependence, enables injecting a fake Session in tests.
- **CLI:** migrate to the object model, keep command surface, add
  `--tab/--pane/--editor` flags. CLI is one-shot (`Session.oneShot()` —
  connect, run, exit); the persistent pool matters only for the long-lived MCP
  server.
- **Docs:** update `CLAUDE.md` decision tree / tool table / return shapes as part
  of the work.

## Error Handling

Three layers, all removing "silent failure":

1. **Context resolution (new, highest priority):** unresolvable ref → throw a
   clear message that **embeds the available list**; never `[0]`.
2. **Bridge layer:** missing/version-mismatched bridge → auto re-inject once,
   retry; else `"bridge unavailable on tab N"`. Bridge methods return
   `{ok:false, error}` (not throw) to distinguish logic errors from transport
   errors.
3. **Transport (CDP):** dead socket → removed via `disconnect` event → one auto
   reconnect on next call. Tab gone from `/json/list` → `"tab closed"` (+ active
   fallback notice).

Tool boundary contract unchanged: every tool stays
`try/catch → jsonResult({success:false, error})` — errors are always structured
returns, the server never dies. The `ctx` echo shows where a failure occurred.

## Testing

Enabled by dependency injection (a Tab takes an injectable evaluate / CDP
client):

1. **Unit (new, broad):** inject a fake client into Tab → test handle
   resolution, selector generation, pool routing, active fallback, and error
   messages **without live TradingView**.
2. **Bridge contract tests:** test `bridge.js` as pure functions / under jsdom —
   `listEditors()`, `pane(i)` indexing, out-of-range errors against a fake
   `window.__tvmcp`. Single file → apply `checkJs` typing here.
3. **e2e (kept + extended):** against live TradingView. Add multi-tab /
   multi-editor scenarios — two tabs open, assert `tab:1` reads the right one and
   `editor:"name"` targets correctly — **regression-locking the bugs we just
   hit.**

The existing 95 tests stay green throughout (compat shims). Each migration phase
ships its own unit tests. The sanitization audit shrinks as ad-hoc string
assembly disappears; it is replaced/strengthened by bridge-arg validation tests.

## Migration Plan (spine first + vertical slice)

Every phase: tests green, 79 tools working, easy to revert. `core/*` kept as
compat shims until the end.

- **Phase 0 — Skeleton (harmless):** add `src/session/`, `src/bridge/`,
  `src/ops/` dirs. Nobody uses them yet.
- **Phase 1 — Transport spine:** `Session` (discovery, pool, activeTabId) +
  `Tab` (owns CDP client, `evaluate`, `disconnect`-based invalidation).
  Re-implement `connection.js` on top but keep its `evaluate()`/`getClient()`
  signatures as shims delegating to `Session.active`. Unit-test routing/pool/
  fallback with a fake client.
- **Phase 2 — Bridge + Pine vertical slice (value-proof gate):** `bridge.js`
  exposing `window.__tvmcp`; `editor.js` handle + `ops/pine.js` rewritten as
  bridge calls; `pine_*` tools gain `tab`/`editor` params, drop `[0]`, echo
  `ctx`. `core/pine.js` → shim. **Stop and actually use it to validate** before
  continuing.
- **Phase 3 — Pane slice (multichart):** `pane.js` handle + `ops/chart.js`,
  `ops/data.js` on the bridge; `chart_*`/`data_*`/`pane_*` tools gain
  `tab`/`pane`.
- **Phase 4 — Remaining domains:** drawing / alerts / replay / ui / watchlist /
  capture / indicators — one commit each, tests green.
- **Phase 5 — Cleanup & surface:** add `context_describe`, delegate `tab_list`;
  remove compat shims; delete emptied `core/`. CLI on Session
  (`--tab/--pane/--editor`, `Session.oneShot()`). Update `CLAUDE.md`.

Revertibility: Phases 0–1 are pure additions (zero risk). From Phase 2 each step
is an independent, test-passing commit; a half-migrated state still works
because of shims.
