// src/bridge/locale.js
// Locale-aware label patterns for TradingView UI controls the bridge clicks.
// Kept as plain strings (not RegExp) so they can be injected into the stringified
// bridge via JSON, and unit-tested independently. Each is compiled with the `i`
// flag inside the page. Korean TV labels are included because the desktop app is
// frequently run in Korean.
export const LOCALE = {
  // "Save and add to chart" / "Add to chart" toolbar control.
  add: 'save and add to chart|add to chart|update on chart|차트에 넣기|차트에 추가|차트에 적용',
  // Pine script menu → "Make a copy…" (forks the current script to a new id).
  copy: 'make a copy|카피 만들기|사본 만들기|복사본 만들기',
  // Pine script menu → "Create new" (fresh blank script in its own slot).
  createNew: 'create new|new script|새로 만들기|새 스크립트',
  // Dialog confirm button — must match the WHOLE label to avoid hitting "Save script".
  confirm: '^(ok|save|create|copy|확인|저장|만들기|복사|생성)$',
  // "Create new" submenu entries by script type.
  type: {
    indicator: 'indicator|지표',
    strategy: 'strategy|전략',
    library: 'library|라이브러리',
  },
};
