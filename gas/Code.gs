/**
 * 班級作業缺交系統與雲端一番賞：後端（Google Apps Script）
 *
 * 使用前：
 * 1. 到「專案設定 → 指令碼屬性」新增兩組存取碼（值由導師自訂，不要寫在程式裡）：
 *    ACCESS_CODE  導師碼：可以使用全部功能（只輸入在導師自己的裝置）
 *    DISPLAY_CODE 教室碼：只能看投影、看抽籤頁與執行「抽」（輸入在班級電腦）
 * 2. 執行 setup() 建立工作表。
 * 3. 部署為網頁應用程式（執行身分：我；存取權：任何人），安全性靠存取碼。
 *
 * 所有 API 一律用 POST，body 為 JSON 字串：{ action, code, ...參數 }
 * 回應：成功 { ok: true, data }；失敗 { ok: false, error: "代碼" }
 */

var SHEET = {
  ROSTER: '名單',
  ASSIGN: '作業',
  MISSING: '缺交',
  TICKETS: '抽籤券',
  POOL: '籤池',
  CARDS: '卡片',
  DRAWS: '抽籤紀錄'
};

var HEADERS = {};
HEADERS[SHEET.ROSTER] = ['班級代號', '座號', '在籍'];
HEADERS[SHEET.ASSIGN] = ['ID', '日期', '名稱', '上投影', '投影順序', '建立時間'];
HEADERS[SHEET.MISSING] = ['作業ID', '座號', '狀態', '更新時間'];
HEADERS[SHEET.TICKETS] = ['座號', '異動', '原因', '時間'];
HEADERS[SHEET.POOL] = ['號碼', '類型', '實物名稱', '已抽', '抽出座號', '抽出時間'];
HEADERS[SHEET.CARDS] = ['卡名', '說明', '權重', '啟用'];
HEADERS[SHEET.DRAWS] = ['請求ID', '時間', '座號', '號碼', '類型', '結果名稱', '結果說明'];

// 這些欄位設為「純文字」格式，避免試算表自動把日期、時間字串轉成日期物件
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.ROSTER] = ['班級代號'];
TEXT_COLUMNS[SHEET.ASSIGN] = ['ID', '日期', '名稱', '建立時間'];
TEXT_COLUMNS[SHEET.MISSING] = ['作業ID', '更新時間'];
TEXT_COLUMNS[SHEET.TICKETS] = ['時間'];
TEXT_COLUMNS[SHEET.POOL] = ['實物名稱', '抽出時間'];
TEXT_COLUMNS[SHEET.DRAWS] = ['請求ID', '時間'];

var POOL_SIZE = 40;
var PRIZE_NUMBERS = [7, 13, 20, 21, 34];
var PRIZE_NAME = '小文具小玩具';
var MAX_BOARD = 5;
var LOCK_WAIT_MS = 10000;

var DEFAULT_CARDS = [
  ['我是DJ', '下課或用餐時間可以點 1 首歌。', 1.5],
  ['導演', '用餐時間可以選一部影片。', 1.5],
  ['神隊友', '考試遇到困難時，可以請求幫助。（限平時考、一題）', 1],
  ['財神爺', '使用後下一次點數 x2。', 1],
  ['免當值日生', '把值日生的任務交給下一個人。', 1],
  ['聯絡簿代抄', '老師幫忙寫聯絡簿。', 1],
  ['免死金牌', '可免除 1 次任何處罰。（嚴重者除外）', 1],
  ['老師來幫忙', '平時考時老師幫你檢查選擇題答案。', 1],
  ['掃地Pass', '今天不用做掃地工作。', 1],
  ['幸運女神', '從全部兌換券選一張。', 1],
  ['作業-1', '不用寫一項作業。（習作、作文除外）', 1],
  ['點數卡', '抽卡完的點數直接加 5 點。', 1],
  ['再抽一次', '不滿意的卡可以再抽一次。（可當次或下次使用）', 1],
  ['野餐卡', '用餐時間可和好朋友一起吃飯。', 1],
  ['白日夢卡', '可以挑一本書閱讀，不用睡午覺。', 1],
  ['榮譽之星', '獲得學校的榮譽卡一張。', 1]
];

