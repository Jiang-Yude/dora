/* 拍立得小卡點開放大：整張卡（膠帶、標題、歪歪的角度）一起放大，不是只放大圖片（江江 2026-10-14）
   sync-guard:allow（遠端領先只有 media/，與 site/ 無重疊） */
(function(){
  if(/[?&]tune=/.test(location.search)) return;
  var SEL='#diary .clip, #about .job, .jobs .job';
  var box=null;
  function close(){if(!box)return;box.classList.remove('on');var b=box;setTimeout(function(){b.remove()},220);box=null;document.removeEventListener('keydown',esc)}
  function esc(e){if(e.key==='Escape')close()}
  function open(card){
    close();
    box=document.createElement('div');box.className='pz';box.setAttribute('role','dialog');box.setAttribute('aria-label','放大的卡片');
    var c=card.cloneNode(true);c.removeAttribute('style');c.classList.add('pz-card');
    c.querySelectorAll('a').forEach(function(a){a.removeAttribute('href')});
    var r=(Math.random()*3+1)*(Math.random()<.5?-1:1);c.style.setProperty('--pz-r',r.toFixed(1)+'deg');
    var x=document.createElement('button');x.className='pz-x';x.type='button';x.setAttribute('aria-label','關閉');x.textContent='×';
    box.appendChild(c);box.appendChild(x);document.body.appendChild(box);
    requestAnimationFrame(function(){box.classList.add('on')});
    box.addEventListener('click',close);document.addEventListener('keydown',esc);x.focus();
  }
  document.addEventListener('click',function(e){var card=e.target.closest(SEL);if(!card||card.closest('.pz'))return;e.preventDefault();open(card)});
  document.querySelectorAll(SEL).forEach(function(c){c.style.cursor='zoom-in';c.setAttribute('tabindex','0');c.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open(c)}})});
})();
