// src/ops/pine.js
import { resolveEditorIndex } from '../session/editor.js';
import { resolvePaneIndex } from '../session/pane.js';
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

async function activate(tab, editorRef) {
  const editor = await resolveEditorIndex(tab, editorRef);
  unwrap(await callBridge(tab, { method: 'editor.activate', args: { editor } }));
  return editor;
}

/** @returns {Promise<{success:true, button:string, editorIndex:number}>} */
export async function compile(tab, editorRef) {
  const editor = await activate(tab, editorRef);
  let button = unwrap(await callBridge(tab, { method: 'editor.compile', args: {} }));
  if (!button) {
    const c = await tab.client();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
    button = 'keyboard_shortcut';
  }
  return { success: true, button, editorIndex: editor };
}

/** @returns {Promise<{success:true, editorIndex:number}>} */
export async function save(tab, editorRef) {
  const editor = await activate(tab, editorRef);
  unwrap(await callBridge(tab, { method: 'editor.save', args: {} }));
  return { success: true, editorIndex: editor };
}

/** @returns {Promise<{entries:string[], editorIndex:number}>} */
export async function getConsole(tab, editorRef) {
  const editor = await activate(tab, editorRef);
  const entries = unwrap(await callBridge(tab, { method: 'editor.console', args: {} }));
  return { entries, editorIndex: editor };
}

/**
 * Apply the editor's current script to a specific pane as a study.
 * mode 'replace' (default): after adding, remove same-titled older studies on
 * the pane (preserving differently-named ones). mode 'add': stack.
 * If the script fails to compile (no new study appears), skip removal and
 * surface the console error — never delete the user's studies on failure.
 * settleMs: how long to wait after compile for the study to appear (default
 * 2000ms; tests pass 0).
 * @returns {Promise<{success:boolean, applied:string|null, removed:number, paneIndex:number, editorIndex:number, error?:string}>}
 */
export async function applyToPane(tab, { editor, pane, mode = 'replace', settleMs = 2000 } = {}) {
  const editorIndex = await activate(tab, editor);
  const paneIndex = await resolvePaneIndex(tab, pane);
  unwrap(await callBridge(tab, { method: 'focusPane', args: { pane: paneIndex } }));

  const before = unwrap(await callBridge(tab, { method: 'pane.studies', args: { pane: paneIndex } }));
  const beforeIds = new Set(before.map((s) => s.id));

  unwrap(await callBridge(tab, { method: 'editor.compile', args: {} }));
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));

  const after = unwrap(await callBridge(tab, { method: 'pane.studies', args: { pane: paneIndex } }));
  const added = after.find((s) => !beforeIds.has(s.id));

  if (!added) {
    const entries = unwrap(await callBridge(tab, { method: 'editor.console', args: {} }));
    const err = entries.find((e) => /error/i.test(e)) || 'compile produced no new study';
    return { success: false, applied: null, removed: 0, paneIndex, editorIndex, error: err };
  }

  let removed = 0;
  if (mode === 'replace') {
    removed = unwrap(await callBridge(tab, { method: 'pane.removeStudyByName', args: { pane: paneIndex, title: added.title, exceptId: added.id } }));
  }
  return { success: true, applied: added.title, removed, paneIndex, editorIndex };
}