/* ============================================================
 * 初始化
 * ============================================================ */

/**
 * 一次建立 7 張工作表、標題列、籤池 40 個號碼與 16 張卡片。
 * 已存在的工作表不會被覆蓋。
 */
function setup() {
  var code = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (!code) {
    throw new Error('尚未設定導師碼：請先到「專案設定（齒輪圖示）→ 指令碼屬性」新增屬性「ACCESS_CODE」，值由導師自行決定，儲存後再重新執行 setup()。');
  }
  var displayCode = PropertiesService.getScriptProperties().getProperty('DISPLAY_CODE');
  if (displayCode && displayCode === code) {
    throw new Error('教室碼 DISPLAY_CODE 不可以和導師碼 ACCESS_CODE 相同，請改成不同的值後再執行 setup()。');
  }
  var ss = ss_();
  var report = [];

  Object.keys(HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      var header = HEADERS[name];
      sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      (TEXT_COLUMNS[name] || []).forEach(function (col) {
        var c = header.indexOf(col) + 1;
        sheet.getRange(2, c, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
      });
      report.push('已建立：' + name);
    } else {
      report.push('已存在，略過：' + name);
    }

    // 籤池、卡片只在沒有資料列時才填入預設內容
    if (name === SHEET.POOL && sheet.getLastRow() <= 1) {
      var poolRows = [];
      for (var n = 1; n <= POOL_SIZE; n++) {
        var isPrize = PRIZE_NUMBERS.indexOf(n) !== -1;
        poolRows.push([n, isPrize ? '實物' : '抽卡', isPrize ? PRIZE_NAME : '', '否', '', '']);
      }
      sheet.getRange(2, 1, poolRows.length, poolRows[0].length).setValues(poolRows);
      report.push('已填入籤池 1 至 ' + POOL_SIZE + ' 號');
    }
    if (name === SHEET.CARDS && sheet.getLastRow() <= 1) {
      var cardRows = DEFAULT_CARDS.map(function (c) { return [c[0], c[1], c[2], '是']; });
      sheet.getRange(2, 1, cardRows.length, 4).setValues(cardRows);
      report.push('已填入 ' + cardRows.length + ' 張卡片');
    }
  });

  if (!displayCode) report.push('提醒：尚未設定教室碼 DISPLAY_CODE，班級電腦目前只能用導師碼登入。');
  console.log(report.join('\n'));
  return report.join('\n');
}

/* ============================================================
 * 進入點
 * ============================================================ */

function doGet() {
  return ContentService.createTextOutput('此網址僅供班級系統 API 使用。').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return out_(fail_('INVALID_INPUT'));
  }
  if (!req || typeof req !== 'object' || Array.isArray(req)) return out_(fail_('INVALID_INPUT'));

  // 一律先驗證存取碼，失敗時不回傳任何資料
  var role = roleOf_(req.code);
  if (!role) return out_(fail_('UNAUTHORIZED'));

  var handler = ACTIONS[req.action];
  if (typeof handler !== 'function') return out_(fail_('INVALID_INPUT'));

  // 教室碼只能使用投影與抽籤需要的功能，其餘一律拒絕
  if (role !== 'teacher' && DISPLAY_ACTIONS.indexOf(req.action) === -1) return out_(fail_('FORBIDDEN'));
  req.role = role;

  try {
    return out_(ok_(handler(req)));
  } catch (err) {
    if (err && err.apiCode) return out_(fail_(err.apiCode));
    console.error('API 發生錯誤（' + req.action + '）：' + (err && err.stack ? err.stack : err));
    return out_(fail_('SERVER_ERROR'));
  }
}

