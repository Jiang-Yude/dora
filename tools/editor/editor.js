/* 朵拉排版編輯器：注入在網站頁面（iframe 裡）的編輯程式。
   只在本機編輯器伺服器 dora-editor.py 的 ?edit=1&frame=1 回應裡出現，原始 HTML 不含這支。
   （sync-guard:allow：遠端領先的 commit 只動 media/） */
(function () {
  'use strict';
  var CFG = window.__DE_CFG || {};
  var WIDTH = Math.round(+new URLSearchParams(location.search).get('w') || window.innerWidth);  // 這次預覽的寬度：存檔就存成這個寬度的錨點
  function shell() { try { return parent !== window ? parent.DoraShell : null; } catch (e) { return null; } }
  var MARK_NAME = { 'dora-nav': '導覽列', 'dora-latest': '首頁日報清單', 'dora-pager': '日報翻頁', 'dora-og': '分享預覽' };

  // ---------- 介面 ----------
  var ui = document.createElement('div');
  ui.id = 'de-ui'; ui.setAttribute('data-de-ui', '');
  ui.innerHTML = '<div id="de-glass"></div>' +
    '<svg id="de-svg" xmlns="http://www.w3.org/2000/svg"><polygon id="de-hover" points=""/><polygon id="de-sel" points=""/><line id="de-rotline"/></svg>' +
    '<div class="de-h" data-h="nw"></div><div class="de-h" data-h="ne"></div><div class="de-h" data-h="se"></div><div class="de-h" data-h="sw"></div>' +
    '<div class="de-h de-rot" data-h="rot" title="拖曳旋轉（按住 Shift 每 15 度）"></div><div id="de-tip"></div>';
  document.documentElement.appendChild(ui);
  var glass = ui.querySelector('#de-glass');
  var hoverPoly = ui.querySelector('#de-hover'), selPoly = ui.querySelector('#de-sel'), rotLine = ui.querySelector('#de-rotline');
  var tip = ui.querySelector('#de-tip');
  var H = {}; ui.querySelectorAll('.de-h').forEach(function (h) { H[h.dataset.h] = h; });

  // ---------- 小工具 ----------
  function rd(v, n) { var p = Math.pow(10, n); return Math.round(v * p) / p; }
  function eqv(a, b) { return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.r - b.r) < 0.01 && Math.abs(a.s - b.s) < 0.0005; }
  function cp(v) { return { x: v.x, y: v.y, r: v.r, s: v.s }; }
  function decompose(m) {
    if (!m || m === 'none') return { x: 0, y: 0, r: 0, s: 1 };
    var M = new DOMMatrix(m);
    return { x: rd(M.e, 1), y: rd(M.f, 1), r: rd(Math.atan2(M.b, M.a) * 180 / Math.PI, 2), s: rd(Math.hypot(M.a, M.b), 3) };
  }
  function ovrSheet() {
    var l = document.querySelector('link[href^="/edit-overrides.css"]');
    return l && l.sheet ? l.sheet : null;
  }
  function isUI(el) { return !!(el && el.closest && el.closest('[data-de-ui]')); }
  function outerSvg(el) {
    if (!(el instanceof SVGElement)) return el;
    var s = el.closest('svg');
    while (s && s.parentElement && s.parentElement.closest('svg')) s = s.parentElement.closest('svg');
    return s || el;
  }
  function selectable(el) {
    return el && el.nodeType === 1 && el !== document.body && el !== document.documentElement && !isUI(el) &&
      document.body.contains(el) && !/^(script|style|link|meta|head|title|br)$/i.test(el.localName);
  }
  function hitStack(x, y) {
    document.documentElement.classList.add('de-hit');
    var arr = document.elementsFromPoint(x, y);
    document.documentElement.classList.remove('de-hit');
    return arr.filter(function (el) {
      if (!selectable(el)) return false;
      var cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;
    });
  }
  function hit(x, y) { var s = hitStack(x, y); return s.length ? outerSvg(s[0]) : null; }
  function label(el) {
    var n = el.localName, cls = Array.prototype.slice.call(el.classList || []).filter(okClass);
    var s = n + (el.id ? '#' + el.id : '') + (cls.length ? '.' + cls.slice(0, 2).join('.') : '');
    var hint = el.getAttribute('alt') || el.getAttribute('aria-label') || (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (hint) s += '「' + (hint.length > 14 ? hint.slice(0, 14) + '…' : hint) + '」';
    return s;
  }
  function okClass(c) { return c && !/^(on|sel|active|open|de-.*|pz.*)$/.test(c); }
  function genRegion(el) {
    if (CFG.generatedPage) return '日報目錄（整頁自動產生）';
    var it = document.createNodeIterator(document.body, NodeFilter.SHOW_COMMENT), n, open = {};
    while ((n = it.nextNode())) {
      var m = n.data.trim();
      (CFG.markers || []).forEach(function (k) {
        if (m === k) open[k] = n;
        else if (m === '/' + k && open[k]) {
          if ((open[k].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) open.hit = k;
          open[k] = null;
        }
      });
      if (open.hit) return MARK_NAME[open.hit] + '（自動產生）';
    }
    return null;
  }

  // 穩定選擇器：優先 id，其次 class 組合＋:nth-of-type，往上加父層直到全頁唯一
  function step(el) {
    var tag = el.localName, cls = Array.prototype.slice.call(el.classList || []).filter(okClass).slice(0, 3);
    var s = CSS.escape(tag) + cls.map(function (c) { return '.' + CSS.escape(c); }).join('');
    var p = el.parentElement;
    if (p) {
      var same = Array.prototype.filter.call(p.children, function (c) { return c.localName === tag; });
      var match = same.filter(function (c) { return c.matches(s); });
      if (match.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
    }
    return s;
  }
  function uniq(sel, el) { try { var a = document.querySelectorAll(sel); return a.length === 1 && a[0] === el; } catch (e) { return false; } }
  // 一段選擇器有沒有「錨點」：有 id 或 class，不是只有標籤名＋第幾個
  function anchored(part) { return /[#.]/.test(part.replace(/:nth-of-type\(\d+\)/g, '')); }
  // 產生的選擇器要同時做到：整頁只命中這 1 個元素；最左邊那段有 id 或 class；
  // 元素自己沒有 id／class 時，至少要往上帶兩層父層（例如 div.about > div:nth-of-type(1) > p.lines > span），
  // 免得像 span:nth-of-type(3) 這種「現在剛好唯一」的寫法，網頁內容一變就套到別的元素。
  function strongEnough(parts) {
    var head = parts[0];
    if (head.charAt(0) === '#') return true;
    if (!anchored(head)) return false;
    return anchored(parts[parts.length - 1]) || parts.length >= 3;
  }
  function cssSel(el) {
    if (el.id && uniq('#' + CSS.escape(el.id), el)) return '#' + CSS.escape(el.id);
    var parts = [], cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur !== el && cur.id && uniq('#' + CSS.escape(cur.id), cur)) { parts.unshift('#' + CSS.escape(cur.id)); }
      else parts.unshift(step(cur));
      var sel = parts.join(' > ');
      if (uniq(sel, el) && strongEnough(parts)) return sel;
      if (parts[0].charAt(0) === '#') break;
      cur = cur.parentElement;
    }
    var full = parts[0].charAt(0) === '#' ? parts.join(' > ') : 'body > ' + parts.join(' > ');
    return uniq(full, el) ? full : null;
  }

  // ---------- 這一頁的錨點（伺服器 /__anchors，正本 tools/editor/anchors.json） ----------
  var RULES = [], RULE_WARN = [];   // RULES：[{sel, ib, anchors:[{w,x,y,r,s}]}]
  function loadRules() {
    return fetch('/__anchors?ep=' + encodeURIComponent(CFG.ep) + '&t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (list) {
      RULES = list || [];
      checkRules();
    }).catch(function () { });
  }
  function checkRules() {
    RULE_WARN = [];
    RULES.forEach(function (r) {
      var n = -1; try { n = document.querySelectorAll(r.sel).length; } catch (e) { }
      if (n === 1) return;
      RULE_WARN.push(r.sel + (n < 0 ? '（寫法錯誤）' : n === 0 ? '（這頁找不到這個元素）' : '（命中 ' + n + ' 個元素，不唯一）'));
    });
    notify();
  }
  function ruleMatches(r, el) { try { var a = document.querySelectorAll(r.sel); return a.length === 1 && a[0] === el; } catch (e) { return false; } }
  // 這個元素的錨點：選擇器完全一樣的優先，其次是別的寫法但剛好唯一命中它的
  function ruleFor(el) {
    var s = cssSel(el), hitR = null;
    RULES.forEach(function (r) { if (r.sel === s) hitR = r; });
    if (hitR) return hitR;
    RULES.forEach(function (r) { if (!hitR && ruleMatches(r, el)) hitR = r; });
    return hitR;
  }
  // 存檔時：同一個元素以前用別的選擇器存過錨點，請伺服器搬到新選擇器底下（不會重複疊兩條）
  function oldRulesFor(el, newSel) {
    return RULES.filter(function (r) { return r.sel !== newSel && ruleMatches(r, el); }).map(function (r) { return r.sel; });
  }
  function anchorsHere() { return RULES.filter(function (r) { return r.anchors.some(function (a) { return a.w === WIDTH; }); }).length; }

  function domPath(el) {
    var out = [], cur = el;
    while (cur && cur !== document.body) {
      var p = cur.parentElement; if (!p) return null;
      out.unshift([cur.localName, Array.prototype.indexOf.call(p.children, cur)]);
      cur = p;
    }
    return cur === document.body ? out : null;
  }

  // ---------- 元素狀態 ----------
  var S = new Map();     // el -> {el, orig, base, saved, cur, needIb}
  var T = new Map();     // el -> {path, old, label}  改過字的元素
  function rec(el) {
    var d = S.get(el); if (d) return d;
    var orig = el.getAttribute('style');
    el.style.setProperty('transition', 'none', 'important');
    var cs = getComputedStyle(el);
    var cur = decompose(cs.transform), disp = cs.display;
    var sh = ovrSheet();
    if (sh) sh.disabled = true;
    var cs2 = getComputedStyle(el), base = decompose(cs2.transform), baseDisp = cs2.display;
    if (sh) sh.disabled = false;
    getComputedStyle(el).transform;
    d = { el: el, orig: orig, base: base, saved: cp(cur), cur: cp(cur), needIb: baseDisp === 'inline' };
    S.set(el, d);
    apply(d);
    return d;
  }
  function apply(d) {
    var st = d.el.style, v = d.cur;
    st.setProperty('transition', 'none', 'important');
    st.setProperty('transform', 'translate(' + v.x + 'px,' + v.y + 'px) rotate(' + v.r + 'deg) scale(' + v.s + ')', 'important');
    if (d.needIb && !eqv(v, d.base)) st.setProperty('display', 'inline-block', 'important');
    else st.removeProperty('display');
  }
  function layoutBox(d) {
    var st = d.el.style, t = st.getPropertyValue('transform');
    st.setProperty('transform', 'none', 'important');
    var r = d.el.getBoundingClientRect();
    var o = getComputedStyle(d.el).transformOrigin.split(' ').map(parseFloat);
    st.setProperty('transform', t, 'important');
    return { l: r.left, t: r.top, w: r.width, h: r.height, ox: o[0] || 0, oy: o[1] || 0 };
  }
  function quad(d) {
    var b = layoutBox(d), v = d.cur, O = { x: b.l + b.ox, y: b.t + b.oy };
    var a = v.r * Math.PI / 180, c = Math.cos(a) * v.s, s = Math.sin(a) * v.s;
    function f(px, py) { var dx = px - O.x, dy = py - O.y; return { x: O.x + v.x + c * dx - s * dy, y: O.y + v.y + s * dx + c * dy }; }
    var top = f(b.l + b.w / 2, b.t), k = zoomK();
    return {
      pts: [f(b.l, b.t), f(b.l + b.w, b.t), f(b.l + b.w, b.t + b.h), f(b.l, b.t + b.h)],
      pivot: { x: O.x + v.x, y: O.y + v.y }, top: top,
      rot: { x: top.x + Math.sin(a) * 28 * k, y: top.y - Math.cos(a) * 28 * k }
    };
  }
  function inPoly(p, pts) {
    var ins = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if (((pts[i].y > p.y) !== (pts[j].y > p.y)) && (p.x < (pts[j].x - pts[i].x) * (p.y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x)) ins = !ins;
    }
    return ins;
  }
  function ptsAttr(pts) { return pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' '); }

  // ---------- 畫框 ----------
  var sel = null, hov = null, zoom = 1;
  function zoomK() { return 1 / (zoom || 1); }
  function draw() {
    if (hov && hov !== sel && document.body.contains(hov)) {
      var r = hov.getBoundingClientRect();
      hoverPoly.setAttribute('points', ptsAttr([{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }]));
    } else hoverPoly.setAttribute('points', '');
    if (sel && document.body.contains(sel)) {
      var q = quad(rec(sel));
      selPoly.setAttribute('points', ptsAttr(q.pts));
      selPoly.classList.toggle('gen', !!genRegion(sel));
      ['nw', 'ne', 'se', 'sw'].forEach(function (k, i) { H[k].style.left = q.pts[i].x + 'px'; H[k].style.top = q.pts[i].y + 'px'; });
      H.rot.style.left = q.rot.x + 'px'; H.rot.style.top = q.rot.y + 'px';
      rotLine.setAttribute('x1', q.top.x); rotLine.setAttribute('y1', q.top.y); rotLine.setAttribute('x2', q.rot.x); rotLine.setAttribute('y2', q.rot.y);
      ui.classList.add('has-sel');
    } else {
      selPoly.setAttribute('points', ''); rotLine.setAttribute('x1', 0); rotLine.setAttribute('x2', 0); rotLine.setAttribute('y1', 0); rotLine.setAttribute('y2', 0);
      ui.classList.remove('has-sel');
    }
  }
  var raf = 0;
  function redraw() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; draw(); }); }
  window.addEventListener('scroll', redraw, true);
  window.addEventListener('resize', redraw);

  // ---------- 復原／重做 ----------
  var undoS = [], redoS = [];
  function push(cmd) { undoS.push(cmd); redoS.length = 0; notify(); }
  function run(cmd, dir) {
    if (cmd.t === 'tf') { var d = rec(cmd.el); d.cur = cp(dir === 'undo' ? cmd.a : cmd.b); apply(d); }
    else if (cmd.t === 'txt') { cmd.el.innerHTML = dir === 'undo' ? cmd.a : cmd.b; }
    if (document.body.contains(cmd.el)) sel = cmd.el;
    draw(); notify();
  }
  function undo() { if (editing) return; var c = undoS.pop(); if (c) { run(c, 'undo'); redoS.push(c); notify(); } }
  function redo() { if (editing) return; var c = redoS.pop(); if (c) { run(c, 'redo'); undoS.push(c); notify(); } }
  function change(el, fn, tag) {
    var d = rec(el), a = cp(d.cur);
    fn(d.cur);
    d.cur.x = rd(d.cur.x, 1); d.cur.y = rd(d.cur.y, 1); d.cur.r = rd(d.cur.r, 2); d.cur.s = rd(Math.max(0.05, d.cur.s), 3);
    apply(d); draw();
    var last = undoS[undoS.length - 1];
    if (tag && last && last.tag === tag && last.el === el && Date.now() - last.time < 1200) { last.b = cp(d.cur); last.time = Date.now(); redoS.length = 0; notify(); return; }
    if (!eqv(a, d.cur)) push({ t: 'tf', el: el, a: a, b: cp(d.cur), tag: tag, time: Date.now() });
  }

  // ---------- 改字時的乾淨 HTML（去掉編輯器自己加的 style） ----------
  function clean(el) {
    var c = el.cloneNode(true), os = el.querySelectorAll('*'), cs = c.querySelectorAll('*');
    for (var i = 0; i < os.length; i++) {
      var d = S.get(os[i]);
      if (d) { if (d.orig == null) cs[i].removeAttribute('style'); else cs[i].setAttribute('style', d.orig); }
      cs[i].removeAttribute('data-de-editing'); cs[i].removeAttribute('contenteditable');
    }
    return c.innerHTML;
  }
  function dirtyList() {
    var tfs = [], txts = [];
    S.forEach(function (d) { if (document.body.contains(d.el) && !eqv(d.cur, d.saved)) tfs.push(d); });
    T.forEach(function (t, el) { if (document.body.contains(el) && clean(el) !== t.old) txts.push(el); });
    return { tfs: tfs, txts: txts };
  }

  // ---------- 通知外框 ----------
  function notify() {
    var sh = shell(); if (!sh || !sh.update) return;
    var dl = dirtyList(), info = null;
    if (sel && document.body.contains(sel)) {
      var d = rec(sel), g = genRegion(sel);
      var rr = ruleFor(sel);
      info = { name: label(sel), selector: cssSel(sel) || '（找不到唯一選擇器，這個元素存不了）', x: d.cur.x, y: d.cur.y, r: d.cur.r, s: d.cur.s,
        base: d.base, gen: g, changed: !eqv(d.cur, d.base), anchors: rr ? rr.anchors : [], anchorSel: rr ? rr.sel : null };
    }
    sh.update({ ruleWarn: RULE_WARN, sel: info, width: WIDTH, anchorsHere: anchorsHere(), anchorElems: RULES.length, dirty: dl.tfs.length + dl.txts.length, canUndo: undoS.length > 0, canRedo: redoS.length > 0, editing: !!editing });
  }
  function toast(msg, kind) { var sh = shell(); if (sh && sh.toast) sh.toast(msg, kind); else console.log(msg); }

  // ---------- 選取、拖曳、縮放、旋轉 ----------
  function select(el) { sel = el || null; if (sel) rec(sel); draw(); notify(); }
  var drag = null;
  glass.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || editing) return;
    e.preventDefault();
    var p = { x: e.clientX, y: e.clientY }, target = null;
    if (e.altKey) {
      var h = hit(p.x, p.y);
      target = (sel && h && sel.contains(h)) ? sel.parentElement : (h && h.parentElement);
      if (!selectable(target)) target = h;
      select(target); return;
    }
    if (sel && document.body.contains(sel) && inPoly(p, quad(rec(sel)).pts)) target = sel;
    else target = hit(p.x, p.y);
    if (!target) { select(null); return; }
    if (target !== sel) select(target);
    glass.setPointerCapture(e.pointerId);
    drag = { mode: 'move', p: p, a: cp(rec(sel).cur), moved: false };
  });
  glass.addEventListener('pointermove', function (e) {
    var p = { x: e.clientX, y: e.clientY };
    if (drag) {
      var dx = p.x - drag.p.x, dy = p.y - drag.p.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      var d = rec(sel); d.cur.x = rd(drag.a.x + dx, 1); d.cur.y = rd(drag.a.y + dy, 1); apply(d); draw(); notify();
      return;
    }
    var h = hit(p.x, p.y);
    if (h !== hov) { hov = h; redraw(); }
    glass.style.cursor = (sel && document.body.contains(sel) && inPoly(p, quad(rec(sel)).pts)) ? 'move' : 'default';
    if (h) { tip.style.display = 'block'; tip.textContent = label(h); tip.style.left = (p.x + 14 * zoomK()) + 'px'; tip.style.top = (p.y + 16 * zoomK()) + 'px'; }
    else tip.style.display = 'none';
  });
  glass.addEventListener('pointerleave', function () { hov = null; tip.style.display = 'none'; redraw(); });
  function endDrag() {
    if (!drag) return;
    var d = rec(sel);
    if (drag.moved && !eqv(drag.a, d.cur)) push({ t: 'tf', el: sel, a: drag.a, b: cp(d.cur), time: Date.now() });
    drag = null; notify();
  }
  glass.addEventListener('pointerup', endDrag);
  glass.addEventListener('pointercancel', endDrag);

  Object.keys(H).forEach(function (k) {
    var h = H[k], st = null;
    h.addEventListener('pointerdown', function (e) {
      if (!sel || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId);
      var d = rec(sel), q = quad(d);
      st = { a: cp(d.cur), pv: q.pivot, d0: Math.hypot(e.clientX - q.pivot.x, e.clientY - q.pivot.y) || 1,
        ang0: Math.atan2(e.clientY - q.pivot.y, e.clientX - q.pivot.x) };
    });
    h.addEventListener('pointermove', function (e) {
      if (!st) return;
      var d = rec(sel);
      if (k === 'rot') {
        var ang = Math.atan2(e.clientY - st.pv.y, e.clientX - st.pv.x);
        var r = st.a.r + (ang - st.ang0) * 180 / Math.PI;
        if (e.shiftKey) r = Math.round(r / 15) * 15;
        d.cur.r = rd(((r + 540) % 360) - 180, 1);
      } else {
        var s = st.a.s * Math.hypot(e.clientX - st.pv.x, e.clientY - st.pv.y) / st.d0;
        d.cur.s = rd(Math.max(0.05, s), e.shiftKey ? 1 : 2);
      }
      apply(d); draw(); notify();
    });
    function up() {
      if (!st) return;
      var d = rec(sel);
      if (!eqv(st.a, d.cur)) push({ t: 'tf', el: sel, a: st.a, b: cp(d.cur), time: Date.now() });
      st = null; notify();
    }
    h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });

  // ---------- 改字 ----------
  var editing = null;
  function hasOwnText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.data.trim()) return true;
    return false;
  }
  glass.addEventListener('dblclick', function (e) {
    e.preventDefault();
    var stack = hitStack(e.clientX, e.clientY), el = null;
    for (var i = 0; i < stack.length; i++) { if (!(stack[i] instanceof SVGElement) && hasOwnText(stack[i])) { el = stack[i]; break; } }
    if (!el) { toast('這裡沒有可以改的字（圖片、圖示請用拖曳、縮放、旋轉）', 'warn'); return; }
    var g = genRegion(el);
    if (g) { select(el); toast('「' + g + '」是自動產生的：改字會被下次重生蓋掉，所以不能在這裡改字。位置、大小、旋轉可以調。', 'warn'); return; }
    var path = domPath(el), old = T.has(el) ? T.get(el).old : clean(el);
    if (!path) { toast('找不到這段字在網頁裡的位置', 'err'); return; }
    var x = e.clientX, y = e.clientY;
    fetch('/__probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: CFG.file, path: path, old: old }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) { select(el); toast(res.error || '這段字不能改', res.generated ? 'warn' : 'err'); return; }
        if (!T.has(el)) T.set(el, { path: path, old: old, label: label(el) });
        startEdit(el, x, y);
      })
      .catch(function (err) { toast('問伺服器失敗：' + err, 'err'); });
  });
  function startEdit(el, x, y) {
    select(el);
    editing = { el: el, before: el.innerHTML };
    el.setAttribute('contenteditable', 'true'); el.setAttribute('data-de-editing', '');
    ui.classList.add('editing');
    el.focus({ preventScroll: true });
    try {
      var r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
      if (r && el.contains(r.startContainer)) { var s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    } catch (e) { }
    tip.style.display = 'none';
    notify();
    toast('改字中：Enter 完成、Shift+Enter 換行、Esc 取消', 'info');
  }
  function finishEdit(commit) {
    if (!editing) return;
    var ed = editing; editing = null;
    if (!commit) ed.el.innerHTML = ed.before;
    ed.el.removeAttribute('contenteditable'); ed.el.removeAttribute('data-de-editing');
    ui.classList.remove('editing');
    getSelection().removeAllRanges();
    if (commit && ed.el.innerHTML !== ed.before) push({ t: 'txt', el: ed.el, a: ed.before, b: ed.el.innerHTML, time: Date.now() });
    draw(); notify();
  }
  document.addEventListener('keydown', function (e) {
    if (editing) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); finishEdit(true); }
      else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); }
      else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
      return;
    }
    keys(e);
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (editing && !editing.el.contains(e.target) && !isUI(e.target)) { e.preventDefault(); e.stopPropagation(); finishEdit(true); }
  }, true);
  // 編輯模式下網頁本身的連結、按鈕、表單都不作用
  document.addEventListener('click', function (e) { e.preventDefault(); if (!editing || !editing.el.contains(e.target)) e.stopPropagation(); }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
  document.addEventListener('paste', function (e) {   // 貼上只貼純文字，免得把別處的格式帶進原始檔
    if (!editing) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
  }, true);

  // ---------- 鍵盤 ----------
  function keys(e) {
    var mod = e.metaKey || e.ctrlKey, k = e.key;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (mod && (k === 's' || k === 'S')) { e.preventDefault(); var sh = shell(); if (sh && sh.save) sh.save(); return; }
    if (k === 'Escape') { select(null); return; }
    if (sel && /^Arrow/.test(k)) {
      e.preventDefault();
      var n = e.shiftKey ? 10 : 1;
      nudge(k === 'ArrowLeft' ? -n : k === 'ArrowRight' ? n : 0, k === 'ArrowUp' ? -n : k === 'ArrowDown' ? n : 0);
    }
  }
  function nudge(dx, dy) { if (sel) change(sel, function (v) { v.x += dx; v.y += dy; }, 'nudge'); }

  // ---------- 存檔 ----------
  function save() {
    if (editing) finishEdit(true);
    var dl = dirtyList(), transforms = [], texts = [], bad = [];
    dl.tfs.forEach(function (d) {
      var s = cssSel(d.el);
      if (!s) { bad.push(label(d.el)); return; }
      transforms.push({ selector: s, x: d.cur.x, y: d.cur.y, r: d.cur.r, s: d.cur.s, ib: d.needIb && !eqv(d.cur, d.base),
        isBase: eqv(d.cur, d.base), renameFrom: oldRulesFor(d.el, s) });
    });
    dl.txts.forEach(function (el) { var t = T.get(el); texts.push({ path: t.path, old: t.old, new: clean(el), label: t.label }); });
    if (bad.length) return Promise.resolve({ ok: false, error: '這些元素找不到唯一選擇器，存不了：' + bad.join('、') });
    if (!transforms.length && !texts.length) return Promise.resolve({ ok: true, written: [], note: '沒有變更' });
    return fetch('/__save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: CFG.file, width: WIDTH, transforms: transforms, texts: texts }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          dl.tfs.forEach(function (d) { d.saved = cp(d.cur); });
          dl.txts.forEach(function (el) { T.get(el).old = clean(el); });
          notify();
        }
        return res;
      });
  }

  // ---------- 給外框呼叫 ----------
  window.DoraEditor = {
    undo: undo, redo: redo, save: save, nudge: nudge,
    selectParent: function () { if (sel && selectable(sel.parentElement)) select(sel.parentElement); else toast('已經是最外層了', 'warn'); },
    resetSel: function () { if (!sel) return; var d = rec(sel); change(sel, function (v) { v.x = d.base.x; v.y = d.base.y; v.r = d.base.r; v.s = d.base.s; }); notify(); },
    setVals: function (v) { if (!sel) return; change(sel, function (c) { ['x', 'y', 'r', 's'].forEach(function (k) { if (typeof v[k] === 'number' && isFinite(v[k])) c[k] = v[k]; }); }); notify(); },
    deselect: function () { select(null); },
    dirty: function () { var d = dirtyList(); return d.tfs.length + d.txts.length; },
    setZoom: function (z) { zoom = z || 1; ui.style.setProperty('--de-k', String(1 / zoom)); document.documentElement.style.setProperty('--de-k', String(1 / zoom)); draw(); },
    keys: keys,
    deleteAnchor: function (w) {
      var r = sel && ruleFor(sel);
      if (!r) return Promise.resolve({ ok: false, error: '這個元素沒有錨點' });
      return fetch('/__anchor_delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: CFG.file, selector: r.sel, width: w }) }).then(function (x) { return x.json(); });
    },
    cfg: CFG, width: WIDTH
  };

  // 存檔後重新載入時回到原本捲動位置
  try {
    var y = sessionStorage.getItem('de-scroll');
    if (y) {
      sessionStorage.removeItem('de-scroll');
      var go = function () { window.scrollTo({ top: +y, behavior: 'instant' }); redraw(); };
      go(); window.addEventListener('load', function () { go(); setTimeout(go, 300); });
    }
  } catch (e) { }
  loadRules();
  var sh0 = shell(); if (sh0 && sh0.frameReady) sh0.frameReady(window.DoraEditor);
  notify();
})();
