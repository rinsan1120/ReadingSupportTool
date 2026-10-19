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
  function prepare(snapshot) {
    clear();
    let pendingAuto = 0;
    const lines = snapshot.lines.flatMap(line => {
      pendingAuto += line.autoBefore;
      if (!line.pieces.some(p => p.text.trim())) return [];
      const copy = { ...line, autoBefore: pendingAuto };
      pendingAuto = 0;
      return [copy];
    });
    if (!lines.length) throw new Error('出力する本文または登録済みの読み仮名がありません。');
    // Connected lines containing the same annotation stay on the same page.
    const last = new Map();
    lines.forEach((line, i) => line.pieces.forEach(p => { if (p.annotation !== null) last.set(p.annotation, i); }));
    const groups = [];
    for (let i = 0; i < lines.length;) {
      let end = i;
      for (let j = i; j <= end; j++) for (const piece of lines[j].pieces) if (piece.annotation !== null) end = Math.max(end, last.get(piece.annotation));
      groups.push(lines.slice(i, end + 1)); i = end + 1;
    }
    root.classList.add('print-measuring');
    const measurePage = document.createElement('section'); measurePage.className = 'manuscript-page'; root.append(measurePage);
    const bounds = measurePage.getBoundingClientRect();
    const maxGroupHeight = Math.max(...groups.map(g => g.at(-1).bottom - g[0].top));
    const scale = Math.min(1, bounds.width / snapshot.width, (bounds.height - 1) / maxGroupHeight);
    const pages = []; let page, cursor = 0, previous = null;
    for (const group of groups) {
      const first = group[0], height = (group.at(-1).bottom - first.top) * scale;
      let gap = Math.max(0, first.top - (previous?.bottom || 0)) * scale;
      if (!page || cursor + gap + height > bounds.height - .5) {
        if (page) gap = Math.max(0, gap - first.autoBefore * scale);
        page = []; pages.push(page); cursor = 0;
        // Original blank lines consume available space, without empty pages.
        gap = Math.min(gap, Math.max(0, bounds.height - height - 1));
      }
      const top = (cursor + gap) / scale;
      for (const line of group) page.push({ ...line, placedTop: top + line.top - first.top });
      cursor += gap + height; previous = group.at(-1);
    }
    root.replaceChildren();
    const probes = [];
    const scaledFont = { ...snapshot.font };
    for (const name of ['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing']) {
      if (scaledFont[name].endsWith('px')) scaledFont[name] = `${parseFloat(scaledFont[name]) * scale}px`;
    }
    for (const pageLines of pages) {
      const sheet = document.createElement('section'); sheet.className = 'manuscript-page';
      const canvas = document.createElement('div'); canvas.className = 'manuscript-canvas';
      // Scale type and coordinates together rather than a CSS transform: print
      // engines may fragment/clip the unscaled overflow of a transformed canvas.
      canvas.dataset.scale = scale;
      Object.assign(canvas.style, scaledFont, { width: `${snapshot.width * scale}px`, left: `${(bounds.width - snapshot.width * scale) / 2}px` });
      for (const line of pageLines) {
        const row = document.createElement('div'); row.className = 'manuscript-line';
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
    return { pages: pages.length, scale, points: parseFloat(snapshot.font.fontSize) * scale * .75 };
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
