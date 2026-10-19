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

const manuscript = (text = '黄昏の空。', annotations = [{ offset: 2, text: 'たそがれ' }]) => ({
  format: 'reading-support-manuscript', version: 1, text, annotations
});

test('JSON round trip preserves all original bytes after UTF-8 encoding and annotations verbatim', () => {
  const text = '\r\n黄昏\r\n \t\r\n👩‍👩‍👧‍👦か\u3099𠮷【元の括弧】\r末\n';
  const data = manuscript(text, [{ offset: text.length, text: ' 末尾 ' }, { offset: 0, text: '<b>先頭</b>' }, { offset: text.indexOf('👩'), text: '家族' }]);
  const model = Model.fromJSON(JSON.stringify(data));
  const exported = JSON.parse(Buffer.from(JSON.stringify(model), 'utf8').toString('utf8'));
  assert.equal(model.source, text);
  assert.deepEqual(exported, { ...data, annotations: data.annotations.toSorted((a, b) => a.offset - b.offset) });
  assert.equal(model.entries.at(-1).text, ' 末尾 ');
  model.set(0, 'へんしゅう'); model.remove(text.length);
  assert.equal(JSON.parse(JSON.stringify(model)).annotations[0].text, 'へんしゅう');
  for (const text of ['', ' \t\r\n', '本文だけ']) {
    assert.deepEqual(JSON.parse(JSON.stringify(Model.fromJSON(JSON.stringify(manuscript(text, []))))), manuscript(text, []));
  }
});

test('reject the complete file on every schema/offset/content failure with a specific reason', () => {
  const cases = [
    ['{', /JSON/], ['null', /format/], ['[]', /format/], ['{}', /format/],
    [{ ...manuscript(), format: 'other' }, /format/],
    [{ ...manuscript(), version: 2 }, /version/],
    [{ ...manuscript(), version: '1' }, /version/],
    [{ ...manuscript(), text: null }, /本文/],
    [{ ...manuscript(), annotations: {} }, /配列/],
    [manuscript('本文', [null]), /オブジェクト/],
    ...[-1, .5, 3, '1', Number.MAX_SAFE_INTEGER + 1].map(offset => [manuscript('本文', [{ offset, text: 'よみ' }]), /整数/]),
    [manuscript('𠮷', [{ offset: 1, text: 'よみ' }]), /境界/],
    [manuscript('か\u3099', [{ offset: 1, text: 'よみ' }]), /境界/],
    [manuscript('👩‍👩‍👧‍👦', [{ offset: 2, text: 'よみ' }]), /境界/],
    [manuscript('\r\n', [{ offset: 1, text: 'よみ' }]), /境界/],
    ...['', '　 ', 'a\nb', 'a\rb', 'a\u2028b', 'a\u2029b', null, 123].map(text => [manuscript('本文', [{ offset: 1, text }]), /改行/]),
    [manuscript('本文', [{ offset: 1, text: 'よみ' }, { offset: 1, text: '重複' }]), /重複/],
    [manuscript('本文', [{ offset: 1, text: '正常' }, { offset: 1.5, text: '不正' }]), /2件目/]
  ];
  const current = Model.fromJSON(JSON.stringify(manuscript()));
  const before = JSON.stringify(current);
  for (const [data, reason] of cases) {
    assert.throws(() => Model.fromJSON(typeof data === 'string' ? data : JSON.stringify(data)), reason);
    assert.equal(JSON.stringify(current), before);
  }
});
