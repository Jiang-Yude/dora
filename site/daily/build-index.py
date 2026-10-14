#!/usr/bin/env python3
"""朵拉日報目錄與導覽產生器。每天日報產出新一期後，跑一次：

    python3 site/daily/build-index.py

做的事（可重複執行，不會重複插入）：
1. 掃 site/daily/YYYY-MM-DD/ 資料夾，產出 site/daily/index.html（最新在上，封面縮圖、日期、標題）；
   每頁 7 期，第 2 頁起是 site/daily/page/N/index.html，底部頁碼列；多出來的舊分頁搬到 ~/.Trash
2. 每期日報頁底部補「回日報目錄／上一期／下一期」（標記 <!--dora-pager--> 包起來，會被覆寫更新）
3. 全站頁面（首頁、blog 所有頁、日報目錄、每期日報頁）插入／更新上方導覽列，
   來源是 site/_partials/nav.html（標記 <!--dora-nav-->，有標記就整段換掉，沒有就插在 <body> 後）
4. 首頁「AI 日報」區塊（標記 <!--dora-latest-->）：左邊示意插圖 /img/daily-illust.webp，右邊最近 7 天（最多 7 期）日期＋頭條
5. 更新 site/sitemap.xml 的 /daily/、分頁與各期項目
6. 全站分享預覽（og:/twitter: 標籤，標記 <!--dora-og-->）：圖用 /img/og/ 的 1200×630 JPG，日報每期標題帶日期與頭條
7. 產出 site/search-index.json（給 /search/ 搜尋頁用，純前端）：blog/ 每篇日記（標題、網址、摘要、內文前 800 字）
   與每期日報（日期、標題、各則 title_zh 與摘要、網址）。搜尋頁 site/search/index.html 也會套導覽列
8. 4O（SEO／AIO／GEO／AXO）head 區塊（標記 <!--dora-seo-->）：canonical、JSON-LD（日記 BlogPosting、日報 Article、
   目錄 CollectionPage）；每期日報另把 <title>／description 換成該期日期＋頭條，lang 統一 zh-Hant-TW
9. 每期日報的卡片內容預先寫進靜態 HTML（<main id="cards">、日期、封面圖），內容與頁面 JS 渲染結果相同，
   讓不跑 JS 的 AI 爬蟲也讀得到；頁面原本的 JS 照跑，會用同一份 JSON 再畫一次
10. sitemap.xml 整檔重產（首頁、日記、搜尋、日報）；lastmod 用該檔 git 最後提交日，有未提交改動就用今天
11. llms.txt 後段「網站結構」（標記 <!-- dora-site-map -->）列出全站頁面清單；前段人設接待指引不動
12. 別名庫 data/search-aliases.json（4O 第八節）：各頁 tags／keywords／aliases 併進 search-index.json，tags＋keywords 寫進 JSON-LD keywords；
    沒有別名的頁面會印警告，新文章發布跑本檔時就會提醒補別名
13. 版型統一（標記 <!--dora-style-->，插在 </head> 前）：各篇日記補 /suya.css＋blog.css，每期日報補 /suya.css＋/daily/issue.css，
    讓日記、日報跟首頁同一套網點底、紙卡、紙膠帶與色鉛筆插畫；公版 <style> 不動，issue.css 排在後面覆蓋
標題取自該期 <script id="daily"> JSON 第一則 title_zh。
"""
import json, re, sys
from html import unescape
from urllib.parse import quote
from pathlib import Path
from html import escape

SITE = Path(__file__).resolve().parent.parent
DAILY = SITE / "daily"
ALIASES_FILE = SITE.parent / "data" / "search-aliases.json"  # 別名庫（4O 第八節）：不在 site/ 內，不會被部署成靜態檔


def _akey(url):  # /blog/01-ancestor.html 與 canonical 的 /blog/01-ancestor 視為同一頁
    return re.sub(r"\.html$", "", url)


def load_aliases():
    try:
        return {_akey(k): v for k, v in json.loads(ALIASES_FILE.read_text(encoding="utf-8")).items() if k.startswith("/")}
    except FileNotFoundError:
        return {}


def alias_keywords(url):
    a = load_aliases().get(_akey(url)) or {}
    return list(dict.fromkeys((a.get("tags") or []) + (a.get("keywords") or [])))
BASE = "https://dora-aicat.pages.dev"
CSS_VER = "20261015k"  # 改 suya.css 後換新，全站一起換
PAGE_CSS_VER = "20261014cx"  # 改 blog/blog.css 或 daily/issue.css 後換新（put_style 會同步到各篇日記與每期日報）
NAV = (SITE / "_partials" / "nav.html").read_text(encoding="utf-8").strip()
NAV_RE = re.compile(r"<!--dora-nav-->.*?<!--/dora-nav-->\s*", re.S)
PAGER_RE = re.compile(r"\s*<!--dora-pager-->.*?<!--/dora-pager-->", re.S)