// 教室碼（DISPLAY_CODE）可以呼叫的 API
var DISPLAY_ACTIONS = ['ping', 'getBoard', 'getLottery', 'draw'];

var ACTIONS = {
  ping: function (req) { return { serverTime: nowIso_(), role: req.role }; },
  getState: getState_,
  getBoard: getBoard_,
  importRoster: importRoster_,
  setRosterActive: setRosterActive_,
  createAssignment: createAssignment_,
  updateAssignment: updateAssignment_,
  deleteAssignment: deleteAssignment_,
  saveMissing: saveMissing_,
  setBoard: setBoard_,
  reorderBoard: reorderBoard_,
  getLottery: getLottery_,
  grantTickets: grantTickets_,
  draw: draw_,
  resetPool: resetPool_
};

/* ============================================================
 * 作業缺交
 * ============================================================ */

function getState_() {
  var missing = table_(SHEET.MISSING).rows.map(function (r) {
    return {
      assignmentId: String(r['作業ID']),
      seat: toInt_(r['座號']),
      status: String(r['狀態']).trim(),
      updatedAt: String(r['更新時間'])
    };
  }).filter(function (m) { return m.seat !== null && (m.status === '缺交' || m.status === '已補交'); });

  return {
    roster: readRoster_(),
    assignments: readAssignments_().map(assignOut_),
    missing: missing,
    serverTime: nowIso_()
  };
}

function getBoard_() {
  var roster = readRoster_();
  var active = {};
  roster.forEach(function (r) { if (r.active) active[r.seat] = true; });

  var items = readAssignments_()
    .filter(function (a) { return a.onBoard; })
    .sort(byOrder_)
    .slice(0, MAX_BOARD);

  var bySeat = {};
  table_(SHEET.MISSING).rows.forEach(function (r) {
    var seat = toInt_(r['座號']);
    if (seat === null || !active[seat] || String(r['狀態']).trim() !== '缺交') return;
    var id = String(r['作業ID']);
    (bySeat[id] = bySeat[id] || {})[seat] = true;
  });

  return {
    items: items.map(function (a) {
      var seats = Object.keys(bySeat[a.id] || {}).map(Number).sort(function (x, y) { return x - y; });
      return { id: a.id, name: a.name, date: a.date, order: a.order, missing: seats };
    }),
    activeCount: Object.keys(active).length,
    serverTime: nowIso_()
  };
}

function importRoster_(req) {
  if (req.mode !== 'replace' && req.mode !== 'append') throw apiError_('INVALID_INPUT');
  if (!Array.isArray(req.rows) || req.rows.length === 0 || req.rows.length > 99) throw apiError_('INVALID_INPUT');

  var seen = {};
  var clean = req.rows.map(function (r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw apiError_('INVALID_INPUT');
    // 只接受班級代號與座號，任何其他欄位（例如姓名）一律拒絕
    Object.keys(r).forEach(function (k) {
      if (k !== 'seat' && k !== 'classCode') throw apiError_('INVALID_INPUT');
    });
    var seat = toSeat_(r.seat);
    if (seat === null || seen[seat]) throw apiError_('INVALID_INPUT');
    seen[seat] = true;
    var cc = r.classCode === undefined || r.classCode === null ? '' : String(r.classCode).trim();
    if (!/^[0-9A-Za-z-]{0,10}$/.test(cc)) throw apiError_('INVALID_INPUT');
    return { seat: seat, classCode: cc };
  });

  return withLock_(function () {
    var t = table_(SHEET.ROSTER);
    var existing = {};
    t.rows.forEach(function (r) {
      var s = toInt_(r['座號']);
      if (s !== null && !existing[s]) existing[s] = r;
    });
    var incoming = {};
    clean.forEach(function (c) { incoming[c.seat] = c; });

    var added = 0, activated = 0, deactivated = 0;
    if (req.mode === 'replace') {
      Object.keys(existing).forEach(function (s) {
        var row = existing[s];
        var inc = incoming[s];
        if (inc) {
          var fields = {};
          if (row['在籍'] !== '是') { fields['在籍'] = '是'; activated++; }
          if (String(row['班級代號']) !== inc.classCode) fields['班級代號'] = inc.classCode;
          setFields_(t, row._row, fields);
        } else if (row['在籍'] !== '否') {
          setFields_(t, row._row, { '在籍': '否' });
          deactivated++;
        }
      });
    }
    var toAdd = clean.filter(function (c) { return !existing[c.seat]; }).map(function (c) {
      return { '班級代號': c.classCode, '座號': c.seat, '在籍': '是' };
    });
    appendRows_(t, toAdd);
    added = toAdd.length;

    return { roster: readRoster_(), added: added, activated: activated, deactivated: deactivated };
  });
}

