#!/usr/bin/env python3
"""朵拉日報目錄與導覽產生器。每天日報產出新一期後，跑一次：

    python3 site/daily/build-index.py

做的事（可重複執行，不會重複插入）：
1. 掃 site/daily/YYYY-MM-DD/ 資料夾，產出 site/daily/index.html（最新在上，封面縮圖、日期、標題）
2. 每期日報頁底部補「回日報目錄／上一期／下一期」（標記 <!--dora-pager--> 包起來，會被覆寫更新）
3. 全站頁面（首頁、blog 所有頁、日報目錄、每期日報頁）插入／更新上方導覽列，
   來源是 site/_partials/nav.html（標記 <!--dora-nav-->，有標記就整段換掉，沒有就插在 <body> 後）
4. 更新 site/sitemap.xml 的 /daily/ 與各期項目
不碰日報頁內文與配色。標題取自該期 <script id="daily"> JSON 第一則 title_zh。
"""
import json, re, sys
from pathlib import Path
from html import escape

SITE = Path(__file__).resolve().parent.parent
DAILY = SITE / "daily"
BASE = "https://dora-aicat.pages.dev"
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
        m = re.search(r'<script id="daily"[^>]*>(.*?)</script>', t, re.S)
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
.dpager{max-width:860px;margin:0 auto;padding:0 16px 56px;display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;font-family:"Noto Sans TC",system-ui,sans-serif;font-size:16px;line-height:1.5}
.dpager a{text-decoration:none;color:#1d2b4f;font-weight:700;background:#fff;border:2px solid #b9d3f0;border-radius:999px;padding:6px 16px}
.dpager a:hover{background:#eaf3fe}
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

def write_index(items):
    cards = "".join(
        f'<a class="item" href="/daily/{it["date"]}/"><img src="/daily/{it["date"]}/{escape(it["cover"])}" alt="" loading="lazy">'
        f'<div><span class="d">{it["date"]}</span><h2>{escape(it["title"])}</h2></div></a>\n'
        for it in items) or '<p>還沒有日報。</p>'
    html = f"""<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>朵拉日報目錄</title>
<meta name="description" content="朵拉日報：朵拉替江江整理的 AI 概念與產業趨勢報導，依日期列出每一期。">
<link rel="canonical" href="{BASE}/daily/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
:root{{color-scheme:light;--bg:#dcebfa;--ink:#1d2b4f;--ink-soft:#506084;--blue:#3d7fd9;--line:#b9d3f0}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:"Noto Sans TC",system-ui,sans-serif;background:var(--bg);color:var(--ink);font-size:18px;line-height:1.8;overflow-x:hidden}}
.wrap{{max-width:760px;margin:0 auto;padding:36px 16px 70px}}
h1{{font-size:clamp(32px,6vw,44px);font-weight:900;line-height:1.3}}
.lead{{color:var(--ink-soft);margin:6px 0 28px}}
.list{{display:grid;gap:20px}}
.item{{display:flex;gap:16px;align-items:center;text-decoration:none;color:var(--ink);background:#fff;border:2px solid var(--ink);border-radius:20px;box-shadow:5px 5px 0 var(--ink);padding:14px}}
.item:hover{{transform:translate(-2px,-2px);box-shadow:7px 7px 0 var(--ink)}}
.item img{{width:96px;height:96px;object-fit:cover;border-radius:12px;flex:none;border:2px solid var(--line)}}
.item div{{min-width:0}}
.d{{display:inline-block;background:#ffd84a;border-radius:8px;padding:0 10px;font-weight:900;font-size:16px}}
.item h2{{font-size:19px;line-height:1.5;margin-top:4px;font-weight:700}}
@media (max-width:480px){{.item img{{width:72px;height:72px}}.item h2{{font-size:17px}}}}
</style>
</head>
<body>
<main class="wrap">
<h1>朵拉日報</h1>
<p class="lead">朵拉替江江讀網路，只整理概念與產業趨勢的報導。最新一期在最上面。</p>
<div class="list">
{cards}</div>
</main>
</body>
</html>
"""
    (DAILY / "index.html").write_text(html, encoding="utf-8")

def update_sitemap(items):
    p = SITE / "sitemap.xml"
    t = p.read_text(encoding="utf-8")
    t = re.sub(r"[ \t]*<url><loc>%s/daily/[^<]*</loc>.*?</url>\n" % re.escape(BASE), "", t)
    latest = items[0]["date"] if items else ""
    rows = f'  <url><loc>{BASE}/daily/</loc><lastmod>{latest}</lastmod></url>\n' if items else ""
    for it in items:
        rows += f'  <url><loc>{BASE}/daily/{it["date"]}/</loc><lastmod>{it["date"]}</lastmod></url>\n'
    t = t.replace("</urlset>", rows + "</urlset>")
    p.write_text(t, encoding="utf-8")

def main():
    items = issues()
    write_index(items)
    put_pager(items)
    put_nav(SITE / "index.html", "home")
    for f in sorted((SITE / "blog").glob("*.html")):
        put_nav(f, "blog")
    put_nav(DAILY / "index.html", "daily")
    for it in items:
        put_nav(it["file"], "daily")
    update_sitemap(items)
    print(f"完成：{len(items)} 期日報")

if __name__ == "__main__":
    main()
