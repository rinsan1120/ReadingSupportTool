/* Keep inline layout intact: relative positioning moves measured line groups
 * without inserting line breaks, changing text, or changing Japanese line rules. */
(() => {
  const root = document.getElementById('reader');
  const status = document.getElementById('layout-status');
  let source = '', settings = { width: 900, fontSize: 22, height: 1.8, breaks: 5 };
  let blocks = [], lastAvailable = 0, lastMobile = false, scheduled = 0;
  let savedAnchor = null;
  let annotations = null, rubyMode = false, draft = null, editAnchor = null;
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
    const add = (value, sourceStart, sourceEnd, annotation = false, pending = false) => {
      if (!value) return;
      runs.push({ start: display.length, end: display.length + value.length, value, sourceStart, sourceEnd, annotation, pending });
      display += value;
    };
    const entries = annotations ? annotations.entries.filter(a => !draft || a.offset !== draft.offset) : [];
    if (draft) entries.push(draft);
    entries.sort((a, b) => a.offset - b.offset);
    for (const entry of entries) {
      if (entry.offset < start || entry.offset > start + text.length) continue;
      add(source.slice(cursor, entry.offset), cursor, entry.offset);
      add(`【${entry.text}】`, entry.offset, entry.offset, true, entry === draft);
      cursor = entry.offset;
    }
    add(source.slice(cursor, start + text.length), cursor, start + text.length);
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
    if (root.closest('[hidden]')) return savedAnchor;
    const edge = document.querySelector('.reader-toolbar').getBoundingClientRect().bottom + 12;
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
    if (!anchor) return;
    const block = blocks.find(b => anchor.offset >= b.start && anchor.offset <= b.sourceEnd);
    if (!block) return;
    const rect = point(block, displayOffset(block, anchor.offset, anchor.annotationIndex));
    if (rect) {
      const panel = document.getElementById('settings-dialog');
      const panelTop = mobile.matches && panel.open ? panel.getBoundingClientRect().top : Infinity;
      const edge = document.querySelector('.reader-toolbar').getBoundingClientRect().bottom + 12;
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
    if (root.closest('[hidden]')) return;
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
    const chunks = source.split(/((?:\r\n|\n|\r)[\t \u3000]*(?:\r\n|\n|\r)(?:[\t \u3000]*(?:\r\n|\n|\r))*)/);
    let start = 0, pendingText = '', pendingStart = 0;
    const positions = [...(annotations?.entries || []), ...(draft ? [draft] : [])].map(a => a.offset);
    const flushText = () => {
      if (pendingText || (!source && positions.includes(0))) {
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
        (start + text.length === source.length && offset === source.length));
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
    lastAvailable = available;
    lastMobile = mobile.matches;
    restore(anchor);
  }
  function updateMode(on) {
    rubyMode = Boolean(annotations && on);
    rubyButton.setAttribute('aria-pressed', String(rubyMode));
    rubyButton.textContent = `ルビ：${rubyMode ? 'ON' : 'OFF'}`;
    rubyHelp.hidden = !rubyMode;
    root.classList.toggle('ruby-mode', rubyMode);
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
  document.getElementById('ruby-form').addEventListener('submit', e => {
    e.preventDefault();
    if (e.isComposing || !draft || !annotations.set(draft.offset, rubyInput.value)) return;
    finishEdit();
  });
  // Enter used to confirm an IME conversion must not register the draft.
  rubyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault();
  });
  document.getElementById('ruby-delete').onclick = () => {
    if (!draft) return;
    annotations.remove(draft.offset); finishEdit();
  };
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
    const annotation = e.target.closest('.reading-annotation');
    if (annotation) { beginEdit(Number(annotation.dataset.offset)); return; }
    const caret = document.caretPositionFromPoint?.(e.clientX, e.clientY);
    const caretRange = !caret && document.caretRangeFromPoint?.(e.clientX, e.clientY);
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
      const rect = [...range.getClientRects()].find(r => r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
      if (rect) {
        const boundary = e.clientX < rect.left + rect.width / 2 ? first : end;
        beginEdit(sourceOffset(block, boundary)); return;
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
    if (root.closest('[hidden]') || (Math.abs(availableWidth() - lastAvailable) < .5 && mobile.matches === lastMobile)) return;
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
    show(text, model = null) {
      finishEdit(); source = text; annotations = model;
      rubyButton.hidden = !model; updateMode(false);
      savedAnchor = null; layout(null);
    },
    leave() { finishEdit(); updateMode(false); },
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
    capture, restore,
    refresh() { layout(savedAnchor); }
  };
})();
