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
    constructor(source = '') { this.source = source; this.items = []; this.history = []; this.nextId = 1; this.memoSettings = { fontSize: 16, opacity: .9 }; }
    get hasMarks() { return this.items.length > 0; }
    remember() { this.history.push(copy(this.items)); if (this.history.length > 40) this.history.shift(); }
    add(item) {
      const used = new Set(this.items.map(mark => mark.id));
      while (used.has(this.nextId)) this.nextId = this.nextId === Number.MAX_SAFE_INTEGER ? 1 : this.nextId + 1;
      this.remember(); this.items.push({ ...copy(item), id: this.nextId });
      this.nextId = this.nextId === Number.MAX_SAFE_INTEGER ? 1 : this.nextId + 1;
    }
    remove(id) { if (!this.items.some(item => item.id === id)) return; this.remember(); this.items = this.items.filter(item => item.id !== id); }
    editMemo(id, text) { this.updateMemo(id, { text }); }
    updateMemo(id, changes) {
      const item = this.items.find(item => item.id === id && item.type === 'memo');
      if (!item || Object.entries(changes).every(([key, value]) => item[key] === value)) return;
      this.remember(); Object.assign(item, copy(changes));
    }
    static settings(value = { fontSize: 16, opacity: .9 }) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['fontSize', 'opacity'].includes(key)) ||
          !Number.isFinite(value.fontSize) || value.fontSize < 12 || value.fontSize > 28 ||
          !Number.isFinite(value.opacity) || value.opacity < .2 || value.opacity > 1) throw new Error('メモ設定は文字サイズ12〜28、不透明度0.2〜1で指定してください。');
      return { fontSize: value.fontSize, opacity: value.opacity };
    }
    undo() { if (this.history.length) this.items = this.history.pop(); }
    movePen(id, changes) {
      const index = this.items.findIndex(item => item.id === id && item.type === 'pen');
      if (index < 0) return;
      this.remember(); this.items[index] = copy(changes);
    }
    static fromItems(items, manuscript, settings) {
      if (!Array.isArray(items)) throw new Error('marksは配列である必要があります。');
      if (items.length > this.MAX_MARKS) throw new Error('書き込みは1,000件までです。');
      const restored = new this(manuscript.source), ids = new Set(), visible = new Set();
      restored.memoSettings = this.settings(settings);
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
          pen: ['id', 'type', 'offset', 'layoutKey', 'points', 'witnesses', 'fontSize'],
          marker: ['id', 'type', 'start', 'end', 'color'], memo: ['id', 'type', 'offset', 'dx', 'dy', 'tx', 'ty', 'color', 'text']
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
            coordinates({ x: item.tx, y: item.ty }, ['x', 'y'], label);
            if (!this.MARKER_COLORS.includes(item.color)) throw new Error(`${label}メモの色が不正です。`);
            if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 200) throw new Error(`${label}メモは空白だけでない200文字以内の文字列にしてください。`);
            restored.items.push({ ...base, offset: item.offset, dx: item.dx, dy: item.dy, tx: item.tx, ty: item.ty, color: item.color, text: item.text });
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
            // Older v3/v4 files did not record the drawing unit. Use the original
            // reader default so later font changes cannot resize those strokes.
            const fontSize = Object.hasOwn(item, 'fontSize') ? item.fontSize : 22;
            if (!Number.isFinite(fontSize) || fontSize < 1 || fontSize > 1000) throw new Error(`${label}赤ペンのfontSizeが不正です。`);
            restored.items.push({ ...base, offset: item.offset, layoutKey: item.layoutKey, fontSize, points, witnesses });
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
      // Legacy notes retain content and anchor with a simple approximate placement.
      const items = data.version >= 3 ? data.marks : [];
      const converted = data.version === 3 && Array.isArray(items) ? items.map(item => item?.type === 'memo' ? { ...item, tx: 0, ty: 0, color: 'yellow' } : item) : items;
      const markings = this.fromItems(converted, manuscript, data.version >= 4 ? data.memoSettings : undefined);
      return { manuscript, markings };
    }
    static serializeManuscript(manuscript, markings) {
      if (manuscript.source !== markings.source) throw new Error('本文と書き込みの原文が一致しません。本文を確認してから保存してください。');
      const validated = window.ReadingAnnotations.fromData(manuscript.toJSON());
      const marks = this.fromItems(markings.items, validated, markings.memoSettings).items;
      const json = JSON.stringify({ ...validated.toJSON(), version: 4, marks, memoSettings: this.settings(markings.memoSettings) }, null, 2);
      if (json.length > window.ReadingAnnotations.MAX_FILE_BYTES || new TextEncoder().encode(json).length > window.ReadingAnnotations.MAX_FILE_BYTES) throw new Error('原稿ファイルは10MiBまでです。');
      return json;
    }
  };
  const $ = id => document.getElementById(id);
  const root = $('reader'), stage = $('reader-stage'), toolbar = $('writing-toolbar');
  const markers = $('writing-markers'), pens = $('writing-pen'), memos = $('writing-memos');
  const editor = $('writing-memo-dialog'), input = $('writing-memo-input');
  let model = null, editable = true, enabled = false, tool = 'pen', markerColor = 'yellow', gesture = null, draftMemo = null, rendering = false;
  let selectedMemo = null, selectedPen = null;
  let paintedPens = [], paintedMarkers = [];
  const help = {
    pen: '本文付近をドラッグして赤い線。スクロールは「書き込みOFF」で。',
    move: '赤ペンをタップして選択し、ドラッグして一筆全体を移動。線以外の場所ではスクロールできます。',
    marker: '最初の文字から最後の文字へなぞって強調。スクロールは「書き込みOFF」で。',
    memo: '本文をタップして作成。本体・丸い足先をドラッグ。選択後にもう一度タップして編集。',
    ruby: '文字の前後をタップして読み仮名を追加。読み仮名を選ぶと編集できます。',
    eraser: '線・マーカーをタップして削除。メモはメモツールで選択して×から削除。'
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
    releaseGesture(); draftMemo = null; selectedMemo = null; selectedPen = null;
    if (editor.open) editor.close();
    if ($('memo-settings-dialog').open) $('memo-settings-dialog').close();
    render();
  }
  function controls() {
    toolbar.hidden = !enabled;
    $('writing-mode').setAttribute('aria-pressed', String(enabled));
    $('writing-mode').querySelector('.button-state').textContent = enabled ? 'ON' : 'OFF';
    $('writing-mode').setAttribute('aria-label', `書き込み：${enabled ? 'ON' : 'OFF'}`);
    const controls = document.querySelector('.reader-controls');
    const changed = controls.classList.contains('is-writing') !== enabled;
    controls.classList.toggle('is-writing', enabled);
    ['export-pdf', 'measure-current', 'writing-mode'].forEach(id => { $(id).hidden = enabled || !editable; });
    if (changed) stage.dispatchEvent(new CustomEvent('reader-writing-mode', { bubbles: true }));
    stage.classList.toggle('writing-active', enabled);
    stage.classList.toggle('writing-drag', enabled && !['memo', 'ruby', 'move'].includes(tool));
    document.querySelectorAll('[data-writing-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.writingTool === tool)));
    const selected = model?.items.find(item => item.id === selectedMemo);
    $('marker-colors').hidden = !enabled || !['marker', 'memo'].includes(tool);
    // Keep the toolbar's height stable when selecting a note during a drag.
    $('marker-colors').style.visibility = tool === 'memo' && !selected ? 'hidden' : '';
    $('marker-colors').setAttribute('aria-label', tool === 'memo' ? 'メモの色' : 'マーカーの色');
    $('memo-settings-open').hidden = !enabled || tool !== 'memo';
    document.querySelectorAll('[data-marker-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.markerColor === (tool === 'memo' ? selected?.color : markerColor))));
    if ($('writing-tool-help').textContent !== help[tool]) $('writing-tool-help').textContent = help[tool];
    $('writing-undo').disabled = !editable || !model?.history.length;
  }
  function setMode(on) {
    if (on && !editable) return;
    const anchor = window.Reader.capture();
    cancelPending(); window.Reader.setRubyMode(false); enabled = Boolean(model && on);
    if (!enabled && tool === 'ruby') tool = 'pen';
    controls(); render(); window.Reader.restore(anchor);
  }
  function strokePoints(item, geometry) {
    const glyph = geometry.byOffset.get(item.offset);
    if (!glyph) return null;
    const origin = center(glyph), font = item.fontSize ?? 22;
    // One rigid translation follows the anchor. Rewrapping never reshapes or
    // edits stored points, even for strokes spanning several lines.
    return item.points.map(p => ({ x: origin.x + p.x * font, y: origin.y + p.y * font }));
  }
  // Shared screen/PDF renderer: tail, background and ink share one opacity.
  function bubble(item, settings, x, y, tx, ty, parent, scale = 1) {
    const note = document.createElement('div'); note.className = 'writing-memo'; note.dataset.markId = item.id;
    Object.assign(note.style, { left: `${x}px`, top: `${y}px`, fontSize: `${settings.fontSize}px`, opacity: settings.opacity });
    if (scale !== 1) Object.assign(note.style, { transform: `scale(${scale})`, transformOrigin: '0 0' });
    note.dataset.color = item.color;
    const tail = svg('svg', { class: 'memo-tail', width: 1, height: 1, 'aria-hidden': 'true' }, note);
    const text = document.createElement('div'); text.className = 'memo-body'; text.textContent = item.text; note.append(text); parent.append(note);
    const width = note.offsetWidth, height = note.offsetHeight;
    // Placement uses output pixels; the tail is drawn inside the scaled body.
    const ex = (tx - x) / scale, ey = (ty - y) / scale;
    const sx = Math.max(0, Math.min(width, ex)), sy = Math.max(0, Math.min(height, ey));
    svg('path', { d: `M${sx},${sy} L${ex},${ey}` }, tail);
    const handle = svg('svg', { class: 'memo-tip-layer', width: 1, height: 1, 'aria-hidden': 'true' }, note);
    svg('circle', { cx: ex, cy: ey, r: 5, class: 'memo-tip' }, handle);
    return note;
  }
  function render() {
    if (rendering || document.body.classList.contains('manuscript-printing')) return;
    rendering = true;
    try {
      markers.replaceChildren(); pens.replaceChildren(); memos.replaceChildren();
      paintedPens = []; paintedMarkers = [];
      controls();
      if (!model || root.closest('[hidden]')) { stage.style.minHeight = ''; return; }
      if (model.items.length || gesture) {
        const geometry = window.Reader.getWritingGeometry(), rect = root.getBoundingClientRect(), outer = stage.getBoundingClientRect();
        const ox = rect.left - outer.left, oy = rect.top - outer.top;
        const markerGroup = svg('g', { transform: `translate(${ox} ${oy})` }, markers);
        const penGroup = svg('g', { transform: `translate(${ox} ${oy})` }, pens);
        const items = model.items.map(item => gesture?.memo?.id === item.id ? gesture.preview : item);
        if (gesture?.preview && !gesture.memo && !gesture.pen) items.push(gesture.preview);
        const noteItems = []; let bottom = 0;
        for (const item of items) {
          if (item.type === 'marker') {
            const boxes = rectangles(item.start, item.end, geometry);
            for (const box of boxes) svg('rect', { ...box, rx: 2, 'data-mark-id': item.id ?? 'draft', 'data-start': item.start, 'data-end': item.end, 'data-color': item.color ?? 'yellow' }, markerGroup);
            paintedMarkers.push({ id: item.id, boxes });
          } else if (item.type === 'pen') {
            let points = strokePoints(item, geometry);
            if (!points) continue; // An anchor beyond a timing excerpt is not displayed.
            if (gesture?.pen && gesture.pen.id === item.id) points = gesture.points.map(p => ({ x: p.x + gesture.dx, y: p.y + gesture.dy }));
            const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
            const active = editable && enabled && tool === 'move';
            if (active && selectedPen === item.id) svg('path', { d, class: 'pen-selection' }, penGroup);
            svg('path', { d, 'data-mark-id': item.id ?? 'draft', 'data-offset': item.offset }, penGroup);
            if (active) svg('path', { d, class: 'pen-hit', 'data-pen-id': item.id }, penGroup);
            paintedPens.push({ id: item.id, points });
            bottom = Math.max(bottom, oy + Math.max(...points.map(p => p.y)) + 12);
          } else {
            const glyph = geometry.byOffset.get(item.offset);
            if (glyph) noteItems.push({ item, glyph });
          }
        }
        for (const { item, glyph } of noteItems) {
          const origin = center(glyph), font = geometry.fontSize;
          const x = Math.max(0, Math.min(outer.width - 180, ox + origin.x + item.dx * font));
          const y = Math.max(0, oy + origin.y + item.dy * font);
          const note = bubble(item, model.memoSettings, x, y, ox + origin.x + item.tx * font, oy + origin.y + item.ty * font, memos);
          const active = editable && enabled && tool === 'memo';
          note.classList.toggle('memo-editable', active);
          note.classList.toggle('memo-selected', active && selectedMemo === item.id);
          if (active && selectedMemo === item.id) {
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'memo-remove';
            remove.textContent = '×'; remove.setAttribute('aria-label', 'このメモを削除'); note.append(remove);
          }
          bottom = Math.max(bottom, y + note.offsetHeight, oy + origin.y + item.ty * font + 12);
        }
        stage.style.minHeight = bottom ? `${Math.ceil(bottom + 16)}px` : '';
      } else stage.style.minHeight = '';
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
    $('writing-memo-delete').hidden = true;
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
  function updateMemoDrag(point) {
    const g = window.Reader.getWritingGeometry(), start = gesture.memo, original = center(g.byOffset.get(start.offset));
    const dx = point.x - gesture.first.x, dy = point.y - gesture.first.y, font = g.fontSize;
    if (gesture.part === 'body') {
      const box = stage.getBoundingClientRect(), rootBox = root.getBoundingClientRect();
      const x = Math.max(box.left - rootBox.left, Math.min(box.right - rootBox.left - 180, gesture.body.x + dx));
      const y = Math.max(box.top - rootBox.top, gesture.body.y + dy);
      gesture.preview = { ...start, dx: (x - original.x) / font, dy: (y - original.y) / font };
    } else {
      const tip = { x: original.x + start.tx * font + dx, y: original.y + start.ty * font + dy };
      const glyph = nearest(tip, g, Infinity), origin = glyph ? center(glyph) : original;
      gesture.preview = { ...start, offset: glyph?.start ?? start.offset,
        tx: (tip.x - origin.x) / font, ty: (tip.y - origin.y) / font,
        dx: (original.x + start.dx * font - origin.x) / font, dy: (original.y + start.dy * font - origin.y) / font };
    }
    for (const key of ['dx', 'dy', 'tx', 'ty']) gesture.preview[key] = Math.max(-1000, Math.min(1000, gesture.preview[key]));
  }
  function updatePenDrag(point) {
    gesture.dx = point.x - gesture.first.x; gesture.dy = point.y - gesture.first.y;
  }
  function commitPenMove(completed) {
    const g = window.Reader.getWritingGeometry();
    const points = completed.points.map(p => ({ x: p.x + completed.dx, y: p.y + completed.dy }));
    const glyph = nearest(points[0], g, Infinity);
    if (!glyph) return;
    const origin = center(glyph), font = g.fontSize;
    const relative = p => ({ x: (p.x - origin.x) / font, y: (p.y - origin.y) / font });
    const witnesses = new Map([[glyph.start, { offset: glyph.start, x: 0, y: 0 }]]);
    // A bounded sample records nearby characters without scanning the entire
    // manuscript once per input point on a long stroke.
    const stride = Math.max(1, Math.ceil(points.length / 32));
    for (const point of points.filter((_, i) => i % stride === 0 || i === points.length - 1)) {
      const nearby = nearest(point, g, Infinity);
      if (nearby && !witnesses.has(nearby.start)) witnesses.set(nearby.start, { offset: nearby.start, ...relative(center(nearby)) });
    }
    const changed = { ...completed.pen, offset: glyph.start, layoutKey: g.layoutKey, fontSize: font,
      points: points.map(relative), witnesses: [...witnesses.values()] };
    // Validate before replacing anything: failed moves leave data/history intact.
    try {
      const manuscript = new window.ReadingAnnotations(model.source);
      window.ManuscriptMarks.fromItems(model.items.map(item => item.id === changed.id ? changed : item), manuscript, model.memoSettings);
      model.movePen(changed.id, changed);
    } catch (error) { alert(`赤ペンを移動できません。${error.message}`); }
  }
  stage.addEventListener('pointerdown', e => {
    if (!enabled || !editable) return;
    if (tool === 'ruby') return;
    if (!e.isPrimary) { releaseGesture(); render(); return; }
    if (e.button !== 0 || editor.open) return;
    const note = e.target.closest('.writing-memo');
    if (note) {
      if (tool !== 'memo') return;
      const item = model.items.find(item => item.id === Number(note.dataset.markId));
      if (e.target.closest('.memo-remove')) {
        e.preventDefault();
        if (confirm('このメモを削除しますか？')) { model.remove(item.id); selectedMemo = null; render(); }
        return;
      }
      e.preventDefault();
      const point = localPoint(e), box = note.getBoundingClientRect(), rootBox = root.getBoundingClientRect();
      gesture = { id: e.pointerId, first: point, scroll: scrollY, moved: false, memo: copy(item), preview: copy(item),
        part: e.target.closest('.memo-tip') ? 'tip' : 'body', wasSelected: selectedMemo === item.id,
        body: { x: box.left - rootBox.left, y: box.top - rootBox.top } };
      selectedMemo = item.id; stage.setPointerCapture(e.pointerId); render(); return;
    }
    selectedMemo = null; controls();
    if (tool === 'move') {
      const id = Number(e.target.closest('.pen-hit')?.dataset.penId);
      const pen = model.items.find(item => item.type === 'pen' && item.id === id);
      selectedPen = pen?.id ?? null;
      if (!pen) { render(); return; }
      e.preventDefault();
      gesture = { id: e.pointerId, first: localPoint(e), scroll: scrollY, moved: false,
        pen: copy(pen), points: strokePoints(pen, window.Reader.getWritingGeometry()), dx: 0, dy: 0 };
      stage.setPointerCapture(e.pointerId); render(); return;
    }
    const geometry = window.Reader.getWritingGeometry(), point = localPoint(e), glyph = nearest(point, geometry);
    if (!glyph && tool !== 'eraser') { render(); return; }
    if (tool !== 'memo') e.preventDefault();
    gesture = { id: e.pointerId, first: point, glyph, scroll: scrollY, moved: false };
    stage.setPointerCapture(e.pointerId);
    if (tool === 'pen') {
      gesture.origin = center(glyph);
      gesture.preview = { type: 'pen', offset: glyph.start, layoutKey: geometry.layoutKey, fontSize: geometry.fontSize, points: [{ x: (point.x - gesture.origin.x) / geometry.fontSize, y: (point.y - gesture.origin.y) / geometry.fontSize }], witnesses: [{ offset: glyph.start, x: 0, y: 0 }] };
    }
    if (tool === 'marker') gesture.preview = { type: 'marker', start: glyph.start, end: glyph.end, color: markerColor };
    render();
  });
  stage.addEventListener('pointermove', e => {
    if (!editable || !gesture || gesture.id !== e.pointerId) return;
    const point = localPoint(e);
    if (Math.hypot(point.x - gesture.first.x, point.y - gesture.first.y) > 8) gesture.moved = true;
    if (gesture.pen) {
      if (gesture.moved) updatePenDrag(point);
      render(); return;
    }
    if (gesture.memo) {
      if (gesture.moved) updateMemoDrag(point);
      render(); return;
    }
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
    if (gesture.pen) {
      if (gesture.moved) updatePenDrag(point);
      const completed = gesture; releaseGesture();
      if (completed.moved && Math.hypot(completed.dx, completed.dy) > .01) commitPenMove(completed);
      render(); return;
    }
    if (gesture.memo) {
      if (gesture.moved) updateMemoDrag(point);
      const completed = gesture; releaseGesture();
      if (completed.moved) model.updateMemo(completed.memo.id, completed.preview);
      else if (completed.wasSelected && completed.part === 'body') openMemo(completed.memo);
      render(); return;
    }
    if (tool === 'pen') updateStroke(point);
    if (tool === 'marker') {
      const last = nearest(point, window.Reader.getWritingGeometry());
      if (last) gesture.preview = { type: 'marker', start: Math.min(gesture.glyph.start, last.start), end: Math.max(gesture.glyph.end, last.end), color: markerColor };
    }
    const completed = gesture; releaseGesture();
    if (tool === 'pen' && completed.preview.points.length > 1) model.add(completed.preview);
    if (tool === 'marker') model.add(completed.preview);
    if (!completed.moved && Math.abs(scrollY - completed.scroll) < 2) {
      if (tool === 'memo') openMemo({ type: 'memo', offset: completed.glyph.start, dx: .6, dy: 1, tx: (point.x - center(completed.glyph).x) / window.Reader.getWritingGeometry().fontSize, ty: (point.y - center(completed.glyph).y) / window.Reader.getWritingGeometry().fontSize, color: markerColor, text: '' });
      if (tool === 'eraser') erase(point);
    }
    render();
  });
  stage.addEventListener('pointercancel', () => { releaseGesture(); render(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && gesture?.pen) { e.preventDefault(); releaseGesture(); render(); }
  });
  stage.addEventListener('lostpointercapture', () => { if (gesture) { gesture = null; render(); } });
  document.querySelectorAll('[data-writing-tool]').forEach(button => button.onclick = async () => {
    if (!editable) return;
    const next = button.dataset.writingTool;
    cancelPending();
    if (next === 'ruby') {
      if (!await window.Reader.activateRubyMode()) return;
    } else window.Reader.setRubyMode(false);
    tool = next; controls(); render();
  });
  document.querySelectorAll('[data-marker-color]').forEach(button => button.onclick = () => {
    if (!editable || !enabled) return;
    if (tool === 'memo' && selectedMemo) model.updateMemo(selectedMemo, { color: button.dataset.markerColor });
    else if (tool === 'marker') markerColor = button.dataset.markerColor;
    render();
  });
  const settingsDialog = $('memo-settings-dialog');
  $('memo-settings-open').onclick = () => {
    if (!editable || !enabled || tool !== 'memo') return;
    $('memo-font-size').value = model.memoSettings.fontSize; $('memo-opacity').value = model.memoSettings.opacity;
    settingsDialog.showModal();
  };
  $('memo-settings-form').onsubmit = e => {
    e.preventDefault();
    if (editable && enabled && tool === 'memo') model.memoSettings = window.ManuscriptMarks.settings({ fontSize: Number($('memo-font-size').value), opacity: Number($('memo-opacity').value) });
    settingsDialog.close(); render();
  };
  $('memo-settings-cancel').onclick = () => settingsDialog.close();
  document.addEventListener('pointerdown', e => {
    if (selectedMemo && !e.target.closest('.writing-memo, #marker-colors, #memo-settings-open, #memo-settings-dialog, #writing-memo-dialog')) { selectedMemo = null; render(); }
  });
  $('writing-off').onclick = () => setMode(false);
  $('writing-undo').onclick = () => { if (!editable || !enabled) return; cancelPending(); model?.undo(); render(); };
  input.addEventListener('input', () => { $('writing-memo-save').disabled = !input.value.trim(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault(); });
  $('writing-memo-form').addEventListener('submit', e => {
    e.preventDefault(); const text = input.value.trim();
    if (!editable || !enabled || !draftMemo || !text || text.length > 200) return;
    if (tool !== 'memo') return;
    if (draftMemo.id) model.editMemo(draftMemo.id, text); else model.add({ ...draftMemo, text });
    cancelPending();
  });
  $('writing-memo-delete').onclick = () => { if (!editable) return; if (enabled && tool === 'memo' && draftMemo?.id && confirm('このメモを削除しますか？')) model.remove(draftMemo.id); cancelPending(); };
  $('writing-memo-cancel').onclick = cancelPending;
  editor.addEventListener('cancel', e => { e.preventDefault(); cancelPending(); });
  editor.addEventListener('close', () => { draftMemo = null; });
  window.visualViewport?.addEventListener('resize', fitEditor);
  window.visualViewport?.addEventListener('scroll', fitEditor);
  root.addEventListener('reader-layout', () => { releaseGesture(); render(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPending(); });
  addEventListener('scroll', () => {
    if (gesture && Math.abs(scrollY - gesture.scroll) > 2) { releaseGesture(); render(); }
  }, { passive: true });
  // Printing temporarily hides the live reader. Do not measure or reposition
  // overlays against its zero-size boxes; repaint once the normal page returns.
  addEventListener('afterprint', () => requestAnimationFrame(render));
  matchMedia('print').addEventListener('change', e => { if (!e.matches) requestAnimationFrame(render); });
  window.ManuscriptWriting = {
    bubble,
    printSnapshot() {
      if (!model) return { source: '', items: [], pens: [] };
      const geometry = window.Reader.getWritingGeometry(), pens = [];
      // Reuse exactly the live stroke anchor rules; pending gestures
      // and memo edits live outside items and are deliberately not exported.
      for (const item of model.items) if (item.type === 'pen') {
        const points = strokePoints(item, geometry);
        if (!points) throw new Error('赤ペンの基準文字を確認できません。本文全体の朗読画面を開き直してから出力してください。');
        pens.push({ id: item.id, points });
      }
      return { source: model.source, items: copy(model.items), memoSettings: copy(model.memoSettings), pens };
    },
    show(next, options = {}) { cancelPending(); model = next; editable = options.editable !== false; enabled = false; controls(); render(); },
    leave() { cancelPending(); enabled = false; model = null; controls(); render(); },
    setMode, cancelPending,
    get hasMarks() { return Boolean(model?.hasMarks); },
    get hasPens() { return Boolean(model?.items.some(item => item.type === 'pen')); },
    get hasPending() { return Boolean(gesture || draftMemo || settingsDialog.open); },
    focusPending() { if (editor.open) input.focus(); else if (settingsDialog.open) $('memo-font-size').focus(); },
    get enabled() { return enabled; }
  };
})();
