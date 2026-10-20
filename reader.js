/* Keep inline layout intact: relative positioning moves measured line groups
 * without inserting line breaks, changing text, or changing Japanese line rules. */
(() => {
  const root = document.getElementById('reader');
  const status = document.getElementById('layout-status');
  let source = '', settings = { width: 900, fontSize: 22, height: 1.8, breaks: 5 };
  let displayEnd = null;
  let blocks = [], lastAvailable = 0, lastMobile = false, scheduled = 0;
  let savedAnchor = null;
  let writingGeometry = null;
  const readingEdge = () => document.querySelector('.reader-controls').getBoundingClientRect().bottom + 12;
  let annotations = null, annotationsEditable = true, rubyMode = false, draft = null, editAnchor = null;
  let readingChangeGuard = async () => true, readingChangePending = false;
  const rubyButton = document.getElementById('ruby-mode');
  const rubyHelp = document.getElementById('ruby-help');
  const editor = document.getElementById('ruby-dialog');
  const rubyInput = document.getElementById('ruby-input');
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  const columnsInput = document.getElementById('columns');
  const columnsOutput = document.getElementById('columns-value');
  const widthInput = document.getElementById('reader-width');
  const widthOutput = document.getElementById('reader-width-value');
  const mobile = matchMedia('(max-width: 600px)');
  const availableWidth = () => Math.max(1, root.parentElement.clientWidth - (mobile.matches ? 32 : 40));
  const range = document.createRange();
  const printMedia = matchMedia('print');
  const printing = () => printMedia.matches && document.body.classList.contains('manuscript-printing');
  function sourceOffset(block, offset) {
    const run = block.runs.find(r => offset >= r.start && offset < r.end) || block.runs.at(-1);
    return run.annotation ? run.sourceStart : run.sourceStart + offset - run.start;
  }
  function displayOffset(block, offset, annotationIndex) {
    const annotation = annotationIndex !== undefined && block.runs.find(r => r.annotation && r.sourceStart === offset);
    if (annotation) {
      // Keep the visible part of a long reading when it spans several lines.
      // After editing, clamp to a complete grapheme in the replacement reading.
      const index = Math.min(annotationIndex, annotation.value.length - 1);
      const boundary = [...segmenter.segment(annotation.value)].filter(s => s.index <= index).at(-1).index;
      return annotation.start + boundary;
    }
    const run = block.runs.find(r => !r.annotation && offset >= r.sourceStart && offset < r.sourceEnd)
      || block.runs.find(r => r.sourceStart === offset);
    return run ? run.start + (run.annotation ? 0 : offset - run.sourceStart) : block.text.length - 1;
  }
  function compose(text, start) {
    const runs = [];
    let display = '', cursor = start;
    const add = (value, sourceStart, sourceEnd, annotation = false, pending = false, sourceRuby = null) => {
      if (!value) return;
      runs.push({ start: display.length, end: display.length + value.length, value, sourceStart, sourceEnd, annotation, pending, sourceRuby });
      display += value;
    };
    const rubies = annotations?.sourceRubies || [];
    const addSource = end => {
      for (const ruby of rubies) {
        if (ruby.start < cursor || ruby.end > end) continue;
        add(source.slice(cursor, ruby.start), cursor, ruby.start);
        add(source.slice(ruby.start, ruby.end), ruby.start, ruby.end, false, false, ruby);
        cursor = ruby.end;
      }
      add(source.slice(cursor, end), cursor, end);
      cursor = end;
    };
    const entries = annotations ? annotations.entries.filter(a => !draft || a.offset !== draft.offset) : [];
    if (draft) entries.push(draft);
    // Keep source ruby atomic. A manual note inside its base appears just after
    // the complete base; its original offset remains available for editing.
    const positioned = entries.map(entry => ({ entry, at: rubies.find(r => entry.offset > r.start && entry.offset < r.end)?.end ?? entry.offset }));
    positioned.sort((a, b) => a.at - b.at || a.entry.offset - b.entry.offset);
    for (const { entry, at } of positioned) {
      if (displayEnd !== null && displayEnd < source.length && (entry.offset >= displayEnd || at > displayEnd)) continue;
      if (entry.offset < start || entry.offset > start + text.length) continue;
      addSource(at);
      add(`【${entry.text}】`, entry.offset, entry.offset, true, entry === draft);
    }
    addSource(start + text.length);
    return { text: display, runs };
  }
  // Use the same inline runs for natural measurement, shifted groups and fallback.
  // Splitting at measured lines must retain annotation colour and source mapping.
  function appendRuns(block, parent, first = 0, end = block.text.length) {
    for (const run of block.runs) {
      const begin = Math.max(first, run.start), finish = Math.min(end, run.end);
      if (begin >= finish) continue;
      const node = document.createTextNode(block.text.slice(begin, finish));
      if (run.annotation) {
        const span = document.createElement('span');
        span.className = `reading-annotation${run.pending ? ' annotation-draft' : ''}`;
        span.dataset.offset = run.sourceStart;
        if (rubyMode && !run.pending) {
          span.setAttribute('role', 'button');
          span.setAttribute('aria-label', `読み仮名「${run.value.slice(1, -1)}」を編集`);
          span.tabIndex = begin === run.start ? 0 : -1;
        }
        span.append(node); parent.append(span);
      } else if (run.sourceRuby) {
        const unit = document.createElement('span'), ruby = document.createElement('ruby'), rt = document.createElement('rt');
        unit.className = 'source-ruby-unit'; rt.textContent = run.sourceRuby.reading;
        ruby.append(node, rt); unit.append(ruby); parent.append(unit);
      } else parent.append(node);
      block.parts.push({ node, start: begin, end: finish, run });
    }
  }
  function point(block, offset) {
    const part = block.parts.find(p => offset >= p.start && offset < p.end) || block.parts.at(-1);
    if (!part) return null;
    const local = Math.max(0, Math.min(offset - part.start, part.node.length - 1));
    range.setStart(part.node, local);
    const length = part.node.data.codePointAt(local) > 0xffff ? 2 : 1;
    range.setEnd(part.node, Math.min(local + length, part.node.length));
    return range.getBoundingClientRect();
  }
  function capture() {
    if (printing() || root.closest('[hidden]')) return savedAnchor;
    const edge = readingEdge();
    let best = null;
    for (const block of blocks) {
      if (block.el.getBoundingClientRect().bottom < edge) continue;
      let lo = 0, hi = block.lines.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (point(block, block.lines[mid].start).bottom < edge) lo = mid + 1;
        else hi = mid;
      }
      if (lo < block.lines.length) {
        const line = block.lines[lo], rect = point(block, line.start);
        best = { offset: sourceOffset(block, line.start), y: rect.top };
        const run = block.runs.find(r => line.start >= r.start && line.start < r.end);
        if (run?.annotation) best.annotationIndex = line.start - run.start;
      }
      if (best) break;
    }
    return best || savedAnchor;
  }
  function restore(anchor) {
    if (!anchor || printing()) return;
    const block = blocks.find(b => anchor.offset >= b.start && anchor.offset <= b.sourceEnd);
    if (!block) return;
    const rect = point(block, displayOffset(block, anchor.offset, anchor.annotationIndex));
    if (rect) {
      const panel = document.getElementById('settings-dialog');
      const panelTop = mobile.matches && panel.open ? panel.getBoundingClientRect().top : Infinity;
      const edge = readingEdge();
      const y = Math.min(anchor.y, Math.max(edge, panelTop - rect.height - 12));
      window.scrollBy(0, rect.top - y);
      savedAnchor = { ...anchor, y };
    }
  }
  function measure(block) {
    if (!block.text.length) return [];
    const offsets = [...segmenter.segment(block.text)].map(s => s.index);
    block.graphemes = offsets.slice();
    offsets.push(block.text.length);
    const lineHeight = parseFloat(getComputedStyle(block.el).lineHeight);
    const top = i => {
      const rect = point(block, offsets[i]);
      // Font fallback (e.g. emoji) can have a different glyph box on the same
      // line. Compare vertical centers within half a line, not exact glyph tops.
      return rect.top + rect.height / 2;
    };
    const lines = [];
    let i = 0;
    while (i < offsets.length - 1) {
      const y = top(i);
      let lo = i + 1, hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (Math.abs(top(mid) - y) < lineHeight / 2) lo = mid + 1; else hi = mid;
      }
      lines.push({ start: offsets[i], end: offsets[lo], y });
      i = lo;
    }
    return lines;
  }
  function layout(anchor = capture()) {
    if (printing() || root.closest('[hidden]')) return;
    writingGeometry = null;
    const available = availableWidth();
    const maxWidth = Math.min(1400, available);
    const minWidth = Math.min(480, maxWidth);
    // Keep the preferred desktop width and font size as independent state.
    // A window resize can constrain width without changing the chosen type size.
    root.style.width = `${mobile.matches ? available : Math.min(maxWidth, Math.max(minWidth, settings.width))}px`;
    const width = root.getBoundingClientRect().width;
    widthInput.min = minWidth;
    widthInput.max = maxWidth;
    widthInput.value = Math.round(width);
    widthOutput.textContent = `${Math.round(width)}px`;
    widthInput.setAttribute('aria-valuetext', `現在の表示幅 ${Math.round(width)}ピクセル`);
    const minColumns = Math.max(1, Math.ceil(width / 36));
    const maxColumns = Math.max(minColumns, Math.floor(width / 18));
    columnsInput.min = minColumns;
    columnsInput.max = maxColumns;
    columnsInput.value = Math.min(maxColumns, Math.max(minColumns, Math.round(width / settings.fontSize)));
    columnsOutput.textContent = `約${columnsInput.value}文字`;
    root.style.fontSize = `${settings.fontSize}px`;
    root.style.lineHeight = settings.height;
    root.replaceChildren(); blocks = [];
    // Empty original lines are natural boundaries; retain all whitespace verbatim.
    const visibleText = displayEnd === null ? source : source.slice(0, displayEnd);
    const chunks = visibleText.split(/((?:\r\n|\n|\r)[\t \u3000]*(?:\r\n|\n|\r)(?:[\t \u3000]*(?:\r\n|\n|\r))*)/);
    let start = 0, pendingText = '', pendingStart = 0;
    const positions = [...(annotations?.entries || []), ...(draft ? [draft] : [])].map(a => a.offset);
    const flushText = () => {
      if (pendingText || (!visibleText && displayEnd === null && positions.includes(0))) {
        const el = document.createElement('div'); el.className = 'text-block';
        const block = { el, ...compose(pendingText, pendingStart), start: pendingStart, sourceEnd: pendingStart + pendingText.length, parts: [], lines: [] };
        appendRuns(block, el);
        root.append(el); blocks.push(block);
      }
      pendingText = '';
    };
    chunks.forEach((text, index) => {
      // Imported annotations can occur inside original blank lines. Merge that
      // gap with adjacent text so its reading and newlines are measured together
      // rather than hiding it in the zero-font natural-gap representation.
      const annotatedGap = index % 2 && positions.some(offset =>
        (offset > start && offset < start + text.length) ||
        (start === 0 && offset === 0) ||
        (start + text.length === visibleText.length && offset === visibleText.length));
      if (index % 2 && !annotatedGap) {
        flushText();
        const gap = document.createElement('div'); gap.className = 'natural-gap';
        gap.textContent = text;
        const count = (text.match(/\r\n|\r|\n/g) || []).length;
        gap.style.fontSize = '0'; gap.style.lineHeight = '0';
        // Use pixel height so font-size:0 doesn't remove the intended blank lines.
        gap.style.height = `${(count - (start ? 1 : 0)) * settings.height * parseFloat(getComputedStyle(root).fontSize)}px`;
        root.append(gap);
      } else {
        if (!pendingText) pendingStart = start;
        pendingText += text;
      }
      start += text.length;
    });
    flushText();
    // Batch natural DOM creation before any geometry reads.
    blocks.forEach(b => { b.lines = measure(b); });
    let unsupported = false;
    const gapSize = parseFloat(getComputedStyle(root).fontSize) * .85;
    blocks.forEach(b => {
      b.parts = [];
      const fragment = document.createDocumentFragment();
      const size = settings.breaks || Math.max(1, b.lines.length);
      for (let i = 0; i < b.lines.length; i += size) {
        const first = b.lines[i].start;
        const end = b.lines[Math.min(i + size, b.lines.length) - 1].end;
        const span = document.createElement('span'); span.className = 'line-segment';
        appendRuns(b, span, first, end);
        span.style.top = `${Math.floor(i / size) * gapSize}px`;
        fragment.append(span);
      }
      b.el.replaceChildren(fragment);
      b.el.style.paddingBottom = `${Math.max(0, Math.ceil(b.lines.length / size) - 1) * gapSize}px`;
    });
    // Some shaping engines can change wrapping across span boundaries. Verify every
    // line start against natural layout; use the intact source on any mismatch.
    blocks.forEach(b => {
      if (!b.lines.length) return;
      const baseRect = point(b, 0);
      const base = baseRect.top + baseRect.height / 2;
      const invalid = b.lines.some((line, i) => {
        const shift = settings.breaks ? Math.floor(i / settings.breaks) * gapSize : 0;
        const rect = point(b, line.start);
        return Math.abs(rect.top + rect.height / 2 - base - (line.y - b.lines[0].y) - shift) > 1;
      });
      if (invalid) {
        unsupported = true; b.el.replaceChildren(); b.el.style.paddingBottom = '0';
        b.parts = []; appendRuns(b, b.el);
      }
    });
    status.textContent = unsupported ? 'この文章の一部では折り返しを優先し、自動区切りを適用していません。' : '';
    if (displayEnd !== null && visibleText) {
      const marker = document.createElement('p'); marker.className = 'reading-end-marker';
      marker.textContent = 'ここまでが計測対象です。'; root.append(marker);
    }
    lastAvailable = available;
    lastMobile = mobile.matches;
    restore(anchor);
    root.dispatchEvent(new Event('reader-layout'));
  }
  // Optional writing layer: original grapheme boxes only, independent of rt and
  // manual readings. Cache lazily per layout; coordinates stay relative to the
  // reader so scrolling never invalidates them or changes annotation offsets.
  function getWritingGeometry() {
    if (writingGeometry) return writingGeometry;
    const origin = root.getBoundingClientRect(), glyphs = [];
    for (const block of blocks) for (const part of block.parts) {
      if (part.run.annotation) continue;
      for (const s of segmenter.segment(part.node.data)) {
        range.setStart(part.node, s.index); range.setEnd(part.node, s.index + s.segment.length);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height || !s.segment.trim()) continue;
        const start = part.run.sourceStart + part.start - part.run.start + s.index;
        glyphs.push({ start, end: start + s.segment.length, text: s.segment,
          x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height });
      }
    }
    const fontSize = parseFloat(getComputedStyle(root).fontSize);
    let flowHash = 2166136261;
    for (const char of JSON.stringify([annotations?.entries, annotations?.sourceRubies, draft])) flowHash = Math.imul(flowHash ^ char.charCodeAt(0), 16777619);
    writingGeometry = { glyphs, byOffset: new Map(glyphs.map(g => [g.start, g])), fontSize, width: origin.width,
      layoutKey: `${(origin.width / fontSize).toFixed(2)}:${settings.height}:${settings.breaks}:${flowHash >>> 0}` };
    return writingGeometry;
  }
  function printSnapshot() {
    if (draft) throw new Error('読み仮名を登録またはキャンセルしてからPDF出力してください。');
    if (printing() || root.closest('[hidden]')) throw new Error('朗読画面でPDF出力してください。');
    const origin = root.getBoundingClientRect(), computed = getComputedStyle(root);
    const font = {};
    for (const name of ['fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'fontStyle', 'fontStretch', 'fontKerning', 'fontFeatureSettings', 'fontVariantLigatures', 'fontVariantEastAsian', 'letterSpacing', 'wordSpacing', 'tabSize', 'direction']) font[name] = computed[name];
    const lines = [];
    for (const block of blocks) {
      let previousShift = 0;
      for (const line of block.lines) {
        const firstRect = point(block, line.start), pieces = [], rects = [];
        const firstPart = block.parts.find(p => line.start >= p.start && line.start < p.end);
        const shift = parseFloat(firstPart.node.parentElement.closest('.line-segment')?.style.top) || 0;
        for (const part of block.parts) {
          const begin = Math.max(line.start, part.start), end = Math.min(line.end, part.end);
          if (begin >= end) continue;
          range.setStart(part.node, begin - part.start); range.setEnd(part.node, end - part.start);
          rects.push(...[...range.getClientRects()].filter(r => r.height > 0));
          if (part.run.sourceRuby) {
            const base = range.getBoundingClientRect();
            const unit = part.node.parentElement.closest('.source-ruby-unit');
            const unitRect = unit.getBoundingClientRect();
            const readingRange = document.createRange(); readingRange.selectNodeContents(unit.querySelector('rt'));
            const readingRect = readingRange.getBoundingClientRect();
            const bounds = rect => ({ left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height });
            // Native ruby is atomic on screen. Freeze its base/reading pairing
            // and actual occupied box, including ink above the normal line.
            rects.push(unitRect, readingRect);
            pieces.push({ text: part.node.data, left: base.left - origin.left, top: base.top - origin.top, annotation: null,
              sourceRuby: { ...part.run.sourceRuby, base: part.node.data, bounds: bounds(unitRect), readingBounds: bounds(readingRect) } });
            continue;
          }
          // Preserve tab stops through the next text's measured X position;
          // resetting a tab inside an independently positioned span would drift.
          for (const match of block.text.slice(begin, end).matchAll(/[^\r\n\t\u2028\u2029]+/gu)) {
            range.setStart(part.node, begin - part.start + match.index);
            range.setEnd(part.node, begin - part.start + match.index + match[0].length);
            const rect = range.getBoundingClientRect();
            pieces.push({ text: match[0], left: rect.left - origin.left, top: rect.top - origin.top, annotation: part.run.annotation ? part.run.sourceStart : null });
          }
        }
        const center = firstRect.top + firstRect.height / 2 - origin.top;
        const top = Math.min(center - parseFloat(computed.lineHeight) / 2, ...rects.map(r => r.top - origin.top));
        const bottom = Math.max(center + parseFloat(computed.lineHeight) / 2, ...rects.map(r => r.bottom - origin.top));
        lines.push({ top, bottom, center, autoBefore: Math.max(0, shift - previousShift), pieces });
        previousShift = shift;
      }
    }
    const geometry = getWritingGeometry();
    // Both print text and writing use the same frozen line table. Associate
    // original graphemes by baseline, never by an overlay's DOM coordinates.
    const glyphs = geometry.glyphs.map(glyph => {
      const y = glyph.y + glyph.height / 2;
      let lo = 0, hi = lines.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (lines[mid].center < y) lo = mid + 1; else hi = mid; }
      const next = Math.min(lo, lines.length - 1), previous = Math.max(0, next - 1);
      const line = Math.abs(lines[previous].center - y) < Math.abs(lines[next].center - y) ? previous : next;
      return { ...glyph, line };
    });
    return { width: origin.width, font, lines, glyphs };
  }
  function updateMode(on) {
    rubyMode = Boolean(annotations && annotationsEditable && on);
    rubyButton.setAttribute('aria-pressed', String(rubyMode));
    rubyButton.querySelector('.button-state').textContent = rubyMode ? 'ON' : 'OFF';
    rubyButton.setAttribute('aria-label', `読み仮名編集：${rubyMode ? 'ON' : 'OFF'}`);
    rubyHelp.hidden = !rubyMode;
    root.classList.toggle('ruby-mode', rubyMode);
    root.dispatchEvent(new CustomEvent('reader-ruby-mode', { detail: rubyMode }));
  }
  function fitEditor() {
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    editor.style.setProperty('--editor-center', `${(viewport?.offsetTop || 0) + height / 2}px`);
    editor.style.setProperty('--editor-height', `${Math.max(120, height - 24)}px`);
  }
  window.visualViewport?.addEventListener('resize', fitEditor);
  window.visualViewport?.addEventListener('scroll', fitEditor);
  addEventListener('resize', fitEditor);
  function finishEdit() {
    if (!draft) return;
    draft = null;
    if (editor.open) editor.close();
    layout(editAnchor);
    editAnchor = null;
  }
  function beginEdit(offset) {
    if (!rubyMode || editor.open) return;
    const existing = annotations.entries.find(a => a.offset === offset);
    editAnchor = capture();
    document.getElementById('settings-dialog').close();
    root.style.setProperty('--settings-panel-height', '0px');
    draft = { offset, text: existing?.text || '' };
    rubyInput.value = draft.text;
    document.getElementById('ruby-title').textContent = existing ? '読み仮名を編集' : '読み仮名を追加';
    document.getElementById('ruby-delete').hidden = !existing;
    document.getElementById('ruby-save').disabled = !draft.text.trim();
    layout(editAnchor);
    fitEditor(); editor.showModal();
    rubyInput.focus({ preventScroll: true });
  }
  rubyInput.addEventListener('input', () => {
    if (!draft) return;
    draft.text = rubyInput.value;
    document.getElementById('ruby-save').disabled = !draft.text.trim() || /[\r\n\u2028\u2029]/u.test(draft.text);
    layout(editAnchor);
  });
  async function commitReading(remove = false) {
    if (!draft || readingChangePending) return;
    const currentDraft = draft, model = annotations, text = rubyInput.value.trim();
    const existing = model.entries.find(a => a.offset === currentDraft.offset);
    if (!remove && (!text || /[\r\n\u2028\u2029]/u.test(text) || !model.boundaries.has(currentDraft.offset))) return;
    if ((!remove && existing?.text === text) || (remove && !existing)) { finishEdit(); return; }
    readingChangePending = true;
    try {
      if (!await readingChangeGuard()) { rubyInput.focus({ preventScroll: true }); return; }
      if (draft !== currentDraft || annotations !== model || !editor.open) return;
      if (remove) model.remove(currentDraft.offset);
      else if (!model.set(currentDraft.offset, text)) return;
      finishEdit();
    } finally { readingChangePending = false; }
  }
  document.getElementById('ruby-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!e.isComposing) commitReading();
  });
  // Enter used to confirm an IME conversion must not register the draft.
  rubyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault();
  });
  document.getElementById('ruby-delete').onclick = () => commitReading(true);
  document.getElementById('ruby-cancel').onclick = finishEdit;
  editor.addEventListener('cancel', e => { e.preventDefault(); finishEdit(); });
  editor.addEventListener('close', () => { if (!editor.open) finishEdit(); });
  rubyButton.onclick = () => {
    const anchor = capture(); updateMode(!rubyMode); layout(anchor);
  };
  // A click is accepted only after a short stationary pointer gesture. Native
  // scrolling/selection stays enabled; cancellation or movement rejects a tap.
  let gesture = null;
  root.addEventListener('pointerdown', e => {
    gesture = rubyMode && e.isPrimary && e.button === 0
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, scroll: window.scrollY, time: performance.now(), moved: false } : null;
  });
  document.addEventListener('pointermove', e => {
    if (gesture && e.pointerId === gesture.id && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 8) gesture.moved = true;
  }, { passive: true });
  document.addEventListener('pointercancel', () => { gesture = null; });
  root.addEventListener('click', e => {
    const tap = gesture; gesture = null;
    if (!rubyMode || !tap || tap.moved || Math.abs(window.scrollY - tap.scroll) > 2 || performance.now() - tap.time > 650) return;
    // Mobile browsers can retarget a click to a nearby button-like note. Use
    // the actual pointer position and require its rectangle to contain the tap.
    const x = tap.x, y = tap.y;
    const annotation = e.target.closest('.reading-annotation');
    if (annotation && [...annotation.getClientRects()].some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) { beginEdit(Number(annotation.dataset.offset)); return; }
    const caret = document.caretPositionFromPoint?.(x, y);
    const caretRange = !caret && document.caretRangeFromPoint?.(x, y);
    const node = caret?.offsetNode || caretRange?.startContainer;
    const offset = caret?.offset ?? caretRange?.startOffset;
    const block = blocks.find(b => b.parts.some(p => p.node === node));
    if (!block) return;
    const part = block.parts.find(p => p.node === node);
    const position = part.start + offset;
    // Caret APIs return the nearest position even in margins. Require the point
    // to be INSIDE a non-whitespace grapheme's actual client rectangle.
    let index = block.graphemes.findIndex(start => start >= position);
    if (index < 0) index = block.graphemes.length;
    for (let i = Math.max(0, index - 1); i <= Math.min(index, block.graphemes.length - 1); i++) {
      const first = block.graphemes[i], end = block.graphemes[i + 1] ?? block.text.length;
      if (!block.text.slice(first, end).trim()) continue;
      const a = block.parts.find(p => first >= p.start && first < p.end);
      const b = block.parts.find(p => end > p.start && end <= p.end);
      if (!a || !b || a.run.annotation) continue;
      range.setStart(a.node, first - a.start); range.setEnd(b.node, end - b.start);
      const rect = [...range.getClientRects()].find(r => r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
      if (rect) {
        const boundary = x < rect.left + rect.width / 2 ? first : end;
        // The next displayed run may be a manual note deferred from inside a
        // source ruby. Map this glyph's edge using its OWN base source run.
        beginEdit(a.run.sourceStart + boundary - a.run.start); return;
      }
    }
  });
  root.addEventListener('keydown', e => {
    const annotation = e.target.closest('.reading-annotation');
    if (rubyMode && annotation && ['Enter', ' '].includes(e.key)) {
      e.preventDefault(); beginEdit(Number(annotation.dataset.offset));
    }
  });
  const observer = new ResizeObserver(() => {
    if (printing() || root.closest('[hidden]') || (Math.abs(availableWidth() - lastAvailable) < .5 && mobile.matches === lastMobile)) return;
    cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(() => layout(savedAnchor));
  });
  observer.observe(root.parentElement);
  mobile.addEventListener('change', () => {
    if (!root.closest('[hidden]')) layout(savedAnchor);
  });
  addEventListener('scroll', () => { savedAnchor = capture(); }, { passive: true });
  document.fonts.ready.then(() => { if (source) layout(savedAnchor); });
  window.Reader = {
    show(text, model = null, { editable = true, end = null } = {}) {
      finishEdit(); source = text; annotations = model;
      displayEnd = editable ? null : end;
      annotationsEditable = editable;
      rubyButton.hidden = !model || !editable; updateMode(false);
      savedAnchor = null; layout(null);
    },
    leave() { finishEdit(); updateMode(false); },
    setDisplayEnd(end) {
      if (annotationsEditable || displayEnd === end) return;
      const anchor = capture(); displayEnd = end; layout(anchor);
    },
    configure(next) {
      const anchor = capture();
      if (next.width !== undefined && !mobile.matches) settings.width = next.width;
      if (next.columns !== undefined) {
        settings.fontSize = Math.min(36, Math.max(18, root.getBoundingClientRect().width / next.columns));
      }
      if (next.height !== undefined) settings.height = next.height;
      if (next.breaks !== undefined) settings.breaks = next.breaks;
      layout(anchor);
    },
    capture, restore, printSnapshot, getWritingGeometry,
    setReadingChangeGuard(guard) { readingChangeGuard = guard; },
    setRubyMode(on) { const anchor = capture(); finishEdit(); updateMode(on); layout(anchor); },
    refresh(anchor = savedAnchor) { savedAnchor = anchor; layout(anchor); }
  };
})();