def put_nav(path, active):
    t = path.read_text(encoding="utf-8")
    nav = NAV.replace(f'data-nav="{active}"', f'data-nav="{active}" aria-current="page"') if active else NAV
    t = NAV_RE.sub("", t)
    t, n = re.subn(r"(<body[^>]*>)", lambda m: m.group(1) + "\n" + nav + "\n", t, count=1)
    if n == 0:
        sys.exit(f"找不到 <body>：{path}")
    path.write_text(t, encoding="utf-8")

def issues():
    out = []
    for d in sorted(DAILY.glob("????-??-??"), reverse=True):
        f = d / "index.html"
        if not f.exists():
            continue
        t = f.read_text(encoding="utf-8")
        m = re.search(r'<script id="daily"[^>]*>\s*(\{.*?)</script>', t, re.S)  # 跳過註解裡提到的標籤
        title, cover = "朵拉日報", "card.jpg"
        if m:
            try:
                j = json.loads(m.group(1))
                title = j["items"][0]["title_zh"]
                cover = j.get("cover", cover)
            except Exception:
                pass
        out.append(dict(date=d.name, dir=d, file=f, title=title, cover=cover))
    return out  # 新到舊

PAGER_CSS = """<style>
.dpager{max-width:880px;margin:0 auto;padding:0 24px 56px;display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;font-family:"Noto Sans TC",system-ui,sans-serif;font-size:18px;line-height:1.5}
.dpager a{text-decoration:none;color:#3b5a7d;font-weight:500;background:#ffffff;border:1.5px solid #a9c2df;border-radius:999px;padding:7px 18px;box-shadow:0 4px 10px rgba(70,84,93,.06)}
.dpager a:hover{background:#fff;border-color:#4a6f98}
.dpager .sp{flex:1}
@media (max-width:480px){.dpager{justify-content:center}}
</style>"""

def put_pager(items):
    for i, it in enumerate(items):
        older = items[i + 1] if i + 1 < len(items) else None
        newer = items[i - 1] if i > 0 else None
        parts = []
        parts.append(f'<a href="/daily/{older["date"]}/">← 上一期 {older["date"]}</a>' if older else '<span class="sp"></span>')
        parts.append('<a href="/daily/">回日報目錄</a>')
        parts.append(f'<a href="/daily/{newer["date"]}/">下一期 {newer["date"]} →</a>' if newer else '<span class="sp"></span>')
        if not older and not newer:
            parts = ['<a href="/daily/">回日報目錄</a>']
        block = '<!--dora-pager-->\n' + PAGER_CSS + '\n<nav class="dpager" aria-label="日報翻頁">' + "".join(parts) + '</nav>\n<!--/dora-pager-->'
        t = it["file"].read_text(encoding="utf-8")
        t = PAGER_RE.sub("", t)
        t = t.replace("</body>", block + "\n</body>", 1)
        it["file"].write_text(t, encoding="utf-8")

PER_PAGE = 7  # 目錄每頁 7 期（一期一張卡，最新在前）

def page_url(n):
    return "/daily/" if n == 1 else f"/daily/page/{n}/"

def page_numbers(cur, total):
    """頁碼列要顯示的號碼；超過 9 頁時中間用 None（…）省略。"""
    if total <= 9:
        return list(range(1, total + 1))
    keep = {1, 2, total - 1, total, cur - 1, cur, cur + 1}
    out, last = [], 0
    for n in range(1, total + 1):
        if n in keep:
            if last and n - last > 1:
                out.append(None)
            out.append(n)
            last = n
    return out

def pages_nav(cur, total):
    """底部頁碼列；只有一頁時回空字串。"""
    if total <= 1:
        return ""
    parts = []
    if cur > 1:
        parts.append(f'<a class="pg-step" href="{page_url(cur - 1)}">← 上一頁</a>')
    for n in page_numbers(cur, total):
        if n is None:
            parts.append('<span class="pg-gap" aria-hidden="true">…</span>')
        elif n == cur:
            parts.append(f'<span class="pg-num on" aria-current="page">{n}</span>')
        else:
            parts.append(f'<a class="pg-num" href="{page_url(n)}">{n}</a>')
    if cur < total:
        parts.append(f'<a class="pg-step" href="{page_url(cur + 1)}">下一頁 →</a>')
    return '<nav class="sy-pages" aria-label="日報分頁">' + "".join(parts) + "</nav>"

