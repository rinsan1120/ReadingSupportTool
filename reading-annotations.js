/* In-memory document model. Offsets are UTF-16 boundaries in the ORIGINAL
 * source, matching DOM Range and reader anchors; never offsets in composed text.
 * Only grapheme boundaries are accepted, so emoji/combining sequences stay whole.
 * This data is intentionally independent of storage and the timing document. */
(() => {
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  window.ReadingAnnotations = class {
    constructor(source = '') { this.reset(source); }
    reset(source) {
      this.source = source;
      this.entries = [];
      this.boundaries = new Set([...segmenter.segment(source)].map(s => s.index));
      this.boundaries.add(source.length);
    }
    set(offset, text) {
      const value = text.trim();
      if (!this.boundaries.has(offset) || !value || /[\r\n\u2028\u2029]/u.test(value)) return false;
      const entry = this.entries.find(a => a.offset === offset);
      if (entry) entry.text = value;
      else this.entries.push({ offset, text: value });
      this.entries.sort((a, b) => a.offset - b.offset);
      return true;
    }
    remove(offset) { this.entries = this.entries.filter(a => a.offset !== offset); }
    toJSON() {
      return { format: 'reading-support-manuscript', version: 1, text: this.source,
        annotations: this.entries.map(({ offset, text }) => ({ offset, text })) };
    }
    static fromJSON(json) {
      let data;
      try { data = JSON.parse(json); }
      catch { throw new Error('正しいJSONとして解析できません。'); }
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== 'reading-support-manuscript') throw new Error('原稿ファイルのformatが一致しません。');
      if (data.version !== 1) throw new Error('対応していないversionです。対応バージョンは1です。');
      if (typeof data.text !== 'string') throw new Error('本文textは文字列である必要があります。');
      if (!Array.isArray(data.annotations)) throw new Error('annotationsは配列である必要があります。');
      // Construct separately: no existing manuscript is mutated on any failure.
      const model = new this(data.text), seen = new Set();
      for (const [index, entry] of data.annotations.entries()) {
        const label = `読み仮名${index + 1}件目：`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label}データがオブジェクトではありません。`);
        if (!Number.isSafeInteger(entry.offset) || entry.offset < 0 || entry.offset > data.text.length) throw new Error(`${label}offsetは本文の範囲内の整数である必要があります。`);
        if (!model.boundaries.has(entry.offset)) throw new Error(`${label}offsetが文字の境界に一致しません。`);
        if (typeof entry.text !== 'string' || !entry.text.trim() || /[\r\n\u2028\u2029]/u.test(entry.text)) throw new Error(`${label}内容は空白だけでない、改行を含まない文字列にしてください。`);
        if (seen.has(entry.offset)) throw new Error(`${label}同じoffsetが重複しています。`);
        seen.add(entry.offset);
        // Preserve content verbatim, including spaces, after model validation.
        // Sorting once below avoids sorting the entire list for every entry.
        model.entries.push({ offset: entry.offset, text: entry.text });
      }
      model.entries.sort((a, b) => a.offset - b.offset);
      return model;
    }
  };
})();
