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
