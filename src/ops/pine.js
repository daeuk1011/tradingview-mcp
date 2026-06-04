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
