const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

function setup(raw = null) {
  const storage = {
    raw, writes: 0, fail: false,
    getItem() { return this.raw; },
    setItem(key, value) {
      if (this.fail) throw new Error('容量不足');
      this.raw = value; this.writes++;
    }
  };
  const context = vm.createContext({ window: {}, Intl, TextEncoder, Event, localStorage: storage, crypto: webcrypto });
  vm.runInContext(read('reading-annotations.js'), context);
  const writing = read('manuscript-writing.js');
  vm.runInContext(writing.slice(0, writing.indexOf('  const $ =')) + '})();', context);
  vm.runInContext(read('user-library.js'), context);
  return { context, storage, api: context.window.UserLibrary };
}

function fixture(s) {
  const data = s.api.empty();
  const text = '黄昏の空。';
  const model = new s.context.window.ReadingAnnotations(text);
  model.set(2, 'たそがれ');
  model.sourceRubies = [{ start: 3, end: 4, reading: 'そら' }];
  const marks = new s.context.window.ManuscriptMarks(text);
  marks.items = [
    { id: 1, type: 'marker', start: 0, end: 2, color: 'pink' },
    { id: 2, type: 'memo', offset: 2, text: 'ゆっくり', dx: 1, dy: 2, tx: 0, ty: 0, color: 'yellow' },
    { id: 3, type: 'pen', offset: 0, layoutKey: '900:1.8:5:123', fontSize: 22, color: 'red',
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], witnesses: [{ offset: 0, x: 0, y: 0 }] }
  ];
  const manuscript = JSON.parse(s.context.window.ManuscriptMarks.serializeManuscript(model, marks));
  data.profile.name = '朗読者';
  data.manuscripts = ['one', 'two'].map(id => ({ id, title: id, createdAt: '2026-11-03T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z', draft: text, manuscript, pending: null }));
  data.activeId = 'two';
  data.history = [{ characters: 5, seconds: 2, type: 'custom', measuredAt: null, title: '記録' }];
  data.target = '300'; data.plannedMinutes = '10';
  return data;
}

test('browser session restores existing data and preserves all manuscript information', () => {
  const s = setup();
  const data = fixture(s);
  const original = JSON.stringify(data, null, 2);
  s.storage.raw = original;
  const session = s.api.openBrowser();
  assert.equal(JSON.stringify(session.data), JSON.stringify(s.api.parse(original)));
  session.save(session.data);
  assert.equal(s.storage.raw, original, 'opening valid data must not rewrite it');
  session.data.manuscripts[1].draft += '続き';
  session.save(session.data);
  const resumed = s.api.openBrowser().data;
  assert.equal(resumed.manuscripts[1].draft, '黄昏の空。続き');
  assert.equal(resumed.manuscripts[1].manuscript.marks.length, 3);
  assert.equal(resumed.manuscripts[1].manuscript.annotations.length, 1);
  assert.equal(resumed.manuscripts[1].manuscript.sourceRubies.length, 1);
  assert.equal(resumed.activeId, 'two');
  assert.equal(resumed.profile.name, '朗読者');
  assert.equal(resumed.history.length, 1);
  assert.equal(resumed.target, '300');
  assert.equal(resumed.plannedMinutes, '10');
});

test('new browser session persists without a JSON file', () => {
  const s = setup(), session = s.api.openBrowser();
  assert.equal(s.storage.writes, 0);
  session.save(session.data);
  assert.equal(s.storage.writes, 1);
  assert.equal(s.api.openBrowser().data.format, 'yomijitaku-user');
});

test('invalid legacy data and denied access cannot be initialized over', () => {
  for (const raw of ['{broken', JSON.stringify({ format: 'unknown' })]) {
    const s = setup(raw);
    assert.throws(() => s.api.openBrowser());
    assert.equal(s.storage.raw, raw);
    assert.equal(s.storage.writes, 0);
  }
  const s = setup();
  s.storage.getItem = () => { throw new Error('アクセス拒否'); };
  assert.throws(() => s.api.openBrowser(), /アクセス拒否/);
  assert.equal(s.storage.writes, 0);
});

test('quota failure preserves last durable data and can be retried', () => {
  const s = setup();
  s.storage.raw = JSON.stringify(fixture(s));
  const original = s.storage.raw, session = s.api.openBrowser();
  session.data.profile.name = '変更後'; s.storage.fail = true;
  assert.throws(() => session.save(session.data), /容量不足/);
  assert.equal(s.storage.raw, original);
  s.storage.fail = false; session.save(session.data);
  assert.equal(s.api.openBrowser().data.profile.name, '変更後');
});

test('other tabs changing or clearing data block automatic overwrites', () => {
  for (const other of [null, '別タブのデータ']) {
    const s = setup(), first = s.api.openBrowser();
    first.save(first.data);
    s.storage.raw = other;
    first.data.profile.name = '古いタブの変更';
    assert.throws(() => first.save(first.data), /別のタブ/);
    assert.equal(s.storage.raw, other);
    assert.throws(() => first.save(first.data), /別のタブ/);
  }
});

