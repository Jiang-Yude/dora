// 往下滑時一張一張貼上去（江江 2026-10-14 晚要的）
// 照片、便條紙：從上面輕輕壓下來貼住；手繪線條、塗鴉：像鉛筆從左畫到右；工作卡、日記卡：一個接一個出現。
// 只用 opacity、scale、translate、mask，不碰 transform，排版編輯器存的位置（edit-overrides.css）不受影響。
(function(){
  if (/[?&]edit=1/.test(location.search)) return;               // 排版編輯器裡不播
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var css =
    '.ss-stick{opacity:0;scale:1.12;translate:0 -18px;transition:opacity .45s ease,scale .55s cubic-bezier(.3,1.6,.5,1),translate .55s cubic-bezier(.3,1.4,.5,1),transform .22s ease,box-shadow .22s ease}' +
    '.ss-stick.ss-in{opacity:1;scale:1;translate:0 0}' +
    // 線條用遮罩從左往右擦開（不用 clip-path：會讓 IntersectionObserver 以為它看不見）
    '.ss-draw{-webkit-mask-image:linear-gradient(90deg,#000 46%,transparent 54%);mask-image:linear-gradient(90deg,#000 46%,transparent 54%);-webkit-mask-size:220% 100%;mask-size:220% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:100% 0;mask-position:100% 0;transition:-webkit-mask-position 1.1s cubic-bezier(.5,.1,.3,1),mask-position 1.1s cubic-bezier(.5,.1,.3,1)}' +
    '.ss-draw.ss-in{-webkit-mask-position:0 0;mask-position:0 0}' +
    '.ss-rise{opacity:0;translate:0 26px;transition:opacity .5s ease,translate .6s cubic-bezier(.2,.8,.3,1),transform .22s ease,box-shadow .22s ease}' +
    '.ss-rise.ss-in{opacity:1;translate:0 0}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var groups = [
    ['ss-stick', '.sy-sticky, .pola, .smalls figure, .more, .illust'],
    ['ss-draw',  '.sy-arrow, .up-arrow, .leaf, .sy-doodle, .pencil-check, .sy-hand'],
    ['ss-rise',  '.jobs > *, .promise-row > *, .smalls > *']
  ];
  var seen = new Set(), list = [];
  groups.forEach(function(g){
    document.querySelectorAll(g[1]).forEach(function(el){
      if (seen.has(el) || el.closest('.sy-hero-in')) return;      // 首屏 Hero 不動，一打開就看得到
      seen.add(el); el.classList.add(g[0]); list.push(el);
    });
  });

  // 同一批進畫面的，照順序一個接一個（每個晚 0.14 秒）
  var io = new IntersectionObserver(function(ents){
    var n = 0;
    ents.forEach(function(e){
      if (!e.isIntersecting) return;
      var el = e.target; io.unobserve(el);
      el.style.transitionDelay = (n++ * 0.14) + 's';
      el.classList.add('ss-in');
      setTimeout(function(){ el.style.transitionDelay = ''; }, 2500);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
  list.forEach(function(el){ io.observe(el); });
})();
