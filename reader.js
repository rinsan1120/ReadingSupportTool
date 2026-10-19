/* Keep inline layout intact: relative positioning moves measured line groups
 * without inserting line breaks, changing text, or changing Japanese line rules. */
(() => {
  const root = document.getElementById('reader');
  const status = document.getElementById('layout-status');
  let source = '', settings = { columns: 28, height: 1.8, breaks: 5 };
  let blocks = [], lastWidth = 0, scheduled = 0;
  let savedAnchor = null;
  const range = document.createRange();
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
        best = { offset: block.start + line.start, y: rect.top };
      }
      if (best) break;
    }
    return best || savedAnchor;
  }
  function restore(anchor) {
    if (!anchor) return;
    const block = blocks.find(b => anchor.offset >= b.start && anchor.offset < b.start + b.text.length);
    if (!block) return;
    const rect = point(block, anchor.offset - block.start);
    if (rect) window.scrollBy(0, rect.top - anchor.y);
    savedAnchor = anchor;
  }
  function measure(block) {
    const node = block.el.firstChild;
    if (!node || !node.length) return [];
    const offsets = [];
    for (let i = 0; i < node.length;) { offsets.push(i); i += node.data.codePointAt(i) > 0xffff ? 2 : 1; }
    offsets.push(node.length);
    const lineHeight = parseFloat(getComputedStyle(block.el).lineHeight);
    const top = i => {
      range.setStart(node, offsets[i]); range.setEnd(node, offsets[i + 1]);
      const rect = range.getBoundingClientRect();
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
    root.style.width = `min(${settings.columns}em, calc(100% - ${innerWidth <= 600 ? 32 : 40}px))`;
    root.style.lineHeight = settings.height;
    root.replaceChildren(); blocks = [];
    // Empty original lines are natural boundaries; retain all whitespace verbatim.
    const chunks = source.split(/((?:\r\n|\n|\r)[\t \u3000]*(?:\r\n|\n|\r)(?:[\t \u3000]*(?:\r\n|\n|\r))*)/);
    let start = 0;
    chunks.forEach((text, index) => {
      if (index % 2) {
        const gap = document.createElement('div'); gap.className = 'natural-gap';
        gap.textContent = text;
        const count = (text.match(/\r\n|\r|\n/g) || []).length;
        gap.style.fontSize = '0'; gap.style.lineHeight = '0';
        // Use pixel height so font-size:0 doesn't remove the intended blank lines.
        gap.style.height = `${(count - (start ? 1 : 0)) * settings.height * parseFloat(getComputedStyle(root).fontSize)}px`;
        root.append(gap);
      } else if (text) {
        const el = document.createElement('div'); el.className = 'text-block'; el.textContent = text;
        root.append(el); blocks.push({ el, text, start, parts: [], lines: [] });
      }
      start += text.length;
    });
    // Batch natural DOM creation before any geometry reads.
    blocks.forEach(b => { b.lines = measure(b); });
    let unsupported = false;
    const gapSize = parseFloat(getComputedStyle(root).fontSize) * .85;
    blocks.forEach(b => {
      const fragment = document.createDocumentFragment();
      const size = settings.breaks || Math.max(1, b.lines.length);
      for (let i = 0; i < b.lines.length; i += size) {
        const first = b.lines[i].start;
        const end = b.lines[Math.min(i + size, b.lines.length) - 1].end;
        const span = document.createElement('span'); span.className = 'line-segment';
        span.textContent = b.text.slice(first, end);
        span.style.top = `${Math.floor(i / size) * gapSize}px`;
        fragment.append(span);
        b.parts.push({ node: span.firstChild, start: first, end });
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
        unsupported = true; b.el.textContent = b.text; b.el.style.paddingBottom = '0';
        b.parts = [{ node: b.el.firstChild, start: 0, end: b.text.length }];
      }
    });
    status.textContent = unsupported ? 'この文章の一部では折り返しを優先し、自動区切りを適用していません。' : '';
    lastWidth = root.getBoundingClientRect().width;
    restore(anchor);
  }
  const observer = new ResizeObserver(() => {
    if (root.closest('[hidden]') || Math.abs(root.getBoundingClientRect().width - lastWidth) < .5) return;
    cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(() => layout(savedAnchor));
  });
  observer.observe(root);
  addEventListener('scroll', () => { savedAnchor = capture(); }, { passive: true });
  document.fonts.ready.then(() => { if (source) layout(savedAnchor); });
  window.Reader = {
    show(text) { source = text; savedAnchor = null; layout(null); },
    configure(next) { settings = { ...settings, ...next }; layout(); },
    capture, restore,
    refresh() { layout(savedAnchor); }
  };
})();
