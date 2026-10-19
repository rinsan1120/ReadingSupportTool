/* Frozen text, not a screenshot: retain measured screen lines and paginate in
 * an independent A4 document. No manuscript, settings or Storage is mutated. */
(() => {
  const root = document.getElementById('manuscript-print');
  let ready = false;
  function clear() {
    ready = false;
    document.body.classList.remove('manuscript-printing');
    root.classList.remove('print-measuring');
    root.replaceChildren();
  }
  const svg = (name, attrs, parent) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    parent.append(el); return el;
  };
  // Divide each vector segment at source-line bands BEFORE pagination. Each
  // fragment then follows its line's page/translation, including removed auto
  // gaps. A single global Y scale would put strokes on the wrong page.
  function splitStroke(points, lines) {
    const cuts = lines.slice(1).map((line, i) => (lines[i].bottom + line.top) / 2);
    const band = y => {
      let lo = 0, hi = cuts.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (cuts[mid] < y) lo = mid + 1; else hi = mid; }
      return lo;
    };
    const fragments = new Map();
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dy = b.y - a.y;
      for (let row = band(Math.min(a.y, b.y)); row <= band(Math.max(a.y, b.y)); row++) {
        const low = row ? cuts[row - 1] : -Infinity, high = cuts[row] ?? Infinity;
        let from = 0, to = 1;
        if (dy) { const t1 = (low - a.y) / dy, t2 = (high - a.y) / dy; from = Math.max(0, Math.min(t1, t2)); to = Math.min(1, Math.max(t1, t2)); }
        if (to < from) continue;
        const point = t => ({ x: a.x + (b.x - a.x) * t, y: a.y + dy * t });
        const start = point(from), end = point(to), paths = fragments.get(row) || [];
        const last = paths.at(-1)?.at(-1);
        if (last && Math.hypot(last.x - start.x, last.y - start.y) < .001) paths.at(-1).push(end);
        else paths.push([start, end]);
        fragments.set(row, paths);
      }
    }
    return fragments;
  }
  function prepare(snapshot, writing = { items: [], pens: [], hiddenPens: 0 }) {
    clear();
    let pendingAuto = 0;
    const lines = snapshot.lines.flatMap((line, index) => {
      pendingAuto += line.autoBefore;
      if (!line.pieces.some(p => p.text.trim())) return [];
      const copy = { ...line, index, autoBefore: pendingAuto, strokes: [] };
      pendingAuto = 0;
      return [copy];
    });
    if (!lines.length) throw new Error('出力する本文または登録済みの読み仮名がありません。');
    const byLine = new Map(lines.map(line => [line.index, line]));
    const glyphs = new Map((snapshot.glyphs || []).map(g => [g.start, g]));
    const glyphsByLine = new Map();
    for (const glyph of snapshot.glyphs || []) {
      if (!glyphsByLine.has(glyph.line)) glyphsByLine.set(glyph.line, []);
      glyphsByLine.get(glyph.line).push(glyph);
    }
    let minX = 0, maxX = snapshot.width;
    for (const pen of writing.pens) {
      for (const point of pen.points) { minX = Math.min(minX, point.x - 1.4); maxX = Math.max(maxX, point.x + 1.4); }
      for (const [row, paths] of splitStroke(pen.points, lines)) lines[row].strokes.push({ id: pen.id, paths });
    }
    // Connected lines containing the same annotation stay on the same page.
    const last = new Map();
    lines.forEach((line, i) => line.pieces.forEach(p => { if (p.annotation !== null) last.set(p.annotation, i); }));
    const groups = [], groupByLine = new Map();
    for (let i = 0; i < lines.length;) {
      let end = i;
      for (let j = i; j <= end; j++) for (const piece of lines[j].pieces) if (piece.annotation !== null) end = Math.max(end, last.get(piece.annotation));
      const group = lines.slice(i, end + 1);
      group.extentTop = group[0].top; group.extentBottom = group.at(-1).bottom;
      for (const line of group) for (const stroke of line.strokes) for (const path of stroke.paths) for (const point of path) {
        group.extentTop = Math.min(group.extentTop, point.y - 1.4);
        group.extentBottom = Math.max(group.extentBottom, point.y + 1.4);
      }
      group.memos = []; groups.push(group);
      for (const line of group) groupByLine.set(line.index, group);
      i = end + 1;
    }
    root.classList.add('print-measuring');
    const measurePage = document.createElement('section'); measurePage.className = 'manuscript-page'; root.append(measurePage);
    const bounds = measurePage.getBoundingClientRect();
    const memoItems = writing.items.filter(item => item.type === 'memo');
    // The note rail uses a physical 9pt font, even if wide screen text shrinks.
    // Measure text (not live memo DOM) before deciding where pages can end.
    const memoWidth = 112, rail = memoItems.length ? memoWidth + 12 : 0;
    for (const item of memoItems) {
      const glyph = glyphs.get(item.offset), line = glyph && byLine.get(glyph.line);
      if (!line) throw new Error('文字メモの本文位置を確認できません。朗読画面を開き直してから出力してください。');
      const el = document.createElement('div'); el.className = 'manuscript-memo'; el.dataset.markId = item.id; el.dataset.offset = item.offset;
      const context = document.createElement('small'), content = document.createElement('span');
      context.textContent = `「${Array.from(writing.source.slice(item.offset)).slice(0, 5).join('').replace(/\s/g, ' ')}」`;
      content.textContent = item.text; el.append(context, content); measurePage.append(el);
      groupByLine.get(line.index).memos.push({ item, glyph, el, height: el.getBoundingClientRect().height });
    }
    const maxGroupHeight = groups.reduce((height, g) => Math.max(height, g.extentBottom - g.extentTop), 0);
    const scale = Math.min(1, (bounds.width - rail) / (maxX - minX), (bounds.height - 1) / maxGroupHeight);
    const pages = []; let page, cursor = 0, previous = null;
    const placeMemos = (group, top, bottom) => {
      const placed = group.memos.map(memo => {
        const ideal = top + (memo.glyph.y - group[0].top + memo.item.dy * parseFloat(snapshot.font.fontSize)) * scale;
        const placedTop = Math.max(bottom, Math.min(bounds.height - memo.height, Math.max(0, ideal)));
        bottom = placedTop + memo.height + 6;
        return { ...memo, placedTop };
      });
      // A cluster near the footer may still fit by moving upward together.
      // Only overflow into earlier notes (or past the page top) needs a break.
      let ceiling = bounds.height;
      for (let i = placed.length - 1; i >= 0; i--) {
        placed[i].placedTop = Math.min(placed[i].placedTop, ceiling - placed[i].height);
        ceiling = placed[i].placedTop - 6;
      }
      return placed;
    };
    for (const group of groups) {
      const first = group[0], height = (group.extentBottom - first.top) * scale;
      let gap = Math.max(0, first.top - (previous?.bottom || 0)) * scale;
      let memos = placeMemos(group, cursor + gap, page?.noteBottom || 0);
      if (!page || cursor + gap + height > bounds.height - .5 || memos.some(m => m.placedTop < (page.noteBottom || 0))) {
        if (page) gap = Math.max(0, gap - first.autoBefore * scale);
        page = { lines: [], memos: [], noteBottom: 0 }; pages.push(page); cursor = 0;
        // Original blank lines consume available space, without empty pages.
        gap = Math.min(gap, Math.max(0, bounds.height - height - 1));
        gap = Math.max(gap, (first.top - group.extentTop) * scale);
        memos = placeMemos(group, gap, 0);
        if (memos.some(m => m.placedTop < 0)) throw new Error('同じ本文位置の文字メモが1ページに収まりません。メモを短くするか件数を減らしてから出力してください。');
      }
      const top = (cursor + gap) / scale;
      for (const line of group) page.lines.push({ ...line, placedTop: top + line.top - first.top });
      page.memos.push(...memos); page.noteBottom = memos.length ? memos.at(-1).placedTop + memos.at(-1).height + 6 : page.noteBottom;
      cursor += gap + (group.at(-1).bottom - first.top) * scale; previous = group.at(-1);
    }
    root.replaceChildren();
    const probes = [];
    const scaledFont = { ...snapshot.font };
    for (const name of ['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing']) {
      if (scaledFont[name].endsWith('px')) scaledFont[name] = `${parseFloat(scaledFont[name]) * scale}px`;
    }
    for (const { lines: pageLines, memos } of pages) {
      const sheet = document.createElement('section'); sheet.className = 'manuscript-page';
      const canvas = document.createElement('div'); canvas.className = 'manuscript-canvas';
      // Scale type and coordinates together rather than a CSS transform: print
      // engines may fragment/clip the unscaled overflow of a transformed canvas.
      canvas.dataset.scale = scale;
      const left = (bounds.width - ((maxX - minX) * scale + rail)) / 2 - minX * scale;
      Object.assign(canvas.style, scaledFont, { width: `${snapshot.width * scale + rail}px`, left: `${left}px` });
      const markerLayer = svg('svg', { class: 'manuscript-markers', width: snapshot.width * scale, height: bounds.height }, canvas);
      for (const line of pageLines) {
        const row = document.createElement('div'); row.className = 'manuscript-line';
        row.dataset.sourceLine = line.index;
        for (const piece of line.pieces) {
          const span = document.createElement('span'); span.className = 'manuscript-piece';
          if (piece.annotation !== null) { span.classList.add('manuscript-annotation'); span.dataset.annotation = piece.annotation; }
          span.textContent = piece.text;
          span.style.left = `${piece.left * scale}px`;
          row.append(span);
          probes.push({ span, top: (line.placedTop + piece.top - line.top) * scale, left: piece.left * scale });
        }
        canvas.append(row);
      }
      // Reconstruct marker boxes from frozen ORIGINAL glyphs, not screen SVGs.
      const placedLines = new Map(pageLines.map(line => [line.index, line]));
      const pageGlyphs = pageLines.flatMap(line => glyphsByLine.get(line.index) || []);
      for (const item of writing.items) if (item.type === 'marker') {
        for (const glyph of pageGlyphs) {
          const line = placedLines.get(glyph.line);
          if (!line || glyph.end <= item.start || glyph.start >= item.end) continue;
          svg('rect', { x: glyph.x * scale, y: (glyph.y + line.placedTop - line.top) * scale,
            width: glyph.width * scale, height: glyph.height * scale, 'data-mark-id': item.id, 'data-offset': glyph.start }, markerLayer);
        }
      }
      const penLayer = svg('svg', { class: 'manuscript-pens', width: snapshot.width * scale, height: bounds.height }, canvas);
      for (const line of pageLines) for (const stroke of line.strokes) {
        const d = stroke.paths.map(points => points.map((point, i) => `${i ? 'L' : 'M'}${point.x * scale},${(point.y + line.placedTop - line.top) * scale}`).join(' ')).join(' ');
        svg('path', { d, 'stroke-width': 2.8 * scale, 'data-mark-id': stroke.id, 'data-source-line': line.index }, penLayer);
      }
      for (const memo of memos) {
        const railStart = maxX * scale + 12;
        const noteLeft = Math.max(railStart, railStart + memo.item.dx * parseFloat(snapshot.font.fontSize) * scale);
        memo.el.style.left = `${Math.min(noteLeft, bounds.width - left - memoWidth)}px`;
        memo.el.style.top = `${memo.placedTop}px`; canvas.append(memo.el);
        const line = placedLines.get(memo.glyph.line);
        const y = (memo.glyph.y + memo.glyph.height / 2 + line.placedTop - line.top) * scale;
        svg('path', { d: `M${snapshot.width * scale + 2},${y} L${parseFloat(memo.el.style.left) - 3},${memo.placedTop + 7}`, class: 'manuscript-note-link' }, penLayer);
      }
      sheet.append(canvas); root.append(sheet);
    }
    // Match glyph boxes (including font fallback/emoji) rather than assuming a
    // font's ascent. Read in one batch before writing final frozen coordinates.
    const range = document.createRange();
    const positions = probes.map(({ span, top, left }) => {
      range.selectNodeContents(span);
      const ink = range.getBoundingClientRect(), box = span.getBoundingClientRect();
      return { span, top: top - (ink.top - box.top), left: left - (ink.left - box.left) };
    });
    positions.forEach(({ span, top, left }) => { span.style.top = `${top}px`; span.style.left = `${left}px`; });
    root.classList.remove('print-measuring'); ready = true;
    return { pages: pages.length, scale, points: parseFloat(snapshot.font.fontSize) * scale * .75,
      marks: writing.items.length - writing.hiddenPens, hiddenPens: writing.hiddenPens };
  }
  window.ManuscriptPrint = {
    prepare, clear,
    print() {
      if (!ready) throw new Error('印刷用の原稿をもう一度準備してください。');
      document.body.classList.add('manuscript-printing');
      window.print(); // Only the browser/user can confirm whether a file is saved.
    }
  };
})();
