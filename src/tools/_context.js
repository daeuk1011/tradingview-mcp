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