function setRosterActive_(req) {
  var seat = toSeat_(req.seat);
  if (seat === null || typeof req.active !== 'boolean') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var t = table_(SHEET.ROSTER);
    var row = find_(t.rows, function (r) { return toInt_(r['座號']) === seat; });
    if (!row) throw apiError_('NOT_FOUND');
    setFields_(t, row._row, { '在籍': req.active ? '是' : '否' });
    return { seat: seat, active: req.active };
  });
}

function createAssignment_(req) {
  var name = cleanName_(req.name);
  var date = req.date === undefined || req.date === '' ? todayStr_() : cleanDate_(req.date);
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN);
    var onBoard = readAssignments_(t).filter(function (a) { return a.onBoard; }).length;
    var canBoard = onBoard < MAX_BOARD;
    var obj = {
      'ID': newId_(),
      '日期': date,
      '名稱': name,
      '上投影': canBoard ? '是' : '否',
      '投影順序': canBoard ? onBoard + 1 : '',
      '建立時間': nowIso_()
    };
    appendRows_(t, [obj]);
    return assignOut_(objToAssign_(obj));
  });
}

function updateAssignment_(req) {
  var id = cleanId_(req.id);
  var name = cleanName_(req.name);
  var date = cleanDate_(req.date);
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN);
    var row = find_(t.rows, function (r) { return String(r['ID']) === id; });
    if (!row) throw apiError_('NOT_FOUND');
    setFields_(t, row._row, { '名稱': name, '日期': date });
    return { id: id, name: name, date: date };
  });
}

function deleteAssignment_(req) {
  var id = cleanId_(req.id);
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN);
    var row = find_(t.rows, function (r) { return String(r['ID']) === id; });
    if (!row) throw apiError_('NOT_FOUND');
    t.sheet.deleteRow(row._row);

    var m = table_(SHEET.MISSING);
    var rowsToDelete = m.rows.filter(function (r) { return String(r['作業ID']) === id; })
      .map(function (r) { return r._row; })
      .sort(function (a, b) { return b - a; });
    rowsToDelete.forEach(function (n) { m.sheet.deleteRow(n); });

    renumberBoard_();
    return { id: id, deletedMissing: rowsToDelete.length };
  });
}

function saveMissing_(req) {
  var id = cleanId_(req.assignmentId);
  if (!Array.isArray(req.changes) || req.changes.length === 0 || req.changes.length > 99) throw apiError_('INVALID_INPUT');
  var seen = {};
  var changes = req.changes.map(function (c) {
    if (!c || typeof c !== 'object') throw apiError_('INVALID_INPUT');
    var seat = toSeat_(c.seat);
    if (seat === null || seen[seat]) throw apiError_('INVALID_INPUT');
    if (['缺交', '已補交', '正常'].indexOf(c.status) === -1) throw apiError_('INVALID_INPUT');
    seen[seat] = true;
    return { seat: seat, status: c.status };
  });

  return withLock_(function () {
    var a = table_(SHEET.ASSIGN);
    if (!find_(a.rows, function (r) { return String(r['ID']) === id; })) throw apiError_('NOT_FOUND');

    var t = table_(SHEET.MISSING);
    var bySeat = {};
    t.rows.forEach(function (r) {
      if (String(r['作業ID']) !== id) return;
      var s = toInt_(r['座號']);
      if (s !== null && !bySeat[s]) bySeat[s] = r;
    });

    var now = nowIso_();
    var toAppend = [];
    var toDelete = [];
    changes.forEach(function (c) {
      var row = bySeat[c.seat];
      if (c.status === '正常') {
        if (row) toDelete.push(row._row);
      } else if (row) {
        if (String(row['狀態']).trim() !== c.status) setFields_(t, row._row, { '狀態': c.status, '更新時間': now });
      } else {
        toAppend.push({ '作業ID': id, '座號': c.seat, '狀態': c.status, '更新時間': now });
      }
    });
    appendRows_(t, toAppend);
    toDelete.sort(function (x, y) { return y - x; }).forEach(function (n) { t.sheet.deleteRow(n); });
    return { saved: changes.length };
  });
}

