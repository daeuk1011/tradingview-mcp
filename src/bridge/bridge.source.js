// src/bridge/bridge.source.js
import { LOCALE } from './locale.js';

export const BRIDGE_VERSION = 4;

// The body installs window.__tvmcp. Authored as a normal function so it stays
// readable/lintable; we inject `fn.toString()` wrapped in an IIFE. `L` carries
// the locale label patterns (see locale.js) — injected as JSON so it survives
// the toString() round-trip.
function INSTALL(version, L) {
  function resolveMonaco() {
    var container = document.querySelector('.monaco-editor.pine-editor-monaco');
    if (!container) return null;
    var el = container, fiberKey;
    for (var i = 0; i < 20 && el; i++) {
      fiberKey = Object.keys(el).find(function (k) { return k.startsWith('__reactFiber$'); });
      if (fiberKey) break;
      el = el.parentElement;
    }
    if (!fiberKey) return null;
    var cur = el[fiberKey];
    for (var d = 0; d < 15 && cur; d++) {
      var p = cur.memoizedProps;
      if (p && p.value && p.value.monacoEnv && p.value.monacoEnv.editor
          && typeof p.value.monacoEnv.editor.getEditors === 'function') {
        return p.value.monacoEnv;
      }
      cur = cur.return;
    }
    return null;
  }

  function internals() {
    return {
      listEditors: function () {
        var env = resolveMonaco();
        if (!env) return [];
        return env.editor.getEditors().map(function (ed, i) {
          var model = ed.getModel && ed.getModel();
          var name = (model && model.uri && String(model.uri.path || '').split('/').pop()) || ('editor' + i);
          return { index: i, name: name };
        });
      },
      editorAt: function (i) {
        var env = resolveMonaco();
        if (!env) return null;
        var eds = env.editor.getEditors();
        var ed = eds[i];
        if (!ed) return null;
        return {
          getSource: function () { return ed.getValue(); },
          setSource: function (v) { ed.setValue(v); return true; },
          getMarkers: function () {
            var model = ed.getModel();
            if (!model) return [];
            return env.editor.getModelMarkers({ resource: model.uri }).map(function (m) {
              return { message: m.message, line: m.startLineNumber, severity: m.severity };
            });
          },
          activate: function () {
            try { ed.focus(); } catch (e) {}
            try {
              var tabs = document.querySelectorAll('[class*="scriptTab"], [class*="editorTab"]');
              if (tabs[i]) tabs[i].click();
            } catch (e) {}
            return true;
          },
        };
      },
      listPanes: function () {
        var cwc = window.TradingViewApi._chartWidgetCollection;
        return cwc.getAll().map(function (c, i) {
          var sym = '', res = null;
          try { var ms = c.model().mainSeries(); sym = ms.symbol(); res = ms.interval(); } catch (e) {}
          return { index: i, symbol: sym, resolution: res };
        });
      },
      // Per-pane study access goes through the ACTIVE chart wrapper, which is the
      // only object exposing clean {id,name} studies + removeEntity. We focus the
      // target pane, wait for the activation to settle, then read/remove. Returns
      // a Promise (the bridge `call` is async and awaits it).
      focusPane: function (i) {
        var cwc = window.TradingViewApi._chartWidgetCollection;
        var c = cwc.getAll()[i];
        if (!c) return null;
        if (c._mainDiv) c._mainDiv.click();
        return new Promise(function (resolve) { setTimeout(function () { resolve(true); }, 250); });
      },
      paneStudies: function (i) {
        var cwc = window.TradingViewApi._chartWidgetCollection;
        var c = cwc.getAll()[i];
        if (!c) return null;
        if (c._mainDiv) c._mainDiv.click();
        return new Promise(function (resolve) {
          setTimeout(function () {
            var w = window.TradingViewApi._activeChartWidgetWV.value();
            resolve(w.getAllStudies().map(function (s) { return { id: s.id, title: s.name }; }));
          }, 250);
        });
      },
      removeStudyByName: function (i, title, exceptId) {
        var cwc = window.TradingViewApi._chartWidgetCollection;
        var c = cwc.getAll()[i];
        if (!c) return null;
        if (c._mainDiv) c._mainDiv.click();
        return new Promise(function (resolve) {
          setTimeout(function () {
            var w = window.TradingViewApi._activeChartWidgetWV.value();
            var removed = 0;
            w.getAllStudies().forEach(function (s) {
              if (s.name === title && s.id !== exceptId) { w.removeEntity(s.id); removed++; }
            });
            resolve(removed);
          }, 250);
        });
      },
    };
  }

  // Fire a real pointer/mouse sequence — these toolbar buttons are React
  // components that ignore a bare .click().
  function realClick(el) {
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'pointerup'].forEach(function (ev) {
      try { el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // First VISIBLE node under `root` whose aria-label/text matches `re`.
  function findLabel(re, root, sel) {
    var scope = root || document;
    var nodes = scope.querySelectorAll(sel || 'button, [role="menuitem"], [role="button"], [aria-label]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.offsetParent === null) continue;
      var label = ((n.getAttribute('aria-label') || '') + ' ' + (n.textContent || '')).trim();
      if (re.test(label)) return n;
    }
    return null;
  }

  // The currently-open dialog (rename/copy prompt), if any.
  function openDialog() {
    var ds = document.querySelectorAll('[role="dialog"], [class*="dialog"]');
    for (var i = 0; i < ds.length; i++) { if (ds[i].offsetParent !== null) return ds[i]; }
    return null;
  }

  // Set an <input> value the way React expects (native setter + input event),
  // otherwise React overwrites it on the next render.
  function setReactInput(input, value) {
    var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Open the Pine editor's script menu (the script-title dropdown in the header).
  function openScriptMenu() {
    var dlg = document.querySelector('[data-name="pine-dialog"]');
    if (!dlg) return false;
    var trig = dlg.querySelector('[aria-haspopup="true"], [data-name="pine-script-title"], [data-name*="title"]');
    if (!trig) {
      var cands = dlg.querySelectorAll('button, [role="button"], [class*="title"]');
      for (var i = 0; i < cands.length; i++) {
        if (cands[i].offsetParent !== null && (cands[i].getAttribute('aria-haspopup') || /title/i.test(cands[i].className || ''))) { trig = cands[i]; break; }
      }
    }
    if (!trig) return false;
    realClick(trig);
    return true;
  }

  var COPY_RE = new RegExp(L.copy, 'i');
  var CREATE_RE = new RegExp(L.createNew, 'i');
  var CONFIRM_RE = new RegExp(L.confirm, 'i');

  // "Make a copy" → forks the current script to a NEW saved id (non-destructive),
  // then renames the copy to `name` via the prompt dialog. Returns the new name.
  async function makeCopy(name) {
    if (!openScriptMenu()) return { ok: false, error: 'could not open Pine script menu' };
    await sleep(300);
    var item = findLabel(COPY_RE, document, '[role="menuitem"], [aria-label]');
    if (!item) return { ok: false, error: 'Make-a-copy menu item not found (locale?)' };
    realClick(item);
    await sleep(450);
    var dlg = openDialog();
    if (name && dlg) {
      var input = dlg.querySelector('input[type="text"], input:not([type])');
      if (input && input.offsetParent !== null) { setReactInput(input, name); await sleep(80); }
    }
    var confirm = findLabel(CONFIRM_RE, dlg || document, 'button');
    if (!confirm) return { ok: false, error: 'copy dialog confirm button not found' };
    realClick(confirm);
    await sleep(600);
    return { ok: true, value: name || null };
  }

  // "Create new" → fresh blank script of `type` in its own slot (non-destructive).
  async function createNew(type) {
    if (!openScriptMenu()) return { ok: false, error: 'could not open Pine script menu' };
    await sleep(300);
    var entry = findLabel(CREATE_RE, document, '[role="menuitem"], [aria-label]');
    if (!entry) return { ok: false, error: 'Create-new menu item not found (locale?)' };
    realClick(entry);
    await sleep(350);
    var typeRe = new RegExp((L.type && L.type[type]) || L.type.indicator, 'i');
    var typeItem = findLabel(typeRe, document, '[role="menuitem"], [aria-label]');
    if (!typeItem) return { ok: false, error: 'Create-new "' + type + '" submenu item not found' };
    realClick(typeItem);
    await sleep(500);
    return { ok: true, value: type };
  }

  // The "add to chart" control matched by title OR text, locale-aware (the
  // button has no data-name/aria-label; in a Korean UI its title is "차트에 넣기").
  var ADD_RE = new RegExp(L.add, 'i');
  function clickCompile() {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var label = (b.getAttribute('title') || '') + ' ' + (b.textContent || '');
      if (ADD_RE.test(label) && b.offsetParent !== null) { realClick(b); return (b.getAttribute('title') || b.textContent || 'add to chart').trim().slice(0, 30); }
    }
    return null;
  }
  // Focus the Pine editor's text input so a CDP Cmd/Ctrl+S save lands there.
  function focusEditorInput() {
    var m = document.querySelector('.monaco-editor.pine-editor-monaco');
    var t = m && m.querySelector('textarea');
    if (t) { t.focus(); return true; }
    return false;
  }
  function readConsole() {
    var out = [];
    var rows = document.querySelectorAll('[class*="consoleRow"], [class*="consoleLine"]');
    for (var i = 0; i < rows.length; i++) { var x = rows[i].textContent.trim(); if (x) out.push(x); }
    return out;
  }

  function paneOr(ref) {
    var panes = internals().listPanes();
    var i = Number(ref);
    if (!Number.isInteger(i) || i < 0 || i >= panes.length) {
      return { err: 'pane ' + ref + ' out of range (layout has ' + panes.length + ' chart' + (panes.length === 1 ? '' : 's') + ')' };
    }
    return { i: i };
  }

  function editorOr(ref) {
    var list = internals().listEditors();
    var i = Number(ref);
    var acc = Number.isInteger(i) ? internals().editorAt(i) : null;
    if (!acc) return { err: 'editor ' + ref + ' out of range (open: ' + list.map(function (e) { return e.index + '=' + e.name; }).join(', ') + ')' };
    return { acc: acc };
  }

  window.__tvmcp = {
    version: version,
    call: async function (payload) {
      try {
        var method = payload.method, args = payload.args || {};
        switch (method) {
          case 'listEditors': return { ok: true, value: internals().listEditors() };
          case 'editor.getSource': { var a = editorOr(args.editor); return a.err ? { ok: false, error: a.err } : { ok: true, value: a.acc.getSource() }; }
          case 'editor.setSource': { var b = editorOr(args.editor); return b.err ? { ok: false, error: b.err } : { ok: true, value: b.acc.setSource(args.source) }; }
          case 'editor.getMarkers': { var c = editorOr(args.editor); return c.err ? { ok: false, error: c.err } : { ok: true, value: c.acc.getMarkers() }; }
          case 'listPanes': return { ok: true, value: internals().listPanes() };
          case 'focusPane': { var fp = paneOr(args.pane); return fp.err ? { ok: false, error: fp.err } : { ok: true, value: await internals().focusPane(fp.i) }; }
          case 'pane.studies': { var ps = paneOr(args.pane); return ps.err ? { ok: false, error: ps.err } : { ok: true, value: await internals().paneStudies(ps.i) }; }
          case 'pane.removeStudyByName': { var rp = paneOr(args.pane); return rp.err ? { ok: false, error: rp.err } : { ok: true, value: await internals().removeStudyByName(rp.i, args.title, args.exceptId) }; }
          case 'editor.activate': { var ea = editorOr(args.editor); return ea.err ? { ok: false, error: ea.err } : { ok: true, value: ea.acc.activate() }; }
          case 'editor.focusInput': return { ok: true, value: focusEditorInput() };
          case 'editor.compile': return { ok: true, value: clickCompile() };
          case 'editor.makeCopy': return await makeCopy(args.name);
          case 'editor.createNew': return await createNew(args.type || 'indicator');
          case 'editor.console': return { ok: true, value: readConsole() };
          default: return { ok: false, error: 'unknown bridge method "' + method + '"' };
        }
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  };
  return version;
}

export const BRIDGE_SOURCE = `(${INSTALL.toString()})(${BRIDGE_VERSION}, ${JSON.stringify(LOCALE)})`;
