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
  var CHIPS = ['認識朵拉', '朵拉日報在講什麼？', '看看江江在做什麼', '想找江江本人'];
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
      b.addEventListener('click', function () { send(q); });
      chipsBox.appendChild(b);
    });
  }

  /* 副標顯示最近一則訊息（規格），沒有對話時顯示身分 */
  function updateSub() {
    var last = history[history.length - 1];
    sub.textContent = last ? String(last.text).replace(/\s+/g, ' ').slice(0, 40) : DEFAULT_SUB;
  }

  function renderAll() {
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
