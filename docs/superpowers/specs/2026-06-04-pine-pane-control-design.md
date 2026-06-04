# Pine Multi-Editor + Pane-Targeted Compile — Design

**Date:** 2026-06-04
**Status:** Approved (design) — pending implementation plan
**Builds on:** `2026-06-04-multi-context-redesign-design.md` (Phases 0–2, merged). This is effectively Phase 3+ of that redesign, focused on the Pine + pane domain.

## Problem

Phase 0–2 made chart tabs and Pine editor tabs addressable, but only three Pine
tools (`pine_get_source`/`pine_set_source`/`pine_get_errors`) were migrated. The
remaining Pine tools (`pine_compile`, `pine_save`, `pine_get_console`,
`pine_smart_compile`, `pine_new`, `pine_open`, `pine_list_scripts`) still operate
on the active/`[0]` editor only. And multichart **panes** are not yet addressable
for Pine: you cannot apply Pine script A to pane 1 and script B to pane 2.

## Goals

1. Make the **remaining Pine tools** addressable by `{tab, editor}` (omit =
   active), so multiple scripts can be edited/compiled/saved independently.
2. Enable **pane-targeted compilation**: `pine_compile` / `pine_smart_compile`
   accept `{pane, mode}` so the editor's current script is applied to a specific
   multichart pane.
3. Keep all 79 existing tools and prior behavior working (additive params, omit =
   active).

## Non-Goals (YAGNI)

- Persistent declarative "pane → script" binding state in Node (desync risk —
  rejected during brainstorming). Application is **imperative**: "add the current
  script to pane N as a study."
- Parallel compilation across panes. Operations remain sequential (queue).
- Migrating chart/data tools to pane addressing broadly — only what Pine
  pane-targeting needs, plus a `ctx` echo on existing `pane_*` tools.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pane-targeted compile mechanism | **focus pane → activate editor → compile** | Matches the proven `pane.js` "focus then act on active chart" pattern |
