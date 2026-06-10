import { z } from 'zod';
import { jsonResult } from './_format.js';
import { tabParam, editorParam } from './_context.js';
import * as core from '../core/pine.js';

export function registerPineTools(server) {
  server.tool('pine_get_source', 'Get Pine Script source from the editor (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.getSource({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_set_source', 'Set Pine Script source in the editor (optionally a specific tab/editor)', {
    source: z.string().describe('Pine Script source code to inject'),
    tab: tabParam, editor: editorParam,
  }, async ({ source, tab, editor }) => {
    try { return jsonResult(await core.setSource({ source, tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_compile', 'Compile / add the current Pine Script to the active chart (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.compile({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_get_errors', 'Get Pine Script compilation errors (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.getErrors({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_save', 'Save the current Pine Script (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.save({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_get_console', 'Read Pine Script console/log output (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.getConsole({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_smart_compile', 'Compile + add to the active chart (optionally a specific tab/editor)', {
    tab: tabParam, editor: editorParam,
  }, async ({ tab, editor }) => {
    try { return jsonResult(await core.smartCompile({ tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_new', 'Replace the editor buffer with a blank template. WARNING: this does NOT create a new saved script — a subsequent pine_save/pine_smart_compile OVERWRITES the script currently loaded in the editor. To create a separate saved script non-destructively, use pine_create (blank) or pine_save_as (copy of current).', {
    type: z.enum(['indicator', 'strategy', 'library']).describe('Type of script to create'),
  }, async ({ type }) => {
    try { return jsonResult(await core.newScript({ type })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_create', 'Create a fresh blank Pine Script in its OWN saved slot (non-destructive — uses TradingView\'s native "Create new", so it never overwrites the currently-loaded script).', {
    type: z.enum(['indicator', 'strategy', 'library']).describe('Type of script to create'),
    tab: tabParam, editor: editorParam,
  }, async ({ type, tab, editor }) => {
    try { return jsonResult(await core.createNewScript({ type, tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_save_as', 'Save the current editor script as a NEW named copy WITHOUT overwriting it (native "Make a copy" → rename). Use this to keep an existing script intact while saving a variant — e.g. saving a visualization indicator without clobbering a strategy.', {
    name: z.string().describe('Name for the new copy'),
    tab: tabParam, editor: editorParam,
  }, async ({ name, tab, editor }) => {
    try { return jsonResult(await core.saveAs({ name, tab, editor })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_open', 'Open a saved Pine Script by name', {
    name: z.string().describe('Name of the saved script to open (case-insensitive match)'),
  }, async ({ name }) => {
    try { return jsonResult(await core.openScript({ name })); }
    catch (err) { return jsonResult({ success: false, source: 'internal_api', error: err.message }, true); }
  });

  server.tool('pine_list_scripts', 'List saved Pine Scripts', {}, async () => {
    try { return jsonResult(await core.listScripts()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_analyze', 'Run static analysis on Pine Script code WITHOUT compiling — catches array out-of-bounds, unguarded array.first()/last(), bad loop bounds, and implicit bool casts. Works offline, no TradingView connection needed.', {
    source: z.string().describe('Pine Script source code to analyze'),
  }, async ({ source }) => {
    try { return jsonResult(core.analyze({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_check', 'Compile Pine Script via TradingView\'s server API without needing the chart open. Returns compilation errors/warnings. Useful for validating code before injecting into the chart.', {
    source: z.string().describe('Pine Script source code to compile/validate'),
  }, async ({ source }) => {
    try { return jsonResult(await core.check({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