function setBoard_(req) {
  var id = cleanId_(req.assignmentId);
  if (typeof req.on !== 'boolean') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN);
    var list = readAssignments_(t);
    var target = find_(list, function (x) { return x.id === id; });
    if (!target) throw apiError_('NOT_FOUND');
    if (req.on) {
      if (target.onBoard) return { id: id, on: true };
      var count = list.filter(function (x) { return x.onBoard; }).length;
      if (count >= MAX_BOARD) throw apiError_('BOARD_FULL');
      setFields_(t, target._row, { '上投影': '是', '投影順序': count + 1 });
    } else {
      setFields_(t, target._row, { '上投影': '否', '投影順序': '' });
      renumberBoard_();
    }
    return { id: id, on: req.on };
  });
}

function reorderBoard_(req) {
  if (!Array.isArray(req.ids) || req.ids.length === 0 || req.ids.length > MAX_BOARD) throw apiError_('INVALID_INPUT');
  var ids = req.ids.map(cleanId_);
  var uniq = {};
  ids.forEach(function (id) {
    if (uniq[id]) throw apiError_('INVALID_INPUT');
    uniq[id] = true;
  });
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN);
    var board = readAssignments_(t).filter(function (a) { return a.onBoard; }).sort(byOrder_);
    var map = {};
    board.forEach(function (a) { map[a.id] = a; });
    ids.forEach(function (id) { if (!map[id]) throw apiError_('INVALID_INPUT'); });
    var ordered = ids.map(function (id) { return map[id]; })
      .concat(board.filter(function (a) { return !uniq[a.id]; }));
    ordered.forEach(function (a, i) {
      if (a.order !== i + 1) setFields_(t, a._row, { '投影順序': i + 1 });
    });
    return { ids: ordered.map(function (a) { return a.id; }) };
  });
}

/** 把投影順序重新整理成 1、2、3…，不留空號 */
function renumberBoard_() {
  var t = table_(SHEET.ASSIGN);
  readAssignments_(t).filter(function (a) { return a.onBoard; }).sort(byOrder_).forEach(function (a, i) {
    if (a.order !== i + 1) setFields_(t, a._row, { '投影順序': i + 1 });
  });
}

/* ============================================================
 * 一番賞
 * ============================================================ */

function getLottery_(req) {
  var limit = toInt_(req.limit);
  if (limit === null || limit < 1) limit = 10;
  if (limit > 50) limit = 50;

  var pool = readPool_();
  var seats = readRoster_().filter(function (r) { return r.active; }).map(function (r) { return r.seat; });
  var balances = balances_();
  var out = {};
  seats.forEach(function (s) { out[s] = balances[s] || 0; });

  var draws = table_(SHEET.DRAWS).rows;
  var recent = draws.slice(-limit).reverse().map(function (r) {
    return {
      time: String(r['時間']),
      seat: toInt_(r['座號']),
      number: toInt_(r['號碼']),
      type: String(r['類型']),
      name: String(r['結果名稱'])
    };
  });

  var drawnCount = pool.filter(function (p) { return p.drawn; }).length;
  return {
    // 籤池只回傳是否已抽，不回傳類型與獎品內容
    pool: pool.map(function (p) { return { number: p.number, drawn: p.drawn }; }),
    seats: seats,
    balances: out,
    recent: recent,
    drawnCount: drawnCount,
    remainingCount: pool.length - drawnCount,
    total: pool.length,
    serverTime: nowIso_()
  };
}

