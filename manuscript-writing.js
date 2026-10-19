/* Writing stays separate from the original text/ruby model. Only confirmed
 * items enter manuscript JSON; history, transient gestures and DOM never do. */
(() => {
  const copy = value => structuredClone(value);
  window.ManuscriptMarks = class {
    static MAX_MARKS = 1000;
    static MAX_POINTS = 2000;
    static MAX_TOTAL_POINTS = 100000;
    static MAX_COORDINATE = 1000;
    static MARKER_COLORS = ['yellow', 'lightblue', 'pink'];
    constructor(source = '') { this.source = source; this.items = []; this.history = []; this.nextId = 1; }
    get hasMarks() { return this.items.length > 0; }
    remember() { this.history.push(copy(this.items)); if (this.history.length > 40) this.history.shift(); }
    add(item) {
      const used = new Set(this.items.map(mark => mark.id));
      while (used.has(this.nextId)) this.nextId = this.nextId === Number.MAX_SAFE_INTEGER ? 1 : this.nextId + 1;
      this.remember(); this.items.push({ ...copy(item), id: this.nextId });
      this.nextId = this.nextId === Number.MAX_SAFE_INTEGER ? 1 : this.nextId + 1;
    }
    remove(id) { if (!this.items.some(item => item.id === id)) return; this.remember(); this.items = this.items.filter(item => item.id !== id); }
    editMemo(id, text) {
      const item = this.items.find(item => item.id === id && item.type === 'memo');
      if (!item || item.text === text) return;
      this.remember(); item.text = text;
    }
    undo() { if (this.history.length) this.items = this.history.pop(); }
    static fromItems(items, manuscript) {
      if (!Array.isArray(items)) throw new Error('marksは配列である必要があります。');
      if (items.length > this.MAX_MARKS) throw new Error('書き込みは1,000件までです。');
      const restored = new this(manuscript.source), ids = new Set(), visible = new Set();
      if (!items.length) return restored;
      const boundaries = [...manuscript.boundaries];
      for (let i = 0; i < boundaries.length - 1; i++) {
        if (manuscript.source.slice(boundaries[i], boundaries[i + 1]).trim()) visible.add(boundaries[i]);
      }
      let total = 0, maxId = 0;
      const object = (value, fields, label) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}オブジェクトで指定してください。`);
        if (Object.keys(value).some(key => !fields.includes(key))) throw new Error(`${label}未対応のフィールドがあります。`);
      };
      const position = value => Number.isSafeInteger(value) && manuscript.boundaries.has(value);
      const anchor = (value, label) => { if (!position(value) || !visible.has(value)) throw new Error(`${label}offsetは本文の文字の先頭に一致する必要があります。`); };
      const coordinates = (value, fields, label) => {
        object(value, fields, label);
        for (const axis of ['x', 'y']) if (!Number.isFinite(value[axis]) || Math.abs(value[axis]) > this.MAX_COORDINATE) throw new Error(`${label}相対座標は±1,000以内の有限数にしてください。`);
        return { x: value.x, y: value.y };
      };
      for (const [index, item] of items.entries()) {
        const label = `書き込み${index + 1}件目：`;
        const fields = {
          pen: ['id', 'type', 'offset', 'layoutKey', 'points', 'witnesses'],
          marker: ['id', 'type', 'start', 'end', 'color'], memo: ['id', 'type', 'offset', 'dx', 'dy', 'text']
        };
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.type !== 'string' || !Object.hasOwn(fields, item.type)) throw new Error(`${label}書き込み種類が不正です。`);
        object(item, fields[item.type], label);
        if (!Number.isSafeInteger(item.id) || item.id < 1) throw new Error(`${label}IDは正の安全な整数にしてください。`);
        if (ids.has(item.id)) throw new Error(`${label}書き込みIDが重複しています。`);
        ids.add(item.id); maxId = Math.max(maxId, item.id);
        const base = { id: item.id, type: item.type };
        if (item.type === 'marker') {
          if (!position(item.start) || !position(item.end) || item.start >= item.end) throw new Error(`${label}マーカーの範囲が不正、または文字境界に一致しません。`);
          if (Object.hasOwn(item, 'color') && !this.MARKER_COLORS.includes(item.color)) throw new Error(`${label}マーカーの色はyellow・lightblue・pinkのいずれかにしてください。`);
          restored.items.push({ ...base, start: item.start, end: item.end, ...(Object.hasOwn(item, 'color') ? { color: item.color } : {}) });
        } else {
          anchor(item.offset, label);
          if (item.type === 'memo') {
            coordinates({ x: item.dx, y: item.dy }, ['x', 'y'], label);
            if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 40 || /[\r\n\u2028\u2029]/u.test(item.text)) throw new Error(`${label}メモは空白だけでない、改行を含まない40 UTF-16文字以内の文字列にしてください。`);
            restored.items.push({ ...base, offset: item.offset, dx: item.dx, dy: item.dy, text: item.text });
          } else {
            if (typeof item.layoutKey !== 'string' || item.layoutKey.length > 100 || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?:\d+:\d+$/.test(item.layoutKey)) throw new Error(`${label}赤ペンのlayoutKeyが不正です。`);
            const [columns, height, breaks, hash] = item.layoutKey.split(':').map(Number);
            if (!(columns > 0 && columns <= 10000 && height > 0 && height <= 10 && Number.isSafeInteger(breaks) && breaks <= 100 && Number.isSafeInteger(hash) && hash <= 0xffffffff)) throw new Error(`${label}赤ペンのlayoutKeyが範囲外です。`);
            if (!Array.isArray(item.points) || item.points.length < 2 || item.points.length > this.MAX_POINTS) throw new Error(`${label}赤ペンの点列は2〜2,000点にしてください。`);
            if (!Array.isArray(item.witnesses) || !item.witnesses.length || item.witnesses.length > this.MAX_POINTS) throw new Error(`${label}赤ペンの補助位置は1〜2,000件にしてください。`);
            total += item.points.length + item.witnesses.length;
            if (total > this.MAX_TOTAL_POINTS) throw new Error('赤ペンの点と補助位置は原稿全体で100,000件までです。');
            const points = item.points.map(p => coordinates(p, ['x', 'y'], label));
            if (!points.some(p => p.x !== points[0].x || p.y !== points[0].y)) throw new Error(`${label}赤ペンの点列に長さがありません。`);
            const seen = new Set();
            const witnesses = item.witnesses.map(w => {
              const point = coordinates(w, ['offset', 'x', 'y'], label); anchor(w.offset, label);
              if (seen.has(w.offset)) throw new Error(`${label}補助位置のoffsetが重複しています。`);
              seen.add(w.offset); return { offset: w.offset, ...point };
            });
            if (!witnesses.some(w => w.offset === item.offset && w.x === 0 && w.y === 0)) throw new Error(`${label}赤ペンの基準位置に対応する補助情報がありません。`);
            restored.items.push({ ...base, offset: item.offset, layoutKey: item.layoutKey, points, witnesses });
          }
        }
      }
      restored.nextId = maxId === Number.MAX_SAFE_INTEGER ? 1 : maxId + 1;
      return restored;
    }
    static restoreManuscript(json) {
      const data = window.ReadingAnnotations.parseJSON(json);
      const manuscript = window.ReadingAnnotations.fromData(data);
      if (data.version < 3 && data.marks !== undefined && (!Array.isArray(data.marks) || data.marks.length)) throw new Error('書き込みを含む原稿はversion 3で指定してください。');
      const markings = this.fromItems(data.version === 3 ? data.marks : [], manuscript);
      return { manuscript, markings };
    }
    static serializeManuscript(manuscript, markings) {
      if (manuscript.source !== markings.source) throw new Error('本文と書き込みの原文が一致しません。本文を確認してから保存してください。');
      const validated = window.ReadingAnnotations.fromData(manuscript.toJSON());
      const marks = this.fromItems(markings.items, validated).items;
      const json = JSON.stringify({ ...validated.toJSON(), version: 3, marks }, null, 2);
      if (json.length > window.ReadingAnnotations.MAX_FILE_BYTES || new TextEncoder().encode(json).length > window.ReadingAnnotations.MAX_FILE_BYTES) throw new Error('原稿ファイルは10MiBまでです。');
      return json;
    }
  };
  const $ = id => document.getElementById(id);
  const root = $('reader'), stage = $('reader-stage'), toolbar = $('writing-toolbar');
  const markers = $('writing-markers'), pens = $('writing-pen'), memos = $('writing-memos');
  const editor = $('writing-memo-dialog'), input = $('writing-memo-input');
  let model = null, editable = true, enabled = false, tool = 'pen', markerColor = 'yellow', gesture = null, draftMemo = null, rendering = false;
  let paintedPens = [], paintedMarkers = [];
  const help = {
    pen: '本文付近をドラッグして赤い線。スクロールは「書き込みOFF」で。',
    marker: '最初の文字から最後の文字へなぞって強調。スクロールは「書き込みOFF」で。',
    memo: '本文付近をタップしてメモ。右のメモをタップすると編集できます。',
    eraser: '線・マーカー・メモをタップすると、その書き込みを削除します。'
  };
  const svg = (name, attributes, parent) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value)); parent.append(el); return el;
  };
  const localPoint = e => {
    const rect = root.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const center = glyph => ({ x: glyph.x + glyph.width / 2, y: glyph.y + glyph.height / 2 });
  function nearest(point, geometry, max = 3) {
    let best = null, distance = max * geometry.fontSize;
    for (const glyph of geometry.glyphs) {
      const dx = Math.max(glyph.x - point.x, 0, point.x - glyph.x - glyph.width);
      const dy = Math.max(glyph.y - point.y, 0, point.y - glyph.y - glyph.height);
      const d = Math.hypot(dx, dy);
      if (d < distance) { best = glyph; distance = d; }
    }
    return best;
  }
  function rectangles(start, end, geometry) {
    const result = [];
    for (const glyph of geometry.glyphs) {
      if (glyph.end <= start || glyph.start >= end) continue;
      const last = result.at(-1);
      if (last && Math.abs(last.y - glyph.y) < 2 && Math.abs(last.height - glyph.height) < 2 && glyph.x >= last.x && glyph.x - last.x - last.width < geometry.fontSize * 1.1) {
        last.width = Math.max(last.width, glyph.x + glyph.width - last.x);
      } else result.push({ x: glyph.x, y: glyph.y, width: glyph.width, height: glyph.height });
    }
    return result;
  }
  function releaseGesture() {
    const previous = gesture; gesture = null;
    if (previous && stage.hasPointerCapture(previous.id)) stage.releasePointerCapture(previous.id);
  }
  function cancelPending() {
    releaseGesture(); draftMemo = null;
    if (editor.open) editor.close();
    render();
  }
  function controls() {
    toolbar.hidden = !enabled;
    $('writing-mode').setAttribute('aria-pressed', String(enabled));
    $('writing-mode').textContent = `書き込み：${enabled ? 'ON' : 'OFF'}`;
    stage.classList.toggle('writing-active', enabled);
    stage.classList.toggle('writing-drag', enabled && tool !== 'memo');
    document.querySelectorAll('[data-writing-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.writingTool === tool)));
    $('marker-colors').hidden = !enabled || tool !== 'marker';
    document.querySelectorAll('[data-marker-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.markerColor === markerColor)));
    if ($('writing-tool-help').textContent !== help[tool]) $('writing-tool-help').textContent = help[tool];
    $('writing-undo').disabled = !editable || !model?.history.length;
  }
  function setMode(on) {
    if (on && !editable) return;
    const anchor = window.Reader.capture();
    cancelPending(); enabled = Boolean(model && on);
    if (enabled) window.Reader.setRubyMode(false);
    controls(); render(); window.Reader.restore(anchor);
  }
  function strokePoints(item, geometry) {
    const glyph = geometry.byOffset.get(item.offset);
    if (!glyph) return null;
    const origin = center(glyph), font = geometry.fontSize;
    const xs = item.points.map(p => p.x), ys = item.points.map(p => p.y);
    const complex = Math.max(...xs) - Math.min(...xs) > 2.5 || Math.max(...ys) - Math.min(...ys) > .9;
    if (complex && item.layoutKey !== geometry.layoutKey) return null;
    // Witnesses are original characters near the line as it was drawn. If
    // their relative positions change after rewrapping, keep the stroke data
    // but hide it rather than point at unrelated words.
    for (const witness of item.witnesses) {
      const current = geometry.byOffset.get(witness.offset);
      if (!current) return null;
      const c = center(current);
      if (Math.hypot((c.x - origin.x) / font - witness.x, (c.y - origin.y) / font - witness.y) > .7) return null;
    }
    return item.points.map(p => ({ x: origin.x + p.x * font, y: origin.y + p.y * font }));
  }
  function render() {
    if (rendering || document.body.classList.contains('manuscript-printing')) return;
    rendering = true;
    try {
      const reserve = Boolean(model?.items.some(item => item.type === 'memo'));
      if (stage.classList.contains('has-writing-memos') !== reserve) {
        const anchor = window.Reader.capture(); stage.classList.toggle('has-writing-memos', reserve);
        window.Reader.refresh(anchor);
      }
      markers.replaceChildren(); pens.replaceChildren(); memos.replaceChildren();
      paintedPens = []; paintedMarkers = [];
      if (!reserve) stage.style.minHeight = '';
      controls();
      if (!model || root.closest('[hidden]')) { $('writing-status').hidden = true; return; }
      let hidden = 0;
      if (model.items.length || gesture) {
        const geometry = window.Reader.getWritingGeometry(), rect = root.getBoundingClientRect(), outer = stage.getBoundingClientRect();
        const ox = rect.left - outer.left, oy = rect.top - outer.top;
        const markerGroup = svg('g', { transform: `translate(${ox} ${oy})` }, markers);
        const penGroup = svg('g', { transform: `translate(${ox} ${oy})` }, pens);
        const items = [...model.items];
        if (gesture?.preview) items.push(gesture.preview);
        const noteItems = [];
        for (const item of items) {
          if (item.type === 'marker') {
            const boxes = rectangles(item.start, item.end, geometry);
            for (const box of boxes) svg('rect', { ...box, rx: 2, 'data-mark-id': item.id ?? 'draft', 'data-start': item.start, 'data-end': item.end, 'data-color': item.color ?? 'yellow' }, markerGroup);
            paintedMarkers.push({ id: item.id, boxes });
          } else if (item.type === 'pen') {
            const points = strokePoints(item, geometry);
            if (!points) { hidden++; continue; }
            svg('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '), 'data-mark-id': item.id ?? 'draft', 'data-offset': item.offset }, penGroup);
            paintedPens.push({ id: item.id, points });
          } else {
            const glyph = geometry.byOffset.get(item.offset);
            if (glyph) noteItems.push({ item, glyph });
          }
        }
        noteItems.sort((a, b) => a.glyph.y - b.glyph.y || a.item.id - b.item.id);
        let bottom = 0;
        for (const { item, glyph } of noteItems) {
          const button = document.createElement(editable ? 'button' : 'div');
          button.className = `writing-memo${editable ? '' : ' writing-memo-readonly'}`; button.dataset.markId = item.id;
          button.textContent = item.text;
          if (editable) {
            button.type = 'button';
            button.setAttribute('aria-label', `文字メモ「${item.text}」を${tool === 'eraser' ? '削除' : '編集'}`);
            button.disabled = !enabled || !['memo', 'eraser'].includes(tool);
          }
          button.style.left = `${Math.min(outer.width - 112, Math.max(ox + rect.width + 4, ox + glyph.x + item.dx * geometry.fontSize))}px`;
          button.style.top = `${Math.max(bottom, oy + glyph.y + item.dy * geometry.fontSize)}px`;
          if (editable) button.onclick = () => {
            if (!enabled || !editable) return;
            if (tool === 'eraser') { model.remove(item.id); render(); }
            else if (tool === 'memo') openMemo(item);
          };
          memos.append(button); bottom = parseFloat(button.style.top) + button.getBoundingClientRect().height + 6;
        }
        stage.style.minHeight = bottom ? `${Math.ceil(bottom + 16)}px` : '';
      } else stage.style.minHeight = '';
      const message = hidden ? `折り返しの変化により赤ペン${hidden}件を一時非表示にしています。${editable ? 'これらはPDFに含まれません。' : ''}元の配置に戻すと再表示します。` : '';
      const status = $('writing-status'), hide = !hidden;
      if (status.hidden !== hide || status.textContent !== message) {
        const anchor = window.Reader.capture(), height = status.getBoundingClientRect().height;
        status.hidden = hide; status.textContent = message;
        if (Math.abs(status.getBoundingClientRect().height - height) > .5) window.Reader.restore(anchor);
      }
    } finally { rendering = false; }
  }
  function fitEditor() {
    const viewport = window.visualViewport, height = viewport?.height || innerHeight;
    editor.style.setProperty('--editor-center', `${(viewport?.offsetTop || 0) + height / 2}px`);
    editor.style.setProperty('--editor-height', `${Math.max(120, height - 24)}px`);
  }
  function openMemo(item) {
    if (!editable || !enabled) return;
    draftMemo = { ...item }; input.value = item.text || '';
    $('writing-memo-delete').hidden = !item.id;
    $('writing-memo-save').disabled = !input.value.trim();
    fitEditor(); editor.showModal(); input.focus({ preventScroll: true });
  }
  const distanceToSegment = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  function erase(point) {
    const ids = new Set();
    for (const pen of paintedPens) if (pen.points.some((p, i) => i && distanceToSegment(point, pen.points[i - 1], p) < 10)) ids.add(pen.id);
    for (const marker of paintedMarkers) if (marker.boxes.some(r => point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height)) ids.add(marker.id);
    const target = model.items.findLast(item => ids.has(item.id));
    if (target) { model.remove(target.id); render(); }
  }
  function updateStroke(point) {
    const g = window.Reader.getWritingGeometry(), origin = gesture.origin, font = g.fontSize;
    const points = gesture.preview.points, last = points.at(-1), next = { x: (point.x - origin.x) / font, y: (point.y - origin.y) / font };
    if (Math.hypot(next.x - last.x, next.y - last.y) * font < 2) return;
    points.push(next);
    if (points.length > 2000) gesture.preview.points = points.filter((_, i) => i % 2 === 0 || i === points.length - 1);
    const witness = nearest(point, g);
    if (witness && !gesture.preview.witnesses.some(w => w.offset === witness.start)) {
      const c = center(witness); gesture.preview.witnesses.push({ offset: witness.start, x: (c.x - origin.x) / font, y: (c.y - origin.y) / font });
    }
  }
  stage.addEventListener('pointerdown', e => {
    if (!enabled || !editable) return;
    if (!e.isPrimary) { releaseGesture(); render(); return; }
    if (e.button !== 0 || e.target.closest('.writing-memo') || editor.open) return;
    if ([...memos.children].some(note => {
      const r = note.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    })) return;
    const geometry = window.Reader.getWritingGeometry(), point = localPoint(e), glyph = nearest(point, geometry);
    if (!glyph && tool !== 'eraser') return;
    if (tool !== 'memo') e.preventDefault();
    gesture = { id: e.pointerId, first: point, glyph, scroll: scrollY, moved: false };
    stage.setPointerCapture(e.pointerId);
    if (tool === 'pen') {
      gesture.origin = center(glyph);
      gesture.preview = { type: 'pen', offset: glyph.start, layoutKey: geometry.layoutKey, points: [{ x: (point.x - gesture.origin.x) / geometry.fontSize, y: (point.y - gesture.origin.y) / geometry.fontSize }], witnesses: [{ offset: glyph.start, x: 0, y: 0 }] };
    }
    if (tool === 'marker') gesture.preview = { type: 'marker', start: glyph.start, end: glyph.end, color: markerColor };
    render();
  });
  stage.addEventListener('pointermove', e => {
    if (!editable || !gesture || gesture.id !== e.pointerId) return;
    const point = localPoint(e);
    if (Math.hypot(point.x - gesture.first.x, point.y - gesture.first.y) > 8) gesture.moved = true;
    if (tool === 'pen') updateStroke(point);
    if (tool === 'marker') {
      const end = nearest(point, window.Reader.getWritingGeometry());
      if (end) gesture.preview = { type: 'marker', start: Math.min(gesture.glyph.start, end.start), end: Math.max(gesture.glyph.end, end.end), color: markerColor };
    }
    if (tool === 'pen' || tool === 'marker') render();
  });
  stage.addEventListener('pointerup', e => {
    if (!editable || !gesture || gesture.id !== e.pointerId) return;
    const point = localPoint(e);
    if (Math.hypot(point.x - gesture.first.x, point.y - gesture.first.y) > 8) gesture.moved = true;
    if (tool === 'pen') updateStroke(point);
    if (tool === 'marker') {
      const last = nearest(point, window.Reader.getWritingGeometry());
      if (last) gesture.preview = { type: 'marker', start: Math.min(gesture.glyph.start, last.start), end: Math.max(gesture.glyph.end, last.end), color: markerColor };
    }
    const completed = gesture; releaseGesture();
    if (tool === 'pen' && completed.preview.points.length > 1) model.add(completed.preview);
    if (tool === 'marker') model.add(completed.preview);
    if (!completed.moved && Math.abs(scrollY - completed.scroll) < 2) {
      if (tool === 'memo') openMemo({ type: 'memo', offset: completed.glyph.start, dx: .4, dy: 0, text: '' });
      if (tool === 'eraser') erase(point);
    }
    render();
  });
  stage.addEventListener('pointercancel', () => { releaseGesture(); render(); });
  stage.addEventListener('lostpointercapture', () => { if (gesture) { gesture = null; render(); } });
  document.querySelectorAll('[data-writing-tool]').forEach(button => button.onclick = () => { if (!editable) return; cancelPending(); tool = button.dataset.writingTool; controls(); render(); });
  document.querySelectorAll('[data-marker-color]').forEach(button => button.onclick = () => { if (!editable) return; cancelPending(); markerColor = button.dataset.markerColor; controls(); render(); });
  $('writing-off').onclick = () => setMode(false);
  $('writing-undo').onclick = () => { if (!editable) return; cancelPending(); model?.undo(); render(); };
  input.addEventListener('input', () => { $('writing-memo-save').disabled = !input.value.trim(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault(); });
  $('writing-memo-form').addEventListener('submit', e => {
    e.preventDefault(); const text = input.value.trim();
    if (!editable || !enabled || !draftMemo || !text || text.length > 40 || /[\r\n\u2028\u2029]/u.test(text)) return;
    if (draftMemo.id) model.editMemo(draftMemo.id, text); else model.add({ ...draftMemo, text });
    cancelPending();
  });
  $('writing-memo-delete').onclick = () => { if (!editable) return; if (draftMemo?.id) model.remove(draftMemo.id); cancelPending(); };
  $('writing-memo-cancel').onclick = cancelPending;
  editor.addEventListener('cancel', e => { e.preventDefault(); cancelPending(); });
  editor.addEventListener('close', () => { draftMemo = null; });
  window.visualViewport?.addEventListener('resize', fitEditor);
  window.visualViewport?.addEventListener('scroll', fitEditor);
  root.addEventListener('reader-layout', () => { releaseGesture(); render(); });
  root.addEventListener('reader-ruby-mode', e => { if (e.detail) setMode(false); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPending(); });
  addEventListener('scroll', () => {
    if (gesture && Math.abs(scrollY - gesture.scroll) > 2) { releaseGesture(); render(); }
  }, { passive: true });
  // Printing temporarily hides the live reader. Do not measure or reposition
  // overlays against its zero-size boxes; repaint once the normal page returns.
  addEventListener('afterprint', () => requestAnimationFrame(render));
  matchMedia('print').addEventListener('change', e => { if (!e.matches) requestAnimationFrame(render); });
  window.ManuscriptWriting = {
    printSnapshot() {
      if (!model) return { source: '', items: [], pens: [], hiddenPens: 0 };
      const geometry = window.Reader.getWritingGeometry(), pens = [];
      let hiddenPens = 0;
      // Reuse exactly the live stroke visibility/anchor rules; pending gestures
      // and memo edits live outside items and are deliberately not exported.
      for (const item of model.items) if (item.type === 'pen') {
        const points = strokePoints(item, geometry);
        if (points) pens.push({ id: item.id, points }); else hiddenPens++;
      }
      return { source: model.source, items: copy(model.items), pens, hiddenPens };
    },
    show(next, options = {}) { cancelPending(); model = next; editable = options.editable !== false; enabled = false; controls(); render(); },
    leave() { cancelPending(); enabled = false; model = null; controls(); render(); },
    setMode, cancelPending,
    get hasMarks() { return Boolean(model?.hasMarks); },
    get hasPens() { return Boolean(model?.items.some(item => item.type === 'pen')); },
    get enabled() { return enabled; }
  };
})();
