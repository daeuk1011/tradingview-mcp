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