| Apply semantics | **`mode:"replace"` (default), `mode:"add"` opt-in** | Idempotent by default; escape hatch for stacking |
| Replace scope | **Remove only same-**title** study** (preserve user's other indicators) | Safest; never deletes manually-added indicators with different names |
| Same-title detection | **Post-compile, by the newly-added study's own title** | No `indicator("...")` source-parsing heuristic; more robust |
| Where new page logic lives | **Resident bridge methods** (Approach A) | Consistent with Phase 2; structured calls; one place to fix on TV updates |
| Bridge version | bump `BRIDGE_VERSION` 1 → 2 | New methods; `inject.js` auto re-injects stale bridges |
| Compile keyboard fallback | stays at op level (CDP `Input`) | Not page JS; bridge returns `{ok:false}` and the op falls back |

## Technical Risks (validate live FIRST — Slice 0)

Like the Phase 2 fiber-walk, these are validated with restore-safe live spikes
before building on them. If either fails, the design is revisited.

1. **Editor-tab activation targets compile:** activating `getEditors()[i]` makes
   "Save and add to chart" compile *that* script.
2. **Per-pane study removal by title:** a custom study on a specific pane can be
   enumerated (`model().model().dataSources()`) and removed by matching title,
   scoped to that pane only.

## Architecture

Extends the Phase 2 structure (thin handles + resident bridge + ops functions).

```
src/bridge/bridge.source.js   + editor.activate/compile/save/console,
                                listPanes/focusPane/pane.studies/pane.removeStudyByName
src/bridge/internals.js       + pure dispatch for the above (fake internals in tests)
src/session/pane.js   (new)    Pane thin handle (wires existing resolvePaneRef)
src/ops/pine.js       (extend) compile/save/getConsole/smartCompile/newScript/openScript
                                + applyToPane (pane-targeted compile orchestration)
src/ops/pane.js       (new)    listPanes/focus/studies (minimal)
src/core/pine.js      (shim)    remaining functions delegate to ops
src/tools/pine.js     (extend) remaining tools gain {tab, editor} (+ pane, mode on compile)
src/tools/_context.js (extend) add modeParam (paneParam already exists)
```

### Bridge methods (`window.__tvmcp`, version 2)

All keep the structured `{method, args}` → `{ok, value} | {ok:false, error}`
envelope and the **no-cached-references** rule (re-derive internals per call).

Editor:
- `editor.activate(editor)` — make `getEditors()[i]` the active editor tab.
- `editor.compile()` — find and click "Save and add to chart"; `{ok:false}` if no
  button (op then tries the CDP keyboard fallback).
- `editor.save()` — trigger save (button / shortcut).
- `editor.console()` — collect Pine console/log output text.

Pane (chart widget in the multichart layout):
- `listPanes()` — `chartWidgetCollection.getAll()` → `[{index, symbol, resolution}]`.
- `focusPane(pane)` — activate that chart widget (the `_mainDiv.click()` pattern).
- `pane.studies(pane)` — that pane's custom studies → `[{id, title}]`.
- `pane.removeStudyByName(pane, title, exceptId)` — remove studies on that pane
  whose title matches, excluding `exceptId` (the just-added study). Returns the
  count removed.

### Pane-targeted compile flow (`ops/pine.js applyToPane`)

`pine_compile({ tab, editor, pane, mode })`, `mode` default `"replace"`:

1. Resolve tab; run inside the Session queue (`s.run`) for serialization.
2. `editor.activate(editorIndex)` — the script that "add to chart" will use.
3. `focusPane(paneIndex)` — that pane becomes the active chart.
4. Snapshot the pane's study ids (`pane.studies`).
5. `editor.compile()`.
6. Identify the new study = an id present now but not in the snapshot; read its
   title.
7. If `mode==="replace"`: `pane.removeStudyByName(pane, newTitle, newStudyId)` —
   removes same-titled older studies, preserving differently-named ones. If
   `mode==="add"`: skip steps 6–7.
8. Return `{ success, ctx: fmtCtx({tab, pane, editor}), applied: <title|null>, removed: <n> }`.

**Safety:** if step 6 cannot identify a new study (e.g. the script failed to
compile, so nothing was added), **skip removal entirely** and surface the compile
error (from `editor.console()` / markers) rather than reporting success — never
delete the user's indicators on a failed apply.

## Tool Surface (additive; omit = active; `ctx` echo)

| Tool | Added params | Notes |
|------|--------------|-------|
| `pine_save` | `tab`, `editor` | activate editor, then save |
| `pine_get_console` | `tab`, `editor` | targeted editor console |
| `pine_smart_compile` | `tab`, `editor`, `pane`, `mode` | same pane-targeting as compile |
| `pine_compile` | `tab`, `editor`, `pane`, `mode` | core flow above |
| `pine_new` | `tab` | returns `editor_index` of the new tab |
| `pine_open` | `tab` | returns `editor_index` of the loaded script |
| `pine_list_scripts` | — | global (REST); addressing not meaningful — unchanged |
| `pane_list/focus/set_layout/set_symbol` | — | behavior unchanged; add `ctx`; delegate to new bridge `listPanes`/`focusPane` (dedupe logic) |

- `mode`: `z.enum(['replace','add']).optional()` default `'replace'` (new
  `modeParam` in `_context.js`; `paneParam` already exists).
- Return shapes: existing keys preserved; `ctx` / `editor_index` / `applied` /
  `removed` are additive.
- `CLAUDE.md`: document pane-targeted compile and the `tab/editor/pane/mode`
  usage; reflect the `ctx` echo.

## Error Handling

Same three layers as Phase 2:

1. **Context resolution:** unresolved `tab`/`editor`/`pane` → error embedding the
   available list; never a `[0]`/active fallback. `resolvePaneRef` already
   exists (`"pane 2 out of range (layout has 1 chart)"`).
2. **Bridge layer:** new methods return `{ok:false, error}`.
   - `editor.compile()` no button → `{ok:false}` → op tries CDP keyboard fallback
     (Ctrl+Enter); still failing → clear error.
   - `focusPane`/`removeStudyByName` out of range → list-embedding error.
   - New-study identification fails (script errored) → `applied:null` + the
     compile error read from console/markers; **removal skipped**.
3. **Transport (CDP):** unchanged (disconnect invalidation + reconnect).

Tool boundary contract unchanged: `try/catch → jsonResult({success:false, error})`.

## Testing

Two layers, mirroring Phase 2:

1. **Unit (injected fakes):** add dispatch tests in `internals.test.js` for
   `listPanes`/`focusPane`/`pane.studies`/`pane.removeStudyByName`/
   `editor.activate` (indexing, range errors, envelope). Test `ops/pine.js`
   `applyToPane` orchestration with a **fake Tab** that emulates the
   snapshot → compile → new-study → remove sequence — verifying replace removes
   only the same-title study, add skips removal, and a failed compile skips
   removal.
2. **e2e (live, `TV_E2E=1`, restore-safe):**
   - Promote the Slice 0 spikes to formal e2e: editor activation drives which
     script compiles; `focusPane` changes active; `removeStudyByName` removes only
     the matching title.
   - **Two-pane scenario:** create a temporary `2h` layout → apply script A to
     pane 0, B to pane 1 → assert each pane's studies → **restore the original
     layout and editor content**.

Existing 154 unit tests and the Phase 2 e2e stay green (shims + additive).

## Build Slices

Each slice: tests green, existing tools working, independently revertible.

- **Slice 0 — Risk spikes (live):** validate editor-activation-drives-compile and
  per-pane study removal-by-title, restore-safe. Gate before building.
- **Slice 1 — Pane primitives:** bridge `listPanes`/`focusPane`/`pane.studies`/
  `pane.removeStudyByName` (+ pure dispatch + `BRIDGE_VERSION` 2); `src/session/pane.js`
  handle; `src/ops/pane.js`. Unit + live.
- **Slice 2 — Remaining Pine tools:** bridge `editor.activate`/`compile`/`save`/
  `console`; `ops/pine.js` compile/save/getConsole/smartCompile/newScript/openScript;
  `core/pine.js` shims; tools gain `{tab, editor}`.
- **Slice 3 — Pane-targeted compile:** `applyToPane`; `pine_compile`/
  `pine_smart_compile` gain `{pane, mode}`; two-pane e2e.
- **Slice 4 — Polish:** `ctx` includes pane; `pane_*` tools echo `ctx` and
  delegate to bridge; `CLAUDE.md` updates.

Revertibility: Slice 0 is throwaway/spike. From Slice 1 each slice is an
independent, test-passing set of commits; `core/*` shims keep everything working
in a half-migrated state.
