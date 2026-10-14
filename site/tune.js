/* 版面微調模式：只在本機預覽且網址帶 ?tune=daily 或 ?tune=diary 時啟用，正式站不會執行
   （sync-guard:allow：遠端領先的 commit 只新增 media/，與 site/ 無重疊，commit 前會 pull --rebase） */
(function(){
  var q=new URLSearchParams(location.search), mode=q.get('tune');
  if(!mode||!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  var DEV=q.get('dev')||'';
  var SETS={
    daily:[['日報插圖','#daily .daily > :first-child'],['日報文字','#daily .daily > :nth-child(2)'],['日報 Q 版','#daily .daily .pet'],['手寫註記','#daily .daily-note']],
    diary:[['大張 01','#diary .clip.big'],['小張 02','#diary .clip.s1'],['小張 03','#diary .clip.s2'],['小張 04','#diary .clip.s3'],['完整日記按鈕','#diary .more .sy-btn'],['真實紀錄註記','#diary .real-note'],['日記 Q 版','#diary .diary-top .sprite-box']]
  };
  var list=SETS[mode]; if(!list) return;
  var S={}, sel=null, items=[];
  function css(){var st=document.createElement('style');st.textContent='[data-tune]{cursor:grab;outline:1.5px dashed rgba(95,134,184,.35);outline-offset:3px;touch-action:none}[data-tune].sel{outline:2px solid #5f86b8}[data-tune]:active{cursor:grabbing}';document.head.appendChild(st)}
  function apply(it){var v=S[it.name];it.el.style.transform='translate('+v.dx+'px,'+v.dy+'px) '+it.base+' rotate('+v.r+'deg) scale('+v.s+')'}
  function report(){parent.postMessage({dora:'tune',dev:DEV,mode:mode,state:S,sel:sel&&sel.name},'*')}
  function init(){
    css();
    list.forEach(function(p){var el=document.querySelector(p[1]); if(!el) return;
      var cs=getComputedStyle(el).transform; var it={name:p[0],el:el,base:(cs&&cs!=='none')?cs:''};
      el.setAttribute('data-tune',p[0]); S[p[0]]={dx:0,dy:0,s:1,r:0}; items.push(it);
      el.addEventListener('click',function(e){e.preventDefault();e.stopPropagation()},true);
      var sx,sy,o,on=false;
      el.addEventListener('pointerdown',function(e){e.preventDefault();e.stopPropagation();el.setPointerCapture(e.pointerId);on=true;select(it);sx=e.clientX;sy=e.clientY;o={dx:S[it.name].dx,dy:S[it.name].dy}});
      el.addEventListener('pointermove',function(e){if(!on)return;S[it.name].dx=Math.round(o.dx+e.clientX-sx);S[it.name].dy=Math.round(o.dy+e.clientY-sy);apply(it)});
      el.addEventListener('pointerup',function(){on=false;report()});
    });
    var target=document.getElementById(mode); if(target) window.scrollTo(0,target.getBoundingClientRect().top+scrollY-20);
    report();
  }
  function select(it){items.forEach(function(x){x.el.classList.toggle('sel',x===it)});sel=it;report()}
  window.addEventListener('message',function(e){var d=e.data||{}; if(d.dora!=='tune-cmd') return;
    if(d.cmd==='set'&&sel){var v=S[sel.name]; if('s' in d) v.s=d.s; if('r' in d) v.r=d.r; apply(sel); report()}
    if(d.cmd==='select'){var it=items.find(function(x){return x.name===d.name}); if(it) select(it)}
    if(d.cmd==='reset'&&sel){S[sel.name]={dx:0,dy:0,s:1,r:0}; apply(sel); report()}
    if(d.cmd==='load'&&d.state){Object.keys(d.state).forEach(function(k){if(S[k]){S[k]=d.state[k];var it=items.find(function(x){return x.name===k});if(it)apply(it)}}); report()}
  });
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){setTimeout(init,400)}); else setTimeout(init,400);
})();
