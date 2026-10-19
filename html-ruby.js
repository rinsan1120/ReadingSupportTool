/* Clipboard HTML stays in an inert template. Never attach copied elements to
 * the live document: only text and validated UTF-16 ranges leave this parser. */
(() => {
  const ignored = new Set(['RT', 'RP', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'TITLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'IMG', 'TEMPLATE']);
  const blocks = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR']);
  const spaces = /[\t\n\r\f ]+/g;
  window.HTMLRubyImporter = {
    parse(html) {
      const begin = html.indexOf('<!--StartFragment-->'), end = html.indexOf('<!--EndFragment-->');
      if (begin >= 0 && end > begin) html = html.slice(begin + '<!--StartFragment-->'.length, end);
      const template = document.createElement('template');
      template.innerHTML = html;
      let text = '', structuralEnd = false;
      const sourceRubies = [];
      const newline = structural => { text += '\n'; structuralEnd = structural; };
      const append = (value, pre) => {
        if (!pre) {
          value = value.replace(spaces, ' ');
          if (!text || /[ \n]$/.test(text)) value = value.replace(/^ /, '');
        }
        if (value) { text += value; structuralEnd = false; }
      };
      const readingText = node => {
        if (node.nodeType === Node.TEXT_NODE) return node.data;
        if (node.nodeType !== Node.ELEMENT_NODE || ignored.has(node.tagName)) return '';
        return [...node.childNodes].map(readingText).join('');
      };
      const ruby = (el, pre) => {
        if (el.querySelector('ruby,rtc,rbc,rt[rbspan]')) throw new Error('入れ子・多段のHTMLルビには対応していません。');
        const children = [...el.childNodes].filter(n => n.nodeType !== Node.COMMENT_NODE && !(n.nodeType === Node.TEXT_NODE && !n.data.trim()));
        const readings = children.filter(n => n.nodeName === 'RT');
        if (!readings.length || el.querySelectorAll('rt').length !== readings.length) throw new Error('HTMLルビの本文と読み仮名を対応付けられません。');
        const bases = children.filter(n => n.nodeName !== 'RT' && n.nodeName !== 'RP');
        const add = (nodes, rt) => {
          const start = text.length;
          nodes.forEach(n => walk(n, pre));
          const reading = [...rt.childNodes].map(readingText).join('').replace(spaces, ' ').trim();
          sourceRubies.push({ start, end: text.length, reading });
        };
        if (readings.length === 1) add(bases, readings[0]);
        else if (bases.every(n => n.nodeName === 'RB') && bases.length === readings.length) {
          bases.forEach((base, i) => add([base], readings[i]));
        } else {
          let pending = [];
          for (const child of children) {
            if (child.nodeName === 'RP') continue;
            if (child.nodeName === 'RT') { add(pending, child); pending = []; }
            else pending.push(child);
          }
          if (pending.length) throw new Error('HTMLルビの本文と読み仮名を対応付けられません。');
        }
      };
      const walk = (node, pre = false) => {
        if (node.nodeType === Node.TEXT_NODE) { append(node.data, pre); return; }
        if (node.nodeType !== Node.ELEMENT_NODE || ignored.has(node.tagName) || node.hidden || node.style.display === 'none') return;
        const tag = node.tagName;
        if (tag === 'RUBY') { ruby(node, pre); return; }
        if (tag === 'BR') { newline(false); return; }
        const block = blocks.has(tag), start = text.length;
        if (block && text && !text.endsWith('\n')) newline(true);
        pre ||= tag === 'PRE' || ['pre', 'pre-wrap', 'break-spaces'].includes(node.style.whiteSpace);
        [...node.childNodes].forEach(n => walk(n, pre));
        if (block && (text.length === start || !text.endsWith('\n'))) newline(true);
      };
      [...template.content.childNodes].forEach(n => walk(n));
      if (structuralEnd) text = text.slice(0, -1);
      return window.ReadingAnnotations.fromJSON(JSON.stringify({
        format: 'reading-support-manuscript', version: 2, text, annotations: [], sourceRubies
      }));
    }
  };
})();
