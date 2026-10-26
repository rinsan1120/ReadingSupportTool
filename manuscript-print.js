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
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function printBubble(item, settings, x, y, tx, ty, parent, scale) {
    // Native print dimensions avoid Chromium clipping the unscaled height of a
    // transformed, tall bubble before shrinking it into its page.
    parent.style.setProperty('--memo-print-scale', scale);
    return window.ManuscriptWriting.bubble(item, { ...settings, fontSize: settings.fontSize * scale }, x, y, tx, ty, parent);
  }
  // Sweep the obstacle edges rather than a pixel grid. For each possible Y,
  // merge forbidden X intervals and keep the nearest unobstructed rectangle.
  function memoPosition(width, height, preferred, obstacles, paper, inset, gap) {
    const right = paper.width - inset - width, bottom = paper.height - inset - height;
    if (right < inset || bottom < inset) return null;
    const ys = new Set([clamp(preferred.y, inset, bottom), inset, bottom]);
    for (const box of obstacles) {
      for (const y of [box.top - height - gap, box.bottom + gap]) if (y >= inset && y <= bottom) ys.add(y);
    }
    let best = null, distance = Infinity;
    for (const y of [...ys].sort((a, b) => Math.abs(a - preferred.y) - Math.abs(b - preferred.y))) {
      if ((y - preferred.y) ** 2 > distance) break;
      const blocked = obstacles.filter(box => y + height + gap > box.top && y - gap < box.bottom)
        .map(box => [box.left - width - gap, box.right + gap]).sort((a, b) => a[0] - b[0]);
      const consider = (from, to) => {
        if (to < from) return;
        const x = clamp(preferred.x, from, to), d = (x - preferred.x) ** 2 + (y - preferred.y) ** 2;
        if (d < distance) { best = { x, y }; distance = d; }
      };
      let from = inset;
      for (const [start, end] of blocked) {
        if (end < from) continue;
        consider(from, Math.min(start, right));
        from = Math.max(from, end);
        if (from > right) break;
      }
      if (from <= right) consider(from, right);
    }
    return best;
  }
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
  function prepare(snapshot, writing = { items: [], pens: [] }) {
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
    const markerBoxesByLine = new Map();
    for (const box of [...(snapshot.glyphs || []), ...(snapshot.annotationRects || [])]) {
      if (!markerBoxesByLine.has(box.line)) markerBoxesByLine.set(box.line, []);
      markerBoxesByLine.get(box.line).push(box);
    }
    let minX = 0, maxX = snapshot.width;
    if (writing.items.some(item => item.type === 'pen' && !writing.pens.some(pen => pen.id === item.id))) {
      throw new Error('赤ペンの描画位置を確認できないためPDFを準備できません。朗読画面を開き直してから出力してください。');
    }
    for (const line of lines) for (const piece of line.pieces) if (piece.sourceRuby) {
      for (const box of [piece.sourceRuby.bounds, piece.sourceRuby.readingBounds]) {
        minX = Math.min(minX, box.left); maxX = Math.max(maxX, box.left + box.width);
      }
    }
    for (const pen of writing.pens) {
      if (pen.points.length < 2 || pen.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('赤ペンの描画座標を確認できないためPDFを準備できません。');
      for (const point of pen.points) { minX = Math.min(minX, point.x - 1.4); maxX = Math.max(maxX, point.x + 1.4); }
      for (const [row, paths] of splitStroke(pen.points, lines)) lines[row].strokes.push({ id: pen.id, paths, color: pen.color ?? 'red' });
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
    const maxGroupHeight = groups.reduce((height, g) => Math.max(height, g.extentBottom - g.extentTop), 0);
    const scale = Math.min(1, bounds.width / (maxX - minX), (bounds.height - 1) / maxGroupHeight);
    const memoInset = 2 * scale, tipInset = 6 * scale;
    const memoItems = writing.items.filter(item => item.type === 'memo');
    const memoSettings = window.ManuscriptMarks.settings(writing.memoSettings);
    for (const [number, item] of memoItems.entries()) {
      const glyph = glyphs.get(item.offset), line = glyph && byLine.get(glyph.line);
      if (!line) throw new Error('文字メモの本文位置を確認できません。朗読画面を開き直してから出力してください。');
      const el = printBubble(item, memoSettings, 0, 0, 0, 0, measurePage, scale);
      const size = el.getBoundingClientRect();
      groupByLine.get(line.index).memos.push({ item, glyph, number: number + 1, width: size.width, height: size.height });
    }
    const pages = []; let page, cursor = 0, previous = null;
    for (const group of groups) {
      const first = group[0], height = (group.extentBottom - first.top) * scale;
      let gap = Math.max(0, first.top - (previous?.bottom || 0)) * scale;
      if (!page || cursor + gap + height > bounds.height - .5) {
        if (page) gap = Math.max(0, gap - first.autoBefore * scale);
        page = { lines: [], memos: [] }; pages.push(page); cursor = 0;
        // Original blank lines consume available space, without empty pages.
        gap = Math.min(gap, Math.max(0, bounds.height - height - 1));
        gap = Math.max(gap, (first.top - group.extentTop) * scale);
      }
      const top = (cursor + gap) / scale;
      for (const line of group) page.lines.push({ ...line, placedTop: top + line.top - first.top });
      page.memos.push(...group.memos);
      cursor += gap + (group.at(-1).bottom - first.top) * scale; previous = group.at(-1);
    }
    root.replaceChildren();
    const probes = [], readingProbes = [], memoPages = [];
    const scaledFont = { ...snapshot.font };
    for (const name of ['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing']) {
      if (scaledFont[name].endsWith('px')) scaledFont[name] = `${parseFloat(scaledFont[name]) * scale}px`;
    }
    for (const { lines: pageLines, memos } of pages) {
      const sheet = document.createElement('section'); sheet.className = 'manuscript-page';
      const canvas = document.createElement('div'); canvas.className = 'manuscript-canvas';
      // Attach the canvas before measuring its text and print-sized bubbles.
      sheet.append(canvas); root.append(sheet);
      // Scale type and coordinates together rather than a CSS transform: print
      // engines may fragment/clip the unscaled overflow of a transformed canvas.
      canvas.dataset.scale = scale;
      const left = (bounds.width - ((maxX - minX) * scale)) / 2 - minX * scale;
      Object.assign(canvas.style, scaledFont, { width: `${snapshot.width * scale}px`, left: `${left}px` });
      const markerLayer = svg('svg', { class: 'manuscript-markers', width: snapshot.width * scale, height: bounds.height }, canvas);
      for (const line of pageLines) {
        const row = document.createElement('div'); row.className = 'manuscript-line';
        row.dataset.sourceLine = line.index;
        for (const piece of line.pieces) {
          const span = document.createElement('span'); span.className = 'manuscript-piece';
          if (piece.annotation !== null) { span.classList.add('manuscript-annotation'); span.dataset.annotation = piece.annotation; }
          let inkNode = span;
          if (piece.sourceRuby) {
            const ruby = document.createElement('ruby'), rt = document.createElement('rt'), reading = document.createElement('span');
            const base = document.createTextNode(piece.sourceRuby.base);
            reading.className = 'manuscript-ruby-reading'; reading.textContent = piece.sourceRuby.reading;
            rt.append(reading); ruby.append(base, rt); span.append(ruby);
            span.classList.add('manuscript-source-ruby');
            span.dataset.start = piece.sourceRuby.start; span.dataset.end = piece.sourceRuby.end;
            inkNode = base;
            readingProbes.push({ reading, canvas, left: piece.sourceRuby.readingBounds.left * scale,
              top: (line.placedTop + piece.sourceRuby.readingBounds.top - line.top) * scale });
          } else span.textContent = piece.text;
          span.style.left = `${piece.left * scale}px`;
          row.append(span);
          probes.push({ span, inkNode, top: (line.placedTop + piece.top - line.top) * scale, left: piece.left * scale });
        }
        canvas.append(row);
      }
      // Original glyphs and eligible manual readings share the frozen line map.
      const placedLines = new Map(pageLines.map(line => [line.index, line]));
      const pageBoxes = pageLines.flatMap(line => markerBoxesByLine.get(line.index) || []);
      for (const item of writing.items) if (item.type === 'marker') {
        for (const box of pageBoxes) {
          const line = placedLines.get(box.line);
          const included = box.offset !== undefined ? item.start < box.offset && box.offset <= item.end
            : box.end > item.start && box.start < item.end;
          if (!line || !included) continue;
          svg('rect', { x: box.x * scale, y: (box.y + line.placedTop - line.top) * scale,
            width: box.width * scale, height: box.height * scale, 'data-mark-id': item.id,
            ...(box.offset !== undefined ? { 'data-annotation': box.offset } : { 'data-offset': box.start }),
            'data-color': item.color ?? 'yellow' }, markerLayer);
        }
      }
      const penLayer = svg('svg', { class: 'manuscript-pens', width: snapshot.width * scale, height: bounds.height }, canvas);
      for (const line of pageLines) for (const stroke of line.strokes) {
        for (const path of stroke.paths) for (const point of path) {
          const x = left + point.x * scale, y = (point.y + line.placedTop - line.top) * scale, radius = 1.4 * scale;
          if (x - radius < -.01 || x + radius > bounds.width + .01 || y - radius < -.01 || y + radius > bounds.height + .01) {
            throw new Error('赤ペンが印刷領域を超えるためPDFを準備できません。赤ペンを移動してから出力してください。');
          }
        }
        const d = stroke.paths.map(points => points.map((point, i) => `${i ? 'L' : 'M'}${point.x * scale},${(point.y + line.placedTop - line.top) * scale}`).join(' ')).join(' ');
        svg('path', { d, 'stroke-width': 2.8 * scale, 'data-mark-id': stroke.id, 'data-source-line': line.index, 'data-color': stroke.color }, penLayer);
      }
      memoPages.push({ sheet, canvas, pageLines, placedLines, memos, left });
    }
    // Match glyph boxes (including font fallback/emoji) rather than assuming a
    // font's ascent. Read in one batch before writing final frozen coordinates.
    const range = document.createRange();
    const positions = probes.map(({ span, inkNode, top, left }) => {
      range.selectNodeContents(inkNode);
      const ink = range.getBoundingClientRect(), box = span.getBoundingClientRect();
      return { span, top: top - (ink.top - box.top), left: left - (ink.left - box.left) };
    });
    positions.forEach(({ span, top, left }) => { span.style.top = `${top}px`; span.style.left = `${left}px`; });
    // Ruby font metrics round differently after shrinking. Keep native ruby's
    // shaping/alignment, then correct its reading ink to the frozen screen box.
    const readingPositions = readingProbes.map(({ reading, canvas, left, top }) => {
      range.selectNodeContents(reading);
      const ink = range.getBoundingClientRect(), box = canvas.getBoundingClientRect();
      return { reading, left: left - (ink.left - box.left), top: top - (ink.top - box.top) };
    });
    readingPositions.forEach(({ reading, left, top }) => { reading.style.left = `${left}px`; reading.style.top = `${top}px`; });
    // Only now are the final base/ruby ink boxes known. Keep bubble bodies clear
    // of them, vector marks and already placed bubbles, without moving the text.
    for (const { sheet, canvas, pageLines, placedLines, memos, left } of memoPages) {
      if (!memos.length) continue;
      const paper = sheet.getBoundingClientRect(), gap = Math.max(3, 4 * scale);
      const obstacles = [...sheet.querySelectorAll('.manuscript-piece,.manuscript-ruby-reading,.manuscript-pens path,.manuscript-markers rect')].map(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left - paper.left, right: r.right - paper.left, top: r.top - paper.top, bottom: r.bottom - paper.top };
      });
      const overflow = [];
      for (const memo of memos) {
        const line = placedLines.get(memo.glyph.line), font = parseFloat(snapshot.font.fontSize) * scale;
        const gx = (memo.glyph.x + memo.glyph.width / 2) * scale;
        const gy = (memo.glyph.y + memo.glyph.height / 2 + line.placedTop - line.top) * scale;
        const preferred = { x: left + gx + memo.item.dx * font, y: gy + memo.item.dy * font };
        const position = memoPosition(memo.width, memo.height, preferred, obstacles, paper, memoInset, gap);
        if (!position) { overflow.push({ ...memo, line }); continue; }
        const tx = clamp(left + gx + memo.item.tx * font, tipInset, paper.width - tipInset) - left;
        const ty = clamp(gy + memo.item.ty * font, tipInset, paper.height - tipInset);
        printBubble(memo.item, memoSettings, position.x - left, position.y, tx, ty, canvas, scale);
        obstacles.push({ left: position.x, right: position.x + memo.width, top: position.y, bottom: position.y + memo.height });
      }
      if (!overflow.length) continue;
      // If this page has no free body-sized region, append referenced note pages
      // immediately after it. Source-page/line/quotation retain the association;
      // neither the frozen manuscript nor any saved coordinates are changed.
      const sourcePage = [...root.children].indexOf(sheet) + 1;
      let notePage = null, after = sheet, cursor = 0, pageStart = 0;
      const inset = 12, bodyGap = 16 * scale + 4;
      const newNotePage = () => {
        notePage = document.createElement('section'); notePage.className = 'manuscript-page manuscript-memo-page';
        const title = document.createElement('h2'); title.className = 'manuscript-notes-title';
        title.textContent = `本文${sourcePage}ページのメモ`;
        notePage.append(title); after.after(notePage); after = notePage;
        cursor = title.offsetTop + title.offsetHeight + 18; pageStart = cursor;
      };
      const measure = (memo, text) => {
        const probe = printBubble({ ...memo.item, text }, memoSettings, 0, 0, 0, 0, notePage, scale);
        const height = probe.getBoundingClientRect().height; probe.remove(); return height;
      };
      for (const memo of overflow) {
        const quoteUnits = Array.from(memo.line.pieces.filter(p => p.annotation === null).map(p => p.sourceRuby?.base ?? p.text).join('').trim());
        const quote = quoteUnits.slice(0, 32).join('') + (quoteUnits.length > 32 ? '…' : '');
        const lineNumber = pageLines.indexOf(memo.line) + 1;
        let units = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(memo.item.text)].map(s => s.segment), part = 0;
        while (units.length) {
          if (!notePage) newNotePage();
          const reference = document.createElement('p'); reference.className = 'manuscript-note-reference';
          reference.dataset.sourceLine = memo.line.index;
          reference.textContent = `メモ${memo.number}${part ? '（続き）' : ''} · 本文${sourcePage}ページ ${lineNumber}行目「${quote}」`;
          reference.style.top = `${cursor}px`; notePage.append(reference);
          const y = cursor + reference.offsetHeight + bodyGap, available = paper.height - inset - y;
          if (measure(memo, units[0]) > available) { reference.remove(); newNotePage(); continue; }
          const fullHeight = measure(memo, units.join(''));
          // Keep an ordinary note intact; split only when it exceeds a fresh page.
          if (fullHeight > available && cursor > pageStart) { reference.remove(); newNotePage(); continue; }
          let count = units.length;
          if (fullHeight > available) {
            let low = 1, high = units.length;
            while (low < high) {
              const mid = Math.ceil((low + high) / 2);
              if (measure(memo, units.slice(0, mid).join('')) <= available) low = mid; else high = mid - 1;
            }
            count = low;
          }
          const text = units.slice(0, count).join(''), x = inset;
          const note = printBubble({ ...memo.item, text }, memoSettings, x, y, inset + 5, y - bodyGap / 2, notePage, scale);
          note.dataset.memoPart = ++part;
          cursor = y + note.getBoundingClientRect().height + 18;
          units = units.slice(count);
          if (units.length) newNotePage();
        }
      }
    }
    root.classList.remove('print-measuring'); ready = true;
    return { pages: root.querySelectorAll('.manuscript-page').length, scale, points: parseFloat(snapshot.font.fontSize) * scale * .75,
      marks: writing.items.length };
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
