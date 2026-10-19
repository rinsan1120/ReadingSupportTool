const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = { window: {}, Intl };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../reading-annotations.js'), 'utf8'), context);
const Model = context.window.ReadingAnnotations;

test('original UTF-16 offsets survive edits, sorting and deletion', () => {
  const source = '黄昏\r\n\r\n👩‍👩‍👧‍👦か\u3099𠮷【原文】';
  const model = new Model(source);
  const emojiEnd = source.indexOf('か');
  assert.equal(model.set(emojiEnd, '  家族  '), true);
  assert.equal(model.set(2, 'たそがれ'), true);
  assert.equal(model.set(0, 'はじめ'), true);
  assert.deepEqual(Array.from(model.entries, a => a.offset), [0, 2, emojiEnd]);
  assert.equal(model.set(2, 'ゆうぐれ'), true);
  assert.equal(model.entries.length, 3);
  assert.equal(model.entries[1].text, 'ゆうぐれ');
  model.remove(emojiEnd);
  assert.equal(model.entries.length, 2);
  assert.equal(model.source, source);
  model.reset('差し替え');
  assert.equal(model.entries.length, 0);
});

test('reject empty, newline, invalid and interior grapheme positions', () => {
  const model = new Model('𠮷👩‍👩‍👧‍👦か\u3099\r\n末');
  for (const offset of [-1, .5, 1, 3, 4, 14, 16, 100]) {
    assert.equal(model.set(offset, 'よみ'), false, `offset ${offset}`);
  }
  for (const text of ['', ' \t　', 'よみ\nがな']) assert.equal(model.set(0, text), false);
  assert.equal(model.set(model.source.length, 'おわり'), true);
  assert.equal(model.source, '𠮷👩‍👩‍👧‍👦か\u3099\r\n末');
});
