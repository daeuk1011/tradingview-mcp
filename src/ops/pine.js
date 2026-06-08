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

// Validated live: TradingView's "add to chart" only applies the SAVED/compiled
// script, so we must save (Cmd/Ctrl+S) first and wait for it to compile, then
// click the (locale-dependent) "add to chart" toolbar button.
const SAVE_MS = 2500;

/** Focus the editor input and save via CDP Cmd/Ctrl+S; waits saveMs for compile. */
async function saveEditor(tab, saveMs) {
  unwrap(await callBridge(tab, { method: 'editor.focusInput', args: {} }));
  const c = await tab.client();
  const mod = process.platform === 'darwin' ? 4 : 2; // Meta on macOS, Ctrl elsewhere
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: mod, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', modifiers: mod, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 });
  if (saveMs) await new Promise((r) => setTimeout(r, saveMs));
}

/** @returns {Promise<{success:true, button:string, editorIndex:number}>} */
export async function compile(tab, editorRef, { saveMs = SAVE_MS } = {}) {
  const editor = await activate(tab, editorRef);
  await saveEditor(tab, saveMs);
  const button = unwrap(await callBridge(tab, { method: 'editor.compile', args: {} }));
  return { success: true, button: button || 'add-to-chart', editorIndex: editor };
}

/** @returns {Promise<{success:true, editorIndex:number}>} */
export async function save(tab, editorRef, { saveMs = SAVE_MS } = {}) {
  const editor = await activate(tab, editorRef);
  await saveEditor(tab, saveMs);
  return { success: true, editorIndex: editor };
}

/** @returns {Promise<{entries:string[], editorIndex:number}>} */
export async function getConsole(tab, editorRef) {
  const editor = await activate(tab, editorRef);
  const entries = unwrap(await callBridge(tab, { method: 'editor.console', args: {} }));
  return { entries, editorIndex: editor };
}

