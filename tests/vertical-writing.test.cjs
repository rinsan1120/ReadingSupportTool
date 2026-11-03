const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ window: {}, Intl, TextEncoder, structuredClone, Event, document: { dispatchEvent() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../reading-annotations.js'), 'utf8'), context);
const writing = fs.readFileSync(path.join(__dirname, '../manuscript-writing.js'), 'utf8');
vm.runInContext(writing.slice(0, writing.indexOf('  const $ =')) + '})();', context);
const { ReadingAnnotations: Readings, ManuscriptMarks: Marks } = context.window;
const plain = value => JSON.parse(JSON.stringify(value));
const pen = direction => ({ type: 'pen', direction, offset: 0, layoutKey: '40:1.8:5:0',
  points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], witnesses: [{ offset: 0, x: 0, y: 0 }], color: 'green' });
const memo = { type: 'memo', offset: 0, dx: 1, dy: 2, tx: 0, ty: 0, text: '読む', color: 'pink' };
test('v5 round trip retains source, both pen sets and both memo placements', () => {
  const r = new Readings('本文。\r\n𠮷が'); r.set(2, 'ほんぶん'); r.sourceRubies = [{ start: 0, end: 2, reading: 'ほんぶん' }];
  const m = new Marks(r.source); m.add(pen('horizontal')); m.direction = 'vertical'; m.add(pen('vertical'));
  m.add({ ...memo, verticalPosition: { dx: -2, dy: 1, tx: .1, ty: .2 } });
  const json = Marks.serializeManuscript(r, m), restored = Marks.restoreManuscript(json);
  assert.equal(Marks.serializeManuscript(restored.manuscript, restored.markings), json);
  assert.equal(restored.markings.direction, 'vertical'); assert.equal(restored.manuscript.source, r.source);
});
test('v1-v4 remain readable; legacy pens and memo coordinates belong to horizontal', () => {
  const r = new Readings('本文。'), m = new Marks(r.source); const oldPen = pen(); delete oldPen.direction;
  m.add(oldPen); m.add(memo);
  const data = JSON.parse(Marks.serializeManuscript(r, m)); delete data.writingDirection;
  for (const version of [1, 2, 3, 4]) {
    const old = structuredClone(data); old.version = version;
    if (version < 3) old.marks = [];
    if (version === 3) for (const item of old.marks) if (item.type === 'memo') { delete item.tx; delete item.ty; delete item.color; }
    const restored = Marks.restoreManuscript(JSON.stringify(old)); assert.equal(restored.markings.direction, 'horizontal');
    if (version >= 3) { assert.equal(restored.markings.items[0].direction, undefined); assert.equal(restored.markings.items[1].dx, 1); }
  }
});
test('direction-specific Undo leaves the other pen set and memo placement unchanged', () => {
  const m = new Marks('本文。'); m.add(pen('horizontal')); m.add(memo);
  m.direction = 'vertical'; m.add(pen('vertical')); m.updateMemo(2, { verticalPosition: { dx: -4, dy: 2, tx: 0, ty: 1 } });
  const other = plain(m.items.find(i => i.id === 3));
  m.direction = 'horizontal'; m.updateMemo(2, { dx: 5 }); m.undo();
  assert.equal(m.items.find(i => i.id === 2).dx, 1); assert.equal(m.items.find(i => i.id === 2).verticalPosition.dx, -4);
  m.undo(); assert.ok(!m.items.some(i => i.id === 2)); m.undo();
  assert.deepEqual(plain(m.items), [other]);
  m.direction = 'vertical'; m.undo(); m.undo(); assert.ok(!m.items.some(i => i.type === 'pen'));
});
test('Undo of a memo placement preserves subsequent shared text/color edits', () => {
  const m = new Marks('本文。'); m.add(memo); m.updateMemo(1, { dx: 5 });
  m.direction = 'vertical'; m.updateMemo(1, { text: '新しいメモ', color: 'lightblue' });
  m.direction = 'horizontal'; m.undo();
  assert.equal(m.items[0].dx, 1); assert.equal(m.items[0].text, '新しいメモ'); assert.equal(m.items[0].color, 'lightblue');
});
test('malformed extended data is rejected without changing the current models', () => {
  const r = new Readings('本文。'), m = new Marks(r.source); m.add(pen('vertical')); m.add(memo);
  const json = Marks.serializeManuscript(r, m), data = JSON.parse(json);
  for (const change of [d => { d.writingDirection = 'sideways'; }, d => { d.marks[0].direction = null; },
    d => { d.marks[1].verticalPosition = { dx: 0, dy: 0, tx: 0, ty: 1001 }; },
    d => { d.marks[1].verticalPosition = { dx: 0, dy: 0 }; },
    d => { d.marks[1].verticalPosition = { dx: 0, dy: 0, tx: 0, ty: 0, extra: true }; }]) {
    const invalid = structuredClone(data); change(invalid); assert.throws(() => Marks.restoreManuscript(JSON.stringify(invalid)));
    assert.equal(Marks.serializeManuscript(r, m), json);
  }
});
