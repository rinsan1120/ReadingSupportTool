const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the actual app handlers without simulating unrelated reader/UI code.
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const handlers = app.slice(app.indexOf('  // Confirm an explicit replacement/deletion'), app.indexOf("  $('clear-read').onclick"));
assert.ok(handlers.includes('beforeinput'));

function setup(id) {
  const fields = Object.fromEntries(['read-text', 'time-text'].map(key => [key, {
    value: '日本語', selectionStart: 0, selectionEnd: 3, listeners: {}, inputs: 0,
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + text.length;
    },
    dispatchEvent(event) { if (event.type === 'input') this.inputs++; }
  }]));
  const questions = [];
  const context = {
    $: key => fields[key], view: 'input', library: { activeId: 'book-1' }, Event,
    replacementLoss: () => ' 読み仮名・書き込みは保持されます。',
    ask(message, action) { return new Promise(resolve => questions.push({ message, action, resolve })); }
  };
  vm.runInNewContext(handlers, context);
  const field = fields[id];
  function emit(type, props = {}) {
    const event = { inputType: 'insertText', data: 'あ', cancelable: true, isComposing: false,
      defaultPrevented: false,
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }, ...props };
    const done = Promise.all((field.listeners[type] || []).map(handler => handler(event)));
    return { event, done };
  }
  return { field, context, questions, emit };
}

for (const id of ['read-text', 'time-text']) {
  test(`${id}: native composition, prediction and non-cancelable edits are uninterrupted`, async () => {
    for (const props of [
      { inputType: 'insertCompositionText' },
      { inputType: 'deleteCompositionText' },
      { inputType: 'deleteByComposition' },
      { inputType: 'insertFromComposition' },
      { inputType: 'insertReplacementText', data: '日本語です' },
      { inputType: 'deleteContentBackward', isComposing: true },
      { inputType: 'insertText', isComposing: true },
      { inputType: 'deleteContentBackward', cancelable: false },
      { inputType: 'insertText', cancelable: false },
      { inputType: 'insertText', data: null },
      { inputType: 'insertFromPaste' },
      { inputType: 'historyUndo' },
      { inputType: 'historyRedo' }
    ]) {
      const { field, questions, emit } = setup(id);
      const { event, done } = emit('beforeinput', props);
      await done;
      assert.equal(event.defaultPrevented, false, JSON.stringify(props));
      assert.equal(questions.length, 0);
      assert.equal(field.value, '日本語');
      assert.equal(field.inputs, 0);
    }
  });

  test(`${id}: composition lifecycle protects events even without isComposing`, async () => {
    const { questions, emit } = setup(id);
    await emit('compositionstart').done;
    for (const inputType of ['deleteContentBackward', 'insertText', 'insertReplacementText']) {
      const edit = emit('beforeinput', { inputType });
      await edit.done;
      assert.equal(edit.event.defaultPrevented, false);
    }
    assert.equal(questions.length, 0);
    await emit('compositionend').done;
    const explicit = emit('beforeinput', { inputType: 'deleteContentBackward' });
    assert.equal(questions.length, 1);
    questions[0].resolve(false);
    await explicit.done;
  });

  test(`${id}: caret input, partial edits and empty text stay native`, async () => {
    for (const [value, start, end] of [['日本語', 1, 1], ['日本語', 0, 2], ['', 0, 0]]) {
      for (const inputType of ['insertText', 'deleteContentBackward', 'deleteContentForward']) {
        const { field, questions, emit } = setup(id);
        Object.assign(field, { value, selectionStart: start, selectionEnd: end });
        const edit = emit('beforeinput', { inputType });
        await edit.done;
        assert.equal(edit.event.defaultPrevented, false);
        assert.equal(questions.length, 0);
      }
    }
  });

  test(`${id}: explicit full deletion/replacement confirms, cancellation retains text`, async () => {
    for (const inputType of ['deleteContentBackward', 'deleteContentForward', 'deleteByCut',
      'deleteByDrag', 'deleteWordBackward', 'deleteContent', 'insertText']) {
      for (const approved of [false, true]) {
        const { field, questions, emit } = setup(id);
        const edit = emit('beforeinput', { inputType, data: 'ABC' });
        assert.equal(edit.event.defaultPrevented, true);
        assert.equal(questions.length, 1);
        assert.equal(field.value, '日本語');
        assert.equal(questions[0].action, inputType === 'insertText' ? '置き換える' : '削除する');
        if (id === 'read-text') assert.match(questions[0].message, /読み仮名・書き込み/);
        questions[0].resolve(approved);
        await edit.done;
        assert.equal(field.value, approved ? (inputType === 'insertText' ? 'ABC' : '') : '日本語');
        assert.equal(field.inputs, approved ? 1 : 0);
      }
    }
  });

  test(`${id}: pending confirmation cannot duplicate or apply to changed targets`, async () => {
    for (const change of [() => {}, s => { s.field.value = '変更済み'; },
      s => { s.context.view = 'home'; }, s => { s.context.library.activeId = 'book-2'; }]) {
      const s = setup(id);
      const first = s.emit('beforeinput', { inputType: 'deleteContentBackward' });
      const second = s.emit('beforeinput', { inputType: 'deleteContentBackward' });
      await second.done;
      assert.equal(second.event.defaultPrevented, true);
      assert.equal(s.questions.length, 1);
      change(s);
      const previous = s.field.value;
      s.questions[0].resolve(true);
      await first.done;
      const stale = s.context.view !== 'input' || s.context.library.activeId !== 'book-1' || previous !== '日本語';
      assert.equal(s.field.value, stale ? previous : '');
      assert.equal(s.field.inputs, stale ? 0 : 1);
    }
  });
}
