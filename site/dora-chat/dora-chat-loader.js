/* ─── 朵拉小客服：延遲載入器（首屏只放這支，約 2KB） ───
   頁面載完、瀏覽器閒下來才畫出右下角「問問朵拉？」按鈕；按下去才載入對話框的 JS／CSS。
   對話內容由後端 /api/dora-chat 查站內資料，前端不下載知識資料。
   上一頁對話框是開著的（localStorage），才直接載完整版接續，不然首頁不多抓任何東西。 */
(function () {
  'use strict';
  if (window.__dcwLoader || document.getElementById('dcw-root')) return;
  window.__dcwLoader = true;
  var base = (document.currentScript && document.currentScript.src.replace(/[^\/]*$/, '')) || '/dora-chat/';

  function loadFull(open) {
    if (window.__dcwFull) return;
    window.__dcwFull = true;
    window.__dcwOpenOnLoad = !!open;
    var s = document.createElement('script');
    s.src = base + 'dora-chat-widget.js';
    s.onerror = function () { window.__dcwFull = false; };
    document.body.appendChild(s);
  }

  var wasOpen = false;
  try { wasOpen = localStorage.getItem('doraChat.open.v1') === '1'; } catch (e) {}

  function paint() {
    if (wasOpen) { loadFull(false); return; }
    var css =
      '#dcw-lite{position:fixed;right:24px;bottom:24px;z-index:99990;font-family:"Noto Sans TC",system-ui,-apple-system,"PingFang TC",sans-serif}' +
      '#dcw-lite button{position:relative;display:flex;align-items:center;min-height:48px;padding:5px 16px 5px 82px;background:#fffefa;border:1.5px solid #a9c2df;border-radius:999px;box-shadow:0 6px 18px rgba(47,60,69,.14);cursor:pointer;font:inherit;transition:transform .2s ease}' +
      '#dcw-lite button:hover{transform:translateY(-2px)}' +
      '#dcw-lite .a{position:absolute;left:-10px;top:50%;transform:translateY(-50%);width:80px;height:80px;border-radius:50%;border:3px solid #fff;box-shadow:0 4px 14px rgba(47,60,69,.22);background:#eaf1f4 url("' + base + 'dora-face.webp") center/cover no-repeat}' +
      '#dcw-lite .t{font-size:19px;font-weight:600;color:#46545d;white-space:nowrap}' +
      '@media (max-width:520px){#dcw-lite{right:16px;bottom:16px}}';
    var st = document.createElement('style');
    st.id = 'dcw-lite-style';
    st.textContent = css;
    document.head.appendChild(st);
    var root = document.createElement('div');
    root.id = 'dcw-lite';
    root.innerHTML = '<button type="button" aria-label="打開朵拉小客服"><span class="a"></span><span class="t">問問朵拉？</span></button>';
    document.body.appendChild(root);
    var btn = root.querySelector('button');
    btn.addEventListener('click', function () { btn.querySelector('.t').textContent = '朵拉來了…'; loadFull(true); });
    // 滑鼠移上去或手指碰到就先預抓，按下去幾乎不用等
    btn.addEventListener('pointerenter', function () {
      var l = document.createElement('link'); l.rel = 'prefetch'; l.href = base + 'dora-chat-widget.js'; document.head.appendChild(l);
    }, { once: true });
  }

  function whenIdle() {
    if (window.requestIdleCallback) requestIdleCallback(paint, { timeout: 2500 });
    else setTimeout(paint, 300);
  }
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle);
})();
