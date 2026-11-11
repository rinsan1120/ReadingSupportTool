'use strict';

// 「朗読作品を探す」画面。
// 青空文庫の作品データ (aozora-works.js) は画面を初めて開いたときにだけ読み込む。
// このサイトが提示するのは作品名・作者・想定時間と図書カードへのリンクだけで、
// 本文そのものは保持も表示もしない。本文の入手と取り込みは利用者自身が行う。
window.WorkSearch = (() => {
  const DATA_SRC = 'aozora-works.js?v=20260401-2';
  const KANA_LABELS = ['新字新仮名', '新字旧仮名', '旧字新仮名', '旧字旧仮名', 'その他'];
  // 持ち時間に収まる側へ寄せる: 想定時間が持ち時間の80%から100%の作品を出す。
  const BAND_LOW = 0.8;
  const MAX_RENDER = 200;

  let loadState = 'idle'; // idle | loading | loaded | failed
  let speed = 0;
  let hasHistory = false;
  let minutes = 15;
  let query = '';
  let modernOnly = true;
  let domesticOnly = false;
  let sort = 'author';

  const $ = id => document.getElementById(id);

  function cardUrl(work) {
    const author = window.AOZORA_WORKS.authors[work[2]];
    return `https://www.aozora.gr.jp/cards/${author[0]}/card${Number(work[0])}.html`;
  }

  function minutesText(chars) {
    const value = chars / speed;
    const rounded = value < 10 ? Math.max(0.1, Math.round(value * 10) / 10) : Math.round(value);
    return `約${rounded.toLocaleString()}分`;
  }

  function loadData() {
    loadState = 'loading';
    renderStatus('作品データを読み込んでいます…');
    const script = document.createElement('script');
    script.src = DATA_SRC;
    script.onload = () => { loadState = 'loaded'; renderStatus(''); renderList(); };
    script.onerror = () => { loadState = 'failed'; renderStatus('作品データを読み込めませんでした。通信状態を確認して、もう一度開いてみてください。'); };
    document.head.appendChild(script);
  }

  function renderStatus(message) {
    const status = $('ws-status');
    status.textContent = message;
    status.hidden = !message;
  }

  function filteredWorks() {
    const data = window.AOZORA_WORKS;
    const target = speed * minutes;
    const low = target * BAND_LOW;
    const keyword = query.trim();
    const list = [];
    for (const work of data.works) {
      const chars = work[4];
      if (chars < low || chars > target) continue;
      if (modernOnly && work[3] !== 0) continue;
      if (domesticOnly && work[5] === 1) continue;
      if (keyword) {
        const author = data.authors[work[2]];
        if (!work[1].includes(keyword) && !author[1].includes(keyword) && !author[2].includes(keyword)) continue;
      }
      list.push(work);
    }
    if (sort === 'fit') list.sort((a, b) => Math.abs(a[4] - target) - Math.abs(b[4] - target));
    else if (sort === 'short') list.sort((a, b) => a[4] - b[4]);
    else if (sort === 'long') list.sort((a, b) => b[4] - a[4]);
    else if (sort === 'random') {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    // 'author' のときはデータ側の並び (作者順→作品名順) をそのまま使う。
    return list;
  }

  function renderList() {
    if (loadState !== 'loaded') return;
    const list = $('ws-list');
    const count = $('ws-count');
    if (!Number.isFinite(minutes) || minutes <= 0) {
      list.replaceChildren();
      count.textContent = '持ち時間を入力してください。';
      return;
    }
    const data = window.AOZORA_WORKS;
    const works = filteredWorks();
    count.textContent = works.length > MAX_RENDER
      ? `${works.length.toLocaleString()}件の作品が見つかりました（${MAX_RENDER}件まで表示しています。条件で絞り込んでください）`
      : `${works.length.toLocaleString()}件の作品が見つかりました`;
    const nodes = [];
    let lastAuthor = -1;
    for (const work of works.slice(0, MAX_RENDER)) {
      if (sort === 'author' && work[2] !== lastAuthor) {
        lastAuthor = work[2];
        const head = document.createElement('li');
        head.className = 'ws-author';
        head.textContent = data.authors[work[2]][1];
        nodes.push(head);
      }
      const author = data.authors[work[2]];
      const item = document.createElement('li');
      item.className = 'ws-item';
      const link = document.createElement('a');
      link.className = 'ws-title';
      link.href = cardUrl(work);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = work[1];
      const meta = document.createElement('p');
      meta.className = 'ws-meta';
      meta.textContent = `${author[1]} ・ ${minutesText(work[4])} ・ ${work[4].toLocaleString()}文字 ・ ${KANA_LABELS[work[3]] || KANA_LABELS[4]}`;
      item.append(link, meta);
      nodes.push(item);
    }
    if (!works.length) {
      const empty = document.createElement('li');
      empty.className = 'ws-item muted';
      empty.textContent = '条件に合う作品がありませんでした。持ち時間や絞り込みを変えてみてください。';
      nodes.push(empty);
    }
    list.replaceChildren(...nodes);
  }

  function syncChips() {
    document.querySelectorAll('[data-ws-minutes]').forEach(chip => {
      chip.setAttribute('aria-pressed', String(Number(chip.dataset.wsMinutes) === minutes));
    });
  }

  function open(context) {
    speed = context.speed;
    hasHistory = context.hasHistory;
    $('ws-average-speed').textContent = hasHistory ? `約${Math.round(speed).toLocaleString()}文字 / 分` : '未計測';
    $('ws-empty').hidden = hasHistory;
    $('ws-controls').hidden = !hasHistory;
    $('ws-results').hidden = !hasHistory;
    if (!hasHistory) return;
    if (loadState === 'idle' || loadState === 'failed') loadData();
    else if (loadState === 'loaded') renderList();
  }

  document.querySelectorAll('[data-ws-minutes]').forEach(chip => {
    chip.addEventListener('click', () => {
      minutes = Number(chip.dataset.wsMinutes);
      $('ws-minutes').value = minutes;
      syncChips();
      renderList();
    });
  });
  $('ws-minutes').addEventListener('input', event => {
    minutes = Number(event.target.value);
    syncChips();
    renderList();
  });
  $('ws-query').addEventListener('input', event => { query = event.target.value; renderList(); });
  $('ws-modern-only').addEventListener('change', event => { modernOnly = event.target.checked; renderList(); });
  $('ws-domestic-only').addEventListener('change', event => { domesticOnly = event.target.checked; renderList(); });
  $('ws-sort').addEventListener('change', event => { sort = event.target.value; renderList(); });
  syncChips();

  return { open };
})();
