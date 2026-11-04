/* Keep inline layout intact: relative positioning moves measured line groups
 * without inserting line breaks, changing text, or changing Japanese line rules. */
(() => {
  const root = document.getElementById('reader');
  const status = document.getElementById('layout-status');
  let source = '', settings = { width: 900, fontSize: 22, height: 1.8, breaks: 5 };
  let displayEnd = null;
  let blocks = [], lastAvailable = 0, lastMobile = false, scheduled = 0;
  let savedAnchor = null;
  let writingGeometry = null, annotationGeometry = null;
  let direction = 'horizontal';
  let displayMode = 'scroll', printLayout = false, printConstraints = null, pages = [], pageIndex = 0, lastPageHeight = 0, scrollModeAnchor = null, pageReadingAnchor = null;
  const viewport = document.getElementById('reader-viewport'), stage = document.getElementById('reader-stage');
  const reading = document.getElementById('reading');
  const pageControls = document.getElementById('page-controls');
  const paged = () => displayMode === 'pages' && !printLayout;
  const pageHeight = () => Math.max(60, Math.floor(Math.min(innerHeight, window.visualViewport?.height ?? innerHeight)
    - controls.getBoundingClientRect().height - (measurementBar.hidden ? 0 : measurementBar.getBoundingClientRect().height)
    - Math.max(52, pageControls.getBoundingClientRect().height) - 32));
  const vertical = () => direction === 'vertical';
  const measurementBar = document.getElementById('measurement-bar');
  const controls = document.querySelector('.reader-controls');
  const columnHeight = () => {
    if (printConstraints?.inlineSize && vertical()) return printConstraints.inlineSize;
    const preferred = Math.max(180, Math.min(620, (isMobileViewport() ? viewportHeight() : innerHeight) * .62));
    if (paged()) return Math.max(36, Math.min(preferred, pageHeight() - 24));
    if (measurementBar.hidden) return preferred;
    const available = viewportHeight() - controls.getBoundingClientRect().height - measurementBar.getBoundingClientRect().height - 12 - settings.fontSize;
    return Math.max(1, Math.min(preferred, available));
  };
  let lastColumnHeight = 0;
  const readingEdge = () => Math.max(window.visualViewport?.offsetTop || 0, controls.getBoundingClientRect().bottom) + 12;
  let annotations = null, annotationsEditable = true, rubyMode = false, draft = null, editAnchor = null;
  let readingChangeGuard = async () => true, readingChangePending = false, editorSuspended = false;
  const rubyHelp = document.getElementById('ruby-help');
  const editor = document.getElementById('ruby-dialog');
  const rubyInput = document.getElementById('ruby-input');
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  const columnsInput = document.getElementById('columns');
  const columnsOutput = document.getElementById('columns-value');
  const widthInput = document.getElementById('reader-width');
  const widthOutput = document.getElementById('reader-width-value');
  const mobile = matchMedia('(max-width: 600px)');
  const touchViewport = matchMedia('(any-pointer: coarse)');
  const isMobileViewport = () => mobile.matches || touchViewport.matches;
  const supportsSmallViewport = CSS.supports('height', '100svh');
  const viewportProbe = document.createElement('div');
  viewportProbe.className = 'reader-viewport-probe'; viewportProbe.setAttribute('aria-hidden', 'true');
  document.body.append(viewportProbe);
  let fallbackWidth = innerWidth, fallbackHeight = Math.min(innerHeight, window.visualViewport?.height ?? innerHeight);
  const viewportHeight = () => {
    if (!isMobileViewport()) return Math.min(innerHeight, window.visualViewport?.height ?? innerHeight);
    // svh stays constant while browser chrome expands/collapses, including on
    // landscape phones. Legacy engines freeze height until a real width change.
    if (innerWidth !== fallbackWidth) {
      fallbackWidth = innerWidth; fallbackHeight = Math.min(innerHeight, window.visualViewport?.height ?? innerHeight);
    }
    return supportsSmallViewport ? viewportProbe.getBoundingClientRect().height || fallbackHeight : fallbackHeight;
  };
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
    if (paged() && pages.length) return { ...(pageReadingAnchor || pages[pageIndex].anchor), y: viewport.getBoundingClientRect().top + 8 };
    const edge = readingEdge();
    if (vertical()) {
      let best = null;
      const origin = root.getBoundingClientRect();
      const ordered = getWritingGeometry().readingOrder;
      let lo = 0, hi = ordered.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (ordered[mid].y < edge - origin.top) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < ordered.length; i++) {
        const glyph = ordered[i];
        if (best && origin.top + glyph.y > best.y + 2) break;
        const y = origin.top + glyph.y;
        if (y < edge || y > innerHeight) continue;
        if (!best || y < best.y - 2 || (Math.abs(y - best.y) < 2 && glyph.x > best.right))
          best = { offset: glyph.start, y, right: glyph.x };
      }
      return best || savedAnchor;
    }
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
      if (paged() && pages.length) {
        const top = rect.top - stage.getBoundingClientRect().top, y = top + rect.height / 2;
        const index = pages.findIndex(p => top >= p.top - .5 && top + rect.height <= Math.min(p.bottom, p.top + lastPageHeight) + .5);
        showPage(index < 0 ? pages.reduce((best, p, i) => Math.abs(p.top - y) < Math.abs(pages[best].top - y) ? i : best, 0) : index);
        pageReadingAnchor = { ...anchor };
        return;
      }
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
      return vertical() ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
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
    if (vertical()) {
      // A Range on an empty line can share the preceding glyph's rectangle.
      // Preserve explicit newline boundaries even when geometry cannot expose
      // the empty column; otherwise freezing the layout collapses blank lines.
      return lines.flatMap(line => {
        const columns = [];
        let start = line.start;
        for (const match of block.text.slice(line.start, line.end).matchAll(/\r\n|\r|\n/g)) {
          const end = line.start + match.index + match[0].length;
          columns.push({ ...line, start, end }); start = end;
        }
        if (start < line.end) columns.push({ ...line, start, end: line.end });
        return columns;
      });
    }
    return lines;
  }
  function layout(anchor = capture()) {
    if (printing() || root.closest('[hidden]')) return;
    viewport.classList.toggle('is-paged', paged());
    document.getElementById('reading').classList.toggle('has-paged-reader', paged());
    pageControls.hidden = !paged();
    if (!paged()) { stage.style.top = ''; viewport.style.height = ''; }
    writingGeometry = null; annotationGeometry = null;
    const layoutColumnHeight = columnHeight();
    const available = availableWidth();
    const maxWidth = Math.min(1400, available);
    const minWidth = Math.min(480, maxWidth);
    // Keep the preferred desktop width and font size as independent state.
    // A window resize can constrain width without changing the chosen type size.
    root.style.width = `${printConstraints?.inlineSize && !vertical() ? printConstraints.inlineSize : mobile.matches ? available : Math.min(maxWidth, Math.max(minWidth, settings.width))}px`;
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
    columnsOutput.textContent = vertical() ? `${Math.round(settings.fontSize)}px` : `約${columnsInput.value}文字`;
    columnsInput.setAttribute('aria-valuetext', vertical() ? `文字サイズ ${Math.round(settings.fontSize)}ピクセル` : `1行に約${columnsInput.value}文字`);
    root.style.fontSize = `${settings.fontSize}px`;
    root.style.lineHeight = settings.height;
    root.classList.toggle('vertical-writing', vertical());
    root.dataset.direction = direction;
    root.replaceChildren(); blocks = [];
    // Horizontal blocks use blank lines as boundaries. Vertical text must measure
    // those same newlines as columns in one flow, rather than starting a fresh
    // viewport-height section for every paragraph. Keep all whitespace verbatim.
    const visibleText = displayEnd === null ? source : source.slice(0, displayEnd);
    const chunks = vertical() ? [visibleText] : visibleText.split(/((?:\r\n|\n|\r)[\t \u3000]*(?:\r\n|\n|\r)(?:[\t \u3000]*(?:\r\n|\n|\r))*)/);
    let start = 0, pendingText = '', pendingStart = 0;
    const positions = [...(annotations?.entries || []), ...(draft ? [draft] : [])].map(a => a.offset);
    const flushText = () => {
      if (pendingText || (!visibleText && displayEnd === null && positions.includes(0))) {
        const el = document.createElement('div'); el.className = 'text-block';
        if (vertical()) Object.assign(el.style, { writingMode: 'vertical-rl', height: `${layoutColumnHeight}px`, width: 'max-content' });
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
      if (vertical()) {
        // Freeze natural columns into viewport-width sections. Each section
        // retains native Japanese shaping/ruby and ordinary touch scrolling.
        b.parts = [];
        b.el.replaceChildren();
        Object.assign(b.el.style, { writingMode: '', height: '', width: '' });
        const pitch = settings.fontSize * settings.height;
        const pageWidth = root.clientWidth;
        let page = null, used = 0, count = 0;
        for (const line of b.lines) {
          const gap = settings.breaks && count && count % settings.breaks === 0 ? gapSize : 0;
          if (!page || used + gap + pitch > pageWidth + .1) {
            page = document.createElement('div'); page.className = 'vertical-page';
            page.style.height = `${layoutColumnHeight}px`; b.el.append(page); used = 0;
          } else used += gap;
          const span = document.createElement('span'); span.className = 'vertical-column';
          span.style.right = `${used}px`; span.style.width = `${pitch}px`;
          appendRuns(b, span, line.start, line.end); page.append(span);
          used += pitch; count++;
          // A frozen column may be taller with another engine's font metrics.
          // Expand its section instead of clipping ink or wrapping into a neighbour.
          const extent = span.scrollHeight;
          if (extent > page.clientHeight + 2) { page.style.height = `${extent}px`; unsupported = true; }
        }
        return;
      }
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
      if (vertical()) return;
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
    status.textContent = unsupported ? (vertical() ? '列の再折り返しを避けるため、区画の高さを調整しています。' : 'この文章の一部では折り返しを優先し、自動区切りを適用していません。') : '';
    if (displayEnd !== null && visibleText) {
      const marker = document.createElement('p'); marker.className = 'reading-end-marker';
      marker.textContent = 'ここまでが計測対象です。'; root.append(marker);
    }
    if (vertical()) getWritingGeometry(); // Build the position index during layout, not the first scroll.
    lastColumnHeight = layoutColumnHeight;
    lastAvailable = available;
    lastMobile = mobile.matches;
    // A real rebuild reveals the toolbar. Keep the restored character below
    // its full height even if the previous scroll had translated it offscreen.
    const visibleEdge = Math.max(readingEdge(), (window.visualViewport?.offsetTop || 0) + controls.getBoundingClientRect().height + 12);
    if (paged()) rebuildPages(anchor);
    else restore(vertical() && anchor ? { ...anchor, y: Math.max(anchor.y, visibleEdge) } : anchor);
    root.dispatchEvent(new Event('reader-layout'));
  }
  // Pages are windows onto the same source-mapped document and writing stage.
  // Moving the whole stage keeps text, pen, markers and memo coordinates together.
  function rebuildPages(anchor) {
    const height = pageHeight(), origin = root.getBoundingClientRect(), outer = stage.getBoundingClientRect();
    const offset = origin.top - outer.top;
    const units = [];
    if (vertical()) {
      const starts = new Map();
      for (const b of blocks) for (const p of b.parts) {
        const section = p.node.parentElement.closest('.vertical-page');
        if (section && !starts.has(section)) starts.set(section, { b, p });
      }
      for (const el of root.querySelectorAll('.vertical-page')) {
        const r = el.getBoundingClientRect();
        const part = starts.get(el);
        if (part) units.push({ top: r.top - outer.top, bottom: r.bottom - outer.top,
          anchor: { offset: sourceOffset(part.b, part.p.start), ...(part.p.run.annotation ? { annotationIndex: part.p.start - part.p.run.start } : {}) } });
      }
    } else {
      const lines = printSnapshot({ allowDraft: true }).lines;
      let i = 0;
      for (const block of blocks) for (const line of block.lines) {
        const measured = lines[i++], run = block.runs.find(r => line.start >= r.start && line.start < r.end);
        units.push({ top: offset + measured.top, bottom: offset + measured.bottom,
          anchor: { offset: sourceOffset(block, line.start), ...(run?.annotation ? { annotationIndex: line.start - run.start } : {}) } });
      }
    }
    const end = root.querySelector('.reading-end-marker');
    if (end) { const r = end.getBoundingClientRect(); units.push({ top: r.top - outer.top, bottom: r.bottom - outer.top, anchor: { offset: displayEnd ?? source.length } }); }
    pages = [];
    for (const unit of units) {
      const last = pages.at(-1);
      const gutter = vertical() ? 8 : 0;
      if (!last || unit.bottom - last.top > height - 32 || vertical())
        pages.push({ top: Math.max(0, Math.floor(unit.top - gutter)), bottom: unit.bottom + gutter, anchor: unit.anchor });
      else last.bottom = Math.max(last.bottom, unit.bottom + gutter);
    }
    if (!pages.length) pages.push({ top: 0, bottom: height, anchor: { offset: 0 } });
    lastPageHeight = height;
    viewport.style.height = `${height}px`;
    pageControls.style.bottom = `${measurementBar.hidden ? 0 : measurementBar.getBoundingClientRect().height}px`;
    document.getElementById('reading').style.setProperty('--page-bottom-space', `${Math.max(52, pageControls.getBoundingClientRect().height) + (measurementBar.hidden ? 0 : measurementBar.getBoundingClientRect().height) + 24}px`);
    showPage(Math.min(pageIndex, pages.length - 1));
    if (anchor) restore(anchor); else showPage(0);
    alignPage();
  }
  function alignPage() {
    if (!paged() || root.closest('[hidden]')) return;
    const target = viewport.getBoundingClientRect().top + scrollY - controls.getBoundingClientRect().height - 12;
    window.scrollTo(0, Math.max(0, target));
  }
  function showPage(index) {
    pageIndex = Math.max(0, Math.min(index, pages.length - 1));
    if (!pages.length) return;
    stage.style.top = `${-pages[pageIndex].top}px`;
    // A short vertical section (or the last page) must not reveal the next page.
    viewport.style.height = `${lastPageHeight}px`;
    document.getElementById('reading').style.setProperty('--page-bottom-space', `${Math.max(52, pageControls.getBoundingClientRect().height) + (measurementBar.hidden ? 0 : measurementBar.getBoundingClientRect().height) + 24}px`);
    document.getElementById('page-position').textContent = `${pageIndex + 1} / ${pages.length} ページ`;
    document.getElementById('page-previous').disabled = pageIndex === 0;
    document.getElementById('page-next').disabled = pageIndex === pages.length - 1;
    pageControls.dataset.direction = direction;
    pageReadingAnchor = { ...pages[pageIndex].anchor };
    savedAnchor = { ...pages[pageIndex].anchor, y: viewport.getBoundingClientRect().top + 8 };
  }
  function pageBusy(implicit) {
    const selection = window.getSelection();
    const selectingText = selection && !selection.isCollapsed && (viewport.contains(selection.anchorNode) || viewport.contains(selection.focusNode));
    return Boolean(root.closest('[hidden]') || document.querySelector('dialog[open]') || draft || window.ManuscriptWriting?.hasPending
      || (implicit && (rubyMode || window.ManuscriptWriting?.enabled || selectingText)));
  }
  function turnPage(delta, implicit = false) {
    if (!paged() || pageBusy(implicit)) return false;
    const next = Math.max(0, Math.min(pages.length - 1, pageIndex + delta));
    if (next === pageIndex) return false;
    showPage(next); alignPage();
    root.dispatchEvent(new Event('reader-page'));
    return true;
  }
  document.getElementById('page-previous').onclick = () => turnPage(-1);
  document.getElementById('page-next').onclick = () => turnPage(1);
  const pageStart = document.getElementById('page-start'), startButton = document.getElementById('start');
  pageStart.onclick = () => startButton.click();
  const syncPageStart = () => {
    pageStart.hidden = document.getElementById('preparation').hidden;
    pageStart.disabled = startButton.disabled;
  };
  new MutationObserver(syncPageStart).observe(document.getElementById('preparation'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(syncPageStart).observe(startButton, { attributes: true, attributeFilter: ['disabled'] });
  syncPageStart();
  let wheelAt = -Infinity, wheelTurnAt = -Infinity, wheelSum = 0, wheelUsed = false;
  reading.addEventListener('wheel', event => {
    if (!paged()) { scrollModeAnchor = null; return; }
    if (event.ctrlKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (target?.closest('dialog,[contenteditable=true],input,textarea,select')) return;
    event.preventDefault();
    const now = performance.now();
    if (now - wheelAt > 220) { wheelUsed = false; wheelSum = 0; }
    wheelAt = now;
    if (pageBusy(true) || wheelUsed) return;
    wheelSum += event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? pageHeight() : 1);
    if (Math.abs(wheelSum) >= 24 && now - wheelTurnAt >= 450) {
      turnPage(Math.sign(wheelSum), true); wheelUsed = true; wheelTurnAt = now;
    }
  }, { passive: false, capture: true });
  document.addEventListener('keydown', event => {
    if (!paged() && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) scrollModeAnchor = null;
    if (!paged() || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || event.target.closest('input,textarea,select,[contenteditable=true],dialog') || pageBusy(true)) return;
    const forward = vertical() ? ['ArrowLeft', 'ArrowDown'] : ['ArrowRight', 'ArrowDown'];
    const backward = vertical() ? ['ArrowRight', 'ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
    const delta = forward.includes(event.key) ? 1 : backward.includes(event.key) ? -1 : 0;
    if (delta) { event.preventDefault(); turnPage(delta, true); }
  });
  let touch = null;
  const touchPointers = new Set();
  viewport.addEventListener('pointerdown', event => {
    if (!paged()) scrollModeAnchor = null;
    if (event.pointerType !== 'touch') return;
    touchPointers.add(event.pointerId);
    if (!paged() || pageBusy(true) || touchPointers.size > 1 || event.target.closest('button,input,textarea,select,a,.writing-memo')) { touch = null; return; }
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
  }, true);
  viewport.addEventListener('pointerup', event => {
    touchPointers.delete(event.pointerId);
    const start = touch; touch = null;
    if (!start || start.id !== event.pointerId || pageBusy(true) || performance.now() - start.at > 700) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) turnPage((vertical() ? dx : -dx) > 0 ? 1 : -1, true);
    else if (Math.hypot(dx, dy) < 10 && performance.now() - start.at < 400) {
      const r = viewport.getBoundingClientRect(), fraction = (event.clientX - r.left) / r.width;
      if (fraction < .22 || fraction > .78) turnPage((vertical() ? fraction < .22 : fraction > .78) ? 1 : -1, true);
    }
  }, true);
  viewport.addEventListener('pointercancel', event => { touchPointers.delete(event.pointerId); touch = null; }, true);
  viewport.addEventListener('focusin', event => {
    const note = event.target.closest('.reading-annotation');
    if (!paged() || !note) return;
    const r = note.getBoundingClientRect(), v = viewport.getBoundingClientRect();
    if (r.bottom >= v.top && r.top <= v.bottom) return;
    // Tab navigation to another ruby must reveal its page, not scroll a hidden flow.
    restore({ offset: Number(note.dataset.offset), y: readingEdge() + 8 }); alignPage();
  });
  // Keep original graphemes separate from manual reading boxes so pen anchors
  // and source hit testing stay unchanged. Coordinates stay relative to the
  // reader so scrolling never invalidates them or changes annotation offsets.
  function getWritingGeometry() {
    if (writingGeometry) return writingGeometry;
    const origin = root.getBoundingClientRect(), glyphs = [], annotationRects = [];
    for (const block of blocks) for (const part of block.parts) {
      if (part.run.annotation) {
        if (!part.run.pending) {
          range.selectNodeContents(part.node);
          for (const rect of range.getClientRects()) if (rect.width && rect.height) {
            annotationRects.push({ offset: part.run.sourceStart,
              x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height });
          }
        }
        continue;
      }
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
    writingGeometry = { glyphs, readingOrder: vertical() ? [...glyphs].sort((a, b) => a.y - b.y || b.x - a.x) : [], annotationRects, byOffset: new Map(glyphs.map(g => [g.start, g])), fontSize, width: origin.width,
      layoutKey: `${(origin.width / fontSize).toFixed(2)}:${settings.height}:${settings.breaks}:${flowHash >>> 0}` };
    return writingGeometry;
  }
  function getAnnotationGlyphs() {
    if (annotationGeometry) return annotationGeometry;
    const origin = root.getBoundingClientRect(), result = [];
    for (const block of blocks) for (const part of block.parts) if (part.run.annotation && !part.run.pending) {
      for (const s of segmenter.segment(part.node.data)) {
        range.setStart(part.node, s.index); range.setEnd(part.node, s.index + s.segment.length);
        const r = range.getBoundingClientRect();
        if (r.width && r.height) result.push({ offset: part.run.sourceStart, readingIndex: part.start - part.run.start + s.index,
          x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height });
      }
    }
    annotationGeometry = result; return result;
  }
  function printSnapshot({ allowDraft = false } = {}) {
    // Pagination needs the live ruby preview; PDF export still rejects drafts.
    if (draft && !allowDraft) throw new Error('読み仮名を登録またはキャンセルしてからPDF出力してください。');
    if (printing() || root.closest('[hidden]')) throw new Error('朗読画面でPDF出力してください。');
    const origin = root.getBoundingClientRect(), computed = getComputedStyle(root);
    const font = {};
    for (const name of ['fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'fontStyle', 'fontStretch', 'fontKerning', 'fontFeatureSettings', 'fontVariantLigatures', 'fontVariantEastAsian', 'letterSpacing', 'wordSpacing', 'tabSize', 'direction']) font[name] = computed[name];
    if (vertical()) return verticalPrintSnapshot(origin, font);
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
    const withLine = glyph => {
      const y = glyph.y + glyph.height / 2;
      let lo = 0, hi = lines.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (lines[mid].center < y) lo = mid + 1; else hi = mid; }
      const next = Math.min(lo, lines.length - 1), previous = Math.max(0, next - 1);
      const line = Math.abs(lines[previous].center - y) < Math.abs(lines[next].center - y) ? previous : next;
      return { ...glyph, line };
    };
    return { width: origin.width, font, lines, glyphs: geometry.glyphs.map(withLine),
      annotationRects: geometry.annotationRects.map(withLine), annotationGlyphs: (allowDraft ? [] : getAnnotationGlyphs()).map(withLine) };
  }
  function verticalPrintSnapshot(origin, font) {
    // Unfold viewport sections into a continuous right-to-left column table.
    // Logical x is distance down a column; logical y is reading progress left.
    // Only coordinates are normalized: print still uses native vertical text.
    const lines = [], sections = [], columns = [];
    const pitch = parseFloat(font.lineHeight);
    let base = 0, previousEnd = 0, inlineSize = 0;
    for (const block of blocks) {
      const blank = source.slice(previousEnd, block.start).match(/\r\n|\r|\n/g) || [];
      base += Math.max(0, blank.length - (previousEnd ? 1 : 0)) * pitch;
      let section = null;
      for (const line of block.lines) {
        const part = block.parts.find(p => line.start >= p.start && line.start < p.end);
        const column = part?.node.parentElement.closest('.vertical-column');
        if (!column) throw new Error('縦書きの列を確認できません。原稿画面を開き直してください。');
        if (section?.element !== column.parentElement) {
          const el = column.parentElement, r = el.getBoundingClientRect();
          section = { element: el, top: r.top - origin.top, bottom: r.bottom - origin.top, right: r.right - origin.left, base, first: lines.length, last: lines.length };
          sections.push(section); inlineSize = Math.max(inlineSize, r.height);
        }
        const map = r => ({ left: r.top - origin.top - section.top, top: section.base + section.right - (r.right - origin.left), width: r.height, height: r.width });
        const first = point(block, line.start), center = map(first).top + first.width / 2;
        const pieces = [], rects = [], ranges = [];
        for (const p of block.parts) {
          const begin = Math.max(line.start, p.start), end = Math.min(line.end, p.end);
          if (begin >= end) continue;
          range.setStart(p.node, begin - p.start); range.setEnd(p.node, end - p.start);
          rects.push(...[...range.getClientRects()].filter(r => r.width && r.height).map(map));
          if (!p.run.annotation) ranges.push({ start: p.run.sourceStart + begin - p.run.start, end: p.run.sourceStart + end - p.run.start });
          if (p.run.sourceRuby) {
            const r = range.getBoundingClientRect(), unit = p.node.parentElement.closest('.source-ruby-unit');
            const readingRange = document.createRange(); readingRange.selectNodeContents(unit.querySelector('rt'));
            const bounds = map(unit.getBoundingClientRect()), readingBounds = map(readingRange.getBoundingClientRect());
            rects.push(bounds, readingBounds);
            pieces.push({ text: p.node.data, ...map(r), annotation: null,
              sourceRuby: { ...p.run.sourceRuby, base: p.node.data, bounds, readingBounds } });
          } else for (const match of block.text.slice(begin, end).matchAll(/[^\r\n\t\u2028\u2029]+/gu)) {
            range.setStart(p.node, begin - p.start + match.index); range.setEnd(p.node, begin - p.start + match.index + match[0].length);
            pieces.push({ text: match[0], ...map(range.getBoundingClientRect()), annotation: p.run.annotation ? p.run.sourceStart : null });
          }
        }
        const box = column.getBoundingClientRect();
        const top = Math.min(center - pitch / 2, ...rects.map(r => r.top));
        const bottom = Math.max(center + pitch / 2, ...rects.map(r => r.top + r.height));
        columns.push({ section, center: box.left + box.width / 2 - origin.left, ranges });
        lines.push({ top, bottom, center, autoBefore: 0, pieces });
        section.last = lines.length - 1;
        base = section.base + section.right - (box.left - origin.left);
      }
      previousEnd = block.sourceEnd;
    }
    const geometry = getWritingGeometry();
    const sourceRanges = columns.flatMap((c, line) => c.ranges.map(r => ({ ...r, line }))).sort((a, b) => a.start - b.start);
    const convert = (g, annotation = false) => {
      let index = -1;
      if (!annotation) {
        let lo = 0, hi = sourceRanges.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (sourceRanges[mid].start <= g.start) lo = mid + 1; else hi = mid; }
        const r = sourceRanges[lo - 1];
        if (r && g.start < r.end) index = r.line;
      }
      if (index < 0) {
        let lo = 0, hi = sections.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (sections[mid].bottom < g.y + g.height / 2) lo = mid + 1; else hi = mid; }
        const s = sections[Math.min(lo, sections.length - 1)];
        let distance = Infinity;
        if (s) for (let i = s.first; i <= s.last; i++) {
          const d = Math.abs(columns[i].center - g.x - g.width / 2);
          if (d < distance) { distance = d; index = i; }
        }
      }
      if (index < 0) throw new Error('書き込みと縦書き本文の対応を確認できません。');
      const s = columns[index].section;
      return { ...g, x: g.y - s.top, y: s.base + s.right - g.x - g.width, width: g.height, height: g.width, line: index };
    };
    return { direction: 'vertical', width: inlineSize, font, lines,
      glyphs: geometry.glyphs.map(g => convert(g)), annotationRects: geometry.annotationRects.map(g => convert(g, true)),
      annotationGlyphs: getAnnotationGlyphs().map(g => convert(g, true)),
      sections: sections.map(({ element, ...s }) => s) };
  }
  function updateMode(on) {
    rubyMode = Boolean(annotations && annotationsEditable && on);
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
      // Suspend the editor without committing or discarding its draft while
      // the writing-position confirmation is shown.
      editorSuspended = true; editor.close();
      let approved;
      try { approved = await readingChangeGuard(); }
      finally {
        editorSuspended = false;
        if (draft === currentDraft && annotations === model) {
          editor.showModal(); rubyInput.focus({ preventScroll: true });
        }
      }
      if (!approved) return;
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
  editor.addEventListener('close', () => { if (!editor.open && !editorSuspended) finishEdit(); });
  let editModeGuard = async () => true;
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
        const boundary = (vertical() ? y < rect.top + rect.height / 2 : x < rect.left + rect.width / 2) ? first : end;
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
  const refreshVisibleHeight = () => {
    if (printing() || root.closest('[hidden]')) return;
    if (paged() ? Math.abs(pageHeight() - lastPageHeight) < .5 : !vertical() || Math.abs(columnHeight() - lastColumnHeight) < .5) return;
    cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(() => layout(savedAnchor));
  };
  const viewportObserver = new ResizeObserver(refreshVisibleHeight);
  viewportObserver.observe(controls, { box: 'border-box' });
  viewportObserver.observe(measurementBar, { box: 'border-box' });
  viewportObserver.observe(pageControls, { box: 'border-box' });
  viewportObserver.observe(viewportProbe, { box: 'border-box' });
  window.visualViewport?.addEventListener('resize', refreshVisibleHeight);
  addEventListener('resize', refreshVisibleHeight);
  mobile.addEventListener('change', () => {
    if (!root.closest('[hidden]')) layout(savedAnchor);
  });
  addEventListener('scroll', () => { savedAnchor = capture(); }, { passive: true });
  document.fonts.ready.then(() => { if (source) layout(savedAnchor); });
  window.Reader = {
    show(text, model = null, { editable = true, end = null, writingDirection = 'horizontal' } = {}) {
      finishEdit(); source = text; annotations = model;
      direction = writingDirection === 'vertical' ? 'vertical' : 'horizontal';
      displayEnd = editable ? null : end;
      annotationsEditable = editable;
      updateMode(false);
      savedAnchor = null; scrollModeAnchor = null; pageReadingAnchor = null; pages = []; pageIndex = 0; layout(null);
    },
    leave() { finishEdit(); updateMode(false); },
    setDisplayEnd(end) {
      if (annotationsEditable || displayEnd === end) return;
      const anchor = capture(); displayEnd = end; layout(anchor);
    },
    configure(next) {
      const anchor = capture();
      if (next.direction !== undefined) direction = next.direction === 'vertical' ? 'vertical' : 'horizontal';
      if (next.width !== undefined && !mobile.matches) settings.width = next.width;
      if (next.columns !== undefined) {
        settings.fontSize = Math.min(36, Math.max(18, root.getBoundingClientRect().width / next.columns));
      }
      if (next.height !== undefined) settings.height = next.height;
      if (next.breaks !== undefined) settings.breaks = next.breaks;
      layout(anchor);
    },
    setDisplayMode(value) {
      const next = value === 'pages' ? 'pages' : 'scroll';
      let anchor = capture();
      // A vertical section can leave the tail of its preceding section visible.
      // Keep the deliberate page anchor when toggling back without reading on.
      if (next === 'pages' && displayMode === 'scroll' && scrollModeAnchor) {
        const block = blocks.find(b => scrollModeAnchor.offset >= b.start && scrollModeAnchor.offset <= b.sourceEnd);
        const rect = block && point(block, displayOffset(block, scrollModeAnchor.offset, scrollModeAnchor.annotationIndex));
        if (rect && rect.bottom >= readingEdge() && rect.top < innerHeight) anchor = scrollModeAnchor;
      }
      const fromPages = displayMode === 'pages';
      displayMode = next;
      document.getElementById('display-mode-state').textContent = displayMode === 'pages' ? 'ページめくり' : 'スクロール';
      document.getElementById('page-turn-help').hidden = displayMode !== 'pages';
      layout(anchor);
      scrollModeAnchor = fromPages && next === 'scroll' ? anchor : null;
    },
    get displayMode() { return displayMode; },
    get pageState() { return { current: pageIndex + 1, total: pages.length, height: lastPageHeight, pages: pages.map(p => ({ ...p, anchor: { ...p.anchor } })) }; },
    turnPage,
    withPrintLayout(action, constraints = null) {
      if (!paged() && !constraints) return action();
      const anchor = capture();
      // Snapshot callbacks are synchronous; restore the screen before the next paint.
      printLayout = true; printConstraints = constraints;
      try { layout(null); return action(); }
      finally { printConstraints = null; printLayout = false; layout(anchor); }
    },
    capture, restore, printSnapshot, getWritingGeometry,
    get direction() { return direction; },
    get viewportHeight() { return viewportHeight(); },
    get hasPending() { return Boolean(draft); },
    focusPending() { if (editor.open) rubyInput.focus({ preventScroll: true }); },
    setEditModeGuard(guard) { editModeGuard = guard; },
    setReadingChangeGuard(guard) { readingChangeGuard = guard; },
    setRubyMode(on) { const anchor = capture(); finishEdit(); updateMode(on); layout(anchor); },
    async activateRubyMode() {
      if (!await editModeGuard(true)) return false;
      const anchor = capture(); finishEdit(); updateMode(true); layout(anchor); return true;
    },
    refresh(anchor = savedAnchor) { savedAnchor = anchor; layout(anchor); }
  };
})();
