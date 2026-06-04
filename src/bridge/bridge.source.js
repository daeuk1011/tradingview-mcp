// src/bridge/bridge.source.js
export const BRIDGE_VERSION = 2;

// The body installs window.__tvmcp. Authored as a normal function so it stays
// readable/lintable; we inject `fn.toString()` wrapped in an IIFE.
function INSTALL(version) {
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

  function clickCompile() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var t = btns[i].textContent.trim();
      if (/save and add to chart/i.test(t)) { btns[i].click(); return 'Save and add to chart'; }
    }
    for (var j = 0; j < btns.length; j++) {
      var t2 = btns[j].textContent.trim();
      if (/^(add to chart|update on chart)$/i.test(t2)) { btns[j].click(); return t2; }
    }
    return null;
  }
  function clickSave() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) { btns[i].click(); return true; }
    }
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
          case 'editor.compile': return { ok: true, value: clickCompile() };
          case 'editor.save': return { ok: true, value: clickSave() };
          case 'editor.console': return { ok: true, value: readConsole() };
          default: return { ok: false, error: 'unknown bridge method "' + method + '"' };
        }
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  };
  return version;
}

export const BRIDGE_SOURCE = `(${INSTALL.toString()})(${BRIDGE_VERSION})`;
