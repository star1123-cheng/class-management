/* 設定頁：存取碼、名單匯入、在籍狀態、發券、籤池、抽籤紀錄 */
(function () {
  'use strict';
  var h = App.h;
  var $ = function (id) { return document.getElementById(id); };

  var state = { roster: [], lottery: null, preview: null, amount: 1, busy: false };

  /* ============ 存取碼 ============ */
  function setStatus(el, msg, ok) {
    el.textContent = msg;
    el.className = 'status-line' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
  }

  var ROLE_NAME = { teacher: '導師碼', display: '教室碼' };

  /** 顯示目前登入狀態：哪一組存取碼、是否只暫時登入 */
  async function refreshCodeHint() {
    if (!App.getCode()) { setStatus($('codeStatus'), '這台裝置尚未儲存存取碼。'); return; }
    var where = App.isTempLogin() ? '（只在這個分頁暫時登入）' : '（已記住在這台裝置）';
    try {
      var d = await App.api('ping');
      setStatus($('codeStatus'), '目前登入：' + (ROLE_NAME[d.role] || '存取碼') + where + '。', true);
    } catch (e) {
      setStatus($('codeStatus'), '目前的存取碼無法使用：' + App.errorText(e), false);
    }
  }

  $('btnSaveCode').addEventListener('click', async function () {
    var code = $('codeInput').value.trim();
    var remember = $('codeRemember').checked;
    if (!code) { setStatus($('codeStatus'), '請先輸入存取碼。', false); return; }
    setStatus($('codeStatus'), '測試連線中…');
    try {
      var d = await App.api('ping', {}, { code: code });
      App.setCode(code, remember);
      $('codeInput').value = '';
      var where = remember ? '已記住在這台裝置' : '只在這個分頁暫時登入，關閉分頁後就會登出';
      if (d.role === 'display') {
        setStatus($('codeStatus'), '連線成功：這是教室碼（' + where + '）。這台裝置可以使用投影頁與抽籤頁，記錄頁與設定頁需要導師碼。', true);
      } else {
        setStatus($('codeStatus'), '連線成功：導師碼（' + where + '）。', true);
      }
      loadAll();
    } catch (e) {
      setStatus($('codeStatus'), '連線失敗：' + App.errorText(e), false);
    }
  });

  $('btnTestCode').addEventListener('click', async function () {
    if (!App.getCode()) { setStatus($('codeStatus'), '這台裝置尚未儲存存取碼。', false); return; }
    setStatus($('codeStatus'), '測試連線中…');
    try {
      var d = await App.api('ping');
      setStatus($('codeStatus'), '連線成功：' + (ROLE_NAME[d.role] || '存取碼') + '（伺服器時間 ' + App.fmtMD(d.serverTime) + ' ' + App.fmtHM(d.serverTime) + '）。', true);
    } catch (e) {
      setStatus($('codeStatus'), '連線失敗：' + App.errorText(e), false);
    }
  });

  $('btnClearCode').addEventListener('click', function () {
    if (!confirm('確定要清除這台裝置的存取碼（包含暫時登入）嗎？之後需要重新輸入。')) return;
    App.clearCode();
    refreshCodeHint();
  });

  /* ============ 載入資料 ============ */
  async function loadAll() {
    if (!App.getCode()) return;
    try {
      var results = await Promise.all([App.api('getState'), App.api('getLottery', { limit: 20 })]);
      state.roster = results[0].roster;
      state.lottery = results[1];
      renderRoster();
      renderTickets();
      renderPool();
      renderDraws();
    } catch (e) {
      if (e.code === 'UNAUTHORIZED' || e.code === 'FORBIDDEN') {
        // 設定頁上方就是登入欄，不另外跳出視窗
        if (e.code === 'FORBIDDEN') setStatus($('codeStatus'), '目前登入的是教室碼，設定頁的資料需要導師碼。請在上方輸入導師碼（班級電腦請取消「記住在這台裝置」）。', false);
        else setStatus($('codeStatus'), App.errorText(e), false);
        return;
      }
      App.toast('載入失敗：' + App.errorText(e), 'error');
    }
  }

  /* ============ 名單 ============ */
  function renderRoster() {
    var active = state.roster.filter(function (r) { return r.active; });
    $('activeCount').textContent = active.length;
    var grid = $('rosterGrid');
    App.clear(grid);
    if (state.roster.length === 0) {
      grid.appendChild(h('p', { class: 'muted', style: 'grid-column:1/-1', text: '尚未匯入名單。' }));
      return;
    }
    state.roster.forEach(function (r) {
      grid.appendChild(h('button', {
        type: 'button',
        class: 'mini' + (r.active ? '' : ' off'),
        'aria-pressed': r.active ? 'true' : 'false',
        title: r.active ? '在籍，點一下設為不在籍' : '不在籍，點一下設為在籍',
        onclick: function () { toggleActive(r); }
      }, String(r.seat), h('small', { text: r.active ? '在籍' : '不在籍' })));
    });
  }

  async function toggleActive(r) {
    var next = !r.active;
    var msg = next ? '要把 ' + r.seat + ' 號設為「在籍」嗎？' : '要把 ' + r.seat + ' 號設為「不在籍」嗎？（資料不會刪除）';
    if (!confirm(msg)) return;
    try {
      await App.api('setRosterActive', { seat: r.seat, active: next });
      App.toast(r.seat + ' 號已設為' + (next ? '在籍' : '不在籍'));
      loadAll();
    } catch (e) {
      App.toast(App.errorText(e), 'error');
    }
  }

  /* ---------- CSV 解析 ---------- */
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    var rows = [], row = [], field = '', inQuote = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuote = false;
        } else field += c;
        continue;
      }
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* 略過 */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function toHalfWidth(s) {
    return s.replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); });
  }

  var SEAT_KEYS = ['座號', 'seat', 'no'];
  var CLASS_KEYS = ['班級代號', 'class'];

  /**
   * 解析並檢查 CSV。只取出座號與班級代號兩欄，其他欄位（例如姓名）讀到就丟棄。
   * 回傳 { rows: [{line, classCode, seat, errors}], error }
   */
  function analyze(text) {
    var all = parseCSV(text);
    var isBlank = function (r) { return r.every(function (c) { return c.trim() === ''; }); };
    // 去掉結尾空白列（Excel 常見）
    while (all.length && isBlank(all[all.length - 1])) all.pop();
    var headIndex = -1;
    for (var i = 0; i < all.length; i++) { if (!isBlank(all[i])) { headIndex = i; break; } }
    if (headIndex === -1) return { error: '檔案是空的。' };

    var header = all[headIndex].map(function (c) { return c.trim().toLowerCase(); });
    var seatCol = header.findIndex(function (c) { return SEAT_KEYS.indexOf(c) !== -1; });
    var classCol = header.findIndex(function (c) { return CLASS_KEYS.indexOf(c) !== -1; });
    if (seatCol === -1) return { error: '找不到「座號」欄位（可用標題：座號、seat、no）。' };

    var out = [];
    var firstLine = {};
    for (var j = headIndex + 1; j < all.length; j++) {
      var raw = all[j];
      var line = j + 1;
      var seatText = toHalfWidth((raw[seatCol] || '').trim());
      var classText = classCol === -1 ? '' : toHalfWidth((raw[classCol] || '').trim());
      var blank = isBlank(raw);
      raw = null; // 其他欄位到此丟棄，不保存、不顯示
      var item = { line: line, classCode: classText, seat: null, seatText: seatText, errors: [] };
      if (blank) item.errors.push('空白列');
      else if (seatText === '') item.errors.push('座號空白');
      else if (!/^\d+$/.test(seatText)) item.errors.push('座號不是整數');
      else {
        var n = parseInt(seatText, 10);
        if (n < 1 || n > 99) item.errors.push('座號超出 1 至 99');
        else {
          item.seat = n;
          if (firstLine[n]) {
            item.errors.push('座號重複（與第 ' + firstLine[n].line + ' 列）');
            if (firstLine[n].errors.indexOf('座號重複') === -1) firstLine[n].errors.push('座號重複');
          } else firstLine[n] = item;
        }
      }
      if (!/^[0-9A-Za-z-]{0,10}$/.test(classText)) {
        item.errors.push('班級代號格式錯誤（只能是 10 個以內的英數字）');
        item.classInvalid = true;
      }
      out.push(item);
    }
    if (out.length === 0) return { error: '檔案只有標題列，沒有資料。' };
    return { rows: out };
  }

  $('csvFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    if (file.size > 200 * 1024) { App.toast('檔案太大，請確認是名單 CSV。', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function () { showPreview(analyze(String(reader.result || ''))); };
    reader.onerror = function () { App.toast('讀取檔案失敗。', 'error'); };
    reader.readAsText(file, 'utf-8');
  });

  function showPreview(result) {
    state.preview = result;
    var body = $('previewBody');
    App.clear(body);
    $('previewBox').hidden = false;
    var summary = $('previewSummary');
    if (result.error) {
      summary.textContent = result.error;
      summary.className = 'preview-summary bad';
      $('btnImport').disabled = true;
      return;
    }
    var bad = result.rows.filter(function (r) { return r.errors.length; });
    result.rows.forEach(function (r) {
      body.appendChild(h('tr', { class: r.errors.length ? 'row-error' : '' },
        h('td', { text: '第 ' + r.line + ' 列' }),
        h('td', { text: r.classInvalid ? '（格式錯誤，不顯示）' : (r.classCode || '—') }),
        h('td', { text: r.seat !== null ? String(r.seat) : (r.errors.indexOf('空白列') !== -1 ? '' : '（無效）') }),
        h('td', { class: r.errors.length ? 'err' : '', text: r.errors.length ? r.errors.join('、') : '可匯入' })));
    });
    if (bad.length) {
      summary.textContent = '共 ' + result.rows.length + ' 列，其中 ' + bad.length + ' 列有錯誤（紅色），請修正 CSV 後重新選擇檔案。';
      summary.className = 'preview-summary bad';
    } else {
      summary.textContent = '共 ' + result.rows.length + ' 列，檢查通過，可以匯入。';
      summary.className = 'preview-summary';
    }
    $('btnImport').disabled = bad.length > 0;
  }

  $('btnCancelImport').addEventListener('click', function () {
    state.preview = null;
    $('previewBox').hidden = true;
    $('csvFile').value = '';
  });

  $('btnImport').addEventListener('click', async function () {
    var p = state.preview;
    if (!p || p.error || p.rows.some(function (r) { return r.errors.length; })) return;
    var mode = document.querySelector('input[name="importMode"]:checked').value;
    var msg = mode === 'replace'
      ? '確定要用這份名單「取代整份名單」嗎？\n名單外的座號會設為「不在籍」（不會刪除資料）。'
      : '確定要「只新增缺少的座號」嗎？\n已存在的座號不會變動。';
    if (!confirm(msg)) return;
    // 只送出班級代號與座號
    var rows = p.rows.map(function (r) { return { classCode: r.classCode, seat: r.seat }; });
    this.disabled = true;
    try {
      var d = await App.api('importRoster', { mode: mode, rows: rows });
      App.toast('匯入完成：新增 ' + d.added + ' 人' + (mode === 'replace' ? '，設為不在籍 ' + d.deactivated + ' 人' : ''));
      $('btnCancelImport').click();
      loadAll();
    } catch (e) {
      App.toast('匯入失敗：' + App.errorText(e), 'error');
      this.disabled = false;
    }
  });

  /* ============ 發券 ============ */
  function renderTickets() {
    var lot = state.lottery;
    var sel = $('ticketSeat');
    var prev = sel.value;
    App.clear(sel);
    lot.seats.forEach(function (s) {
      sel.appendChild(h('option', { value: String(s), text: s + ' 號（' + (lot.balances[s] || 0) + ' 張）' }));
    });
    if (prev && lot.seats.indexOf(Number(prev)) !== -1) sel.value = prev;

    var grid = $('balanceGrid');
    App.clear(grid);
    if (lot.seats.length === 0) {
      grid.appendChild(h('p', { class: 'muted', style: 'grid-column:1/-1', text: '尚未匯入名單。' }));
    }
    lot.seats.forEach(function (s) {
      var n = lot.balances[s] || 0;
      grid.appendChild(h('div', { class: 'mini static' + (n > 0 ? ' has' : '') }, s + ' 號', h('small', { text: n + ' 張' })));
    });
  }

  function renderAmount() {
    $('ticketAmount').textContent = String(state.amount);
  }
  $('btnMinus').addEventListener('click', function () {
    var min = $('ticketReason').value === '發放' ? 1 : -20;
    state.amount = Math.max(min, state.amount - 1);
    if (state.amount === 0) state.amount = -1;
    renderAmount();
  });
  $('btnPlus').addEventListener('click', function () {
    state.amount = Math.min(20, state.amount + 1);
    if (state.amount === 0) state.amount = 1;
    renderAmount();
  });
  $('ticketReason').addEventListener('change', function () {
    if (this.value === '發放' && state.amount < 1) { state.amount = 1; renderAmount(); }
  });

  $('btnGrant').addEventListener('click', async function () {
    var seat = Number($('ticketSeat').value);
    var reason = $('ticketReason').value;
    var amount = state.amount;
    if (!seat) { setStatus($('ticketStatus'), '請先選擇座號。', false); return; }
    if (reason === '發放' && amount < 1) { setStatus($('ticketStatus'), '「發放」張數需為正數。', false); return; }
    var text = seat + ' 號 ' + (amount > 0 ? '發 ' + amount : '扣 ' + (-amount)) + ' 張（' + reason + '）';
    if (!confirm('確定要' + text + '嗎？')) return;
    this.disabled = true;
    setStatus($('ticketStatus'), '送出中…');
    try {
      var d = await App.api('grantTickets', { seat: seat, amount: amount, reason: reason });
      setStatus($('ticketStatus'), '完成：' + text + '，目前餘額 ' + d.balance + ' 張。', true);
      state.amount = 1;
      $('ticketReason').value = '發放';
      renderAmount();
      loadAll();
    } catch (e) {
      var msg = e.code === 'INVALID_INPUT' ? '餘額不足或資料不正確（餘額不可低於 0）。' : App.errorText(e);
      setStatus($('ticketStatus'), '失敗：' + msg, false);
    } finally {
      this.disabled = false;
    }
  });

  /* ============ 籤池 ============ */
  function renderPool() {
    $('poolDrawn').textContent = state.lottery.drawnCount;
    $('poolTotal').textContent = state.lottery.total;
  }
  $('resetInput').addEventListener('input', function () {
    $('btnReset').disabled = this.value.trim() !== '重設';
  });
  $('btnReset').addEventListener('click', async function () {
    if ($('resetInput').value.trim() !== '重設') return;
    if (!confirm('確定要重設籤池嗎？所有號碼會重新變成可抽。')) return;
    this.disabled = true;
    try {
      await App.api('resetPool', { confirm: '重設' });
      $('resetInput').value = '';
      setStatus($('poolStatus'), '籤池已重設，40 個號碼都可以抽了。', true);
      loadAll();
    } catch (e) {
      setStatus($('poolStatus'), '重設失敗：' + App.errorText(e), false);
      this.disabled = false;
    }
  });

  /* ============ 抽籤紀錄 ============ */
  function renderDraws() {
    var body = $('drawBody');
    App.clear(body);
    var list = state.lottery.recent;
    if (!list.length) {
      body.appendChild(h('tr', {}, h('td', { colspan: '5', class: 'muted', text: '尚無抽籤紀錄。' })));
      return;
    }
    list.forEach(function (r) {
      body.appendChild(h('tr', {},
        h('td', { text: App.fmtMD(r.time) + ' ' + App.fmtHM(r.time) }),
        h('td', { text: r.seat + ' 號' }),
        h('td', { text: String(r.number) }),
        h('td', { text: r.type }),
        h('td', { text: r.name })));
    });
  }

  /* ============ 啟動 ============ */
  renderAmount();
  if (!(window.APP_CONFIG || {}).GAS_URL) {
    setStatus($('codeStatus'), App.ERROR_TEXT.NO_CONFIG, false);
  } else {
    refreshCodeHint().then(loadAll);
  }
})();
