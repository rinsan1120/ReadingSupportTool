/* Versioned user files wrap the existing manuscript format without changing it. */
(() => {
  'use strict';
  const KEY = 'yomijitaku-user-v1', MAX_BYTES = 30 * 1024 * 1024;
  const empty = () => ({ format: 'yomijitaku-user', version: 1, profile: { name: '' }, manuscripts: [], activeId: null, history: [], target: '', plannedMinutes: '20' });
  function validate(data) {
    const fail = () => { throw new Error('ファイルの形式・内容が正しくありません。よみじたくのユーザーデータJSONかどうかを確認してください。'); };
    const string = (v, max) => typeof v === 'string' && v.length <= max;
    const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
    if (!data || data.format !== 'yomijitaku-user' || data.version !== 1 || !string(data.profile?.name, 80) ||
        !Array.isArray(data.manuscripts) || data.manuscripts.length > 500 || !Array.isArray(data.history) || data.history.length > 100 ||
        !string(data.target, 20) || !string(data.plannedMinutes, 30) ||
        (data.target !== '' && (!Number.isSafeInteger(Number(data.target)) || Number(data.target) <= 0 || Number(data.target) > 1e9)) ||
        !data.plannedMinutes.trim() || !Number.isFinite(Number(data.plannedMinutes)) || Number(data.plannedMinutes) <= 0) fail();
    const ids = new Set();
    const manuscripts = data.manuscripts.map(item => {
      if (!item || !string(item.id, 100) || !item.id || ids.has(item.id) || !string(item.title, 120) || !item.title.trim() ||
          !date(item.createdAt) || !date(item.updatedAt) || !string(item.draft, window.ReadingAnnotations.MAX_TEXT_LENGTH)) fail();
      ids.add(item.id);
      const restored = window.ManuscriptMarks.restoreManuscript(JSON.stringify(item.manuscript));
      const manuscript = JSON.parse(window.ManuscriptMarks.serializeManuscript(restored.manuscript, restored.markings));
      let pending = null;
      if (item.pending != null) {
        const model = window.ReadingAnnotations.fromData(item.pending);
        if (model.source.replace(/\r\n?/g, '\n') !== item.draft) fail();
        pending = model.toJSON();
      }
      return { id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, draft: item.draft, manuscript, pending };
    });
    if (data.activeId !== null && !ids.has(data.activeId)) fail();
    const history = data.history.map(r => {
      if (!r || !Number.isSafeInteger(r.characters) || r.characters <= 0 || !Number.isFinite(r.seconds) || r.seconds <= 0 ||
          !['sample', 'custom'].includes(r.type) || (r.measuredAt !== null && !date(r.measuredAt)) || !string(r.title, 120)) fail();
      return { characters: r.characters, seconds: r.seconds, type: r.type, measuredAt: r.measuredAt, title: r.title };
    });
    return { ...empty(), profile: { name: data.profile.name }, manuscripts, activeId: data.activeId, history, target: data.target, plannedMinutes: data.plannedMinutes };
  }
  function parse(json) {
    if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error('ファイルが大きすぎます（上限は約30MBです）。');
    return validate(JSON.parse(json));
  }
  window.UserLibrary = { KEY, MAX_BYTES, empty, parse, validate };
})();