function grantTickets_(req) {
  var seat = toSeat_(req.seat);
  var amount = toInt_(req.amount);
  var reason = req.reason;
  if (seat === null || amount === null || amount === 0 || Math.abs(amount) > 50) throw apiError_('INVALID_INPUT');
  if (reason !== '發放' && reason !== '更正') throw apiError_('INVALID_INPUT');
  if (reason === '發放' && amount < 0) throw apiError_('INVALID_INPUT');

  return withLock_(function () {
    if (!isActiveSeat_(seat)) throw apiError_('NOT_FOUND');
    var balance = balances_()[seat] || 0;
    if (balance + amount < 0) throw apiError_('INVALID_INPUT');
    appendRows_(table_(SHEET.TICKETS), [{ '座號': seat, '異動': amount, '原因': reason, '時間': nowIso_() }]);
    return { seat: seat, balance: balance + amount };
  });
}

function draw_(req) {
  var seat = toSeat_(req.seat);
  var requestId = typeof req.requestId === 'string' ? req.requestId : '';
  if (seat === null || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw apiError_('INVALID_INPUT');

  return withLock_(function () {
    // 1. 相同 requestId 已處理過：直接回傳上次結果，不重複扣券
    var draws = table_(SHEET.DRAWS);
    var prev = find_(draws.rows, function (r) { return String(r['請求ID']) === requestId; });
    if (prev) {
      var prevSeat = toInt_(prev['座號']);
      var poolNow = readPool_();
      return {
        number: toInt_(prev['號碼']),
        type: String(prev['類型']),
        name: String(prev['結果名稱']),
        description: String(prev['結果說明'] || ''),
        seat: prevSeat,
        balance: balances_()[prevSeat] || 0,
        remainingCount: poolNow.filter(function (p) { return !p.drawn; }).length,
        replay: true
      };
    }

    // 2. 驗證在籍與券餘額
    if (!isActiveSeat_(seat)) throw apiError_('INVALID_INPUT');
    var balance = balances_()[seat] || 0;
    if (balance < 1) throw apiError_('NO_TICKET');

    // 3. 從未抽號碼中均勻隨機抽一個
    var poolTable = table_(SHEET.POOL);
    var undrawn = poolTable.rows.filter(function (r) {
      return toInt_(r['號碼']) !== null && !yes_(r['已抽']);
    });
    if (undrawn.length === 0) throw apiError_('POOL_EMPTY');
    var pick = undrawn[Math.floor(Math.random() * undrawn.length)];
    var number = toInt_(pick['號碼']);

    // 4. 決定結果
    var type, name, description;
    if (String(pick['類型']).trim() === '實物') {
      type = '實物';
      name = String(pick['實物名稱'] || '').trim() || PRIZE_NAME;
      description = '';
    } else {
      var card = pickCard_();
      if (!card) throw apiError_('NOT_FOUND');
      type = '抽卡';
      name = card.name;
      description = card.description;
    }

    // 5. 寫入籤池、抽籤券、抽籤紀錄
    var now = nowIso_();
    setFields_(poolTable, pick._row, { '已抽': '是', '抽出座號': seat, '抽出時間': now });
    appendRows_(table_(SHEET.TICKETS), [{ '座號': seat, '異動': -1, '原因': '抽籤', '時間': now }]);
    appendRows_(draws, [{
      '請求ID': requestId, '時間': now, '座號': seat, '號碼': number,
      '類型': type, '結果名稱': name, '結果說明': description
    }]);

    // 6. 回傳
    return {
      number: number,
      type: type,
      name: name,
      description: description,
      seat: seat,
      balance: balance - 1,
      remainingCount: undrawn.length - 1
    };
  });
}

function resetPool_(req) {
  if (req.confirm !== '重設') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var t = table_(SHEET.POOL);
    t.rows.forEach(function (r) {
      setFields_(t, r._row, { '已抽': '否', '抽出座號': '', '抽出時間': '' });
    });
    return { reset: t.rows.length };
  });
}

