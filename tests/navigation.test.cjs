const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function setup() {
  const entries = [], renders = [], moves = [];
  let pop;
  const c = vm.createContext({ Date, Math, Map, Set, Number,
    libraryReady: true, library: { activeId: 'book' }, view: 'home', mode: 'read', resultMode: 'records',
    sourceType: 'custom', sample: null, displayedText: '秘密の本文', readAnnotations: { source: '秘密の本文' },
    phase: 'idle', history: [], allowed: true, confirmed: true,
    $: () => ({ value: '秘密の本文' }),
    addEventListener(type, listener) { pop = listener; },
    show(view, resultMode) {
      if (c.view === 'reading' && view !== 'reading') c.cancelMeasurement();
      c.view = view; c.resultMode = resultMode; renders.push(view);
    },
    displayReader(mode, text) { c.view = 'reading'; c.mode = mode; renders.push({ mode, text }); },
    cancelMeasurement() { c.phase = 'idle'; },
    readyForDirectAction() { return c.allowed; },
    window: { confirm() { return c.confirmed; }, history: {
      state: null,
      pushState(state, _, url) { this.state = state; entries.push({ state, url }); },
      replaceState(state, _, url) { this.state = state; entries.push({ state, url }); },
      go(delta) { moves.push(delta); }
    } }
  });
  vm.runInContext(app.slice(app.indexOf('  // Browser entries'), app.indexOf('  const hasReadings')), c);
  c.writeNavigation('home', 'records', true);
  return { c, entries, renders, moves, pop: state => pop({ state }) };
}
test('entries contain only navigation metadata and duplicate screens do not push', () => {
  const { c, entries } = setup();
  c.writeNavigation('reading', 'records');
  c.writeNavigation('reading', 'records');
  assert.equal(entries.length, 2);
  assert.equal(JSON.stringify(entries).includes('秘密'), false);
});
test('back and forward render retained manuscript without opening or resetting models', () => {
  const { c, entries, renders, pop } = setup();
  c.writeNavigation('reading', 'records');
  const reader = entries.at(-1).state;
  c.writeNavigation('results', 'completed');
  pop(reader);
  assert.deepEqual(renders.at(-1), { mode: 'read', text: '秘密の本文' });
  assert.equal(c.phase, 'idle');
  c.readAnnotations.source = '';
  pop(reader);
  assert.equal(renders.at(-1), 'read-input');
});
test('cancelled measurement exit and unfinished edits restore the history position', () => {
  for (const editing of [false, true]) {
    const { c, entries, moves, renders, pop } = setup();
    const home = entries[0].state;
    c.writeNavigation('reading', 'records');
    c.phase = 'running'; c.confirmed = false; c.allowed = !editing;
    pop(home);
    assert.equal(c.phase, 'running');
    assert.deepEqual(moves, [1]);
    assert.equal(renders.length, 0);
    pop(entries.at(-1).state);
    assert.equal(renders.length, 0);
  }
});
test('accepted exit cancels measurement and invalid state falls back safely', () => {
  const { c, entries, renders, pop } = setup();
  const home = entries[0].state;
  c.writeNavigation('reading', 'records');
  c.view = 'reading'; c.phase = 'running';
  pop(home);
  assert.equal(renders.at(-1), 'home');
  assert.equal(c.phase, 'idle');
  pop({ view: 'reading', index: -1 });
  assert.equal(renders.at(-1), 'home');
});
test('completed timing entry restores preparation only, and changed timing input falls back', () => {
  const { c, entries, renders, pop } = setup();
  c.mode = 'time';
  c.writeNavigation('reading', 'records');
  const preparation = entries.at(-1).state;
  c.writeNavigation('results', 'completed');
  pop(preparation);
  assert.deepEqual(renders.at(-1), { mode: 'time', text: '秘密の本文' });
  assert.equal(c.phase, 'idle');
  assert.equal(c.history.length, 0);
  c.$ = () => ({ value: '変更後' });
  pop(preparation);
  assert.equal(renders.at(-1), 'time-input');
});