function appSetup(s) {
  const app = read('app.js'), fields = new Map();
  const node = () => ({ value: '', textContent: '', hidden: false, dataset: {}, classList: { toggle() {} }, setAttribute() {},
    querySelector() { return this.label ||= node(); } });
  const $ = id => { if (!fields.has(id)) fields.set(id, node()); return fields.get(id); };
  s.context.window.localStorage = s.storage;
  s.context.window.Reader = { displayMode: 'scroll', setDisplayMode(mode) { this.displayMode = mode; } };
  Object.assign(s.context, { $, document: { querySelector: () => ({ inert: true }), dispatchEvent() {} },
    clearTimeout, setTimeout, renderLibrary() {}, renderResults() {}, show() {},
    validTarget: value => Number(value) > 0, validMinutes: value => Number(value) > 0,
    countText: value => value.length, setTarget(value) { s.context.target = value; }, libraryReady: false, library: s.api.empty(),
    savedUserSnapshot: null, captureFailed: false, userDirty: false,
    browserSession: null, browserSaveError: '', changeTimer: 0, userFilename: '',
    pendingReadPaste: null, readPaper: false, readMeasurementReturn: null });
  const functions = app.slice(app.indexOf('  function activeBook()'), app.indexOf('  let libraryRenderKey'));
  const use = app.slice(app.indexOf('  function openBrowserSession('), app.indexOf('  let restoringUser'));
  const mark = app.slice(app.indexOf('  function markFileSaved('), app.indexOf('  async function saveUserData'));
  vm.runInContext(functions + use + mark, s.context);
  return { c: s.context, $ };
}

test('backup and restored files keep autosave active, including after failures', () => {
  const s = setup(), { c, $ } = appSetup(s);
  s.storage.raw = JSON.stringify(fixture(s));
  const session = s.api.openBrowser();
  c.useUserData(session.data, '', session);
  assert.equal($('read-text').value, '黄昏の空。');
  assert.match($('storage-guidance').textContent, /自動保存/);
  $('read-text').value += '編集';
  c.syncLibrary();
  assert.equal(s.api.openBrowser().data.manuscripts[1].draft, '黄昏の空。編集');
  assert.equal(c.userDirty, false);
  s.storage.fail = true;
  $('profile-name').value = '容量不足中の編集';
  assert.equal(c.syncLibrary(), true, 'capture remains available for JSON backup');
  assert.equal(c.userDirty, true);
  assert.match($('user-save-status').textContent, /容量不足/);
  assert.equal($('retry-browser-save').hidden, false);
  c.markFileSaved('backup.json');
  assert.equal(c.userDirty, true);
  s.storage.fail = false;
  c.syncLibrary();
  assert.equal(c.userDirty, false);
  assert.equal(s.api.openBrowser().data.profile.name, '容量不足中の編集');

  c.useUserData(s.api.empty(), 'import.json', s.api.openBrowser(s.storage, { replacement: true }));
  $('profile-name').value = '読み込んだJSONの編集';
  c.syncLibrary();
  assert.equal(s.api.openBrowser().data.profile.name, '読み込んだJSONの編集');
  assert.match($('storage-guidance').textContent, /自動保存/);
});

test('debounced edits persist and JSON backup remains usable during browser storage failure', async () => {
  const s = setup(), { c, $ } = appSetup(s), session = s.api.openBrowser();
  c.useUserData(session.data, '', session);
  $('profile-name').value = '入力後に自動保存';
  c.scheduleLibraryChange();
  assert.equal(c.userDirty, true);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(s.api.openBrowser().data.profile.name, '入力後に自動保存');
  assert.equal(c.userDirty, false);

  let output = null;
  Object.assign(c, { savingUser: false, readyForDirectAction: () => true, setFileControlsBusy() {}, notify() {} });
  c.window.isSecureContext = true;
  c.window.showSaveFilePicker = async () => ({ name: 'backup.json', createWritable: async () => ({
    async write(json) { output = json; }, async close() {}
  }) });
  const app = read('app.js');
  vm.runInContext(app.slice(app.indexOf('  async function saveUserData()'), app.indexOf("  $('export-user').onclick = saveUserData")), c);
  s.storage.fail = true;
  $('profile-name').value = 'ブラウザ未保存・JSONに退避';
  await c.saveUserData();
  assert.equal(s.api.parse(output).profile.name, 'ブラウザ未保存・JSONに退避');
  assert.equal(c.userDirty, true);
  assert.match($('user-save-status').textContent, /容量不足/);
  assert.equal(s.api.openBrowser().data.profile.name, '入力後に自動保存');
});


test('explicit replacement preserves unreadable data until save and detects concurrent edits', () => {
  const s = setup('{broken'), session = s.api.openBrowser(s.storage, { replacement: true });
  assert.equal(session.hasData, true);
  assert.equal(s.storage.raw, '{broken');
  const candidate = fixture(s);
  session.save(candidate);
  assert.equal(s.api.openBrowser().data.history.length, 1);
  const next = s.api.openBrowser(s.storage, { replacement: true });
  s.storage.raw = 'another tab';
  assert.throws(() => next.save(candidate), /別のタブ/);
  assert.equal(s.storage.raw, 'another tab');
});


test('global display mode survives browser/file storage; older files default to scroll', () => {
  const s = setup(), data = fixture(s);
  delete data.displaySettings;
  assert.equal(s.api.parse(JSON.stringify(data)).displaySettings.mode, 'scroll');
  data.displaySettings = { mode: 'pages' };
  const session = s.api.openBrowser(); session.save(data);
  assert.equal(s.api.openBrowser().data.displaySettings.mode, 'pages');
  assert.equal(s.api.parse(JSON.stringify(data)).displaySettings.mode, 'pages');
  for (const invalid of [null, {}, { mode: 'other' }, { mode: 1 }]) {
    assert.throws(() => s.api.parse(JSON.stringify({ ...data, displaySettings: invalid })));
  }
});
