'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'aozora-works.js'), 'utf8'), context);
const { authors, works } = context.window.AOZORA_WORKS;
const urlFor = w => 'https://www.aozora.gr.jp/cards/' + (w[6] || authors[w[2]][0]) +
  '/card' + Number(w[0]) + '.html';

test('共著・別名義の作品に青空文庫公式の図書カードURLを使う', () => {
  const cases = [
    ['001152', 'https://www.aozora.gr.jp/cards/000077/card1152.html'],
    ['047057', 'https://www.aozora.gr.jp/cards/001138/card47057.html'],
    ['060788', 'https://www.aozora.gr.jp/cards/002176/card60788.html'],
  ];
  for (const [id, expected] of cases) {
    const work = works.find(w => w[0] === id);
    assert.ok(work, id + ' が収録されている');
    assert.equal(urlFor(work), expected);
  }
});

test('収録作品の図書カードURL形式と補正IDが整合する', () => {
  assert.ok(works.length > 10000);
  const seen = new Set();
  let overrideCount = 0;
  for (const w of works) {
    assert.ok(w.length === 6 || w.length === 7, 'work ID: ' + w[0]);
    assert.ok(Number.isInteger(w[2]) && w[2] >= 0 && w[2] < authors.length);
    assert.ok(!seen.has(w[0]), '作品IDの重複: ' + w[0]);
    seen.add(w[0]);
    assert.match(urlFor(w), /^https:\/\/www\.aozora\.gr\.jp\/cards\/\d{6}\/card\d+\.html$/);
    if (w.length === 7) {
      assert.match(w[6], /^\d{6}$/);
      assert.notEqual(w[6], authors[w[2]][0]);
      overrideCount++;
    }
  }
  assert.ok(overrideCount > 0, '補正IDが消失していないこと');
});

function renderedUrlsFor(id) {
  const selected = works.find(w => w[0] === id);
  assert.ok(selected);
  class Element {
    constructor(tagName) { this.tagName = tagName; this.children = []; this.listeners = {}; this.value = ''; this.hidden = false; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    setAttribute() {}
    dispatch(name) { this.listeners[name]({ target: this }); }
  }
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element('div'));
    return elements.get(id);
  };
  const document = {
    getElementById: get,
    querySelectorAll: () => [],
    createElement: tag => new Element(tag),
    head: { appendChild: script => script.onload() },
  };
  get('ws-minutes').value = 15;
  const window = { AOZORA_WORKS: context.window.AOZORA_WORKS };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'work-search.js'), 'utf8'), { document, window });
  window.WorkSearch.open({ speed: selected[4] / 14, hasHistory: true });
  get('ws-modern-only').checked = false;
  get('ws-modern-only').dispatch('change');
  get('ws-query').value = selected[1];
  get('ws-query').dispatch('input');
  return get('ws-list').children.flatMap(li => li.children.filter(child => child.tagName === 'a'))
    .filter(link => link.textContent === selected[1]).map(link => link.href);
}

test('検索結果の画面リンクが補正後URLを指す', () => {
  assert.ok(renderedUrlsFor('001152').includes('https://www.aozora.gr.jp/cards/000077/card1152.html'));
  assert.ok(renderedUrlsFor('047057').includes('https://www.aozora.gr.jp/cards/001138/card47057.html'));
});
