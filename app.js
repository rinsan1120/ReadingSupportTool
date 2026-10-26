(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let library = null, changeTimer = 0, libraryReady = false;
  let savedUserSnapshot = null, captureFailed = false, userDirty = false, savingUser = false, userFilename = '';
  let hasLegacyUserData = false, pendingDownloadSnapshot = null;
  let view = 'home', mode = 'read', sourceType = 'sample', sample = null;
  let history = [], target = '', targetManual = false, plannedMinutes = '20';
  let readMeasurementReturn = null;
  let phase = 'idle', began = 0, accumulatedMilliseconds = 0, countdownTimer = 0, elapsedTimer = 0, noticeTimer = 0;
  let measuredCount = 0, measuredType = 'sample', lastMeasuredCustomText = null, wakeLock = null, wakePending = false, wakeGeneration = 0;
  let partialOn = false, partialLimit = '200', measuredPartial = false, timingRange = null;
  let readAnnotations = new window.ReadingAnnotations();
  let readMarks = new window.ManuscriptMarks();
  let pendingReadPaste = null;
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
    ['preparation-partial'].forEach(prefix => {
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
  function currentScreenId() {
    if (view === 'home') return 'SCR-HOME';
    if (view === 'read-input') return 'SCR-READ-INPUT';
    if (view === 'time-input') return 'SCR-TIME-INPUT';
    if (view === 'reading') {
      if (mode === 'read') return 'SCR-READ-VIEW';
      if (phase === 'countdown') return 'SCR-TIME-COUNTDOWN';
      if (phase === 'resuming') return 'SCR-TIME-RESUME-COUNTDOWN';
      if (phase === 'paused') return 'SCR-TIME-PAUSED';
      if (phase === 'running') return 'SCR-TIME-RUN';
      return 'SCR-TIME-PREP';
    }
    if (view === 'results') return 'SCR-RESULT-TIME';
    if (view === 'estimate') return 'SCR-ESTIMATE';
    return 'SCR-HOME';
  }
  function syncScreenId() {
    document.querySelector('main').dataset.screenId = currentScreenId();
    syncWorkflow();
  }
  function renderSteps(id, measuring, current) {
    const list = $(id), labels = measuring ? ['本文を用意', '原稿を整える', '測る', '結果'] : ['本文を用意', '原稿を整える'];
    const key = `${measuring}:${current}`;
    if (list.dataset.progress === key) return;
    list.dataset.progress = key;
    list.replaceChildren(...labels.map((label, index) => {
      const item = document.createElement('li'), marker = document.createElement('span'), name = document.createElement('span'), status = document.createElement('small');
      const completed = index < current, active = index === current;
      item.className = completed ? 'is-complete' : active ? 'is-current' : 'is-pending';
      if (active) item.setAttribute('aria-current', 'step');
      marker.className = 'step-marker'; marker.setAttribute('aria-hidden', String(!active));
      marker.textContent = completed ? '✓' : active ? `${index + 1}/${labels.length}` : String(index + 1);
      name.textContent = label; status.textContent = completed ? '完了' : active ? '現在' : 'これから';
      item.append(marker, name, status);
      return item;
    }));
  }
  function syncWorkflow() {
    if (view === 'read-input') renderSteps('read-input-steps', false, 0);
    if (view === 'time-input') renderSteps('time-input-steps', true, 0);
    if (view === 'results') {
      $('result-steps').hidden = !history.length;
      if (history.length) renderSteps('result-steps', true, 3);
    }
    if (view !== 'reading') return;
    const measuring = mode === 'time', active = measuring && phase !== 'idle';
    $('reader-state').textContent = !measuring ? '原稿編集中' : phase === 'running' ? '計測中' : phase === 'paused' ? '一時停止中' : phase === 'resuming' ? '再開準備中' : phase === 'countdown' ? '計測開始前' : '計測準備';
    $('reader-progress').classList.toggle('is-measuring', active);
    renderSteps('reader-steps', measuring, active ? 2 : 1);
    const backLabel = measuring ? '計測設定に戻る' : '本文入力に戻る';
    $('reader-back').querySelector('span').textContent = backLabel;
    $('reader-back').setAttribute('aria-label', backLabel);
  }
  async function copyScreenId() {
    const id = currentScreenId();
    try {
      if (typeof navigator.clipboard?.writeText === 'function') await navigator.clipboard.writeText(id);
      else {
        const field = document.createElement('textarea');
        field.value = id; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.append(field); field.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } finally { field.remove(); }
        if (!copied) throw new Error('copy command failed');
      }
      notify(`画面IDをコピーしました：${id}`);
    } catch { notify(`画面IDをコピーできませんでした：${id}`); }
  }
  $('screen-id-copy').addEventListener('click', copyScreenId);
  $('screen-id-copy').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); copyScreenId(); }
  });
  function recordChanges() {
    if (libraryReady) syncLibrary();
  }
  function setTarget(value, manual = false) {
    target = value; if (manual) targetManual = true;
    $('result-target').value = value; $('estimate-target').value = value;
    updatePreparationInfo();
  }
  function updatePreparationInfo() {
    $('preparation-info').textContent = measuredPartial
      ? `読む文字数の目安：${validPartialLimit() ? Number(partialLimit) : '未設定'}文字\n実際に読む文字数：${measuredCount}文字${timingRange?.full ? '（全文が対象です。）' : ''}`
      : `計測する本文：${measuredCount}文字`;
    $('finish').textContent = measuredPartial ? '計測終了' : '読了';
    $('preparation-guidance').textContent = (measuredPartial ? '表示された文章を読み終えたら「計測終了」を押してください。' : '全文を読み終えたら「読了」を押してください。') + '計測中に入力画面やホームへ戻る、または別のタブ・アプリへ移動すると、その回の計測結果は保存されません。';
  }
  setTarget(target);
  $('planned-minutes').value = plannedMinutes;
  function show(next) {
    if (libraryReady) syncLibrary();
    if (view === 'reading' && next !== 'reading') { window.ManuscriptWriting.leave(); window.ManuscriptPrint.clear(); window.Reader.leave(); cancelMeasurement(); releaseWake(); }
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== next);
    view = next; $('footer').hidden = next === 'reading';
    if (next === 'results' || next === 'estimate') renderResults();
    if (next === 'home') renderHomeResults();
    $('existing-results').hidden = !history.length;
    $('annotation-retention').hidden = !hasReadings(readAnnotations);
    $('time-annotation-retention').hidden = !hasReadings(timeAnnotations) && !timeMarks?.hasMarks;
    $('writing-retention').hidden = !readMarks.hasMarks;
    syncScreenId();
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
    $('custom-input').hidden = sourceType !== 'custom';
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
  ['preparation-partial'].forEach(prefix => {
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
  ['result-target', 'estimate-target'].forEach(id => $(id).addEventListener('input', () => {
    setTarget($(id).value, true); recordChanges(); renderResults();
  }));
  ['planned-minutes', 'estimate-minutes'].forEach(id => $(id).addEventListener('input', () => {
    plannedMinutes = $(id).value; recordChanges(); renderResults();
  }));
  async function openReader(nextMode) {
    if (openingReader) return;
    const pasted = nextMode === 'read' && pendingReadPaste?.input === $('read-text').value ? pendingReadPaste.model : null;
    const text = nextMode === 'read' ? (pasted ? pasted.source : $('read-text').value === readInputSnapshot ? readAnnotations.source : $('read-text').value) : sourceType === 'sample' ? sample.text :
      timeAnnotations && $('time-text').value === timeInputSnapshot ? timeAnnotations.source : $('time-text').value;
    const retainedRead = nextMode === 'read' && $('read-text').value === readInputSnapshot;
    if (!countText(text) && !retainedRead) { notify('朗読する文章を入力してください。'); return; }
    openingReader = true;
    try {
      if (nextMode === 'read' && (text !== readAnnotations.source || pasted)) {
        if ((hasReadings(readAnnotations) || readMarks.hasMarks) && !await ask('この文章を開くと、現在の原稿の読み仮名・赤ペン・マーカー・文字メモはすべて削除されます。変更後の本文を開きますか？', '開く')) return;
        if (pasted) readAnnotations = pasted;
        else readAnnotations.reset(text);
        pendingReadPaste = null;
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
  function displayReader(nextMode, text, readerReturnState = null) {
    mode = nextMode;
    displayedText = text;
    const paper = timingPaper[sourceType];
    if (mode === 'time' && paper.text !== text) { paper.text = text; paper.on = false; }
    applyPaper(mode === 'read' ? readPaper : paper.on);
    show('reading');
    $('reading-title').textContent = mode === 'time' ? (sourceType === 'sample' ? sample.title : '朗読速度の計測') : '原稿画面';
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
    if (mode === 'read' && readerReturnState) {
      Object.entries(readerReturnState.settings).forEach(([id, value]) => { $(id).value = value; applySetting(id, Number(value)); });
      if (readerReturnState.anchor) requestAnimationFrame(() => window.Reader.restore(readerReturnState.anchor));
    }
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
    const readerReturnAnchor = window.Reader.capture();
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
      const settings = Object.fromEntries(['reader-width', 'columns', 'line-height', 'break-lines'].map(id => [id, $(id).value]));
      displayReader('time', text);
      readMeasurementReturn = { anchor: readerReturnAnchor, settings };
    } catch (error) { notify(`計測用の原稿を準備できません。${error.message}`); }
    finally { openingReader = false; }
  };
  $('export-manuscript').onclick = saveUserData;
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
        !await ask('現在の本文・読み仮名・赤ペン・マーカー・文字メモを、選択した原稿ファイルの内容で置き換えますか？この原稿の内容は置き換わります。', '置き換える')) return;
      // All validation and confirmation have succeeded. Commit together, using
      // the same model and rendering path as manually entered manuscripts.
      readAnnotations = restored;
      readMarks = markings;
      pendingReadPaste = null;
      $('read-text').value = restored.source;
      readInputSnapshot = $('read-text').value;
      $('read-text').dispatchEvent(new Event('input'));
      displayReader('read', restored.source);
      notify('原稿ファイルを読み込みました。');
    } catch (error) { notify(`原稿を読み込めません。${error.message}`); }
    finally { importing = false; $('import-manuscript').disabled = false; }
  });
  function requestNavigation(next) {
    if (!libraryReady || !readyForDirectAction()) return;
    if (next === 'home' || next === 'read-input') readMeasurementReturn = null;
    show(next);
  }
  async function approveEditing() { return readyForDirectAction(); }
  $('reader-back').onclick = () => requestNavigation(mode === 'time' ? 'time-input' : 'read-input');
  $('toolbar-settings').onclick = () => { if (!readyForDirectAction()) return; openSettings(); };
  function closeWritingMenu() {
    closeSettings();
    window.ManuscriptWriting.setMode(false);
    $('writing-mode').focus({ preventScroll: true });
  }
  $('writing-off').onclick = closeWritingMenu;
  $('writing-mode').onclick = async () => {
    if (window.ManuscriptWriting.enabled) { closeWritingMenu(); return; }
    if (!await approveEditing(false)) return;
    closeSettings();
    window.ManuscriptWriting.setMode(true);
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
    accumulatedMilliseconds = 0; began = 0;
    phase = 'idle'; $('paper-mode').disabled = false; $('toolbar-settings').disabled = false; $('countdown').hidden = true; $('measurement-bar').hidden = true;
    $('start').disabled = false;
    updateMeasurementControls();
    ['preparation-partial-enabled', 'preparation-partial-limit'].forEach(id => $(id).disabled = false);
    syncScreenId();
  }
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  function measurementMilliseconds(now = performance.now()) {
    return accumulatedMilliseconds + (phase === 'running' ? now - began : 0);
  }
  function updateMeasurementControls() {
    $('pause-measurement').textContent = phase === 'paused' ? '再開' : phase === 'resuming' ? '再開準備中' : '一時停止';
    $('pause-measurement').disabled = phase !== 'running' && phase !== 'paused';
    $('finish').disabled = phase !== 'running';
    $('measurement-status').textContent = phase === 'paused' ? '一時停止中' : phase === 'resuming' ? '再開準備中' : phase === 'countdown' ? '開始準備中' : phase === 'running' ? '計測中' : '';
    $('elapsed').textContent = clock(measurementMilliseconds() / 1000);
  }
  function beginCountdown(resuming = false) {
    clearTimeout(countdownTimer); clearInterval(elapsedTimer);
    const countdownPhase = resuming ? 'resuming' : 'countdown';
    phase = countdownPhase; updateMeasurementControls(); syncScreenId();
    let value = 3; $('countdown').hidden = false; $('countdown').textContent = '3';
    const tick = () => {
      if (phase !== countdownPhase) return;
      if (document.hidden) { interrupt(); return; }
      value--;
      if (value > 0) { $('countdown').textContent = String(value); countdownTimer = setTimeout(tick, 1000); }
      else {
        $('countdown').textContent = resuming ? '再開' : 'スタート';
        began = performance.now(); phase = 'running'; updateMeasurementControls(); syncScreenId();
        countdownTimer = setTimeout(() => $('countdown').hidden = true, 500);
        elapsedTimer = setInterval(() => $('elapsed').textContent = clock(measurementMilliseconds() / 1000), 250);
      }
    };
    countdownTimer = setTimeout(tick, 1000);
  }
  $('start').onclick = () => {
    if (phase !== 'idle' || document.hidden) return;
    if (measuredPartial && (!validPartialLimit() || !measuredCount)) { notify('読む文字数の目安は正の整数で入力してください。'); return; }
    $('settings-dialog').close();
    accumulatedMilliseconds = 0;
    $('paper-mode').disabled = true; $('start').disabled = true; $('toolbar-settings').disabled = true;
    ['preparation-partial-enabled', 'preparation-partial-limit'].forEach(id => $(id).disabled = true);
    // Remove preparation controls and scroll to the beginning BEFORE counting.
    $('preparation').hidden = true; $('measurement-bar').hidden = false;
    window.scrollTo(0, 0);
    window.Reader.refresh(null);
    beginCountdown();
  };
  $('pause-measurement').onclick = () => {
    if (document.hidden) return;
    if (phase === 'running') {
      accumulatedMilliseconds = measurementMilliseconds();
      clearInterval(elapsedTimer); clearTimeout(countdownTimer); $('countdown').hidden = true;
      phase = 'paused'; updateMeasurementControls(); syncScreenId();
    } else if (phase === 'paused') beginCountdown(true);
  };
  $('finish').onclick = () => {
    const stopped = performance.now();
    if (phase !== 'running') return;
    const seconds = measurementMilliseconds(stopped) / 1000;
    cancelMeasurement();
    if (Number.isFinite(seconds) && seconds > 0) {
      lastMeasuredCustomText = measuredType === 'custom' ? displayedText : null;
      history.push({ characters: measuredCount, seconds, type: measuredType, measuredAt: new Date().toISOString(),
        title: measuredType === 'sample' ? sample.title : readMeasurementReturn ? activeBook()?.title || '無題の原稿' : '用意した文章' });
      history = history.slice(-100); recordChanges();
    }
    show('results');
  };
  function readingStatistics() {
    const characters = history.reduce((sum, r) => sum + r.characters, 0);
    const seconds = history.reduce((sum, r) => sum + r.seconds, 0);
    const speed = seconds > 0 ? characters / seconds * 60 : 0;
    return { characters, seconds, speed };
  }
  function paceText(speed) { return history.length ? `約${Math.round(speed).toLocaleString()}文字 / 分` : '未計測'; }
  function renderHomeResults() {
    $('home-results').hidden = !history.length;
    $('home-average-speed').textContent = history.length ? paceText(readingStatistics().speed) : '';
  }
  function renderResults() {
    const { characters, seconds, speed } = readingStatistics();
    const minutes = Number(target) / speed;
    $('time-estimate').textContent = !history.length ? '計測結果がありません'
      : target === '' ? '作品の文字数を入力してください'
        : !validTarget(target) ? '作品の文字数を正しく入力してください'
          : `約${(minutes < 10 ? Math.max(.1, Math.round(minutes * 10) / 10) : Math.round(minutes)).toLocaleString()}分`;
    $('speed-estimate').textContent = !history.length ? '計測結果がありません'
      : !validMinutes(plannedMinutes) ? '予定時間を正しく入力してください'
        : `約${Math.round(Number(plannedMinutes) * speed).toLocaleString()}文字`;
    const pace = paceText(speed);
    $('average-speed').textContent = pace; $('estimate-average-speed').textContent = pace;
    $('estimate-target').value = target; $('result-target').value = target;
    $('planned-minutes').value = plannedMinutes; $('estimate-minutes').value = plannedMinutes;
    $('estimate-time').textContent = $('time-estimate').textContent;
    $('estimate-capacity').textContent = $('speed-estimate').textContent;
    $('result-empty').hidden = !!history.length; $('estimate-empty').hidden = !!history.length;
    $('estimate-results').hidden = !history.length;
    $('estimate-return').hidden = !readMeasurementReturn;
    $('retry-measurement').hidden = !history.length;
    $('history-count').textContent = `（${history.length}回）`;
    $('result-summary').textContent = history.length ? `合計${characters.toLocaleString()}文字・実測${seconds.toFixed(1)}秒 ／ 平均${Math.round(speed).toLocaleString()}文字/分` : '';
    const lastMeasurement = history.at(-1);
    const currentText = $('time-text').value.replace(/\r\n?/g, '\n');
    const retainedCustomText = lastMeasurement?.type === 'custom' && currentText && currentText === lastMeasuredCustomText?.replace(/\r\n?/g, '\n');
    $('again').textContent = readMeasurementReturn ? '原稿に戻る' : sourceType === 'custom' ? '入力した文章に戻る' : '計測設定に戻る';
    $('result-retention').hidden = !retainedCustomText;
    $('history').replaceChildren();
    history.forEach((record, i) => {
      const li = document.createElement('li'), detail = document.createElement('div'), small = document.createElement('small'), remove = document.createElement('button');
      detail.textContent = `${i + 1}回目 · ${record.characters.toLocaleString()}文字 / ${record.seconds.toFixed(1)}秒`;
      small.textContent = `${record.measuredAt ? new Date(record.measuredAt).toLocaleString('ja-JP') : '日時不明（旧履歴）'} · ${record.title || (record.type === 'sample' ? '例文' : '用意した文章')}・${Math.round(record.characters / record.seconds * 60).toLocaleString()}文字/分`;
      detail.append(small); remove.textContent = '削除'; remove.setAttribute('aria-label', `${i + 1}回目の計測結果を削除`);
      remove.onclick = () => { history.splice(i, 1); recordChanges(); renderResults(); };
      li.append(detail, remove); $('history').append(li);
    });
    $('reset-history').disabled = !history.length;
    renderHomeResults();
    syncWorkflow();
  }
  $('existing-results').onclick = () => show('results');
  function returnToSource() {
    if (readMeasurementReturn) {
      const returnState = readMeasurementReturn;
      readMeasurementReturn = null;
      show('reading');
      displayReader('read', readAnnotations.source, returnState);
      return;
    }
    show('time-input');
  }
  $('again').onclick = returnToSource;
  $('estimate-return').onclick = returnToSource;
  $('retry-measurement').onclick = () => openReader('time');
  $('reset-history').onclick = async () => { if (await ask('すべての計測履歴を削除しますか？')) { history = []; recordChanges(); renderResults(); } };
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
  renderHomeResults();
  // Only transform the controls: do not change the text or annotation layout.
  const toolbarSurface = document.querySelector('.reader-controls');
  const toolbarMobile = matchMedia('(max-width: 600px)');
  let toolbarY = window.scrollY, toolbarTravel = 0, toolbarDirection = 0, toolbarIgnoreUntil = 0;
  function revealToolbar() {
    toolbarSurface.classList.remove('is-scroll-hidden');
    toolbarY = window.scrollY; toolbarTravel = 0; toolbarDirection = 0;
  }
  function toolbarLocked() {
    return !toolbarMobile.matches || view !== 'reading' || phase === 'countdown' || phase === 'resuming'
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

  function activeBook() { return library?.manuscripts.find(book => book.id === library.activeId); }
  function renderIdentity() {
    const book = activeBook();
    $('profile-display').textContent = (library.profile.name ? `${library.profile.name}さんの本棚` : 'あなたの本棚') + (book ? ` · ${book.title}` : '');
  }
  function saveStatus(message, failed = false) {
    $('user-save-status').textContent = message;
    $('user-save-status').classList.toggle('save-failed', failed);
    $('user-save-status').dataset.unsaved = String(userDirty);
  }
  function snapshotKey(data) {
    // Opening a different book does not change the user's manuscripts or results.
    return JSON.stringify({ ...data, activeId: null }, (key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(name => [name, value[name]])) : value);
  }
  function renderSaveState(message = '') {
    saveStatus(message || (userDirty ? '未保存の変更があります。JSONファイルに保存してください。' : `変更なし · ${userFilename || '読み込んだユーザーデータ'}`), captureFailed);
  }
  function createBook() {
    if (library.manuscripts.length >= 500) throw new Error('原稿は500件までです。バックアップして整理してください。');
    const now = new Date().toISOString();
    const book = { id: crypto.randomUUID(), title: '無題の原稿', createdAt: now, updatedAt: now, draft: '', pending: null,
      manuscript: JSON.parse(window.ManuscriptMarks.serializeManuscript(new window.ReadingAnnotations(), new window.ManuscriptMarks())) };
    library.manuscripts.push(book); library.activeId = book.id; return book;
  }
  function captureLibrary() {
    let book = activeBook();
    if (!book && ($('read-text').value || readAnnotations.source)) book = createBook();
    if (book) {
      const manuscript = JSON.parse(window.ManuscriptMarks.serializeManuscript(readAnnotations, readMarks));
      const draft = $('read-text').value;
      if (draft.length > window.ReadingAnnotations.MAX_TEXT_LENGTH) throw new Error('本文は200,000 UTF-16文字までです。');
      const title = $('manuscript-title').value.trim() || '無題の原稿';
      const pending = pendingReadPaste?.input === draft ? pendingReadPaste.model.toJSON() : null;
      if (book.draft !== draft || book.title !== title || JSON.stringify(book.manuscript) !== JSON.stringify(manuscript) || JSON.stringify(book.pending) !== JSON.stringify(pending)) {
        Object.assign(book, { draft, title, manuscript, pending, updatedAt: new Date().toISOString() });
      }
    }
    library.profile.name = $('profile-name').value;
    library.history = history;
    library.target = validTarget(target) ? String(Number(target)) : '';
    library.plannedMinutes = validMinutes(plannedMinutes) ? String(Number(plannedMinutes)) : '20';
    renderIdentity();
  }
  function syncLibrary() {
    if (!libraryReady) return false;
    clearTimeout(changeTimer);
    try {
      captureLibrary(); captureFailed = false;
      userDirty = savedUserSnapshot === null || snapshotKey(library) !== savedUserSnapshot;
      renderSaveState(); renderLibrary(); return true;
    } catch (error) {
      captureFailed = true; userDirty = true;
      saveStatus(`未保存：${error.message} 変更はこの画面内にのみ保持されています。`, true); return false;
    }
  }
  function scheduleLibraryChange() {
    if (!libraryReady) return;
    // Mark immediately, then capture after the synchronous model operation finishes.
    userDirty = true; renderSaveState(); clearTimeout(changeTimer);
    changeTimer = setTimeout(syncLibrary, 150);
  }
  function restoreBook(book) {
    const restored = book ? window.ManuscriptMarks.restoreManuscript(JSON.stringify(book.manuscript)) :
      { manuscript: new window.ReadingAnnotations(), markings: new window.ManuscriptMarks() };
    readAnnotations = restored.manuscript; readMarks = restored.markings;
    $('read-text').value = book?.draft || '';
    readInputSnapshot = readAnnotations.source.replace(/\r\n?/g, '\n');
    pendingReadPaste = book?.pending ? { model: window.ReadingAnnotations.fromData(book.pending), input: book.draft } : null;
    $('manuscript-title').value = book?.title || '';
    $('read-count').textContent = `${countText($('read-text').value)}文字`;
    readPaper = false; readMeasurementReturn = null;
    renderIdentity();
  }
  let libraryRenderKey = '';
  function renderLibrary() {
    const key = JSON.stringify(library.manuscripts.map(b => [b.id, b.title, b.updatedAt, b.draft.length]));
    if (key === libraryRenderKey) return;
    libraryRenderKey = key;
    $('library-empty').hidden = !!library.manuscripts.length;
    $('library-list').replaceChildren(...[...library.manuscripts].reverse().map(book => {
      const li = document.createElement('li'), open = document.createElement('button'), detail = document.createElement('small'), remove = document.createElement('button');
      open.className = 'book-open'; open.textContent = book.title;
      detail.textContent = `${countText(book.draft).toLocaleString()}文字 · ${new Date(book.updatedAt).toLocaleDateString('ja-JP')}`;
      open.append(detail);
      open.onclick = () => {
        if (!syncLibrary()) { notify('入力内容を確認してから原稿を切り替えてください。'); return; }
        library.activeId = book.id; restoreBook(book); syncLibrary();
        if (book.draft === readInputSnapshot && countText(book.draft)) displayReader('read', readAnnotations.source);
        else show('read-input');
      };
      remove.textContent = '削除'; remove.setAttribute('aria-label', `${book.title}を削除`);
      remove.onclick = async () => {
        if (!await ask(`「${book.title}」とその書き込みを削除します。この操作は取り消せません。必要なら先にバックアップしてください。`, '削除する', '原稿を削除しますか？')) return;
        if (!syncLibrary()) return;
        const candidate = structuredClone(library);
        candidate.manuscripts = candidate.manuscripts.filter(b => b.id !== book.id);
        if (candidate.activeId === book.id) candidate.activeId = null;
        try {
          library = candidate;
          if (!library.activeId) restoreBook(null);
          syncLibrary();
        } catch (error) { saveStatus(`削除できません：${error.message}`, true); }
      };
      li.append(open, remove); return li;
    }));
  }
  $('new-manuscript').onclick = () => {
    if (!syncLibrary()) return;
    try { const book = createBook(); restoreBook(book); syncLibrary(); show('read-input'); $('manuscript-title').focus(); }
    catch (error) { notify(error.message); }
  };
  ['read-text', 'manuscript-title', 'profile-name'].forEach(id => $(id).addEventListener('input', scheduleLibraryChange));
  // Debouncing captures completed model operations, excluding unfinished gestures/editors.
  document.addEventListener('manuscript-change', scheduleLibraryChange);
  addEventListener('beforeunload', event => {
    if (!libraryReady) return;
    syncLibrary();
    if (userDirty || window.Reader.hasPending || window.ManuscriptWriting.hasPending) {
      event.preventDefault(); event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && libraryReady) syncLibrary(); });

  function setFileControlsBusy(busy) {
    ['export-manuscript', 'export-user', 'save-user-status', 'import-user', 'start-load', 'start-new', 'start-legacy'].forEach(id => { $(id).disabled = busy; });
  }
  function downloadJSON(json, filename) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a');
    try { a.href = url; a.download = filename; document.body.append(a); a.click(); }
    finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  }
  function markFileSaved(key, filename) {
    savedUserSnapshot = key; userFilename = filename;
    syncLibrary();
  }
  async function saveUserData() {
    if (!libraryReady || savingUser || !readyForDirectAction() || !syncLibrary()) return;
    savingUser = true; setFileControlsBusy(true);
    let writable = null;
    try {
      const validated = window.UserLibrary.validate(library);
      const json = JSON.stringify(validated, null, 2); window.UserLibrary.parse(json);
      const key = snapshotKey(validated);
      const filename = userFilename || `yomijitaku-user-${new Date().toLocaleDateString('sv-SE')}.json`;
      if (typeof window.showSaveFilePicker === 'function' && window.isSecureContext) {
        // Keep the picker in the initiating user gesture. Never fall back on cancel/error.
        const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'よみじたく ユーザーデータJSON', accept: { 'application/json': ['.json'] } }] });
        writable = await handle.createWritable();
        await writable.write(json); await writable.close(); writable = null;
        markFileSaved(key, handle.name || filename);
        notify(userDirty ? 'ファイルを保存しました。保存中に加わった変更は未保存です。' : 'ユーザーデータをファイルに保存しました。');
      } else {
        downloadJSON(json, filename);
        // A download click does not prove that the browser actually saved a file.
        pendingDownloadSnapshot = { key, filename };
        $('download-confirm-dialog').showModal(); $('download-not-saved').focus();
        renderSaveState('ダウンロードを開始しました。端末への保存が未確認です。');
      }
    } catch (error) {
      if (writable) { try { await writable.abort(); } catch { /* Keep the original failure. */ } }
      syncLibrary();
      const outcome = error.name === 'AbortError' ? '保存をキャンセルしました。' : `ファイルを保存できません：${error.message}`;
      saveStatus(`${outcome} ${userDirty ? '未保存の変更があります。' : '元の保存状態を維持しています。'}`, error.name !== 'AbortError');
    } finally { savingUser = false; setFileControlsBusy(false); }
  }
  $('export-user').onclick = saveUserData;
  $('save-user-status').onclick = saveUserData;
  $('download-saved').onclick = () => {
    if (!pendingDownloadSnapshot) return;
    const saved = pendingDownloadSnapshot; pendingDownloadSnapshot = null;
    markFileSaved(saved.key, saved.filename); $('download-confirm-dialog').close();
  };
  $('download-not-saved').onclick = () => $('download-confirm-dialog').close();
  $('download-confirm-dialog').addEventListener('close', () => { pendingDownloadSnapshot = null; syncLibrary(); });

  function useUserData(candidate, filename = '', saved = false) {
    clearTimeout(changeTimer);
    libraryReady = false;
    library = candidate; history = library.history; target = library.target; plannedMinutes = library.plannedMinutes;
    $('profile-name').value = library.profile.name; restoreBook(activeBook());
    timeAnnotations = null; timeMarks = null; timeInputSnapshot = null; $('time-text').value = ''; lastMeasuredCustomText = null;
    $('time-count').textContent = '計測する本文：0文字';
    setTarget(target); targetManual = !!target;
    $('planned-minutes').value = plannedMinutes; $('estimate-minutes').value = plannedMinutes;
    userFilename = filename; savedUserSnapshot = saved ? snapshotKey(library) : null;
    libraryReady = true; document.querySelector('main').inert = false;
    syncLibrary(); renderResults(); show('home');
  }
  let restoringUser = false;
  const chooseUserFile = () => { if (!savingUser && !restoringUser) $('user-file').click(); };
  $('import-user').onclick = chooseUserFile;
  $('start-load').onclick = chooseUserFile;
  $('user-file').onchange = async () => {
    const file = $('user-file').files[0]; $('user-file').value = '';
    if (!file || restoringUser || savingUser) return;
    restoringUser = true; setFileControlsBusy(true); $('startup-error').textContent = '';
    try {
      if (file.size > window.UserLibrary.MAX_BYTES) throw new Error('ユーザーデータは30MiBまでです。');
      const candidate = window.UserLibrary.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
      if (libraryReady) {
        if (!readyForDirectAction()) return;
        syncLibrary();
        if (!await ask(`表示名：${candidate.profile.name || '未設定'}\n原稿：${candidate.manuscripts.length}件／計測履歴：${candidate.history.length}件\n\n現在のユーザーデータ全体を置き換えます。${userDirty ? '未保存の変更は失われます。必要ならキャンセルして先に保存してください。' : '自動統合はしません。'}`, '読み込む', 'ユーザーデータを読み込みますか？')) return;
      }
      useUserData(candidate, file.name, true);
      notify('ユーザーデータJSONを読み込みました。');
    } catch (error) {
      const message = `読み込めません。現在のデータは変更していません。${error.message}`;
      if (!libraryReady) $('startup-error').textContent = message; else notify(message);
    } finally { restoringUser = false; setFileControlsBusy(false); }
  };
  $('start-new').onclick = () => useUserData(window.UserLibrary.empty());
  $('start-legacy').onclick = () => {
    try {
      // Read again on explicit selection. Migration never removes or overwrites the source.
      const raw = localStorage.getItem(window.UserLibrary.KEY);
      if (raw === null) throw new Error('ブラウザ保存データが見つかりません。');
      useUserData(window.UserLibrary.parse(raw));
      notify('ブラウザ保存データを引き継ぎました。「ユーザーデータを保存」でJSONに保存してください。');
    } catch (error) { $('startup-error').textContent = `引き継げません。元データは保持しています。${error.message}`; }
  };
  $('export-legacy').onclick = () => {
    try {
      const raw = localStorage.getItem(window.UserLibrary.KEY);
      if (raw === null) throw new Error('データが見つかりません。');
      downloadJSON(raw, 'yomijitaku-browser-data.json');
      $('startup-error').textContent = '旧データのダウンロードを開始しました。端末への保存をご確認ください。元データはブラウザに残しています。';
    } catch (error) { $('startup-error').textContent = `取り出せません：${error.message}`; }
  };
  library = window.UserLibrary.empty();
  try { hasLegacyUserData = localStorage.getItem(window.UserLibrary.KEY) !== null; }
  catch { $('startup-storage-note').textContent = 'ブラウザ保存データを確認できませんでした。JSONの読み込み・新規作成は利用できます。'; }
  $('legacy-user-data').hidden = !hasLegacyUserData;
  $('startup-dialog').addEventListener('cancel', event => event.preventDefault());
  $('startup-dialog').showModal();
})();
