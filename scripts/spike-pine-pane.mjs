// scripts/spike-pine-pane.mjs
// Restore-safe live spike. Requires TradingView running with the Pine Editor open.
// Run: node scripts/spike-pine-pane.mjs
import { evaluate, disconnect } from '../src/connection.js';
import { ensurePineEditorOpen } from '../src/core/pine.js';

const ev = (s) => evaluate(s);
const log = (...a) => console.log(...a);

async function main() {
  await ensurePineEditorOpen();

  // --- RISK 2: study list + remove-by-name on the active chart ---
  const studies = await ev(`(function(){
    var c = window.TradingViewApi._activeChartWidgetWV.value();
    return JSON.stringify(c.getAllStudies().map(function(s){ return { id:s.id, name:s.name }; }));
  })()`);
  log('RISK2 studies on active chart:', studies);
  log('RISK2 has removeEntity:', await ev(`typeof window.TradingViewApi._activeChartWidgetWV.value().removeEntity === 'function'`));
  log('RISK2 has getStudyById:', await ev(`typeof window.TradingViewApi._activeChartWidgetWV.value().getStudyById === 'function'`));

  // --- RISK 1: enumerate editors + does an "activate" exist? ---
  const editors = await ev(`(function(){
    var cont = document.querySelector('.monaco-editor.pine-editor-monaco'); if(!cont) return '[]';
    var el=cont,key; for(var i=0;i<20&&el;i++){ key=Object.keys(el).find(function(k){return k.startsWith('__reactFiber$');}); if(key)break; el=el.parentElement; }
    var cur=el&&el[key];
    for(var d=0;d<15&&cur;d++){ var p=cur.memoizedProps; if(p&&p.value&&p.value.monacoEnv&&p.value.monacoEnv.editor&&p.value.monacoEnv.editor.getEditors){ var eds=p.value.monacoEnv.editor.getEditors();
      return JSON.stringify(eds.map(function(e,i){ var m=e.getModel&&e.getModel(); return { index:i, hasFocus: typeof e.focus==='function', uri:(m&&String(m.uri.path||''))||'' }; })); } cur=cur.return; }
    return '[]';
  })()`);
  log('RISK1 editors:', editors);

  // Pine editor script tabs in the DOM (the activation surface if focus() is not enough)
  const tabs = await ev(`(function(){
    var ts = document.querySelectorAll('[class*="tab"][data-name], [class*="editorTab"], [class*="scriptTab"], [class*="tabs-"] [role="tab"]');
    return JSON.stringify(Array.prototype.slice.call(ts, 0, 12).map(function(t){ return { cls:String(t.className).slice(0,45), txt:t.textContent.trim().slice(0,30) }; }));
  })()`);
  log('RISK1 candidate script-tab DOM:', tabs);

  await disconnect();
}
main().then(()=>process.exit(0)).catch((e)=>{ console.error('SPIKE ERR', e); process.exit(1); });

// ── SLICE 0 GATE RESULT (2026-06-04) ──────────────────────────────────────
// RISK2 (study removal): CONFIRMED. chart.getAllStudies() -> [{id,name}];
//   chart.removeEntity(id) and chart.getStudyById(id) are functions.
// RISK1 (editor activation): getEditors()[i].focus() exists. With one script
//   open, getEditors() returns 1. editor.activate(i) = getEditors()[i].focus()
//   with a DOM script-tab-click fallback. The pane-targeted compile headline
//   works single-editor (source swapped between applies), so multi-editor-tab
//   activation is off the critical path and validated opportunistically in e2e.
// DECISION: GATE PASS. Proceed to Slice 1.
