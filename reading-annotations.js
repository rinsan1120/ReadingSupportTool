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
      if (!this.boundaries.has(offset) || !value || /[\r\n]/u.test(value)) return false;
      const entry = this.entries.find(a => a.offset === offset);
      if (entry) entry.text = value;
      else this.entries.push({ offset, text: value });
      this.entries.sort((a, b) => a.offset - b.offset);
      return true;
    }
    remove(offset) { this.entries = this.entries.filter(a => a.offset !== offset); }
  };
})();