/** 依權重從啟用的卡片中抽一張 */
function pickCard_() {
  var cards = table_(SHEET.CARDS).rows.map(function (r) {
    return {
      name: String(r['卡名'] || '').trim(),
      description: String(r['說明'] || '').trim(),
      weight: Number(r['權重']),
      enabled: String(r['啟用']).trim() !== '否' && r['啟用'] !== false
    };
  }).filter(function (c) { return c.name && c.enabled && isFinite(c.weight) && c.weight > 0; });
  if (cards.length === 0) return null;
  var total = cards.reduce(function (s, c) { return s + c.weight; }, 0);
  var r = Math.random() * total;
  for (var i = 0; i < cards.length; i++) {
    r -= cards[i].weight;
    if (r < 0) return cards[i];
  }
  return cards[cards.length - 1];
}

/* ============================================================
 * 讀取輔助
 * ============================================================ */

function readRoster_() {
  var seen = {};
  return table_(SHEET.ROSTER).rows.map(function (r) {
    return {
      classCode: r['班級代號'] === '' || r['班級代號'] === null ? '' : String(r['班級代號']),
      seat: toInt_(r['座號']),
      active: String(r['在籍']).trim() !== '否'
    };
  }).filter(function (r) {
    if (r.seat === null || seen[r.seat]) return false;
    seen[r.seat] = true;
    return true;
  }).sort(function (a, b) { return a.seat - b.seat; });
}

function isActiveSeat_(seat) {
  return readRoster_().some(function (r) { return r.seat === seat && r.active; });
}

function readAssignments_(t) {
  t = t || table_(SHEET.ASSIGN);
  return t.rows.map(function (r) {
    var a = objToAssign_(r);
    a._row = r._row;
    return a;
  }).filter(function (a) { return a.id; });
}

function objToAssign_(r) {
  var onBoard = yes_(r['上投影']);
  return {
    id: String(r['ID'] || ''),
    date: String(r['日期'] || ''),
    name: String(r['名稱'] || ''),
    onBoard: onBoard,
    order: onBoard ? toInt_(r['投影順序']) : null,
    createdAt: String(r['建立時間'] || '')
  };
}

function assignOut_(a) {
  return { id: a.id, date: a.date, name: a.name, onBoard: a.onBoard, order: a.order, createdAt: a.createdAt };
}

function byOrder_(a, b) {
  var x = a.order === null ? 999 : a.order;
  var y = b.order === null ? 999 : b.order;
  return x - y || (a.createdAt < b.createdAt ? -1 : 1);
}

function readPool_() {
  return table_(SHEET.POOL).rows.map(function (r) {
    return { number: toInt_(r['號碼']), drawn: yes_(r['已抽']) };
  }).filter(function (p) { return p.number !== null; })
    .sort(function (a, b) { return a.number - b.number; });
}

function balances_() {
  var sum = {};
  table_(SHEET.TICKETS).rows.forEach(function (r) {
    var s = toInt_(r['座號']);
    var d = toInt_(r['異動']);
    if (s === null || d === null) return;
    sum[s] = (sum[s] || 0) + d;
  });
  Object.keys(sum).forEach(function (s) { if (sum[s] < 0) sum[s] = 0; });
  return sum;
}

/* ============================================================
 * 試算表存取
 * ============================================================ */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** 讀取整張工作表，回傳 { sheet, header, idx, rows }，rows 為物件且含 _row（實際列號） */
