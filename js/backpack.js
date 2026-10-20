/*
 * 抽籤頁：卡片背包
 * 打開背包 → 選座號 → 看卡片 → 點卡片放大 → 「使用這張卡」（需要導師碼）。
 * 再抽一次：使用後自動送 1 張抽籤券。
 * 幸運女神：使用前先從其他卡片挑一張，挑到的卡放進同一位同學的背包。
 * 「復原」只在設定頁提供（導師專用）。
 */
(function () {
  'use strict';
  var h = App.h;
  var $ = function (id) { return document.getElementById(id); };

  var CARD_REDRAW = '再抽一次';
  var CARD_LUCKY = '幸運女神';

  var hooks = null;   // 由 lottery.js 提供：getSeats、getSelected、getBagCounts、isIdle、onUsed、onChanged、sfx
  var st = { seat: null, cards: [], choices: [], counts: {}, busy: false, loadSeq: 0 };

  function init(opts) {
    hooks = opts;
    $('btnBag').addEventListener('click', function () { open(hooks.getSelected()); });
    $('btnBagClose').addEventListener('click', close);
    $('bagOverlay').addEventListener('click', function (e) { if (e.target === this) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('bagOverlay').hidden && !document.querySelector('.gate')) close();
    });
  }

  function isOpen() { return !$('bagOverlay').hidden; }

  function open(seat) {
    if (!hooks.isIdle()) return;
    var seats = hooks.getSeats();
    if (!seats.length) { App.toast('尚未匯入名單。', 'error'); return; }
    st.seat = seats.indexOf(seat) !== -1 ? seat : null;
    st.counts = Object.assign({}, hooks.getBagCounts());
    $('bagOverlay').hidden = false;
    renderSeats();
    if (st.seat === null) {
      showMessage('請先點上方的座號，查看那位同學的卡片。');
    } else {
      load();
    }
    setTimeout(function () { $('btnBagClose').focus(); }, 50);
  }

  function close() {
    if (st.busy) return;
    $('bagOverlay').hidden = true;
    App.clear($('bagBody'));
    hooks.onChanged();
  }

  /* ============ 資料 ============ */
  async function load() {
    var seq = ++st.loadSeq;
    showMessage('讀取中…');
    try {
      var d = await App.api('getBackpack', { seat: st.seat });
      if (seq !== st.loadSeq) return; // 已切換到別的座號
      st.cards = d.cards;
      st.choices = d.choices;
      st.counts = d.counts || {};
      renderSeats();
      renderList();
    } catch (e) {
      if (seq !== st.loadSeq) return;
      showMessage('讀取失敗：' + App.errorText(e));
    }
  }

  /* ============ 畫面 ============ */
  function renderSeats() {
    var box = $('bagSeats');
    App.clear(box);
    hooks.getSeats().forEach(function (s) {
      var n = st.counts[s] || 0;
      box.appendChild(h('button', {
        type: 'button',
        class: 'bag-seat' + (s === st.seat ? ' selected' : ''),
        'aria-pressed': s === st.seat ? 'true' : 'false',
        'aria-label': s + ' 號，' + n + ' 張未使用的卡片',
        disabled: st.busy,
        onclick: function () { st.seat = s; renderSeats(); load(); }
      }, String(s), n ? h('i', { text: String(n) }) : null));
    });
  }

  function showMessage(text) {
    var body = $('bagBody');
    App.clear(body);
    body.appendChild(h('p', { class: 'bag-empty', text: text }));
  }

  /** 票券造型的卡片；opts.big 放大顯示、opts.onclick 可點擊 */
  function ticket(card, opts) {
    opts = opts || {};
    var used = card.status === '已使用';
    var meta = opts.meta !== undefined ? opts.meta
      : used ? '已使用　' + App.fmtMD(card.usedAt)
      : card.gotAt ? App.fmtMD(card.gotAt) + ' 取得' + (card.source === CARD_LUCKY ? '（幸運女神）' : '') : '';
    var el = h(opts.onclick ? 'button' : 'div', {
      type: opts.onclick ? 'button' : null,
      class: 'mini-ticket' + (opts.big ? ' big' : '') + (used ? ' used' : '') + (opts.cls ? ' ' + opts.cls : ''),
      onclick: opts.onclick || null,
      'aria-label': card.name + (used ? '，已使用' : '')
    },
      h('span', { class: 'mt-barcode', 'aria-hidden': 'true' }),
      h('span', { class: 'mt-body' },
        h('span', { class: 'mt-meta', text: meta }),
        h('span', { class: 'mt-name', text: card.name }),
        h('span', { class: 'mt-desc', text: card.description || '' })),
      used ? h('span', { class: 'stamp', 'aria-hidden': 'true', text: '已使用' }) : null);
    return el;
  }

  function renderList() {
    var body = $('bagBody');
    App.clear(body);
    var unused = st.cards.filter(function (c) { return c.status === '未使用'; });
    var used = st.cards.filter(function (c) { return c.status === '已使用'; });
    body.appendChild(h('p', { class: 'bag-summary' },
      h('strong', { text: st.seat + ' 號' }), '　未使用 ', h('b', { text: String(unused.length) }), ' 張　・　已使用 ' + used.length + ' 張'));
    if (!st.cards.length) {
      body.appendChild(h('p', { class: 'bag-empty', text: '背包還是空的，抽到卡片後會自動放進來。' }));
      return;
    }
    var grid = h('div', { class: 'bag-grid' });
    unused.concat(used).forEach(function (c) {
      grid.appendChild(ticket(c, { onclick: function () { renderDetail(c); } }));
    });
    body.appendChild(grid);
  }

  function renderDetail(card) {
    var body = $('bagBody');
    App.clear(body);
    var used = card.status === '已使用';
    var hint = used ? '這張卡在 ' + App.fmtMD(card.usedAt) + ' ' + App.fmtHM(card.usedAt) + ' 使用過了。'
      : card.name === CARD_REDRAW ? '使用後會自動送 ' + card.seat + ' 號 1 張抽籤券。'
      : card.name === CARD_LUCKY ? '使用時可以從其他卡片中挑一張，放進 ' + card.seat + ' 號的背包。'
      : '使用後請老師現場執行卡片內容。';
    body.appendChild(h('div', { class: 'bag-detail' },
      ticket(card, { big: true }),
      h('p', { class: 'bag-hint', text: hint }),
      h('div', { class: 'bag-actions' },
        h('button', { type: 'button', class: 'btn', text: '← 回到背包', onclick: renderList }),
        used ? null : h('button', {
          type: 'button', class: 'btn btn-use', text: card.name === CARD_LUCKY ? '使用：挑一張卡' : '使用這張卡',
          onclick: function () { card.name === CARD_LUCKY ? renderLucky(card) : useCard(card, null, this); }
        }))));
  }

  /** 幸運女神：列出可以挑的卡片 */
  function renderLucky(card) {
    var body = $('bagBody');
    App.clear(body);
    var picked = null;
    var confirmBtn = h('button', { type: 'button', class: 'btn btn-use', text: '確定選這張', disabled: true,
      onclick: function () { if (picked) useCard(card, picked.name, this); } });
    var grid = h('div', { class: 'bag-grid lucky' });
    st.choices.forEach(function (c) {
      var el = ticket({ name: c.name, description: c.description, status: '未使用' }, {
        meta: '',
        onclick: function () {
          picked = c;
          Array.prototype.forEach.call(grid.children, function (x) { x.classList.remove('picked'); x.setAttribute('aria-pressed', 'false'); });
          el.classList.add('picked');
          el.setAttribute('aria-pressed', 'true');
          confirmBtn.disabled = false;
          confirmBtn.textContent = '確定選「' + c.name + '」';
        }
      });
      el.setAttribute('aria-pressed', 'false');
      grid.appendChild(el);
    });
    body.appendChild(h('p', { class: 'bag-summary' }, '🍀 幸運女神：請 ', h('strong', { text: card.seat + ' 號' }), ' 挑一張卡'));
    body.appendChild(grid);
    body.appendChild(h('div', { class: 'bag-actions sticky' },
      h('button', { type: 'button', class: 'btn', text: '← 返回', onclick: function () { renderDetail(card); } }),
      confirmBtn));
  }

  /* ============ 使用 ============ */
  async function useCard(card, choice, btn) {
    if (st.busy) return;
    st.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '處理中…'; }
    try {
      var d = await App.teacherApi('useCard', { cardId: card.id, choice: choice || undefined });
      st.busy = false;
      // 先在本機更新卡片數：用掉 1 張；幸運女神會多 1 張挑到的卡
      st.counts[card.seat] = Math.max(0, (st.counts[card.seat] || 0) - 1 + (d.chosen ? 1 : 0));
      renderSeats();
      renderDone(d);
      hooks.onUsed(d);
    } catch (e) {
      st.busy = false;
      if (e.code === 'CANCELLED') {
        if (btn) { btn.disabled = false; btn.textContent = choice ? '確定選「' + choice + '」' : '使用這張卡'; }
        return;
      }
      App.toast(App.errorText(e), 'error');
      if (e.code === 'ALREADY_USED' || e.code === 'NOT_FOUND') { load(); return; }
      if (btn) { btn.disabled = false; btn.textContent = choice ? '確定選「' + choice + '」' : '使用這張卡'; }
    }
  }

  /** 使用成功：蓋上「已使用」印章，並顯示自動效果的結果 */
  function renderDone(d) {
    var body = $('bagBody');
    App.clear(body);
    var card = d.card;
    var t = ticket(card, { big: true, cls: 'stamping' });
    var info = [];
    if (d.granted) info.push(h('p', { class: 'bag-result' }, '🎟️ 已送 ', h('strong', { text: card.seat + ' 號' }), ' 1 張抽籤券，目前 ', h('strong', { text: String(d.balance) }), ' 張'));
    if (d.chosen) {
      info.push(h('p', { class: 'bag-result' }, '🍀 已把「', h('strong', { text: d.chosen.name }), '」放進 ' + card.seat + ' 號的背包'));
      info.push(ticket(d.chosen, { cls: 'pop-in' }));
    }
    if (!info.length) info.push(h('p', { class: 'bag-result', text: '請老師現場執行卡片內容。' }));
    body.appendChild(h('div', { class: 'bag-detail' }, t, info,
      h('div', { class: 'bag-actions' }, h('button', { type: 'button', class: 'btn btn-use', text: '回到背包', onclick: function () { load(); } }))));
    if (hooks.sfx) hooks.sfx(d.granted || d.chosen ? 'fanfare' : 'ding');
  }

  window.Backpack = { init: init, open: open, isOpen: isOpen };
})();
