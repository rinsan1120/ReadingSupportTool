(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE = 'reading-support-results-v1';
  let view = 'home', mode = 'read', sourceType = 'sample', sample = null;
  let history = [], target = '', targetManual = false, plannedMinutes = '20';
  let phase = 'idle', began = 0, countdownTimer = 0, elapsedTimer = 0, noticeTimer = 0;
  let measuredCount = 0, measuredType = 'sample', lastMeasuredCustomText = null, wakeLock = null, wakePending = false, wakeGeneration = 0;
  let partialOn = false, partialLimit = '200', measuredPartial = false, timingRange = null;
  let readAnnotations = new window.ReadingAnnotations();
  let readMarks = new window.ManuscriptMarks();
  let savedManuscript = false, editWarningPending = false, pendingReadPaste = null;
  const replacementLoss = () => hasReadings(readAnnotations) || readMarks.hasMarks
    ? ' 読み仮名・書き込みは、変更後の本文を開くまで保持されます。開く際に削除を確認します。' : '';
  // A textarea normalizes CRLF/CR to LF. Retain the exact imported source until
  // its displayed input is edited, otherwise UTF-16 annotation offsets drift.
  let readInputSnapshot = null;
  let timeAnnotations = null, timeMarks = null, timeInputSnapshot = null;
  // Tab-local paint state; timing keeps its own preference for each source.
  // A different manuscript starts dark, while a retry of the same text keeps it.
  let readPaper = false, displayedText = '';
  const timingPaper = { custom: { text: null, on: false }, sample: { text: null, on: false } };
  function applyPaper(on) {
    $('reader-stage').classList.toggle('paper-mode', on);
    $('paper-mode').setAttribute('aria-pressed', String(on));
    $('paper-mode').querySelector('.button-state').textContent = on ? 'ON' : 'OFF';
    $('paper-mode').setAttribute('aria-label', `白背景：${on ? 'ON' : 'OFF'}`);
  }
  let openingReader = false;
  const hasReadings = model => !!(model && (model.entries.length || model.sourceRubies.length));
  function ask(message, action = '削除する', title = '操作の確認') {
    return new Promise(resolve => {
      const dialog = $('confirm-dialog');
      $('confirm-title').textContent = title;
      $('confirm-message').textContent = message; $('confirm-ok').textContent = action;
      dialog.returnValue = '';
      $('confirm-cancel').onclick = () => dialog.close('cancel');
      $('confirm-ok').onclick = () => dialog.close('ok');
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
      dialog.showModal(); $('confirm-cancel').focus();
    });
  }
  function confirmMarkedChange(subject) {
    if (!window.ManuscriptWriting.hasMarks) return Promise.resolve(true);
    const impact = window.ManuscriptWriting.hasPens
      ? '赤ペンの位置がずれる場合があります。変更後は移動して調整できます。'
      : '書き込みの表示位置が変わる場合があります。';
    return ask(window.ManuscriptWriting.hasPens ? impact : `原稿に書き込みがあります。\n\n${subject}を変更すると、${impact}`, '変更する', `${subject}を変更しますか？`);
  }
  window.Reader.setReadingChangeGuard(() => confirmMarkedChange('読み仮名'));
  function countText(text) {
    const derived = text.replace(/［＃[^\r\n]*?］/g, '')
      .replace(/｜([^｜《》\r\n]+)《[^《》\r\n]+》/g, '$1')
      .replace(/([\p{Script=Han}々〆ヵヶ]+)《[^《》\r\n]+》/gu, '$1');
    return Array.from(derived.replace(/\s/gu, '')).length;
  }
  window.countReadingCharacters = countText;
  function validPartialLimit() { const n = Number(partialLimit); return Number.isSafeInteger(n) && n > 0; }
  function partialReadingRange(text, limit) {
    // Keep original UTF-16 endpoints beside the same code points counted by
    // countText. Removed ruby/note text can never supply the stopping period.
    let offset = 0;
    let units = Array.from(text, char => { const start = offset; offset += char.length; return { char, start, end: offset }; });
    function strip(pattern, basePrefix = null) {
      const removals = [];
      for (const m of units.map(u => u.char).join('').matchAll(pattern)) {
        if (basePrefix === null) removals.push({ start: m.index, end: m.index + m[0].length, attach: true });
        else {
          if (basePrefix) removals.push({ start: m.index, end: m.index + basePrefix, attach: false });
          removals.push({ start: m.index + basePrefix + m[1].length, end: m.index + m[0].length, attach: true });
        }
      }
      if (!removals.length) return;
      let position = 0, index = 0;
      const kept = [];
      for (const unit of units) {
        while (index < removals.length && removals[index].end <= position) index++;
        const removal = removals[index];
        if (removal && position >= removal.start && position < removal.end) {
          // Include a base character's original ruby suffix when it ends the
          // range, so the displayed prefix remains countable by countText too.
          if (removal.attach && kept.length) kept.at(-1).end = unit.end;
        } else kept.push(unit);
        position += unit.char.length;
      }
      units = kept;
    }
    strip(/［＃[^\r\n]*?］/g);
    strip(/｜([^｜《》\r\n]+)《[^《》\r\n]+》/g, 1);
    strip(/([\p{Script=Han}々〆ヵヶ]+)《[^《》\r\n]+》/gu, 0);
    let count = 0, end = text.length;
    for (const unit of units) {
      if (/\s/u.test(unit.char)) continue;
      count++;
      if (count > limit && unit.char === '。') { end = unit.end; break; }
    }
    while (end < text.length && /[」』）】〕〉》］｝〗〙〛’”»›)\]}]/u.test(text[end])) end++;
    // Count against the full manuscript's parsed units: a cutoff can be inside
    // a ruby base, where reparsing the prefix alone would count a stray ｜.
    const actualCount = units.reduce((sum, unit) => sum + (unit.start < end && !/\s/u.test(unit.char) ? 1 : 0), 0);
    return { end, count: actualCount, full: end === text.length };
  }
  function customTimingText() {
    return timeAnnotations && $('time-text').value === timeInputSnapshot ? timeAnnotations.source : $('time-text').value;
  }
  function syncPartialInputs() {
    const valid = validPartialLimit();
    const text = view === 'reading' && mode === 'time' && sourceType === 'custom' ? displayedText : customTimingText();
    const range = partialOn && valid ? partialReadingRange(text, Number(partialLimit)) : null;
    ['partial', 'preparation-partial'].forEach(prefix => {
      $(`${prefix}-enabled`).checked = partialOn;
      $(`${prefix}-limit`).value = partialLimit;
      $(`${prefix}-fields`).hidden = !partialOn;
      $(`${prefix}-count`).textContent = !valid ? '読む文字数の目安は正の整数で入力してください。'
        : `実際に読む文字数：${range?.count ?? 0}文字${range?.full ? '（全文が対象です。）' : ''}`;
    });
    if (view === 'reading' && mode === 'time' && phase === 'idle') {
      measuredPartial = sourceType === 'custom' && partialOn;
      timingRange = measuredPartial ? range : null;
      measuredCount = measuredPartial ? timingRange?.count ?? 0 : countText(displayedText);
      window.Reader.setDisplayEnd(measuredPartial ? timingRange?.end ?? 0 : null);
      updatePreparationInfo();
      $('start').disabled = measuredPartial && (!valid || !measuredCount);
    }
  }
  function validTarget(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 && n <= 1e9; }
  function validMinutes(value) { const n = Number(value); return value !== '' && Number.isFinite(n) && n > 0; }
  function notify(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 6500); }
  function persist() {
    try { sessionStorage.setItem(STORAGE, JSON.stringify({ version: 1, history, target: validTarget(target) ? Number(target) : null, plannedMinutes: validMinutes(plannedMinutes) ? Number(plannedMinutes) : 20 })); }
    catch { notify('このブラウザでは結果を保存できません。この画面を開いている間は利用できます。'); }
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE));
    if (stored?.version === 1 && Array.isArray(stored.history)) {
      history = stored.history.filter(r => Number.isSafeInteger(r.characters) && r.characters > 0 && Number.isFinite(r.seconds) && r.seconds > 0 && ['sample', 'custom'].includes(r.type))
        .map(r => ({ characters: r.characters, seconds: r.seconds, type: r.type }));
      if (validTarget(stored.target)) { target = String(stored.target); targetManual = true; }
      if (validMinutes(stored.plannedMinutes)) plannedMinutes = String(stored.plannedMinutes);
    }
  } catch { /* Storage is optional; text is never stored. */ }
  function setTarget(value, manual = false) {
    target = value; if (manual) targetManual = true;
    $('target-count').value = value; $('result-target').value = value; $('preparation-target').value = value;
    updatePreparationInfo();
  }
  function updatePreparationInfo() {
    const total = validTarget(target) ? `${Number(target).toLocaleString()}文字` : '未設定';
    $('preparation-info').textContent = measuredPartial
      ? `読む文字数の目安：${validPartialLimit() ? Number(partialLimit) : '未設定'}文字\n実際に読む文字数：${measuredCount}文字${timingRange?.full ? '（全文が対象です。）' : ''}\n作品全体の文字数：${total}`
      : `計測する本文：${measuredCount}文字 ／ 作品全体：${total}`;
    $('finish').textContent = measuredPartial ? '計測終了' : '読了';
    $('preparation-guidance').textContent = (measuredPartial ? '表示された文章を読み終えたら「計測終了」を押してください。' : '全文を読み終えたら「読了」を押してください。') + '計測中に入力画面やホームへ戻る、または別のタブ・アプリへ移動すると、その回の計測結果は保存されません。';
  }
  setTarget(target);
  $('planned-minutes').value = plannedMinutes;
  function show(next) {
    if (view === 'reading' && next !== 'reading') { window.ManuscriptWriting.leave(); window.ManuscriptPrint.clear(); window.Reader.leave(); cancelMeasurement(); releaseWake(); }
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== next);
    view = next; $('footer').hidden = next === 'reading';
    if (next === 'results') { selectResultTab('time'); renderResults(); }
    $('existing-results').hidden = !history.length;
    $('annotation-retention').hidden = !hasReadings(readAnnotations);
    $('time-annotation-retention').hidden = !hasReadings(timeAnnotations) && !timeMarks?.hasMarks;
    $('writing-retention').hidden = !readMarks.hasMarks;
    window.scrollTo(0, 0);
    $(next).querySelector('h1')?.focus({ preventScroll: true });
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => requestNavigation(b.dataset.go)));
  function selectSample() {
    const level = Number($('sample-level').value), mood = $('sample-mood').value;
    const choices = window.READING_SAMPLES.filter(s => s.level === level && (mood === 'おまかせ' || s.mood === mood));
    sample = choices[Math.floor(Math.random() * choices.length)];
    $('sample-info').textContent = `${sample.title} / ${sample.mood}・計測本文 ${countText(sample.text)}文字`;
  }
  selectSample();
  ['sample-level', 'sample-mood'].forEach(id => $(id).addEventListener('change', selectSample));
  document.querySelectorAll('[name=source]').forEach(r => r.addEventListener('change', () => {
    sourceType = r.value;
    $('custom-input').hidden = sourceType !== 'custom'; $('apply-count').hidden = sourceType !== 'custom';
    $('sample-options').hidden = sourceType !== 'sample'; $('sample-info').hidden = sourceType !== 'sample';
    if (sourceType === 'custom' && !targetManual) setTarget(countText($('time-text').value) || '');
    syncPartialInputs();
  }));
  $('read-text').addEventListener('input', () => $('read-count').textContent = `${countText($('read-text').value)}文字`);
  $('time-text').addEventListener('input', () => {
    const count = countText($('time-text').value);
    $('time-count').textContent = `計測する本文：${count}文字`;
    if (!targetManual) setTarget(count || '');
    syncPartialInputs();
  });
  ['partial', 'preparation-partial'].forEach(prefix => {
    $(`${prefix}-enabled`).addEventListener('change', () => {
      if (phase !== 'idle') return;
      partialOn = $(`${prefix}-enabled`).checked; syncPartialInputs();
    });
    $(`${prefix}-limit`).addEventListener('input', () => {
      if (phase !== 'idle') return;
      partialLimit = $(`${prefix}-limit`).value; syncPartialInputs();
    });
  });
  // Only plain source enters the textarea. Commit the separately validated
  // ruby ranges together with it after replacement confirmation has succeeded.
  let pasting = false;
  ['read-text', 'time-text'].forEach(id => $(id).addEventListener('paste', async event => {
    const html = event.clipboardData?.getData('text/html');
    const el = $(id), begin = el.selectionStart, end = el.selectionEnd;
    const ruby = html && /<ruby[\s>]/i.test(html);
    if (!ruby && begin === end) return;
    event.preventDefault();
    if (pasting) return;
    pasting = true;
    const previous = el.value, previousView = view;
    try {
      let plain = event.clipboardData?.getData('text/plain') || '', imported = null;
      const retained = id === 'read-text' ? readAnnotations : timeAnnotations;
      const retainedMarks = id === 'read-text' ? readMarks : timeMarks;
      const whole = begin === 0 && end === el.value.length;
      if (ruby) {
        imported = window.HTMLRubyImporter.parse(html);
        if (!whole && (hasReadings(retained) || retainedMarks?.hasMarks)) {
          notify('読み仮名・書き込みがある原稿の途中にはHTMLルビを貼り付けできません。本文全体を選択して置き換えるか、別の原稿として取り込んでください。'); return;
        }
        plain = imported.source;
        const combined = el.value.slice(0, begin) + plain + el.value.slice(end);
        imported = window.ReadingAnnotations.fromJSON(JSON.stringify({ ...imported.toJSON(), text: combined,
          sourceRubies: imported.sourceRubies.map(r => ({ ...r, start: r.start + begin, end: r.end + begin })) }));
      }
      const replacingReadings = ruby && whole && (hasReadings(retained) || retainedMarks?.hasMarks);
      if (((el.value && end > begin) || replacingReadings) && !await ask(replacingReadings ?
        '入力欄の本文と読み仮名を、貼り付けた文章と元の読み仮名で置き換えますか？' + (id === 'read-text' ? replacementLoss() : timeMarks?.hasMarks ? ' 計測用の書き込みも削除されます。「文章を読む」の原稿は保持します。' : '') : '選択中の本文を貼り付けた文章で置き換えますか？', '置き換える')) return;
      if (view !== previousView || el.value !== previous) return;
      el.setRangeText(plain, begin, end, 'end');
      if (imported) {
        if (id === 'read-text') { pendingReadPaste = { model: imported, input: el.value }; }
        else { timeAnnotations = imported; timeMarks = null; timeInputSnapshot = el.value; }
        $('annotation-retention').hidden = !hasReadings(readAnnotations);
        $('time-annotation-retention').hidden = !hasReadings(timeAnnotations) && !timeMarks?.hasMarks;
        $('writing-retention').hidden = !readMarks.hasMarks;
        if (imported.sourceRubies.length) notify(`元の読み仮名を${imported.sourceRubies.length}件取り込みました`);
      }
      el.dispatchEvent(new Event('input'));
    } catch (error) { notify(`HTMLの読み仮名を取り込めません。${error.message} 原稿は変更していません。`); }
    finally { pasting = false; }
  }));
  // Confirm an explicit replacement/deletion while leaving normal typing and
  // navigation uninterrupted. Native undo remains available for text edits.
  ['read-text', 'time-text'].forEach(id => $(id).addEventListener('beforeinput', async e => {
    const el = $(id);
    const deleting = e.inputType.startsWith('delete');
    const replacing = ['insertText', 'insertReplacementText'].includes(e.inputType);
    if (el.value && el.selectionStart === 0 && el.selectionEnd === el.value.length && (deleting || replacing)) {
      e.preventDefault();
      const next = deleting ? '' : (e.data || '');
      if (await ask('入力済みの本文全体を削除・置換しますか？' + (id === 'read-text' ? replacementLoss() : ''), deleting ? '削除する' : '置き換える')) {
        el.setRangeText(next, 0, el.value.length, 'end'); el.dispatchEvent(new Event('input'));
      }
    }
  }));
  $('clear-read').onclick = async () => { if ($('read-text').value && await ask('入力した本文を削除しますか？' + replacementLoss())) { $('read-text').value = ''; $('read-text').dispatchEvent(new Event('input')); } };
  $('apply-count').onclick = () => { setTarget(countText($('time-text').value) || '', true); persist(); };
  $('target-count').addEventListener('input', () => { setTarget($('target-count').value, true); persist(); });
  $('preparation-target').addEventListener('input', () => { setTarget($('preparation-target').value, true); persist(); });
  $('result-target').addEventListener('input', () => { setTarget($('result-target').value, true); persist(); renderResults(); });
  $('planned-minutes').addEventListener('input', () => { plannedMinutes = $('planned-minutes').value; persist(); renderResults(); });
  function selectResultTab(tab) {
    const time = tab === 'time';
    $('result-time-tab').setAttribute('aria-selected', String(time)); $('result-time-tab').tabIndex = time ? 0 : -1;
    $('result-speed-tab').setAttribute('aria-selected', String(!time)); $('result-speed-tab').tabIndex = time ? -1 : 0;
    $('result-time-panel').hidden = !time; $('result-speed-panel').hidden = time;
  }
  [['result-time-tab', 'time'], ['result-speed-tab', 'speed']].forEach(([id, tab]) => {
    $(id).addEventListener('click', () => selectResultTab(tab));
    $(id).addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); const next = event.key === 'Home' ? 'time' : event.key === 'End' ? 'speed' : tab === 'time' ? 'speed' : 'time';
        selectResultTab(next); $(`result-${next}-tab`).focus();
      }
    });
  });
  async function openReader(nextMode) {
    if (openingReader) return;
    const pasted = nextMode === 'read' && pendingReadPaste?.input === $('read-text').value ? pendingReadPaste.model : null;
    const text = nextMode === 'read' ? (pasted ? pasted.source : $('read-text').value === readInputSnapshot ? readAnnotations.source : $('read-text').value) : sourceType === 'sample' ? sample.text :
      timeAnnotations && $('time-text').value === timeInputSnapshot ? timeAnnotations.source : $('time-text').value;
    const retainedRead = nextMode === 'read' && $('read-text').value === readInputSnapshot;
    if (!countText(text) && !retainedRead) { notify('朗読する文章を入力してください。'); return; }
    if (nextMode === 'time' && target !== '' && !validTarget(target)) { notify('作品全体の文字数を1〜1,000,000,000の整数で入力してください。'); $('target-count').focus(); return; }
    if (nextMode === 'time' && sourceType === 'custom' && partialOn && !validPartialLimit()) {
      notify('読む文字数の目安は正の整数で入力してください。'); $('partial-limit').focus(); return;
    }
    openingReader = true;
    try {
      if (nextMode === 'read' && (text !== readAnnotations.source || pasted)) {
        if ((hasReadings(readAnnotations) || readMarks.hasMarks) && !await ask('この文章を開くと、現在の原稿の読み仮名・赤ペン・マーカー・文字メモはすべて削除されます。変更後の本文を開きますか？', '開く')) return;
        if (pasted) readAnnotations = pasted;
        else readAnnotations.reset(text);
        pendingReadPaste = null; savedManuscript = false;
        readMarks = new window.ManuscriptMarks(text);
        readInputSnapshot = $('read-text').value;
      }
      if (nextMode === 'time' && sourceType === 'custom' && timeAnnotations && text !== timeAnnotations.source) {
        if ((hasReadings(timeAnnotations) || timeMarks?.hasMarks) && !await ask('計測用の本文が変更されています。開くと計測用の読み仮名・書き込みはすべて削除されます。「文章を読む」の原稿は変更されません。本文を差し替えますか？', '差し替える')) return;
        timeAnnotations = null; timeMarks = null; timeInputSnapshot = null;
      }
    } finally { openingReader = false; }
    displayReader(nextMode, text);
  }
  function displayReader(nextMode, text) {
    mode = nextMode;
    displayedText = text;
    const paper = timingPaper[sourceType];
    if (mode === 'time' && paper.text !== text) { paper.text = text; paper.on = false; }
    applyPaper(mode === 'read' ? readPaper : paper.on);
    show('reading');
    $('reading-title').textContent = mode === 'time' ? (sourceType === 'sample' ? sample.title : '朗読速度の計測') : '文章を読む';
    $('preparation').hidden = mode !== 'time'; $('measurement-bar').hidden = true;
    $('toolbar-settings').disabled = phase !== 'idle';
    $('export-manuscript').hidden = mode !== 'read';
    $('export-pdf').hidden = mode !== 'read';
    $('measure-current').hidden = mode !== 'read';
    $('writing-mode').hidden = mode !== 'read';
    measuredPartial = mode === 'time' && sourceType === 'custom' && partialOn;
    timingRange = measuredPartial && validPartialLimit() ? partialReadingRange(text, Number(partialLimit)) : null;
    measuredCount = measuredPartial ? timingRange?.count ?? 0 : countText(text); measuredType = sourceType;
    $('preparation-partial').hidden = mode !== 'time' || sourceType !== 'custom';
    updatePreparationInfo();
    const model = mode === 'read' ? readAnnotations : sourceType === 'custom' ? timeAnnotations : null;
    window.Reader.show(text, model, { editable: mode === 'read', end: measuredPartial ? timingRange?.end ?? 0 : null });
    window.ManuscriptWriting.show(mode === 'read' ? readMarks : sourceType === 'custom' && timeMarks?.source === text ? timeMarks : null, { editable: mode === 'read' });
    syncPartialInputs();
  }
  $('open-read').onclick = () => openReader('read'); $('prepare-time').onclick = () => openReader('time');
  let preparingPDF = false, pdfAnchor = null;
  $('export-pdf').onclick = async () => {
    if (!readyForDirectAction()) return;
    if (view !== 'reading' || mode !== 'read' || preparingPDF) return;
    preparingPDF = true;
    try {
      await document.fonts.ready;
      // Let ResizeObserver/reader layout and its writing layer settle together
      // before freezing glyphs and resolving source-anchored strokes.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (view !== 'reading' || mode !== 'read') return;
      const snapshot = window.Reader.printSnapshot();
      pdfAnchor = window.Reader.capture();
      const writing = window.ManuscriptWriting.printSnapshot();
      const result = window.ManuscriptPrint.prepare(snapshot, writing);
      $('pdf-small-warning').hidden = result.points >= 9;
      $('pdf-small-warning').textContent = '文字が小さくなるため、キャンセルして本文幅を狭くするか文字サイズを大きくしてから出力することをおすすめします。長い読み仮名がある場合は、内容の短縮もご検討ください。';
      $('pdf-dialog').showModal();
    } catch (error) { window.ManuscriptPrint.clear(); notify(error.message); }
    finally { preparingPDF = false; }
  };
  $('pdf-cancel').onclick = () => $('pdf-dialog').close();
  $('pdf-dialog').addEventListener('close', () => {
    if (!document.body.classList.contains('manuscript-printing')) window.ManuscriptPrint.clear();
  });
  $('pdf-print').onclick = () => {
    // Set printing state before closing: the asynchronous close event must not
    // remove the prepared pages while a mobile print dialog is still opening.
    document.body.classList.add('manuscript-printing'); $('pdf-dialog').close();
    try { window.ManuscriptPrint.print(); }
    catch { window.ManuscriptPrint.clear(); notify('このブラウザでは印刷を開始できませんでした。端末の印刷・PDF保存に対応したブラウザでお試しください。'); }
  };
  const finishPDF = () => {
    if (!document.body.classList.contains('manuscript-printing')) return;
    window.ManuscriptPrint.clear();
    const anchor = pdfAnchor; pdfAnchor = null;
    requestAnimationFrame(() => { if (view === 'reading') window.Reader.restore(anchor); });
  };
  addEventListener('afterprint', finishPDF);
  matchMedia('print').addEventListener('change', e => { if (!e.matches) finishPDF(); });
  $('measure-current').onclick = async () => {
    if (!readyForDirectAction()) return;
    if (view !== 'reading' || mode !== 'read' || openingReader) return;
    const text = readAnnotations.source, count = countText(text);
    if (!count) { notify('計測する文字を含む本文を用意してください。'); return; }
    openingReader = true;
    try {
      const inputText = text.replace(/\r\n?/g, '\n');
      if ($('time-text').value && $('time-text').value !== inputText &&
        !await ask('計測用入力欄の本文を、この文章で置き換えますか？入力済みの計測用本文・読み仮名・書き込みは失われます。「文章を読む」の原稿は保持します。', '置き換える')) {
        return;
      }
      // Take an independent snapshot so changing either mode cannot mutate the
      // other manuscript. Keep original CRLF/CR and UTF-16 offsets in the model.
      const copied = new window.ReadingAnnotations(text);
      copied.entries = readAnnotations.entries.map(({ offset, text }) => ({ offset, text }));
      copied.sourceRubies = readAnnotations.sourceRubies.map(({ start, end, reading }) => ({ start, end, reading }));
      if (readMarks.source !== text) throw new Error('本文と書き込みの原文が一致しません。');
      const copiedMarks = window.ManuscriptMarks.fromItems(readMarks.items, copied, readMarks.memoSettings);
      timeAnnotations = copied; timeMarks = copiedMarks;
      timingPaper.custom = { text, on: readPaper };
      $('time-text').value = text; timeInputSnapshot = $('time-text').value;
      const custom = document.querySelector('[name=source][value=custom]');
      custom.checked = true; custom.dispatchEvent(new Event('change'));
      $('time-text').dispatchEvent(new Event('input'));
      setTarget(count, true);
      displayReader('time', text);
    } catch (error) { notify(`計測用の原稿を準備できません。${error.message}`); }
    finally { openingReader = false; }
  };
  function downloadManuscript() {
    if (!readyForDirectAction()) return;
    if (view !== 'reading' || mode !== 'read') return;
    let url;
    const link = document.createElement('a');
    try {
      const json = window.ManuscriptMarks.serializeManuscript(readAnnotations, readMarks);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      url = URL.createObjectURL(blob);
      link.href = url; link.download = 'reading-manuscript.json';
      document.body.append(link); link.click();
      window.ManuscriptWriting.setMode(false);
      window.Reader.setRubyMode(false);
      savedManuscript = true;
      return true;
    } catch (error) {
      const message = `原稿ファイルを保存できません。${error.message}`;
      notify(message);
      if ($('save-navigation-dialog').open) $('save-navigation-error').textContent = message;
      return false;
    }
    finally {
      link.remove();
      // Leave time for the browser's local download to consume the blob URL.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };
  $('export-manuscript').onclick = downloadManuscript;
  let importing = false;
  $('import-manuscript').onclick = () => $('manuscript-file').click();
  $('manuscript-file').addEventListener('change', async () => {
    const file = $('manuscript-file').files[0];
    $('manuscript-file').value = ''; // Allow retrying the same file after cancel/error.
    if (!file || importing || view !== 'read-input') return;
    importing = true; $('import-manuscript').disabled = true;
    try {
      if (file.size > window.ReadingAnnotations.MAX_FILE_BYTES) throw new Error('原稿ファイルは10MiBまでです。');
      let json;
      try { json = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('UTF-8のJSONファイルを読み取れませんでした。'); }
      const { manuscript: restored, markings } = window.ManuscriptMarks.restoreManuscript(json);
      if (view !== 'read-input') return;
      if (($('read-text').value || readAnnotations.source || hasReadings(readAnnotations) || readMarks.hasMarks) &&
        !await ask('現在の本文・読み仮名・赤ペン・マーカー・文字メモを、選択した原稿ファイルの内容で置き換えますか？未保存の変更は失われます。', '置き換える')) return;
      // All validation and confirmation have succeeded. Commit together, using
      // the same model and rendering path as manually entered manuscripts.
      readAnnotations = restored;
      readMarks = markings;
      pendingReadPaste = null; savedManuscript = true;
      $('read-text').value = restored.source;
      readInputSnapshot = $('read-text').value;
      $('read-text').dispatchEvent(new Event('input'));
      displayReader('read', restored.source);
      notify('原稿ファイルを読み込みました。');
    } catch (error) { notify(`原稿を読み込めません。${error.message}`); }
    finally { importing = false; $('import-manuscript').disabled = false; }
  });
  // Keep the first destination until this dialog is closed. No navigation or
  // draft mutation occurs when the user cancels.
  let navigationTarget = null;
  function requestNavigation(next) {
    if (navigationTarget !== null || editWarningPending) return;
    if (view !== 'reading' || mode !== 'read') { show(next); return; }
    if (!readyForDirectAction()) return;
    if (!hasReadings(readAnnotations) && !readMarks.hasMarks) { show(next); return; }
    closeSettings();
    if (document.querySelector('dialog[open]')) return;
    navigationTarget = next;
    const dialog = $('save-navigation-dialog'), scroll = window.scrollY;
    $('save-navigation-prompt').hidden = false;
    $('save-navigation-started').hidden = true;
    $('save-navigation-error').textContent = '';
    const move = () => { const destination = navigationTarget; dialog.close('move'); show(destination); };
    $('save-navigation-cancel').onclick = () => dialog.close();
    $('save-navigation-discard').onclick = move;
    $('save-navigation-download').onclick = () => {
      if (!downloadManuscript()) return;
      $('save-navigation-prompt').hidden = true;
      $('save-navigation-started').hidden = false;
      $('save-navigation-return').focus({ preventScroll: true });
    };
    $('save-navigation-return').onclick = () => dialog.close('reader');
    $('save-navigation-move').onclick = move;
    dialog.returnValue = '';
    dialog.addEventListener('close', () => {
      navigationTarget = null;
      if (view === 'reading') {
        window.scrollTo(0, scroll);
      }
    }, { once: true });
    dialog.showModal(); $('save-navigation-cancel').focus({ preventScroll: true });
  }
  async function approveEditing(alreadyEnabled) {
    if (editWarningPending || navigationTarget !== null || !readyForDirectAction()) return false;
    if (alreadyEnabled || !savedManuscript) return true;
    closeSettings();
    if (document.querySelector('dialog[open]')) return false;
    editWarningPending = true;
    try {
      if (!await ask('編集内容は既存のJSONファイルへ自動反映されません。編集後は「原稿を保存」から再保存してください。', '編集を始める', '原稿の編集を始めますか？')) return false;
      savedManuscript = false;
      return true;
    } finally { editWarningPending = false; }
  }
  $('reader-back').onclick = () => requestNavigation(mode === 'time' ? 'time-input' : 'read-input');
  $('toolbar-settings').onclick = () => { if (!readyForDirectAction()) return; openSettings(); };
  $('writing-mode').onclick = async () => {
    if (!await approveEditing(window.ManuscriptWriting.enabled)) return;
    closeSettings();
    window.ManuscriptWriting.setMode(!window.ManuscriptWriting.enabled);
  };
  window.Reader.setEditModeGuard(approveEditing);
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.dataset.close === 'settings-dialog' ? closeSettings() : $(b.dataset.close).close());
  const settingsMobile = matchMedia('(max-width: 600px)');
  const layoutSettings = ['columns', 'line-height', 'break-lines'];
  const sliderIds = ['reader-width', ...layoutSettings];
  const sliderOutput = { 'reader-width': 'reader-width-value', columns: 'columns-value', 'line-height': 'line-height-value', 'break-lines': 'break-lines-value' };
  let settingsApproved = false, pendingSetting = null, confirmingSetting = false, settingsSession = 0;
  let pointerAdjusting = false, keyboardAdjusting = false;
  let settingsBaseline = new Map();
  function rememberSettings() {
    if (pendingSetting || confirmingSetting) return;
    settingsBaseline = new Map(sliderIds.map(id => [id, { value: $(id).value, label: $(sliderOutput[id]).textContent }]));
  }
  function discardSetting() {
    pendingSetting = null;
    settingsBaseline.forEach((state, id) => { $(id).value = state.value; $(sliderOutput[id]).textContent = state.label; });
    pointerAdjusting = false; keyboardAdjusting = false;
  }
  $('reader').addEventListener('reader-layout', () => {
    // Rotation can update the width/character bounds while confirmation is
    // open. Cancellation must restore the new viewport's actual controls.
    if (pendingSetting || confirmingSetting) {
      ['reader-width', 'columns'].forEach(id => settingsBaseline.set(id, { value: $(id).value, label: $(sliderOutput[id]).textContent }));
    } else rememberSettings();
  });
  const settingNames = layoutSettings;
  let activeSetting = 'columns';
  function reserveSettingsSpace() {
    const panel = $('settings-dialog');
    const height = panel.open && settingsMobile.matches ? Math.ceil(panel.getBoundingClientRect().height) : 0;
    $('reader').style.setProperty('--settings-panel-height', `${height}px`);
  }
  function updateSettingsControls() {
    $('settings-tabs').hidden = !settingsMobile.matches;
    $('setting-width').hidden = settingsMobile.matches;
    settingNames.forEach(name => {
      const group = $(`setting-${name}`), tab = $(`tab-${name}`);
      group.hidden = settingsMobile.matches && activeSetting !== name;
      if (settingsMobile.matches) {
        group.setAttribute('role', 'tabpanel'); group.setAttribute('aria-labelledby', tab.id);
      } else { group.removeAttribute('role'); group.removeAttribute('aria-labelledby'); }
      tab.setAttribute('aria-selected', String(activeSetting === name));
      tab.tabIndex = activeSetting === name ? 0 : -1;
    });
    reserveSettingsSpace();
  }
  function closeSettings() {
    const panel = $('settings-dialog');
    if (!panel.open) return;
    discardSetting(); settingsApproved = false; settingsSession++;
    // The user can scroll while the mobile panel is open. Keep the CURRENT
    // source position instead of returning to the position at panel opening.
    const anchor = window.Reader.capture();
    panel.close(); reserveSettingsSpace();
    if (view === 'reading') window.Reader.restore(anchor);
  }
  function openSettings() {
    if (phase !== 'idle') return;
    const anchor = window.Reader.capture();
    updateSettingsControls();
    if (!$('settings-dialog').open) {
      settingsApproved = false; settingsSession++; rememberSettings();
      if (settingsMobile.matches) $('settings-dialog').show(); else $('settings-dialog').showModal();
    }
    reserveSettingsSpace(); window.Reader.restore(anchor);
  }
  $('before-settings').onclick = openSettings;
  $('settings-dialog').addEventListener('close', () => {
    reserveSettingsSpace();
    if (!$('settings-dialog').open) { discardSetting(); settingsApproved = false; settingsSession++; }
  });
  $('settings-dialog').addEventListener('cancel', e => { e.preventDefault(); closeSettings(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && settingsMobile.matches && $('settings-dialog').open) { e.preventDefault(); closeSettings(); }
  });
  settingNames.forEach((name, index) => {
    $(`tab-${name}`).onclick = () => { activeSetting = name; updateSettingsControls(); };
    $(`tab-${name}`).onkeydown = e => {
      let next;
      if (e.key === 'ArrowRight') next = (index + 1) % settingNames.length;
      if (e.key === 'ArrowLeft') next = (index + settingNames.length - 1) % settingNames.length;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = settingNames.length - 1;
      if (next === undefined) return;
      e.preventDefault(); activeSetting = settingNames[next]; updateSettingsControls();
      $(`tab-${activeSetting}`).focus({ preventScroll: true });
    };
  });
  settingsMobile.addEventListener('change', () => {
    const panel = $('settings-dialog'), anchor = window.Reader.capture(), wasOpen = panel.open;
    if (wasOpen) panel.close();
    updateSettingsControls();
    if (wasOpen) {
      if (settingsMobile.matches) panel.show(); else panel.showModal();
      reserveSettingsSpace(); window.Reader.restore(anchor);
    }
  });
  new ResizeObserver(reserveSettingsSpace).observe($('settings-dialog'));
  $('paper-mode').onclick = () => {
    if (view !== 'reading' || phase !== 'idle') return;
    const on = !$('reader-stage').classList.contains('paper-mode');
    if (mode === 'read') readPaper = on;
    else timingPaper[sourceType] = { text: displayedText, on };
    applyPaper(on);
  };
  function applySetting(id, value) {
    if (id === 'reader-width') window.Reader.configure({ width: value });
    if (id === 'columns') window.Reader.configure({ columns: value });
    if (id === 'line-height') {
      $('line-height-value').textContent = value.toFixed(1); window.Reader.configure({ height: value });
    }
    if (id === 'break-lines') {
      $('break-lines-value').textContent = value ? `${value}表示行ごと` : 'なし'; window.Reader.configure({ breaks: value });
    }
    rememberSettings();
  }
  async function commitSetting() {
    if (!pendingSetting || confirmingSetting || pointerAdjusting || keyboardAdjusting) return;
    const change = pendingSetting, session = settingsSession;
    if (String(change.value) === settingsBaseline.get(change.id)?.value) { discardSetting(); return; }
    confirmingSetting = true;
    try {
      const approved = await confirmMarkedChange('表示設定');
      if (session !== settingsSession || view !== 'reading' || phase !== 'idle' || !$('settings-dialog').open) return;
      if (!approved) { discardSetting(); return; }
      settingsApproved = true; pendingSetting = null;
      applySetting(change.id, change.value);
    } finally { confirmingSetting = false; rememberSettings(); }
  }
  sliderIds.forEach(id => {
    const input = $(id);
    input.addEventListener('pointerdown', () => { rememberSettings(); pointerAdjusting = true; });
    input.addEventListener('keydown', e => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
        rememberSettings(); keyboardAdjusting = true;
      }
    });
    input.addEventListener('keyup', () => { keyboardAdjusting = false; commitSetting(); });
    input.addEventListener('change', commitSetting);
    input.addEventListener('blur', () => { keyboardAdjusting = false; commitSetting(); });
    input.addEventListener('input', () => {
      if (phase !== 'idle' || confirmingSetting) return;
      const value = Number(input.value);
      if (!window.ManuscriptWriting.hasMarks || settingsApproved) { applySetting(id, value); return; }
      pendingSetting = { id, value };
      $(sliderOutput[id]).textContent = id === 'reader-width' ? `${value}px` : id === 'columns' ? `約${value}文字`
        : id === 'line-height' ? value.toFixed(1) : value ? `${value}表示行ごと` : 'なし';
    });
  });
  document.addEventListener('pointerup', () => { pointerAdjusting = false; commitSetting(); });
  document.addEventListener('pointercancel', () => { if (pendingSetting) discardSetting(); pointerAdjusting = false; });
  function cancelMeasurement() {
    clearTimeout(countdownTimer); clearInterval(elapsedTimer);
    phase = 'idle'; $('paper-mode').disabled = false; $('toolbar-settings').disabled = false; $('countdown').hidden = true; $('measurement-bar').hidden = true;
    $('start').disabled = false;
    ['preparation-partial-enabled', 'preparation-partial-limit'].forEach(id => $(id).disabled = false);
  }
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  $('start').onclick = () => {
    if (phase !== 'idle' || document.hidden) return;
    if (measuredPartial && (!validPartialLimit() || !measuredCount)) { notify('読む文字数の目安は正の整数で入力してください。'); return; }
    if (target !== '' && !validTarget(target)) { notify('作品全体の文字数を1〜1,000,000,000の整数で入力してください。'); $('preparation-target').focus(); return; }
    $('settings-dialog').close();
    phase = 'countdown'; $('paper-mode').disabled = true; $('start').disabled = true; $('toolbar-settings').disabled = true;
    ['preparation-partial-enabled', 'preparation-partial-limit'].forEach(id => $(id).disabled = true);
    // Remove preparation controls and scroll to the beginning BEFORE counting.
    $('preparation').hidden = true; $('measurement-bar').hidden = false; $('finish').disabled = true;
    $('elapsed').textContent = '準備中'; window.scrollTo(0, 0);
    window.Reader.refresh(null);
    let value = 3; $('countdown').hidden = false; $('countdown').textContent = '3';
    const tick = () => {
      if (phase !== 'countdown') return;
      value--;
      if (value > 0) { $('countdown').textContent = String(value); countdownTimer = setTimeout(tick, 1000); }
      else {
        $('countdown').textContent = 'スタート'; phase = 'running'; began = performance.now();
        $('finish').disabled = false; $('elapsed').textContent = '0:00';
        countdownTimer = setTimeout(() => $('countdown').hidden = true, 500);
        elapsedTimer = setInterval(() => $('elapsed').textContent = clock((performance.now() - began) / 1000), 250);
      }
    };
    countdownTimer = setTimeout(tick, 1000);
  };
  $('finish').onclick = () => {
    const stopped = performance.now();
    if (phase !== 'running') return;
    const seconds = (stopped - began) / 1000;
    cancelMeasurement();
    if (Number.isFinite(seconds) && seconds > 0) {
      lastMeasuredCustomText = measuredType === 'custom' ? displayedText : null;
      history.push({ characters: measuredCount, seconds, type: measuredType }); persist();
    }
    show('results');
  };
  function renderResults() {
    const characters = history.reduce((sum, r) => sum + r.characters, 0);
    const seconds = history.reduce((sum, r) => sum + r.seconds, 0);
    const speed = seconds > 0 ? characters / seconds * 60 : 0;
    const minutes = Number(target) / speed;
    $('time-estimate').textContent = !history.length ? '計測結果がありません'
      : target === '' ? '作品の文字数を入力してください'
        : !validTarget(target) ? '作品の文字数を正しく入力してください'
          : `約${(minutes < 10 ? Math.max(.1, Math.round(minutes * 10) / 10) : Math.round(minutes)).toLocaleString()}分`;
    $('speed-estimate').textContent = !history.length ? '計測結果がありません'
      : !validMinutes(plannedMinutes) ? '予定時間を正しく入力してください'
        : `約${Math.round(Number(plannedMinutes) * speed).toLocaleString()}文字`;
    $('result-summary').textContent = history.length ? `合計${characters.toLocaleString()}文字・実測${seconds.toFixed(1)}秒 ／ 平均${Math.round(speed).toLocaleString()}文字/分` : '';
    const lastMeasurement = history.at(-1);
    const currentText = $('time-text').value.replace(/\r\n?/g, '\n');
    const retainedCustomText = lastMeasurement?.type === 'custom' && currentText && currentText === lastMeasuredCustomText?.replace(/\r\n?/g, '\n');
    $('again').textContent = lastMeasurement?.type === 'custom' ? '入力した文章に戻る' : '計測設定に戻る';
    $('result-retention').hidden = !retainedCustomText;
    $('history').replaceChildren();
    history.forEach((record, i) => {
      const li = document.createElement('li'), detail = document.createElement('div'), small = document.createElement('small'), remove = document.createElement('button');
      detail.textContent = `${i + 1}回目 · ${record.characters.toLocaleString()}文字 / ${record.seconds.toFixed(1)}秒`;
      small.textContent = `${record.type === 'sample' ? '例文' : '用意した文章'}・${Math.round(record.characters / record.seconds * 60).toLocaleString()}文字/分`;
      detail.append(small); remove.textContent = '削除'; remove.setAttribute('aria-label', `${i + 1}回目の計測結果を削除`);
      remove.onclick = () => { history.splice(i, 1); persist(); renderResults(); };
      li.append(detail, remove); $('history').append(li);
    });
    $('reset-history').disabled = !history.length;
  }
  $('existing-results').onclick = () => show('results');
  $('again').onclick = () => show('time-input');
  $('reset-history').onclick = async () => { if (await ask('すべての計測履歴を削除しますか？')) { history = []; persist(); renderResults(); } };
  function readyForDirectAction() {
    if (window.Reader.hasPending) {
      window.Reader.focusPending();
      notify('入力中の読み仮名を確定またはキャンセルしてから操作してください。');
      return false;
    }
    if (!window.ManuscriptWriting.hasPending) return true;
    window.ManuscriptWriting.focusPending();
    notify('入力中の書き込みを確定またはキャンセルしてから操作してください。');
    return false;
  }
  function wakeUI() {
    const handheld = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1)
      || (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse) and (hover: none)').matches);
    const on = Boolean(wakeLock && !wakeLock.released);
    $('wake').hidden = !handheld || !('wakeLock' in navigator);
    $('wake').querySelector('.button-state').textContent = wakePending ? '…' : on ? 'ON' : 'OFF';
    $('wake').setAttribute('aria-pressed', String(on));
    $('wake').setAttribute('aria-label', `画面点灯維持：${on ? 'ON' : 'OFF'}`);
    $('wake').disabled = wakePending || !('wakeLock' in navigator);
  }
  async function releaseWake() {
    wakeGeneration++; const current = wakeLock; wakeLock = null; wakeUI();
    if (current) { try { await current.release(); } catch { /* Already released. */ } }
  }
  $('wake').onclick = async () => {
    if (wakeLock) { await releaseWake(); return; }
    if (view !== 'reading' || document.hidden || wakePending) return;
    const generation = ++wakeGeneration; wakePending = true; wakeUI();
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (generation !== wakeGeneration || view !== 'reading' || document.hidden) { await acquired.release(); return; }
      wakeLock = acquired;
      acquired.addEventListener('release', () => { if (wakeLock === acquired) { wakeLock = null; wakeUI(); notify('点灯維持を解除しました。必要なときは再度ONにしてください。'); } });
    } catch { wakeUI(); notify('点灯維持を取得できませんでした。通常どおり朗読できます。'); }
    finally { wakePending = false; wakeUI(); }
  };
  wakeUI();
  function interrupt() {
    if (phase !== 'idle') {
      cancelMeasurement(); $('preparation').hidden = mode !== 'time';
      notify('画面が非表示になったため、この回の計測を無効にしました。過去の結果は保持しています。');
    }
    releaseWake();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); });
  addEventListener('pagehide', interrupt);
  $('existing-results').hidden = !history.length;
  // Only transform the controls: do not change the text or annotation layout.
  const toolbarSurface = document.querySelector('.reader-controls');
  const toolbarMobile = matchMedia('(max-width: 600px)');
  let toolbarY = window.scrollY, toolbarTravel = 0, toolbarDirection = 0, toolbarIgnoreUntil = 0;
  function revealToolbar() {
    toolbarSurface.classList.remove('is-scroll-hidden');
    toolbarY = window.scrollY; toolbarTravel = 0; toolbarDirection = 0;
  }
  function toolbarLocked() {
    return !toolbarMobile.matches || view !== 'reading' || phase === 'countdown'
      || window.ManuscriptWriting.enabled
      || Boolean(document.querySelector('dialog[open]'))
      || Boolean(document.activeElement?.matches('input,textarea,select'));
  }
  addEventListener('scroll', () => {
    const y = Math.max(0, window.scrollY), delta = y - toolbarY; toolbarY = y;
    if (toolbarLocked() || y < 40 || performance.now() < toolbarIgnoreUntil) { revealToolbar(); return; }
    if (Math.abs(delta) < 2) return;
    const direction = Math.sign(delta);
    if (direction !== toolbarDirection) { toolbarTravel = 0; toolbarDirection = direction; }
    toolbarTravel += Math.abs(delta);
    if (toolbarTravel >= (direction > 0 ? 64 : 32)) {
      toolbarSurface.classList.toggle('is-scroll-hidden', direction > 0); toolbarTravel = 0;
    }
  }, { passive:true });
  toolbarSurface.addEventListener('focusin', revealToolbar);
  $('reader').addEventListener('reader-ruby-mode', revealToolbar);
  document.addEventListener('reader-writing-mode', revealToolbar);
  $('reader').addEventListener('reader-layout', revealToolbar);
  document.querySelectorAll('dialog').forEach(dialog => new MutationObserver(revealToolbar).observe(dialog, { attributes:true, attributeFilter:['open'] }));
  new MutationObserver(revealToolbar).observe($('reading'), { attributes:true, attributeFilter:['hidden'] });
  function resetToolbarViewport() { toolbarIgnoreUntil = performance.now() + 250; revealToolbar(); }
  addEventListener('resize', resetToolbarViewport);
  addEventListener('orientationchange', resetToolbarViewport);
  window.visualViewport?.addEventListener('resize', resetToolbarViewport);
})();
