// src/tools/_context.js
import { z } from 'zod';

export const tabParam = z.union([z.number(), z.string()]).optional()
  .describe('Chart tab: index or chart_id. Omit = active tab.');
export const paneParam = z.number().int().optional()
  .describe('Multichart pane index. Omit = active pane.');
export const editorParam = z.union([z.number(), z.string()]).optional()
  .describe('Pine editor: index or script name. Omit = active editor.');

export { fmtCtx } from '../session/context.js';
