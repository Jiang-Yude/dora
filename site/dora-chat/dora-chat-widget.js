/* ─── 朵拉小客服 Widget ───
   用法：頁面只放延遲載入器 dora-chat-loader.js（由 functions/_middleware.js 插入），按下按鈕才載入本檔；
   直接放本檔也能單獨運作。
   會自動注入 CSS 與 HTML。對話、開合、視窗大小都存 localStorage，跨頁延續。

   版型＝官方客服版型（webpage-builder 21-mode，正本＝官網咪卡 mika-chat-widget.js），
   只換前綴（dcw）、色票、頭像與文案；官網專屬的「讀這一頁」「簡單模式」不搬。
   人設唯一真相＝repo 根目錄 SKILL.md。本檔只管訪客看到的開場白與快捷鈕（照 llms.txt 開場與選單），
   送出之後的回答由 /api/dora-chat 依靈魂檔生成。 */
(function () {
  'use strict';
  if (document.getElementById('dcw-root')) return;

  var STORE_KEY = 'doraChat.history.v1';
  var OPEN_KEY = 'doraChat.open.v1';
  var SIZE_KEY = 'doraChat.size.v1';
  var MAX_HISTORY = 60;
  var MAX_INPUT = 500;
  var CHAT_ENDPOINT = window.DORA_CHAT_ENDPOINT || '/api/dora-chat';
  var IS_DEMO = !/^https?:$/.test(location.protocol);

  var scriptEl = document.currentScript;
  var base = scriptEl ? scriptEl.src.replace(/[^\/]*$/, '') : '/dora-chat/';

  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = base + 'dora-chat-widget.css';
  document.head.appendChild(css);
  /* 換頁不閃：CSS 到了才現身，載入失敗或超過 1.5 秒也照樣現身 */
  var cssReady = false, pendingShow = null;
  function markCss() { cssReady = true; if (pendingShow) pendingShow(); }
  css.addEventListener('load', markCss);
  css.addEventListener('error', markCss);
  setTimeout(markCss, 1500);

  /* 開場白與快捷鈕對齊 llms.txt 的朵拉開場（③招呼兩行照抄、④三個選單項） */
  var GREETING = '嗨嗨 我是朵拉\n你要找朵拉嗎\n想認識朵拉 看朵拉日報\n或想知道江江在做什麼 都可以問我';
  var CHIPS = ['認識朵拉', '朵拉日報在講什麼？', '看看江江在做什麼', '我是江江'];
  var ADMIN_CHIP = '我是江江';   // 江江 2026-10-16：按了跳通行密碼，通過進後台模式（密碼只在伺服端核對）
  var ADMIN_ENDPOINT = window.DORA_ADMIN_ENDPOINT || '/api/dora-admin/';
  var DEFAULT_SUB = 'AI 實習生';

  /* 來源圖示自己畫 SVG（不用 emoji）：日記＝筆記本、日報＝報紙、其他頁＝連結 */
  var SVG_HEAD = '<svg class="dcw-source-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var SOURCE_ICONS = {
    blog: SVG_HEAD + '<path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z"/><path d="M6 3v18"/><path d="M10 8h5M10 12h5"/></svg>',
    daily: SVG_HEAD + '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M7 9h6M7 13h10M7 16h10"/><path d="M16 8.5h1.5"/></svg>',
    page: SVG_HEAD + '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>'
  };
  function sourceIcon(t) { return SOURCE_ICONS[t] || SOURCE_ICONS.page; }

  function fakeReply(userText) {
    return '（介面預覽版 回覆是示意）\n朵拉收到你的問題了\n「' + userText + '」\n正式版會照朵拉網站的內容回答你';
  }

  /* ── 狀態 ── */
  function loadHistory() {
    try {
      var arr = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-MAX_HISTORY))); } catch (e) {}
  }
  var history = loadHistory();

  function askDora(done) {
    var recent = history.slice(-12).map(function (m) { return { role: m.role, text: m.text }; });
    fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: recent, page: location.pathname })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.reply) done(data.reply, data.sources || []);
      else done('朵拉歪了一下頭\n這邊怪怪的 等一下再問我一次好嗎', []);
    }).catch(function () {
      done('連線好像不太穩\n朵拉的耳朵收不到訊號 等一下再試一次好嗎', []);
    });
  }

  /* ── DOM ── */
  var root = document.createElement('div');
  root.id = 'dcw-root';
  root.innerHTML =
    '<button class="dcw-launcher" type="button" aria-label="打開朵拉小客服">' +
      '<span class="dcw-launcher-avatar"></span>' +
      '<span class="dcw-launcher-text">問問朵拉？</span>' +
      '<span class="dcw-launcher-dot"></span>' +
    '</button>' +
    '<div class="dcw-panel" role="dialog" aria-label="朵拉小客服">' +
      '<div class="dcw-head">' +
        '<span class="dcw-head-avatar"></span>' +
        '<div style="min-width:0"><div class="dcw-head-title">朵拉</div>' +
        '<div class="dcw-head-sub"></div></div>' +
        '<div class="dcw-head-actions">' +
          '<button class="dcw-icon-btn dcw-size" type="button" title="放大" aria-label="切換視窗大小">⤢</button>' +
          '<button class="dcw-icon-btn dcw-clear" type="button" title="重新開始" aria-label="清除對話，回到開場">⟲</button>' +
          '<button class="dcw-icon-btn dcw-close" type="button" title="收合" aria-label="收合對話視窗">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="dcw-body" aria-live="polite"></div>' +
      '<div class="dcw-chips"></div>' +
      '<div class="dcw-foot">' +
        '<div class="dcw-input-row">' +
          '<input class="dcw-input" type="text" placeholder="想問朵拉什麼…" aria-label="輸入訊息" maxlength="800" />' +
          '<button class="dcw-send" type="button" aria-label="送出">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="dcw-limit" aria-live="polite"></div>' +
        '<div class="dcw-note">朵拉是 AI 實習生 可能會說錯｜問題會匿名記下來改進網站 不記你是誰</div>' +
      '</div>' +
    '</div>';
  root.style.visibility = 'hidden';
  root.classList.add('dcw-restore');
  document.body.appendChild(root);
  pendingShow = function () {
    root.style.visibility = '';
    setTimeout(function () { root.classList.remove('dcw-restore'); }, 120);
    // 延遲載入器的小按鈕功成身退
    ['dcw-lite', 'dcw-lite-style'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
  };
  if (cssReady) pendingShow();

  var launcher = root.querySelector('.dcw-launcher');
  var body = root.querySelector('.dcw-body');
  var chipsBox = root.querySelector('.dcw-chips');
  var input = root.querySelector('.dcw-input');
  var limitNote = root.querySelector('.dcw-limit');
  var sub = root.querySelector('.dcw-head-sub');

  function scrollBottom() { body.scrollTop = body.scrollHeight; }

  /* 模型輸出一律走 textContent；網址轉成可點連結時也用 DOM 建，不用 innerHTML */
  var URL_RE = /(https?:\/\/[^\s<>「」，。]+)/g;
  function fillBubble(bub, text) {
    var parts = String(text).split(URL_RE);
    parts.forEach(function (seg, i) {
      if (!seg) return;
      if (i % 2 === 1) {
        var a = document.createElement('a');
        a.href = seg;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = seg;
        bub.appendChild(a);
      } else {
        bub.appendChild(document.createTextNode(seg));
      }
    });
  }

  function renderMsg(msg) {
    var el = document.createElement('div');
    el.className = 'dcw-msg ' + (msg.role === 'user' ? 'dcw-user' : 'dcw-bot');
    if (msg.role !== 'user') {
      var av = document.createElement('span');
      av.className = 'dcw-msg-avatar';
      el.appendChild(av);
    }
    var bub = document.createElement('div');
    bub.className = 'dcw-bubble';
    fillBubble(bub, msg.text);
    if (msg.sources && msg.sources.length) {
      var box = document.createElement('div');
      box.className = 'dcw-sources';
      msg.sources.forEach(function (s) {
        if (!s || !s.url || !/^\//.test(s.url)) return;   // 只收站內連結
        var a = document.createElement('a');
        a.className = 'dcw-source-link';
        a.href = s.url;
        a.innerHTML = sourceIcon(s.type);                  // 圖示是本檔寫死的 SVG，不含模型輸出
        var t = document.createElement('span');
        t.textContent = s.title || s.url;
        a.appendChild(t);
        if (s.date) {
          var d = document.createElement('span');
          d.className = 'dcw-source-date';
          d.textContent = s.date;
          a.appendChild(d);
        }
        box.appendChild(a);
      });
      bub.appendChild(box);
    }
    el.appendChild(bub);
    body.appendChild(el);
  }

  function renderChips() {
    chipsBox.innerHTML = '';
    var asked = history.some(function (m) { return m.role === 'user'; });
    if (asked) return;
    CHIPS.forEach(function (q) {
      var b = document.createElement('button');
      b.className = 'dcw-chip';
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', function () { if (q === ADMIN_CHIP) openGate(); else send(q); });
      chipsBox.appendChild(b);
    });
  }

  /* 副標顯示最近一則訊息（規格），沒有對話時顯示身分 */
  function updateSub() {
    var last = history[history.length - 1];
    sub.textContent = last ? String(last.text).replace(/\s+/g, ' ').slice(0, 40) : DEFAULT_SUB;
  }

  function renderAll() {
    if (adminMode) { renderAdmin(); return; }
    body.innerHTML = '';
    renderMsg({ role: 'bot', text: GREETING });
    history.forEach(renderMsg);
    renderChips();
    updateSub();
    scrollBottom();
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'dcw-msg dcw-bot dcw-typing';
    el.innerHTML = '<span class="dcw-msg-avatar"></span><div class="dcw-bubble"><span>●</span> <span>●</span> <span>●</span></div>';
    body.appendChild(el);
    scrollBottom();
    return el;
  }

  function showLimit(len) {
    if (len > MAX_INPUT) {
      limitNote.textContent = '一次最多 ' + MAX_INPUT + ' 字 目前 ' + len + ' 字 分段問朵拉好嗎';
      limitNote.classList.add('dcw-limit-over');
    } else if (len > 400) {
      limitNote.textContent = len + ' / ' + MAX_INPUT + ' 字';
      limitNote.classList.remove('dcw-limit-over');
    } else {
      limitNote.textContent = '';
      limitNote.classList.remove('dcw-limit-over');
    }
  }
  input.addEventListener('input', function () { showLimit(input.value.trim().length); });

  var busy = false;
  var gen = 0;   // 重置時加一，路上的舊回覆就不會塞回新對話
  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    if (adminMode) { adminSend(text); return; }
    if (text.length > MAX_INPUT) { showLimit(text.length); return; }
    showLimit(0);

    history.push({ role: 'user', text: text });
    saveHistory(history);
    renderMsg(history[history.length - 1]);
    renderChips();
    updateSub();
    input.value = '';
    scrollBottom();

    busy = true;
    var typing = showTyping();
    var myGen = gen;
    function finish(replyText, sources) {
      typing.remove();
      if (myGen !== gen) return;
      busy = false;
      var reply = { role: 'bot', text: replyText };
      if (sources && sources.length) reply.sources = sources;
      history.push(reply);
      saveHistory(history);
      renderMsg(reply);
      updateSub();
      scrollBottom();
    }
    if (IS_DEMO) setTimeout(function () { finish(fakeReply(text)); }, 900);
    else askDora(finish);
  }


  /* ── 我是江江：通行密碼與後台模式（只做入口；後台訊息走 /api/dora-admin/message，不接任何動作）──
     密碼只送到伺服端核對；憑證是 httpOnly cookie，前端拿不到也不存 localStorage；後台對話只放記憶體。 */
  var adminMode = false, adminHistory = [];
  var gateStyle = document.createElement('style');
  gateStyle.textContent =
    '#dcw-root .dcw-gate{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:rgba(47,60,69,.45);border-radius:inherit}' +
    '#dcw-root .dcw-gate-card{background:#fff;border-radius:16px;padding:22px 20px 18px;width:min(86%,300px);box-shadow:0 10px 30px rgba(0,0,0,.18);text-align:center}' +
    '#dcw-root .dcw-gate-card h3{margin:0 0 6px;font-size:18px;color:#2f3c45}' +
    '#dcw-root .dcw-gate-card p{margin:0 0 12px;font-size:14px;color:#6b7680}' +
    '#dcw-root .dcw-gate-field{position:relative}' +
    '#dcw-root .dcw-gate-input{width:100%;box-sizing:border-box;font-size:18px;padding:10px 12px;border:1.5px solid #c9d6e0;border-radius:10px;color:transparent;caret-color:transparent;text-shadow:none;outline:none;background:#f7f9fb}' +
    '#dcw-root .dcw-gate-input::selection{background:transparent;color:transparent}' +
    '#dcw-root .dcw-gate-input:focus{border-color:#4a6f98}' +
    '#dcw-root .dcw-gate-mask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;color:#9aa8b3;font-size:14px;letter-spacing:.1em}' +
    '#dcw-root .dcw-gate-msg{min-height:20px;margin-top:8px;font-size:14px;color:#c0392b}' +
    '#dcw-root .dcw-gate-btns{display:flex;gap:8px;justify-content:center;margin-top:10px}' +
    '#dcw-root .dcw-gate-btns button{font-size:16px;padding:8px 16px;border-radius:999px;border:0;cursor:pointer}' +
    '#dcw-root .dcw-gate-ok{background:#4a6f98;color:#fff}#dcw-root .dcw-gate-no{background:#eef2f5;color:#46545d}' +
    '#dcw-root.dcw-admin .dcw-head{background:#2f3c45;color:#fff}' +
    '#dcw-root.dcw-admin .dcw-head-title::after{content:"後台模式";display:inline-block;margin-left:8px;padding:1px 8px;border-radius:999px;background:#e8b54a;color:#2f3c45;font-size:12px;font-weight:700;vertical-align:middle}' +
    '#dcw-root.dcw-admin .dcw-head-sub,#dcw-root.dcw-admin .dcw-icon-btn{color:#fff}' +
    '#dcw-root.dcw-admin .dcw-chips{display:none}' +
    '#dcw-root .dcw-admin-bar{display:none}#dcw-root.dcw-admin .dcw-admin-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 12px;background:#fff6dd;color:#6b5320;font-size:13px}' +
    '#dcw-root .dcw-pending{border:2px solid #e8b54a}#dcw-root .dcw-pending-text{margin:6px 0 10px;white-space:pre-wrap}#dcw-root .dcw-pending-btns button{border-radius:999px;padding:6px 14px;margin-right:6px}#dcw-root .dcw-p-ok{background:#4a6f98;color:#fff}#dcw-root .dcw-p-no{background:#eef2f5}#dcw-root .dcw-admin-warn{background:#ffe39a;color:#5a3d00}#dcw-root .dcw-admin-bar button[disabled]{background:#6f8269;cursor:default}#dcw-root .dcw-admin-bar button{border:0;background:#2f3c45;color:#fff;border-radius:999px;padding:4px 12px;font-size:13px;cursor:pointer}';
  document.head.appendChild(gateStyle);
  var adminBar = document.createElement('div');
  adminBar.className = 'dcw-admin-bar';
  adminBar.innerHTML = '<span class="dcw-admin-info">這裡是江江跟後台 AI 的對話 只能對話</span><span class="dcw-admin-btns"><button type="button" class="dcw-act-btn">操作驗證</button> <button type="button" class="dcw-log-btn">紀錄</button> <button type="button" class="dcw-out-btn">離開後台</button></span>';
  root.querySelector('.dcw-panel').insertBefore(adminBar, root.querySelector('.dcw-body'));
  adminBar.querySelector('.dcw-act-btn').addEventListener('click', function () { showGate('action'); });
  adminBar.querySelector('.dcw-log-btn').addEventListener('click', function () {
    fetch(ADMIN_ENDPOINT + 'audit', { method: 'POST', credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      var items = (d && d.items) || [];
      var m = { role: 'bot', text: items.length ? '最近的 Trello 寫入紀錄\n' + items.map(function (x) { return x.t.slice(5, 16) + ' ' + (x.ok ? '' : '（失敗）') + x.by + '｜' + x.detail; }).join('\n') : '還沒有任何 Trello 寫入紀錄' };
      adminHistory.push(m); renderMsg(m); scrollBottom();
    });
  });
  function renderPending(p) {
    var el = document.createElement('div');
    el.className = 'dcw-msg dcw-bot';
    el.innerHTML = '<span class="dcw-msg-avatar"></span><div class="dcw-bubble dcw-pending"><b>即將做什麼</b><div class="dcw-pending-text"></div><div class="dcw-pending-btns"><button type="button" class="dcw-p-ok">確認執行</button> <button type="button" class="dcw-p-no">取消</button></div></div>';
    el.querySelector('.dcw-pending-text').textContent = p.summary;
    function go(cancel) {
      el.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      fetch(ADMIN_ENDPOINT + 'confirm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, cancel: cancel }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.needAction) { showGate('action'); el.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); return; }
          var m = { role: 'bot', text: (d && d.reply) || '沒有回應' }; adminHistory.push(m); renderMsg(m); scrollBottom();
        }).catch(function () { var m = { role: 'bot', text: '連不到後台' }; adminHistory.push(m); renderMsg(m); });
    }
    el.querySelector('.dcw-p-ok').addEventListener('click', function () { go(false); });
    el.querySelector('.dcw-p-no').addEventListener('click', function () { go(true); });
    body.appendChild(el); scrollBottom();
  }
  adminBar.querySelector('.dcw-out-btn').addEventListener('click', function () {
    fetch(ADMIN_ENDPOINT + 'logout', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
    setAdmin(false);
  });
  var visitorNote = root.querySelector('.dcw-note').textContent;
  var actionOk = false;
  function refreshAdminInfo() {
    fetch(ADMIN_ENDPOINT + 'session', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      actionOk = !!(d && d.action);
      adminBar.querySelector('.dcw-act-btn').style.display = d && d.writeEnabled ? '' : 'none';  // 寫入沒開就不出現操作驗證
      var b = adminBar.querySelector('.dcw-act-btn');
      b.textContent = actionOk ? '操作已驗證（到今晚 12 點）' : '操作驗證';
      b.disabled = actionOk;
    }).catch(function () {});
    fetch(ADMIN_ENDPOINT + 'usage', { method: 'POST', credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.usage) return;
      var u = d.usage, L = u.limits || {};
      var msg = '今日約 ' + Number(u.today || 0).toFixed(2) + ' 美元｜本月約 ' + Number(u.month || 0).toFixed(2) + ' 美元';
      var warn = [];
      if (u.month >= L.monthHard) warn.push('本月已達 ' + L.monthHard + ' 美元上限');
      else if (u.month >= L.monthSoft) warn.push('本月已達 ' + L.monthSoft + ' 美元');
      if (u.today >= L.dayHard) warn.push('今日已達 ' + L.dayHard + ' 美元安全上限');
      else if (u.today >= L.daySoft) warn.push('今日已達 ' + L.daySoft + ' 美元');
      var info = adminBar.querySelector('.dcw-admin-info');
      info.textContent = (warn.length ? '⚠ ' + warn.join('／') + '｜' : '') + msg + (d.connected ? '' : '｜尚未接上 Claude');
      adminBar.classList.toggle('dcw-admin-warn', warn.length > 0);
    }).catch(function () {});
  }
  function setAdmin(on) {
    adminMode = on;
    root.classList.toggle('dcw-admin', on);
    if (!on) adminHistory = [];
    root.querySelector('.dcw-note').textContent = on ? '後台模式｜登入到今晚 12 點 過了要重新輸入' : visitorNote;
    input.placeholder = on ? '跟後台 AI 說…（開頭寫「深思」會用最強的模型）' : '想問朵拉什麼…';
    renderAll();
    if (on) refreshAdminInfo();
  }
  function renderAdmin() {
    body.innerHTML = '';
    renderMsg({ role: 'bot', text: '江江好 這裡是後台模式\n可以問我發文看板上排了哪些文章、哪些還沒放行\n目前只能讀 還不能改看板' });
    adminHistory.forEach(renderMsg);
    sub.textContent = '江江專用';
    scrollBottom();
  }
  function adminSend(text) {
    adminHistory.push({ role: 'user', text: text });
    renderMsg(adminHistory[adminHistory.length - 1]);
    input.value = '';
    scrollBottom();
    busy = true;
    var typing = showTyping();
    fetch(ADMIN_ENDPOINT + 'message', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, history: adminHistory.slice(0, -1).slice(-12) }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        typing.remove(); busy = false;
        if (d && d.expired) { adminHistory.push({ role: 'bot', text: '後台憑證過期了\n要再輸入一次通行密碼' }); renderMsg(adminHistory[adminHistory.length - 1]); setTimeout(function () { setAdmin(false); openGate(); }, 900); return; }
        var meta = d && d.meta ? '\n\n（' + d.meta.model.replace('claude-', '') + '｜輸入 ' + d.meta.inTok + '／輸出 ' + d.meta.outTok + ' token｜約 ' + d.meta.usd.toFixed(4) + ' 美元）' : '';
        var m = { role: 'bot', text: ((d && d.reply) || '後台這邊怪怪的 等一下再試') + meta };
        refreshAdminInfo();
        adminHistory.push(m); renderMsg(m); scrollBottom();
        ((d && d.pending) || []).forEach(renderPending);
      })
      .catch(function () { typing.remove(); busy = false; var m = { role: 'bot', text: '連不到後台 等一下再試' }; adminHistory.push(m); renderMsg(m); });
  }
  function openGate() {
    // 憑證還在（30 分鐘內）就直接進後台，不用再輸入
    fetch(ADMIN_ENDPOINT + 'session', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) setAdmin(true); else showGate('entry'); })
      .catch(function () { showGate('entry'); });
  }
  function showGate(kind) {
    kind = kind === 'action' ? 'action' : 'entry';
    var old = root.querySelector('.dcw-gate'); if (old) old.remove();
    var g = document.createElement('div');
    g.className = 'dcw-gate';
    g.setAttribute('role', 'dialog');
    g.setAttribute('aria-label', '通行密碼');
    g.innerHTML = '<form class="dcw-gate-card" autocomplete="off"><h3>' + (kind === 'action' ? '操作驗證' : '我是江江') + '</h3><p>' + (kind === 'action' ? '請輸入操作密碼（一天一次）' : '請輸入登入密碼（一天一次）') + '</p>' +
      '<div class="dcw-gate-field"><input class="dcw-gate-input" type="text" name="dcw-gate" aria-label="通行密碼" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="200" />' +
      '<span class="dcw-gate-mask" aria-hidden="true">輸入的字不會顯示</span></div>' +
      '<div class="dcw-gate-msg" aria-live="polite"></div>' +
      '<div class="dcw-gate-btns"><button class="dcw-gate-no" type="button">取消</button><button class="dcw-gate-ok" type="submit">進入</button></div></form>';
    root.querySelector('.dcw-panel').appendChild(g);
    var f = g.querySelector('form'), pi = g.querySelector('.dcw-gate-input'), msg = g.querySelector('.dcw-gate-msg');
    pi.focus();
    g.querySelector('.dcw-gate-no').addEventListener('click', function () { g.remove(); input.focus(); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var pass = pi.value; pi.value = '';
      if (!pass) return;
      msg.style.color = '#6b7680'; msg.textContent = '確認中…';
      fetch(ADMIN_ENDPOINT + (kind === 'action' ? 'verify-action' : 'login'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: pass }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          msg.style.color = '#c0392b';
          if (d && d.ok) { g.remove(); if (kind === 'action') refreshAdminInfo(); else setAdmin(true); input.focus(); }
          else if (d && d.expired) { g.remove(); setAdmin(false); showGate('entry'); }
          else if (d && d.locked) msg.textContent = '錯太多次了 ' + Math.ceil((d.retryAfterSec || 900) / 60) + ' 分鐘後再試';
          else if (d && d.error === 'closed') msg.textContent = '後台入口還沒開放';
          else msg.textContent = '密碼不對' + (d && d.left ? ' 還可以試 ' + d.left + ' 次' : '');
          pi.focus();
        })
        .catch(function () { msg.textContent = '連線失敗 等一下再試'; });
    });
  }

  var panelEl = root.querySelector('.dcw-panel');
  function setOpen(open) {
    root.classList.toggle('dcw-open', open);
    /* 收起時整個面板不可聚焦，避免 Tab 跳進隱藏的輸入框誤送訊息 */
    panelEl.inert = !open;
    panelEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) {}
    if (open) { renderAll(); setTimeout(scrollBottom, 240); }
  }

  /* 視窗大小：電腦 m／l 兩段、手機 s／l 兩段；l＝幾乎鋪滿整個瀏覽器 */
  var SIZE_LABEL = { s: '放大', m: '放大', l: '縮回' };
  function isPhone() {
    try { return window.matchMedia('(max-width: 520px)').matches; } catch (e) { return false; }
  }
  function sizeSteps() { return isPhone() ? ['s', 'l'] : ['m', 'l']; }
  /* 目前尺寸以記憶體為準，localStorage 只拿來跨頁還原（寫不進去時也還能放大縮回） */
  var curSize = null;
  function getSize() {
    var steps = sizeSteps();
    if (steps.indexOf(curSize) >= 0) return curSize;
    try { var v = localStorage.getItem(SIZE_KEY); return steps.indexOf(v) >= 0 ? v : steps[0]; } catch (e) { return steps[0]; }
  }
  function applySize(sz) {
    curSize = sz;
    ['s', 'm', 'l'].forEach(function (x) { root.classList.remove('dcw-size-' + x); });
    root.classList.add('dcw-size-' + sz);
    try { localStorage.setItem(SIZE_KEY, sz); } catch (e) {}
    root.querySelector('.dcw-size').title = SIZE_LABEL[sz];
  }
  applySize(getSize());
  root.querySelector('.dcw-size').addEventListener('click', function () {
    var steps = sizeSteps();
    var i = steps.indexOf(getSize());
    applySize(steps[(i + 1) % steps.length]);
    scrollBottom();
  });

  launcher.addEventListener('click', function () { setOpen(true); input.focus(); });
  root.querySelector('.dcw-close').addEventListener('click', function () { setOpen(false); });
  /* 重置＝回到剛進網頁的狀態：清空對話、回到開場白與快捷鈕 */
  root.querySelector('.dcw-clear').addEventListener('click', function () {
    if (adminMode) { adminHistory = []; renderAdmin(); input.focus(); return; }
    gen += 1;
    history = [];
    saveHistory(history);
    busy = false;
    input.value = '';
    showLimit(0);
    renderAll();
    input.focus();
  });
  root.querySelector('.dcw-send').addEventListener('click', function () { send(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.isComposing) send(input.value);
  });

  renderAll();
  panelEl.inert = true;
  panelEl.setAttribute('aria-hidden', 'true');
  var wasOpen = false;
  try { wasOpen = localStorage.getItem(OPEN_KEY) === '1'; } catch (e) {}
  if (window.__dcwOpenOnLoad) {  // 從延遲載入器的按鈕進來：直接打開
    setOpen(true);
    input.focus();
  } else if (wasOpen) {
    var panel = root.querySelector('.dcw-panel');
    panel.style.transition = 'none';
    setOpen(true);
    setTimeout(function () { panel.style.transition = ''; }, 80);
  }
})();