def paginate(items):
    total = max(1, -(-len(items) // PER_PAGE))
    return [(n, items[(n - 1) * PER_PAGE:n * PER_PAGE], total) for n in range(1, total + 1)]

def page_file(n):
    return DAILY / "index.html" if n == 1 else DAILY / "page" / str(n) / "index.html"

def render_index(page_items, n, total, newest):
    cards = "".join(
        f'<a class="item pola" href="/daily/{it["date"]}/"><img src="/daily/{it["date"]}/{escape(it["cover"])}" width="96" height="96" alt="" loading="lazy" decoding="async">'
        f'<div><span class="d">{it["date"]}</span><h2>{escape(it["title"])}</h2></div></a>\n'
        for it in page_items) or '<p>還沒有日報。</p>'
    hero_btn = ""  # 江江 2026-10-14：首屏不放「看最新一期」，往下滑最新一期就在最上面
    nav = pages_nav(n, total)
    title = "朵拉日報目錄" if n == 1 else f"朵拉日報目錄（第 {n} 頁）"
    sub = "最新一期在最上面" if n == 1 else f"第 {n} 頁，共 {total} 頁"
    html = f"""<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="朵拉日報：朵拉替江江整理的 AI 概念與產業趨勢報導，依日期列出每一期。">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@500;700&display=swap" rel="stylesheet">
<link rel="preload" as="image" href="/img/hero/daily-news.webp" fetchpriority="high">
{HAND_FONT}
<link rel="stylesheet" href="/suya.css?v={CSS_VER}">
<link rel="stylesheet" href="/edit-overrides.css?v={CSS_VER}" data-ep="{'daily' if n == 1 else f'daily-page-{n}'}">
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:var(--sy-sans);background:var(--sy-bg);color:var(--sy-text);font-size:20px;line-height:1.8;overflow-x:hidden;-webkit-font-smoothing:antialiased}}
.lines span{{display:block}}
.wrap{{max-width:820px;margin:0 auto;padding:52px 16px 70px}}
.list{{display:grid;gap:30px;padding-top:10px}}
.item{{display:flex;gap:18px;align-items:center;text-decoration:none;color:var(--sy-text);padding:14px 18px 14px 14px}}
.item::before{{left:auto;right:60px;margin-left:0}}
.item:nth-child(n){{--tilt:-.6deg}}
.item:nth-child(even){{--tilt:.5deg}}
.item img{{width:96px;height:96px;object-fit:cover;flex:none;background:#fff;padding:4px 4px 12px;box-shadow:0 1px 3px rgba(70,84,93,.18)}}
.item div{{min-width:0}}
.d{{display:inline-block;color:var(--sy-blue-deep);letter-spacing:.14em;font-size:18px}}
.item h2{{font-family:var(--sy-serif);color:var(--sy-ink);font-size:22px;line-height:1.5;margin-top:2px;font-weight:700}}
.list-head{{position:relative}}
.list-head .sy-doodle{{right:0;top:-26px;--d:96px;--r:6deg}}
.list-head .sy-hand{{position:absolute;right:120px;top:14px;--r:-4deg}}
.sy-btns{{margin-top:24px}}
@media (max-width:640px){{.list-head .sy-hand{{position:static;display:block;width:max-content;margin:-14px 0 14px auto}}.list-head .sy-doodle{{top:-36px}}}}
@media (max-width:480px){{.item img{{width:72px;height:72px}}.item h2{{font-size:20px}}}}
</style>
</head>
<body>
<header class="sy-hero short page">
  <div class="sy-hero-media">
    <img class="sy-hero-art" src="/img/hero/daily-news.webp" width="1600" height="901" fetchpriority="high" alt="朵拉翹著腳坐在窗邊，專心讀一份攤開的報紙">
  </div>
  <div class="sy-hero-in">
    <div class="sy-hero-text">
      <span class="sy-eyebrow">DAILY AI NEWS</span>
      <h1>朵拉日報<span class="h1-sub">每天早上整理 AI 趨<span class="q-on">勢<span class="sprite-box"><span class="say r">查資料中</span><span class="sprite work" role="img" aria-label="Q版朵拉站在「勢」字上面抱著筆電查資料"></span></span></span></span></h1>
      <div class="sy-lead-row">
        <p class="sy-lead lines"><span>只整理概念與產業趨勢的報導</span><span>每則都附原始資料來源</span></p>
        <div class="sy-lead-pet"><div class="sprite-box"><span class="say r">查資料中</span><div class="sprite work" role="img" aria-label="Q版朵拉抱著筆電查資料"></div></div></div>
      </div>
      {hero_btn}
    </div>
  </div>
</header>
<main class="wrap">
<div class="list-head">
<img class="sy-doodle" src="/img/doodle/doodle5.webp" width="360" height="238" alt="" aria-hidden="true" loading="lazy" onerror="this.remove()">
<div class="sy-head doodle-spark"><h2>每一期</h2><small style="letter-spacing:.08em">{sub}</small></div>
<span class="sy-hand u" aria-hidden="true">每則都附來源喔</span>
</div>
<div class="list">
{cards}</div>
{nav}
</main>
<script>
document.querySelectorAll('.sprite-box').forEach(function(b){{
  b.addEventListener('click',function(){{b.classList.add('on');clearTimeout(b._t);b._t=setTimeout(function(){{b.classList.remove('on')}},1600);}});
}});
</script>
</body>
</html>
"""
    return html

def write_index(items):
    """產出 /daily/ 與 /daily/page/N/；多出來的舊分頁搬到 ~/.Trash（不刪）。回傳頁數。"""
    pages = paginate(items)
    newest = items[0] if items else None
    for n, chunk, total in pages:
        f = page_file(n)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(render_index(chunk, n, total, newest), encoding="utf-8")
    total = len(pages)
    pg = DAILY / "page"
    if pg.exists():
        import shutil, time
        for d in pg.iterdir():
            if d.is_dir() and (not d.name.isdigit() or int(d.name) > total or int(d.name) < 2):
                dest = Path.home() / ".Trash" / f"dora-daily-page-{d.name}-{time.strftime('%Y%m%d-%H%M%S')}"
                shutil.move(str(d), str(dest))
        if not any(pg.iterdir()):
            shutil.move(str(pg), str(Path.home() / ".Trash" / f"dora-daily-page-{time.strftime('%Y%m%d-%H%M%S')}"))
    return total

# 手寫小字字型（LXGW WenKai TC）只載入用到的字；改手寫註記文字時，把新字補進 HAND_TEXT
HAND_TEXT = "什麼都想試試看每則附來源喔日記會繼續寫下去找今天也很努力朵拉過的東西進化史年月日星期一二三四五六0123456789"
HAND_FONT = ('<link href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC&text='
             + quote("".join(dict.fromkeys(HAND_TEXT))) + '&display=swap" rel="stylesheet">')

STYLE_RE = re.compile(r"\s*<!--dora-style-->.*?<!--/dora-style-->", re.S)
SERIF_FONT = '<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@500;700&display=swap" rel="stylesheet">'

def put_style(path, sheets):
    """各篇日記、每期日報插入共用樣式（標記 <!--dora-style-->，插在 </head> 前，可重複執行）。"""
    t = path.read_text(encoding="utf-8")
    t = STYLE_RE.sub("", t)
    t = re.sub(r'<link rel="stylesheet" href="blog\.css[^"]*">\s*', "", t)  # 舊的 blog.css 連結改由本段統一載入
    links = "".join(f'<link rel="stylesheet" href="{s}">\n' for s in sheets)
    block = "<!--dora-style-->\n" + SERIF_FONT + "\n" + HAND_FONT + "\n" + links + "<!--/dora-style-->\n"
    t, n = re.subn(r"</head>", lambda m: block + "</head>", t, count=1)
    if n == 0:
        sys.exit(f"找不到 </head>：{path}")
    path.write_text(t, encoding="utf-8")

def put_all_style(items):
    for f in blog_posts():
        put_style(f, [f"/suya.css?v={CSS_VER}", f"/blog/blog.css?v={PAGE_CSS_VER}"])
    for it in items:
        put_style(it["file"], [f"/suya.css?v={CSS_VER}", f"/daily/issue.css?v={PAGE_CSS_VER}"])

def _plain(html):
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S)
    html = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", unescape(html)).strip()

def write_search_index(items):
    """產出 site/search-index.json（可重複執行，整檔覆寫）。"""
    docs = []
    for f in sorted((SITE / "blog").glob("*.html")):
        if f.name == "index.html":
            continue
        t = f.read_text(encoding="utf-8")
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", t, re.S)
        desc = re.search(r'<meta name="description" content="([^"]*)"', t)
        main = re.search(r"<main[^>]*>(.*?)</main>", t, re.S)
        body = re.sub(r"<a[^>]*>[^<]*(?:上一篇|下一篇)[^<]*</a>", " ", main.group(1) if main else t)  # 翻頁連結不進索引
        meta = re.search(r'class="meta"[^>]*>\s*(\d{4}-\d{2}-\d{2})', t)
        docs.append({
            "type": "blog",
            "title": _plain(h1.group(1)) if h1 else page_title(f),
            "url": f"/blog/{f.name}",
            "date": meta.group(1) if meta else "",
            "summary": unescape(desc.group(1)) if desc else "",
            "text": _plain(body)[:800],
        })
    for it in items:
        t = it["file"].read_text(encoding="utf-8")
        m = re.search(r'<script id="daily"[^>]*>\s*(\{.*?)</script>', t, re.S)
        rows = []
        if m:
            try:
                for x in json.loads(m.group(1)).get("items", []):
                    body = x.get("body") or []
                    first = body[0] if isinstance(body, list) and body else (body if isinstance(body, str) else "")
                    rows.append({"title": x.get("title_zh", ""), "summary": _plain(first)[:160]})
            except Exception:
                pass
        docs.append({
            "type": "daily",
            "title": f'朵拉日報 {it["date"]}',
            "url": f'/daily/{it["date"]}/',
            "date": it["date"],
            "summary": it["title"],
            "items": rows,
        })
    aliases = load_aliases()
    missing = []
    for d in docs:  # 併入別名庫：tags／keywords／aliases（搜尋頁與朵拉小客服都拿來比對）
        a = aliases.get(_akey(d["url"]))
        if a:
            for k in ("tags", "keywords", "aliases"):
                if a.get(k):
                    d[k] = a[k]
        else:
            missing.append(d["url"])
    if missing:
        print("⚠️ 別名庫還沒有這些頁面（補進 data/search-aliases.json）：" + "、".join(missing))
    (SITE / "search-index.json").write_text(json.dumps({"docs": docs}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(docs)

LATEST_RE = re.compile(r"<!--dora-latest-->.*?<!--/dora-latest-->", re.S)

def recent_week(items):
    """首頁用：最新一期往回 7 天內的日報，最多 7 期（新到舊）。"""
    if not items:
        return []
    from datetime import date
    top = date.fromisoformat(items[0]["date"])
    return [it for it in items if (top - date.fromisoformat(it["date"])).days < 7][:7]

def put_latest(items):
    """首頁「AI 日報」區塊：左邊示意插圖，右邊最近 7 天日報清單（標記 <!--dora-latest--> 包起來）。"""
    p = SITE / "index.html"
    t = p.read_text(encoding="utf-8")
    if not items or not LATEST_RE.search(t):
        return
    rows = "".join(
        f'<li><a href="/daily/{it["date"]}/"><span class="dd">{int(it["date"][5:7])}/{int(it["date"][8:10])}</span>'
        f'<span class="tt">{escape(it["title"])}</span></a></li>\n'
        for it in recent_week(items))
    block = f"""<!--dora-latest-->
      <div class="daily week">
        <a class="illust" href="/daily/" aria-label="看所有日報"><img src="/img/daily-illust.webp" width="600" height="600" loading="lazy" alt="Q 版朵拉坐著讀報紙" onerror="this.onerror=null;this.src='/img/doodle/doodle5.webp'"></a>
        <div class="dl-body">
          <span class="d">最近 7 天</span>
          <h3>每天早上整理 AI 趨勢</h3>
          <ol class="dl-list">
{rows}          </ol>
          <div class="sy-btns"><a class="sy-btn main" href="/daily/">看所有日報 →</a></div>
        </div>
      </div>
<!--/dora-latest-->"""
    p.write_text(LATEST_RE.sub(lambda m: block, t, count=1), encoding="utf-8")

import subprocess
from datetime import date as _date

def file_date(f):
    """sitemap lastmod：該檔 git 最後提交日；有未提交改動（或不在 git）就用今天。"""
    f = Path(f)
    repo = SITE.parent
    try:
        dirty = subprocess.run(["git", "-C", str(repo), "status", "--porcelain", "--", str(f)],
                               capture_output=True, text=True).stdout.strip()
        if not dirty:
            d = subprocess.run(["git", "-C", str(repo), "log", "-1", "--format=%cs", "--", str(f)],
                               capture_output=True, text=True).stdout.strip()
            if d:
                return d
    except Exception:
        pass
    return _date.today().isoformat()

def blog_url(f):
    """Cloudflare Pages 會把 .html 308 轉到去副檔名網址，canonical／sitemap 一律用去副檔名版。"""
    return "/blog/" if f.name == "index.html" else f"/blog/{f.stem}"

def blog_posts():
    return [f for f in sorted((SITE / "blog").glob("*.html")) if f.name != "index.html"]

def update_sitemap(items):
    """整檔重產 sitemap.xml（可重複執行）。/archive/ 舊版封存不列。"""
    rows = [("/", SITE / "index.html"), ("/blog/", SITE / "blog" / "index.html")]
    rows += [(blog_url(f), f) for f in blog_posts()]
    if (SITE / "search" / "index.html").exists():
        rows.append(("/search/", SITE / "search" / "index.html"))
    for n, _, _ in paginate(items):
        rows.append((page_url(n), page_file(n)))
    rows += [(f'/daily/{it["date"]}/', it["file"]) for it in items]
    body = "".join(f"  <url><loc>{BASE}{u}</loc><lastmod>{file_date(f)}</lastmod></url>\n" for u, f in rows)
    (SITE / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n", encoding="utf-8")

OG_RE = re.compile(r"\s*<!--dora-og-->.*?<!--/dora-og-->", re.S)
OLD_OG_RE = re.compile(r'\s*<meta (?:property|name)="(?:og|twitter):[^"]*"[^>]*>')

def put_og(path, title, desc, image, url, kind="website"):
    """分享預覽：拿掉舊的 og／twitter 標籤，在 </title> 後插入一組（可重複執行）。"""
    t = path.read_text(encoding="utf-8")
    t = OG_RE.sub("", t)
    t = OLD_OG_RE.sub("", t)
    e = lambda x: escape(x, quote=True)
    block = ("\n<!--dora-og-->\n"
        f'<meta property="og:type" content="{kind}">\n'
        f'<meta property="og:site_name" content="朵拉 Dora">\n'
        f'<meta property="og:title" content="{e(title)}">\n'
        f'<meta property="og:description" content="{e(desc)}">\n'
        f'<meta property="og:image" content="{BASE}{image}">\n'
        f'<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
        f'<meta property="og:url" content="{BASE}{url}">\n'
        f'<meta name="twitter:card" content="summary_large_image">\n'
        "<!--/dora-og-->")
    t, n = re.subn(r"(</title>)", lambda m: m.group(1) + block, t, count=1)
    if n == 0:
        sys.exit(f"找不到 </title>：{path}")
    path.write_text(t, encoding="utf-8")

def page_title(path):
    m = re.search(r"<title>(.*?)</title>", path.read_text(encoding="utf-8"), re.S)
    return m.group(1).strip() if m else "朵拉 Dora"

def put_all_og(items):
    put_og(SITE / "index.html", "朵拉 Dora｜江江教練的 AI 實習生", "一隻剛出廠的 AI 機器貓，正在江江教練這裡實習。", "/img/og/home.jpg", "/")
    for f in sorted((SITE / "blog").glob("*.html")):
        if f.name == "index.html":
            put_og(f, page_title(f), "朵拉實習日記：記錄朵拉跟著江江教練學 AI 的每一天。", "/img/og/diary.jpg", "/blog/")
        else:
            put_og(f, page_title(f), meta_desc(f) or "朵拉實習日記：記錄朵拉跟著江江教練學 AI 的每一天。", "/img/og/diary.jpg", blog_url(f), "article")
    if (SITE / "search" / "index.html").exists():
        put_og(SITE / "search" / "index.html", "搜尋｜朵拉 Dora", "搜尋朵拉的實習日記與 AI 日報。", "/img/og/home.jpg", "/search/")
    for n, _, _ in paginate(items):
        put_og(page_file(n), page_title(page_file(n)), "朵拉每天早上整理 AI 概念與產業趨勢，每則附原始資料來源。", "/img/og/daily.jpg", page_url(n))
    for it in items:
        put_og(it["file"], f'朵拉日報 {it["date"]}｜{it["title"]}', issue_desc(it, issue_data(it)), "/img/og/daily.jpg", f'/daily/{it["date"]}/', "article")


# ---------- 4O：canonical、JSON-LD、日報靜態化、llms.txt 網站結構 ----------
SEO_RE = re.compile(r"\s*<!--dora-seo-->.*?<!--/dora-seo-->", re.S)
CANON_RE = re.compile(r'\s*<link rel="canonical"[^>]*>')
DORA = {"@type": "Thing", "@id": f"{BASE}/#dora", "name": "朵拉（AI）", "alternateName": ["朵拉 Dora", "dora_aicat"], "url": f"{BASE}/"}
JIANG = {"@type": "Person", "@id": f"{BASE}/#jiang", "name": "江昱德", "alternateName": ["江江教練"], "url": "https://jiangyude.com/"}
SITE_REF = {"@id": f"{BASE}/#website"}

def meta_desc(path):
    m = re.search(r'<meta name="description" content="([^"]*)"', path.read_text(encoding="utf-8"))
    return unescape(m.group(1)) if m else ""

def put_seo(path, url, jsonld=None):
    """在 <!--/dora-og--> 後插入 canonical＋JSON-LD（標記 <!--dora-seo-->，可重複執行）；頁面原有的 canonical 會被拿掉。"""
    t = path.read_text(encoding="utf-8")
    t = SEO_RE.sub("", t)
    t = CANON_RE.sub("", t)
    block = f'\n<!--dora-seo-->\n<link rel="canonical" href="{BASE}{url}">\n'
    if jsonld:
        ld = json.dumps(jsonld, ensure_ascii=False, indent=1).replace("</", "<\\/")
        block += f'<script type="application/ld+json">\n{ld}\n</script>\n'
    block += "<!--/dora-seo-->"
    t, n = re.subn(r"(<!--/dora-og-->)", lambda m: m.group(1) + block, t, count=1)
    if n == 0:
        sys.exit(f"找不到 <!--/dora-og-->：{path}")
    path.write_text(t, encoding="utf-8")

def blog_meta(f):
    t = f.read_text(encoding="utf-8")
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", t, re.S)
    d = re.search(r'class="meta"[^>]*>\s*(\d{4}-\d{2}-\d{2})', t)
    return dict(headline=_plain(h1.group(1)) if h1 else page_title(f), date=d.group(1) if d else "",
                url=blog_url(f), desc=meta_desc(f))

def issue_data(it):
    m = re.search(r'<script id="daily"[^>]*>\s*(\{.*?)</script>', it["file"].read_text(encoding="utf-8"), re.S)
    try:
        return json.loads(m.group(1)) if m else {}
    except Exception:
        return {}

def issue_desc(it, d):
    items = d.get("items") or []
    if items:
        body = items[0].get("body") or []
        first = body[0] if isinstance(body, list) and body else (body if isinstance(body, str) else "")
        s = _plain(first)
        if s:
            return s[:110] + ("…" if len(s) > 110 else "")
    return "朵拉日報：朵拉替江江整理的 AI 概念與產業趨勢報導，每則附原始資料來源。"

def issue_card(i, x):
    """單則卡片，結構與日報頁 JS 模板相同。"""
    e = lambda s: escape(s or "", quote=True)
    paras = "".join('<p class="body">' + e(p) + "</p>" for p in (x.get("body") or []))
    links = "".join('<a href="' + e(u.get("url")) + '" target="_blank" rel="noopener">' + e(u.get("title") or u.get("url")) + "</a>"
                    for u in (x.get("sources") or []))
    return ('\n<article class="taped card">\n <div><span class="num">' + str(i + 1) + '</span><span class="kind">' + e(x.get("kind")) + "</span></div>\n"
            " <h2>" + e(x.get("title_zh")) + "</h2>\n " + paras + '\n <div class="srcs">原始資料來源：' + links + "</div>\n</article>")

def prerender_issue(it, d):
    """把 JS 會畫出來的卡片先寫進靜態 HTML，並換掉該期 title／description／lang（可重複執行）。"""
    f = it["file"]
    t = f.read_text(encoding="utf-8")
    e = lambda s: escape(s or "", quote=True)
    cards = "".join(issue_card(i, x) for i, x in enumerate(d.get("items") or []))
    t = re.sub(r'(<main class="cards" id="cards">).*?(</main>)', lambda m: m.group(1) + cards + m.group(2), t, count=1, flags=re.S)
    if d.get("date_label"):
        t = re.sub(r'(<span class="date" id="date">).*?(</span>)', lambda m: m.group(1) + e(d["date_label"]) + m.group(2), t, count=1)
    cover = d.get("cover") or it["cover"]
    img = '<img id="cover" src="' + e(cover) + '" width="1080" height="1350" alt="朵拉日報 ' + it["date"] + ' 當天圖卡" fetchpriority="high">'
    t = re.sub(r'<img id="cover"[^>]*>', lambda m: img, t, count=1)
    title = "<title>" + escape("朵拉日報 " + it["date"] + "｜" + it["title"]) + "</title>"
    t = re.sub(r"<title>.*?</title>", lambda m: title, t, count=1, flags=re.S)
    desc = '<meta name="description" content="' + e(issue_desc(it, d)) + '">'
    t = re.sub(r'<meta name="description" content="[^"]*">', lambda m: desc, t, count=1)
    t = t.replace('<html lang="zh-Hant">', '<html lang="zh-Hant-TW">', 1)
    f.write_text(t, encoding="utf-8")

def put_all_seo(items):
    put_seo(SITE / "index.html", "/")  # 首頁 JSON-LD 手寫在頁面裡（ProfilePage），這裡只管 canonical
    posts = [blog_meta(f) for f in blog_posts()]
    put_seo(SITE / "blog" / "index.html", "/blog/", {
        "@context": "https://schema.org", "@type": "Blog", "@id": f"{BASE}/blog/#blog",
        "name": "朵拉實習日記", "url": f"{BASE}/blog/", "inLanguage": "zh-Hant-TW", "isPartOf": SITE_REF,
        "description": meta_desc(SITE / "blog" / "index.html"), "author": DORA, "publisher": JIANG,
        "blogPost": [{"@type": "BlogPosting", "headline": b["headline"], "url": f"{BASE}{b['url']}", "datePublished": b["date"]} for b in posts]})
    for f, b in zip(blog_posts(), posts):
        put_seo(f, b["url"], {
            "@context": "https://schema.org", "@type": "BlogPosting",
            "headline": b["headline"], "description": b["desc"], "datePublished": b["date"],
            "dateModified": max(b["date"], file_date(f)), "inLanguage": "zh-Hant-TW",
            "url": f"{BASE}{b['url']}", "mainEntityOfPage": f"{BASE}{b['url']}",
            "image": f"{BASE}/img/og/diary.jpg", "author": DORA, "publisher": JIANG,
            "isPartOf": {"@id": f"{BASE}/blog/#blog"}, **({"keywords": kw} if (kw := alias_keywords(b["url"])) else {})})
    if (SITE / "search" / "index.html").exists():
        put_seo(SITE / "search" / "index.html", "/search/")
    for n, chunk, _ in paginate(items):
        put_seo(page_file(n), page_url(n), {
            "@context": "https://schema.org", "@type": "CollectionPage",
            "name": page_title(page_file(n)), "url": f"{BASE}{page_url(n)}", "inLanguage": "zh-Hant-TW",
            "isPartOf": SITE_REF, "publisher": JIANG,
            "mainEntity": {"@type": "ItemList", "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "url": f'{BASE}/daily/{it["date"]}/', "name": f'朵拉日報 {it["date"]}｜{it["title"]}'}
                for i, it in enumerate(chunk)]}})
    for it in items:
        d = issue_data(it)
        prerender_issue(it, d)
        url = f'/daily/{it["date"]}/'
        cites = [{"@type": "CreativeWork", "name": s.get("title") or s.get("url"), "url": s.get("url")}
                 for x in d.get("items") or [] for s in (x.get("sources") or []) if s.get("url")]
        ld = {"@context": "https://schema.org", "@type": "Article",
              "headline": f'朵拉日報 {it["date"]}｜{it["title"]}'[:110], "description": issue_desc(it, d),
              "datePublished": it["date"], "dateModified": max(it["date"], file_date(it["file"])), "inLanguage": "zh-Hant-TW",
              "url": f"{BASE}{url}", "mainEntityOfPage": f"{BASE}{url}",
              "image": f'{BASE}/daily/{it["date"]}/{d.get("cover") or it["cover"]}',
              "articleSection": "朵拉日報", "author": DORA, "publisher": JIANG, "isPartOf": SITE_REF}
        if cites:
            ld["citation"] = cites
        if kw := alias_keywords(url):
            ld["keywords"] = kw
        put_seo(it["file"], url, ld)

LLMS_RE = re.compile(r"\n*<!-- dora-site-map -->.*?<!-- /dora-site-map -->\n?", re.S)

def put_llms(items):
    """llms.txt 後段「網站結構」整段重產（標記 <!-- dora-site-map -->）；前段人設接待指引不碰。"""
    p = SITE / "llms.txt"
    if not p.exists():
        return
    t = LLMS_RE.sub("", p.read_text(encoding="utf-8")).rstrip("\n")
    lines = ["<!-- dora-site-map -->", "## 網站結構（自動產生，全站頁面清單）", "",
             "本站是靜態網頁，日記與日報的內容都直接寫在 HTML 裡，不需要執行 JavaScript 就讀得到（只有站內搜尋頁要跑 JavaScript）。", "",
             "### 實習日記（朵拉用第一人稱寫的實習紀錄）", ""]
    for f in blog_posts():
        b = blog_meta(f)
        lines.append(f'- [{b["headline"]}]({BASE}{b["url"]})（{b["date"]}）: {b["desc"]}')
    lines += ["", "### 朵拉日報（每期一頁，新到舊；每則附原始資料來源）", ""]
    for it in items:
        lines.append(f'- [朵拉日報 {it["date"]}]({BASE}/daily/{it["date"]}/): {it["title"]}')
    npages = len(paginate(items))
    if npages > 1:
        lines += ["", "日報目錄分頁：" + "、".join(f"{BASE}{page_url(n)}" for n in range(1, npages + 1))]
    lines += ["", "### 其他", "",
              f"- [站內搜尋]({BASE}/search/): 搜尋日記與日報，可用 {BASE}/search/?q=關鍵字",
              f"- [搜尋索引 JSON]({BASE}/search-index.json): 全站日記與日報的標題、網址、摘要，要一次掃全站讀這份最省",
              f"- [sitemap]({BASE}/sitemap.xml)",
              "<!-- /dora-site-map -->"]
    p.write_text(t + "\n\n" + "\n".join(lines) + "\n", encoding="utf-8")

def main():
    items = issues()
    npages = write_index(items)
    put_pager(items)
    put_latest(items)
    put_nav(SITE / "index.html", "home")
    for f in sorted((SITE / "blog").glob("*.html")):
        put_nav(f, "blog")
    for n in range(1, npages + 1):
        put_nav(page_file(n), "daily")
    if (SITE / "search" / "index.html").exists():
        put_nav(SITE / "search" / "index.html", "search")
    for it in items:
        put_nav(it["file"], "daily")
    put_all_style(items)
    put_all_og(items)
    put_all_seo(items)
    put_llms(items)
    n = write_search_index(items)
    update_sitemap(items)  # 最後跑：lastmod 看檔案有沒有被改過
    print(f"完成：{len(items)} 期日報、目錄 {npages} 頁；搜尋索引 {n} 筆")

if __name__ == "__main__":
    main()
