/* In-memory document model. Offsets are UTF-16 boundaries in the ORIGINAL
 * source, matching DOM Range and reader anchors; never offsets in composed text.
 * Only grapheme boundaries are accepted, so emoji/combining sequences stay whole.
 * This data is intentionally independent of storage and the timing document. */
(() => {
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  window.ReadingAnnotations = class {
    static MAX_FILE_BYTES = 10 * 1024 * 1024;
    static MAX_TEXT_LENGTH = 200000;
    static MAX_READINGS = 10000;
    constructor(source = '') { this.reset(source); }
    reset(source) {
      this.source = source;
      this.entries = [];
      this.sourceRubies = [];
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
      return { format: 'reading-support-manuscript', version: 2, text: this.source,
        annotations: this.entries.map(({ offset, text }) => ({ offset, text })),
        sourceRubies: this.sourceRubies.map(({ start, end, reading }) => ({ start, end, reading })) };
    }
    static fromJSON(json) {
      return this.fromData(this.parseJSON(json));
    }
    static parseJSON(json) {
      if (typeof json !== 'string') throw new Error('原稿はJSON文字列で指定してください。');
      if (json.length > this.MAX_FILE_BYTES || new TextEncoder().encode(json).length > this.MAX_FILE_BYTES) throw new Error('原稿ファイルは10MiBまでです。');
      let data;
      try { data = JSON.parse(json); }
      catch { throw new Error('正しいJSONとして解析できません。'); }
      return data;
    }
    static fromData(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== 'reading-support-manuscript') throw new Error('原稿ファイルのformatが一致しません。');
      if (![1, 2, 3].includes(data.version)) throw new Error('対応していないversionです。対応バージョンは1・2・3です。');
      if (typeof data.text !== 'string') throw new Error('本文textは文字列である必要があります。');
      if (data.text.length > this.MAX_TEXT_LENGTH) throw new Error('本文は200,000 UTF-16文字までです。');
      if (!Array.isArray(data.annotations)) throw new Error('annotationsは配列である必要があります。');
      if (data.annotations.length > this.MAX_READINGS) throw new Error('手動読み仮名は10,000件までです。');
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
      if (data.version >= 2 || data.sourceRubies !== undefined) {
        if (!Array.isArray(data.sourceRubies)) throw new Error('sourceRubiesは配列である必要があります。');
        if (data.sourceRubies.length > this.MAX_READINGS) throw new Error('元の読み仮名は10,000件までです。');
        for (const [index, ruby] of data.sourceRubies.entries()) {
          const label = `元の読み仮名${index + 1}件目：`;
          if (!ruby || typeof ruby !== 'object' || Array.isArray(ruby)) throw new Error(`${label}データがオブジェクトではありません。`);
          const { start, end, reading } = ruby;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end || end > model.source.length) throw new Error(`${label}start・endは本文内の有効な範囲にしてください。`);
          if (!model.boundaries.has(start) || !model.boundaries.has(end)) throw new Error(`${label}範囲が文字の境界に一致しません。`);
          if (!model.source.slice(start, end).trim() || /[\r\n\u2028\u2029]/u.test(model.source.slice(start, end))) throw new Error(`${label}対象本文は空白だけでなく、改行をまたがない範囲にしてください。`);
          if (typeof reading !== 'string' || !reading.trim() || /[\r\n\u2028\u2029]/u.test(reading)) throw new Error(`${label}readingは空白だけでない、改行を含まない文字列にしてください。`);
          model.sourceRubies.push({ start, end, reading });
        }
        model.sourceRubies.sort((a, b) => a.start - b.start);
        for (let i = 1; i < model.sourceRubies.length; i++) {
          if (model.sourceRubies[i].start < model.sourceRubies[i - 1].end) throw new Error('元の読み仮名の範囲が重複・交差しています。');
        }
      }
      return model;
    }
  };
})();
