/*
 * 共用模組：API 請求封裝、存取碼處理、錯誤訊息與小工具
 * 所有請求一律 POST，Content-Type 用 text/plain 以避免 CORS 預檢。
 */
(function () {
  'use strict';

  var CODE_KEY = 'hwt_access_code';

  var ERROR_TEXT = {
    UNAUTHORIZED: '存取碼錯誤或尚未設定，請重新輸入。',
    INVALID_INPUT: '資料格式不正確，請檢查後再試一次。',
    NOT_FOUND: '找不到這筆資料，可能已被刪除，請重新整理。',
    BOARD_FULL: '投影已滿 5 項，請先關閉一項。',
    LOCKED_TIMEOUT: '系統忙碌中，請稍後再試一次。',
    NO_TICKET: '這位同學沒有抽籤券了。',
    POOL_EMPTY: '籤池已全部抽完。',
    SERVER_ERROR: '伺服器發生錯誤，請稍後再試。',
    NETWORK: '網路連線失敗，請檢查網路後再試一次。',
    NO_CONFIG: '尚未設定 GAS 網址，請先編輯 config.js 的 GAS_URL。',
    NO_CODE: '尚未輸入存取碼。',
    BAD_RESPONSE: '伺服器回應格式不正確，請確認 config.js 的 GAS 網址與部署設定。'
  };

  function ApiError(code) {
    this.name = 'ApiError';
    this.code = code;
    this.message = ERROR_TEXT[code] || ('發生錯誤（' + code + '）');
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  /* ---------- localStorage（包 try/catch，無痕模式也不會壞） ---------- */
  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function storeRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
  }
  function storeGetJSON(key, fallback) {
    var raw = storeGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function storeSetJSON(key, value) { return storeSet(key, JSON.stringify(value)); }

  function getCode() { return storeGet(CODE_KEY) || ''; }
  function setCode(code) { storeSet(CODE_KEY, code); }
  function clearCode() { storeRemove(CODE_KEY); }

  /* ---------- API ---------- */
  async function api(action, params, opts) {
    opts = opts || {};
    var cfg = window.APP_CONFIG || {};
    if (!cfg.GAS_URL) throw new ApiError('NO_CONFIG');
    var code = opts.code !== undefined ? opts.code : getCode();
    if (!code) throw new ApiError('NO_CODE');

    var body = Object.assign({}, params || {}, { action: action, code: code });
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 25000) : null;
    var res;
    try {
      res = await fetch(cfg.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      throw new ApiError('NETWORK');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new ApiError('NETWORK');
    var json;
    try { json = await res.json(); } catch (e) { throw new ApiError('BAD_RESPONSE'); }
    if (!json || json.ok !== true) throw new ApiError((json && json.error) || 'BAD_RESPONSE');
    return json.data;
  }

  function errorText(err) {
    if (err && err.code && ERROR_TEXT[err.code]) return ERROR_TEXT[err.code];
    if (err && err.message) return err.message;
    return '發生未知錯誤。';
  }

  /* ---------- DOM 小工具（一律用 textContent，不用 innerHTML） ---------- */
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var toastTimer = null;
  function toast(msg, type) {
    var el = document.getElementById('app-toast');
    if (!el) {
      el = h('div', { id: 'app-toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, type === 'error' ? 4500 : 2500);
  }

  /* ---------- 時間格式 ---------- */
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function toDate(v) { var d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d; }
  function fmtHM(v) { var d = toDate(v); return d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''; }
  function fmtMD(v) { var d = toDate(v); return d ? (d.getMonth() + 1) + '/' + d.getDate() : ''; }
  /** yyyy-mm-dd 字串轉 M/D，不經過時區換算 */
  function ymdToMD(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? Number(m[2]) + '/' + Number(m[3]) : (s || '');
  }
  function todayYMD() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function weekday(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return '';
    return '日一二三四五六'.charAt(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay());
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID().replace(/-/g, '');
    var a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* ---------- 存取碼輸入視窗 ---------- */
  var gateOpen = null;
  function codeGate(message) {
    if (gateOpen) return gateOpen;
    gateOpen = new Promise(function (resolve) {
      var input = h('input', { type: 'password', class: 'input', placeholder: '存取碼', autocomplete: 'current-password', 'aria-label': '存取碼' });
      var err = h('p', { class: 'gate-error', role: 'alert' });
      var btn = h('button', { type: 'submit', class: 'btn btn-primary', text: '確認' });
      var form = h('form', { class: 'gate-box' },
        h('h2', { text: '請輸入存取碼' }),
        h('p', { class: 'gate-hint', text: message || '存取碼由導師在 GAS 指令碼屬性設定，輸入一次後會記在這台裝置的瀏覽器。' }),
        input, err, btn);
      var wrap = h('div', { class: 'gate', role: 'dialog', 'aria-modal': 'true' }, form);
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var code = input.value.trim();
        if (!code) { err.textContent = '請輸入存取碼。'; return; }
        btn.disabled = true;
        btn.textContent = '檢查中…';
        err.textContent = '';
        try {
          await api('ping', {}, { code: code });
          setCode(code);
          wrap.remove();
          gateOpen = null;
          resolve(code);
        } catch (ex) {
          err.textContent = errorText(ex);
          btn.disabled = false;
          btn.textContent = '確認';
        }
      });
      document.body.appendChild(wrap);
      setTimeout(function () { input.focus(); }, 50);
    });
    return gateOpen;
  }

  /** 沒有存取碼時先跳出輸入視窗，再執行頁面初始化 */
  async function requireCode() {
    if (!(window.APP_CONFIG || {}).GAS_URL) {
      toast(ERROR_TEXT.NO_CONFIG, 'error');
      return false;
    }
    if (!getCode()) await codeGate();
    return true;
  }

  /** 遇到 UNAUTHORIZED 時清除存取碼並要求重新輸入，成功後重新整理頁面 */
  function handleAuth(err) {
    if (err && err.code === 'UNAUTHORIZED') {
      clearCode();
      codeGate('存取碼錯誤或已變更，請重新輸入。').then(function () { location.reload(); });
      return true;
    }
    return false;
  }

  function toggleFullscreen() {
    var d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      var el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    }
  }

  window.App = {
    api: api,
    ApiError: ApiError,
    ERROR_TEXT: ERROR_TEXT,
    errorText: errorText,
    getCode: getCode,
    setCode: setCode,
    clearCode: clearCode,
    store: { get: storeGet, set: storeSet, remove: storeRemove, getJSON: storeGetJSON, setJSON: storeSetJSON },
    h: h,
    clear: clear,
    toast: toast,
    fmtHM: fmtHM,
    fmtMD: fmtMD,
    ymdToMD: ymdToMD,
    todayYMD: todayYMD,
    weekday: weekday,
    newId: newId,
    codeGate: codeGate,
    requireCode: requireCode,
    handleAuth: handleAuth,
    toggleFullscreen: toggleFullscreen
  };
})();
