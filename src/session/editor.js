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