function table_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('找不到工作表「' + name + '」，請先執行 setup()。');
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), HEADERS[name].length);
  var values = lastRow >= 1 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  header.forEach(function (h, i) { if (h && !(h in idx)) idx[h] = i; });
  HEADERS[name].forEach(function (h) {
    if (!(h in idx)) throw new Error('工作表「' + name + '」缺少欄位「' + h + '」。');
  });

  var tz = Session.getScriptTimeZone();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var arr = values[i];
    var empty = true;
    var obj = { _row: i + 1 };
    for (var key in idx) {
      var v = arr[idx[key]];
      if (v instanceof Date) v = key === '日期' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
      if (v !== '' && v !== null) empty = false;
      obj[key] = v;
    }
    if (!empty) rows.push(obj);
  }
  return { name: name, sheet: sheet, header: header, idx: idx, width: lastCol, rows: rows };
}

function setFields_(t, rowNum, fields) {
  Object.keys(fields).forEach(function (k) {
    t.sheet.getRange(rowNum, t.idx[k] + 1).setValue(fields[k]);
  });
}

function appendRows_(t, objs) {
  if (!objs || objs.length === 0) return;
  var start = t.sheet.getLastRow() + 1;
  var data = objs.map(function (o) {
    var arr = [];
    for (var c = 0; c < t.width; c++) arr.push('');
    Object.keys(o).forEach(function (k) { arr[t.idx[k]] = o[k]; });
    return arr;
  });
  (TEXT_COLUMNS[t.name] || []).forEach(function (col) {
    t.sheet.getRange(start, t.idx[col] + 1, data.length, 1).setNumberFormat('@');
  });
  t.sheet.getRange(start, 1, data.length, t.width).setValues(data);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw apiError_('LOCKED_TIMEOUT');
  try {
    var result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 * 小工具
 * ============================================================ */

/** 回傳 'teacher'（導師碼）、'display'（教室碼）或 null（錯誤） */
function roleOf_(code) {
  var props = PropertiesService.getScriptProperties();
  if (checkCode_(code, props.getProperty('ACCESS_CODE'))) return 'teacher';
  if (checkCode_(code, props.getProperty('DISPLAY_CODE'))) return 'display';
  return null;
}

function checkCode_(code, expected) {
  if (!expected || typeof code !== 'string' || code.length === 0) return false;
  if (code.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < code.length; i++) diff |= code.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function ok_(data) { return { ok: true, data: data }; }
function fail_(code) { return { ok: false, error: code }; }

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code) {
  var e = new Error(code);
  e.apiCode = code;
  return e;
}

function find_(list, pred) {
  for (var i = 0; i < list.length; i++) if (pred(list[i])) return list[i];
  return null;
}

function yes_(v) {
  return v === true || String(v).trim() === '是' || String(v).toUpperCase() === 'TRUE';
}

function toInt_(v) {
  if (typeof v === 'number') return isFinite(v) && Math.floor(v) === v ? v : null;
  if (typeof v === 'string' && /^\s*-?\d{1,6}\s*$/.test(v)) return parseInt(v, 10);
  return null;
}

function toSeat_(v) {
  var n = toInt_(v);
  return n !== null && n >= 1 && n <= 99 ? n : null;
}

function cleanName_(v) {
  var s = typeof v === 'string' ? v.trim() : '';
  if (s.length === 0 || s.length > 40) throw apiError_('INVALID_INPUT');
  return s;
}

function cleanDate_(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw apiError_('INVALID_INPUT');
  var p = v.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  if (d.getFullYear() !== p[0] || d.getMonth() !== p[1] - 1 || d.getDate() !== p[2]) throw apiError_('INVALID_INPUT');
  return v;
}

function cleanId_(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(v)) throw apiError_('INVALID_INPUT');
  return v;
}

function newId_() {
  var rand = Math.random().toString(36).slice(2, 8);
  return Date.now().toString(36) + '-' + rand;
}

function nowIso_() {
  return new Date().toISOString();
}

function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
