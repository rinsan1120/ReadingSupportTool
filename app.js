(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE = 'reading-support-results-v1';
  let view = 'home', mode = 'read', sourceType = 'sample', sample = null;
  let history = [], target = '', targetManual = false;
  let phase = 'idle', began = 0, countdownTimer = 0, elapsedTimer = 0, noticeTimer = 0;
  let measuredCount = 0, measuredType = 'sample', wakeLock = null, wakePending = false, wakeGeneration = 0;
  function ask(message, action = '削除する') {
    return new Promise(resolve => {
      const dialog = $('confirm-dialog');
      $('confirm-message').textContent = message; $('confirm-ok').textContent = action;
      dialog.returnValue = '';
      $('confirm-cancel').onclick = () => dialog.close('cancel');
      $('confirm-ok').onclick = () => dialog.close('ok');
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
      dialog.showModal(); $('confirm-cancel').focus();
    });
  }
  function countText(text) {
    const derived = text.replace(/［＃[^\r\n]*?］/g, '')
      .replace(/｜([^｜《》\r\n]+)《[^《》\r\n]+》/g, '$1')
      .replace(/([\p{Script=Han}々〆ヵヶ]+)《[^《》\r\n]+》/gu, '$1');
    return Array.from(derived.replace(/\s/gu, '')).length;
  }
  window.countReadingCharacters = countText;
  function validTarget(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 && n <= 1e9; }
  function notify(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 6500); }
  function persist() {
    try { sessionStorage.setItem(STORAGE, JSON.stringify({ version: 1, history, target: validTarget(target) ? Number(target) : null })); }
    catch { notify('このブラウザでは結果を保存できません。この画面を開いている間は利用できます。'); }
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE));
    if (stored?.version === 1 && Array.isArray(stored.history)) {
      history = stored.history.filter(r => Number.isSafeInteger(r.characters) && r.characters > 0 && Number.isFinite(r.seconds) && r.seconds > 0 && ['sample', 'custom'].includes(r.type))
        .map(r => ({ characters: r.characters, seconds: r.seconds, type: r.type }));
      if (validTarget(stored.target)) { target = String(stored.target); targetManual = true; }
    }
  } catch { /* Storage is optional; text is never stored. */ }
  function setTarget(value, manual = false) {
    target = value; if (manual) targetManual = true;
    $('target-count').value = value; $('result-target').value = value;
  }
  setTarget(target);
  function show(next) {
    if (view === 'reading' && next !== 'reading') { cancelMeasurement(); releaseWake(); }
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== next);
    view = next; $('footer').hidden = next === 'reading';
    if (next === 'results') renderResults();
    $('existing-results').hidden = !history.length;
    window.scrollTo(0, 0);
    $(next).querySelector('h1')?.focus({ preventScroll: true });
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));
  function selectSample() {
    const level = Number($('sample-level').value), mood = $('sample-mood').value;
    const choices = window.READING_SAMPLES.filter(s => s.level === level && (mood === 'おまかせ' || s.mood === mood));
    sample = choices[Math.floor(Math.random() * choices.length)];
    $('sample-info').textContent = `${sample.title} / ${sample.mood}・計測本文 ${countText(sample.text)}文字（初版の暫定例文）`;
  }
  selectSample();
  ['sample-level', 'sample-mood'].forEach(id => $(id).addEventListener('change', selectSample));
  document.querySelectorAll('[name=source]').forEach(r => r.addEventListener('change', () => {
    sourceType = r.value;
    $('custom-input').hidden = sourceType !== 'custom'; $('apply-count').hidden = sourceType !== 'custom';
    $('sample-options').hidden = sourceType !== 'sample'; $('sample-info').hidden = sourceType !== 'sample';
    if (sourceType === 'custom' && !targetManual) setTarget(countText($('time-text').value) || '');
  }));
  $('read-text').addEventListener('input', () => $('read-count').textContent = `${countText($('read-text').value)}文字`);
  $('time-text').addEventListener('input', () => {
    const count = countText($('time-text').value);
    $('time-count').textContent = `計測する本文：${count}文字`;
    if (!targetManual) setTarget(count || '');
  });
  // HTML clipboard ruby is parsed in an inert document. Only plain text enters
  // the textarea; neither pasted markup nor ruby annotations enter the page.
  ['read-text', 'time-text'].forEach(id => $(id).addEventListener('paste', async event => {
    const html = event.clipboardData?.getData('text/html');
    const el = $(id), begin = el.selectionStart, end = el.selectionEnd;
    const ruby = html && /<ruby[\s>]/i.test(html);
    if (!ruby && begin === end) return;
    let plain = event.clipboardData?.getData('text/plain') || '';
    if (ruby) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('rt,rp,script,style').forEach(n => n.remove());
      doc.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
      doc.querySelectorAll('p,div,li').forEach(n => n.append('\n'));
      plain = (doc.body.textContent || '').replace(/\n$/, '');
    }
    event.preventDefault();
    if (el.value && end > begin && !await ask('選択中の本文を貼り付けた文章で置き換えますか？', '置き換える')) return;
    el.setRangeText(plain, begin, end, 'end'); el.dispatchEvent(new Event('input'));
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
      if (await ask('入力済みの本文全体を削除・置換しますか？', deleting ? '削除する' : '置き換える')) {
        el.setRangeText(next, 0, el.value.length, 'end'); el.dispatchEvent(new Event('input'));
      }
    }
  }));
  $('clear-read').onclick = async () => { if ($('read-text').value && await ask('入力した本文を削除しますか？')) { $('read-text').value = ''; $('read-text').dispatchEvent(new Event('input')); } };
  $('apply-count').onclick = () => { setTarget(countText($('time-text').value) || '', true); persist(); };
  $('target-count').addEventListener('input', () => { setTarget($('target-count').value, true); persist(); });
  $('result-target').addEventListener('input', () => { setTarget($('result-target').value, true); persist(); renderResults(); });
  function openReader(nextMode) {
    mode = nextMode;
    const text = mode === 'read' ? $('read-text').value : sourceType === 'sample' ? sample.text : $('time-text').value;
    if (!countText(text)) { notify('朗読する文章を入力してください。'); return; }
    if (mode === 'time' && !validTarget(target)) { notify('作品全体の文字数を1〜1,000,000,000の整数で入力してください。'); $('target-count').focus(); return; }
    show('reading');
    $('reading-title').textContent = mode === 'time' ? (sourceType === 'sample' ? sample.title : '朗読速度の計測') : '文章を読む';
    $('preparation').hidden = mode !== 'time'; $('measurement-bar').hidden = true;
    $('preparation-info').textContent = `計測する本文：${countText(text)}文字 ／ 作品全体：${Number(target).toLocaleString()}文字`;
    $('open-settings').disabled = false;
    measuredCount = countText(text); measuredType = sourceType;
    window.Reader.show(text);
  }
  $('open-read').onclick = () => openReader('read'); $('prepare-time').onclick = () => openReader('time');
  $('reader-back').onclick = () => show(mode === 'time' ? 'time-input' : 'read-input');
  $('edit-from-menu').onclick = () => $('reader-back').click();
  $('home-from-menu').onclick = () => show('home');
  $('operations').onclick = () => { closeSettings(); $('open-settings').disabled = phase !== 'idle'; $('operation-dialog').showModal(); };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.dataset.close === 'settings-dialog' ? closeSettings() : $(b.dataset.close).close());
  const settingsMobile = matchMedia('(max-width: 600px)');
  const settingNames = ['columns', 'line-height', 'break-lines'];
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
    // The user can scroll while the mobile panel is open. Keep the CURRENT
    // source position instead of returning to the position at panel opening.
    const anchor = window.Reader.capture();
    panel.close(); reserveSettingsSpace();
    if (view === 'reading') window.Reader.restore(anchor);
  }
  function openSettings() {
    if (phase !== 'idle') return;
    const anchor = window.Reader.capture();
    $('operation-dialog').close();
    updateSettingsControls();
    if (!$('settings-dialog').open) {
      if (settingsMobile.matches) $('settings-dialog').show(); else $('settings-dialog').showModal();
    }
    reserveSettingsSpace(); window.Reader.restore(anchor);
  }
  $('before-settings').onclick = openSettings; $('open-settings').onclick = openSettings;
  $('settings-dialog').addEventListener('close', reserveSettingsSpace);
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
  ['reader-width', ...settingNames].forEach(id => $(id).addEventListener('input', () => {
    if (phase !== 'idle') return;
    const value = Number($(id).value);
    if (id === 'reader-width') window.Reader.configure({ width: value });
    if (id === 'columns') window.Reader.configure({ columns: value });
    if (id === 'line-height') {
      $('line-height-value').textContent = value.toFixed(1); window.Reader.configure({ height: value });
    }
    if (id === 'break-lines') {
      $('break-lines-value').textContent = value ? `${value}表示行ごと` : 'なし'; window.Reader.configure({ breaks: value });
    }
  }));
  function cancelMeasurement() {
    clearTimeout(countdownTimer); clearInterval(elapsedTimer);
    phase = 'idle'; $('countdown').hidden = true; $('measurement-bar').hidden = true;
    $('start').disabled = false;
  }
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  $('start').onclick = () => {
    if (phase !== 'idle' || document.hidden) return;
    $('operation-dialog').close(); $('settings-dialog').close();
    phase = 'countdown'; $('start').disabled = true; $('open-settings').disabled = true;
    // Remove preparation controls and scroll to the beginning BEFORE counting.
    $('preparation').hidden = true; $('measurement-bar').hidden = false; $('finish').disabled = true;
    $('elapsed').textContent = '準備中'; window.scrollTo(0, 0);
    window.Reader.refresh();
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
    if (Number.isFinite(seconds) && seconds > 0) { history.push({ characters: measuredCount, seconds, type: measuredType }); persist(); }
    show('results');
  };
  function renderResults() {
    const characters = history.reduce((sum, r) => sum + r.characters, 0);
    const seconds = history.reduce((sum, r) => sum + r.seconds, 0);
    const speed = seconds > 0 ? characters / seconds * 60 : 0;
    const minutes = Number(target) / speed;
    $('estimate').textContent = speed && validTarget(target) ? `約${(minutes < 10 ? Math.max(.1, Math.round(minutes * 10) / 10) : Math.round(minutes)).toLocaleString()}分` : 'まだ推定できません';
    $('result-summary').textContent = history.length ? `${history.length}回の計測 ／ 合計${characters.toLocaleString()}文字・実測${seconds.toFixed(1)}秒 ／ 平均${Math.round(speed).toLocaleString()}文字/分` : '文章を一度読むと、朗読時間の目安が分かります。';
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
  function wakeUI(message = '') {
    $('wake').textContent = `画面点灯維持：${wakeLock && !wakeLock.released ? 'ON' : 'OFF'}`;
    $('wake-status').textContent = message;
    $('wake').disabled = wakePending || !('wakeLock' in navigator);
  }
  async function releaseWake() {
    wakeGeneration++; const current = wakeLock; wakeLock = null; wakeUI();
    if (current) { try { await current.release(); } catch { /* Already released. */ } }
  }
  $('wake').onclick = async () => {
    if (wakeLock) { await releaseWake(); return; }
    if (view !== 'reading' || document.hidden || wakePending) return;
    const generation = ++wakeGeneration; wakePending = true; wakeUI('取得中…');
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (generation !== wakeGeneration || view !== 'reading' || document.hidden) { await acquired.release(); return; }
      wakeLock = acquired;
      acquired.addEventListener('release', () => { if (wakeLock === acquired) { wakeLock = null; wakeUI('点灯維持を解除しました。必要なときは再度ONにしてください。'); } });
    } catch { wakeUI('点灯維持を取得できませんでした。通常どおり朗読できます。'); }
    finally { wakePending = false; wakeUI($('wake-status').textContent === '取得中…' ? '' : $('wake-status').textContent); }
  };
  wakeUI('wakeLock' in navigator ? '初期状態はOFFです。必要なときだけONにしてください。' : 'このブラウザは画面点灯維持に対応していません。');
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
})();
