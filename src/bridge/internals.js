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
