#!/usr/bin/env python3
"""朵拉官網排版編輯器（本機用，不會被部署）

    python3 tools/editor/dora-editor.py            # 開在 http://127.0.0.1:8792/?edit=1

- 服務 site/ 底下的檔案（不帶 ?edit=1 就是一般網站預覽）
- 網址帶 ?edit=1：回傳編輯器外框（工具列＋裝置寬度切換），裡面用 iframe 載入同一頁
- iframe 那一頁（?edit=1&frame=1）會在 </body> 前注入編輯器 script 與 style（只注入在回應裡，不改原檔）
- POST /__save：位置／旋轉／縮放存成「目前預覽寬度」的錨點（tools/editor/anchors.json），再重新產生 site/edit-overrides.css；改字在原始 HTML 做精確替換；寫入前先備份到 tools/editor/backups/
- GET /__anchors?ep=頁面代號：這一頁所有元素的錨點；POST /__anchor_delete：刪掉某元素某寬度的錨點
- python3 dora-editor.py --migrate：一次性把舊版三段 CSS 轉成 anchors.json
- POST /__probe：雙擊改字前先問伺服器「這段字在原始檔找得到嗎、是不是自動產生的」

只用 Python 標準函式庫。只綁 127.0.0.1。
（sync-guard:allow：遠端領先的 1 個 commit 只動 media/，與 tools/editor、site/ 無重疊）
"""
import json, re, shutil, sys, time
from html import unescape
from html.parser import HTMLParser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, unquote

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SITE = REPO / "site"
BACKUPS = HERE / "backups"
OVR = SITE / "edit-overrides.css"
HOST, PORT = "127.0.0.1", 8792

ANCH = HERE / "anchors.json"   # 錨點正本（不在 site/，不會部署）
# 自動產生的區塊：裡面的字改了會被 build-index.py 下次重生蓋掉
GEN_MARKERS = ["dora-nav", "dora-latest", "dora-pager", "dora-og"]
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
MIME = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".mp4": "video/mp4", ".webm": "video/webm",
}


# ---------- 頁面與檔案 ----------

def url_to_file(path):
    """網址路徑 → site/ 底下的檔案（不允許跑出 site/）。"""
    p = unquote(path)
    root = SITE.resolve()
    f = (SITE / p.lstrip("/")).resolve()
    if root not in f.parents and f != root:
        return None
    if f.is_dir():
        f = f / "index.html"
    elif not f.exists() and not f.suffix and (f.parent / (f.name + ".html")).exists():
        f = f.parent / (f.name + ".html")  # /blog/01-ancestor 這種沒副檔名的網址
    return f if f.is_file() else None


def rel(f):
    return f.resolve().relative_to(SITE.resolve()).as_posix()


def page_key(relpath):
    """檔案相對路徑 → 頁面代號（寫在 overrides link 的 data-ep 上，用來把規則限定在這一頁）。"""
    k = re.sub(r"\.html$", "", relpath)
    k = re.sub(r"(^|/)index$", "", k)
    k = k.strip("/").replace("/", "-")
    return k or "home"


def generated_page(relpath):
    """整頁都是 build-index.py 產生的（字改了會被蓋掉）。"""
    return relpath == "daily/index.html" or bool(re.match(r"daily/page/\d+/index\.html$", relpath))


def list_pages():
    out = []
    for f in sorted(SITE.rglob("*.html")):
        r = rel(f)
        if r.startswith(("_partials/", "archive/")):
            continue
        url = "/" + re.sub(r"(^|/)index\.html$", r"\1", r)
        t = f.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"<title>(.*?)</title>", t, re.S)
        out.append({"url": url, "file": r, "title": unescape(m.group(1)).strip() if m else r})
    return out


# ---------- 在原始 HTML 找到某個元素（給改字用） ----------

class Locator(HTMLParser):
    """把原始 HTML 解析成元素樹，記下每個元素開頭標籤結束處（ie）與結尾標籤開始處（ee）在原檔的字元位置。"""

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.text = text
        self.lines = [0]
        for i, ch in enumerate(text):
            if ch == "\n":
                self.lines.append(i + 1)
        self.root = {"tag": "#root", "children": [], "s": 0, "ie": 0, "ee": None}
        self.stack = [self.root]
        self.feed(text)
        self.close()

    def _off(self):
        ln, col = self.getpos()
        return self.lines[ln - 1] + col

    def _add(self, tag, closed):
        s = self._off()
        raw = self.get_starttag_text() or ""
        node = {"tag": tag, "children": [], "s": s, "ie": s + len(raw), "ee": None}
        self.stack[-1]["children"].append(node)
        if closed or tag in VOID:
            node["ee"] = node["ie"]
        else:
            self.stack.append(node)

    def handle_starttag(self, tag, attrs):
        self._add(tag, False)

    def handle_startendtag(self, tag, attrs):
        self._add(tag, True)

    def handle_endtag(self, tag):
        pos = self._off()
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i]["tag"] == tag:
                for n in self.stack[i:]:  # 沒寫結尾標籤的（例如 <p>、<li>）在這裡一起結束
                    n["ee"] = pos
                del self.stack[i:]
                return

    def find_body(self):
        def walk(n):
            if n["tag"] == "body":
                return n
            for c in n["children"]:
                r = walk(c)
                if r:
                    return r
            return None
        return walk(self.root)


def plain(html):
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S)
    html = re.sub(r"<!--.*?-->", " ", html, flags=re.S)
    html = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", "", unescape(html))


def marker_ranges(text):
    out = []
    for m in GEN_MARKERS:
        for mm in re.finditer(r"<!--%s-->.*?<!--/%s-->" % (re.escape(m), re.escape(m)), text, re.S):
            out.append((mm.start(), mm.end(), m))
    return out


def locate(text, path, old):
    """回傳原檔中該元素內文的 (開始, 結束) 位置，或丟出 ValueError（中文原因）。
    path：從 <body> 往下，每層 [標籤名, 第幾個子元素]（跟瀏覽器 DOM 的 children 同算法）。
    先用 path 對位置，再確認內文一致；對不上才退回「整份檔只出現一次的精確字串」。"""
    try:
        node = Locator(text).find_body()
        ok = node is not None
        for tag, idx in path if ok else []:
            kids = node["children"]
            if idx >= len(kids) or kids[idx]["tag"].lower() != str(tag).lower():
                ok = False
                break
            node = kids[idx]
        if ok and node.get("ee") is not None:
            a, b = node["ie"], node["ee"]
            src = text[a:b]
            if src == old or (plain(src) == plain(old) and plain(old)):
                return a, b
    except Exception:
        pass
    # 退路：精確字串，但不算 <head>、<script>、<style>、註解裡的（那些是資料或程式，不是畫面上的字）
    # sync-guard:allow（遠端領先 2 個 commit 都只動 media/）
    skip = [(m.start(), m.end()) for m in re.finditer(
        r"<head[\s>].*?</head>|<script[\s>].*?</script>|<style[\s>].*?</style>|<!--.*?-->", text, re.S | re.I)]
    hits = []
    i = text.find(old) if old.strip() else -1
    while i >= 0:
        if not any(s <= i < e for s, e in skip):
            hits.append(i)
        i = text.find(old, i + 1)
    if len(hits) == 1:
        return hits[0], hits[0] + len(old)
    if len(hits) > 1:
        raise ValueError("這段字在原始檔出現 %d 次，又對不上位置，為了安全不改" % len(hits))
    raise ValueError("原始檔的 HTML 裡找不到這段字：它是網頁程式自己產生的（例如日報內文、搜尋結果），要改請改資料來源")


def in_generated(text, a):
    for s, e, name in marker_ranges(text):
        if s <= a < e:
            return name
    return None


# ---------- 錨點（anchors.json）與 edit-overrides.css ----------
#
# 正本是 tools/editor/anchors.json：每個元素（頁面＋選擇器）記一組「錨點」，
# 一個錨點＝在某個預覽寬度存下的位置／旋轉／縮放。edit-overrides.css 每次存檔由它整份重新產生。
# 產生規則（三段裝置各自算，不跨 760/761、1366/1367 邊界，因為那裡版型會換）：
#   - 兩個相鄰錨點之間：照視窗寬度線性內插（translate 直接 calc；旋轉、縮放用 tan(atan2()) 換成 0～1 的比例再乘）
#   - 比該段最窄的錨點還窄：沿用最窄的錨點；比最寬的還寬：沿用最寬的
#   - 筆電段一個錨點都沒有、桌機段有：照桌機最窄錨點 × 100vw/1366 等比例（舊版的 auto）
#   - 手機段沒有錨點：保持原樣

SEGS = [  # (名稱, 最小寬, 最大寬)
    ("mobile", 0, 760),
    ("laptop", 761, 1366),
    ("desktop", 1367, None),
]
SEG_NAME = {"mobile": "手機", "laptop": "筆電", "desktop": "桌機"}
RULE_RE = re.compile(r'^\s*html:has\(link\[data-ep="([^"]+)"\]\)\s+(.+?)\s*\{(.*)\}\s*$')
TF_RE = re.compile(r"translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*rotate\(\s*(-?[\d.]+)deg\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)")


def seg_of(w):
    for name, lo, hi in SEGS:
        if w >= lo and (hi is None or w <= hi):
            return name
    return "desktop"


def num(v, nd):
    v = round(float(v), nd)
    if v == int(v):
        return str(int(v))
    return ("%%.%df" % nd % v).rstrip("0").rstrip(".")


def clean_vals(v):
    return {"x": round(float(v["x"]), 1), "y": round(float(v["y"]), 1),
            "r": round(float(v["r"]), 2), "s": round(float(v["s"]), 3)}


def read_overrides_v1():
    """讀舊版（2026-10-14 以前）按裝置分三段的 edit-overrides.css，只給一次性遷移用。"""
    data = {"desktop": {}, "laptop": {}, "mobile": {}}
    if not OVR.exists():
        return data
    dev = None
    for line in OVR.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*/\*\s*@device\s+(\w+)", line)
        if m:
            dev = m.group(1) if m.group(1) in data else None
            continue
        m = RULE_RE.match(line)
        if m and dev:
            ep, sel, body = m.groups()
            t = TF_RE.search(body)
            if not t:
                continue
            data[dev][(ep, sel)] = {
                "x": float(t.group(1)), "y": float(t.group(2)), "r": float(t.group(3)), "s": float(t.group(4)),
                "ib": "inline-block" in body,
            }
    return data


def migrate_v1():
    """舊三段資料 → 錨點。桌機→1920、1367；筆電有寫→1366、761；筆電沒寫但桌機有→1366＝桌機值、761＝桌機值×761/1366
    （等同舊的 auto 等比例）；手機→760、320。"""
    old = read_overrides_v1()
    rules = {}

    def put(key, w, v):
        r = rules.setdefault(key, {"ib": False, "anchors": {}})
        r["ib"] = r["ib"] or bool(v.get("ib"))
        r["anchors"][w] = clean_vals(v)

    for key, v in old["desktop"].items():
        put(key, 1920, v)
        put(key, 1367, v)
        if key not in old["laptop"]:
            k = 761 / 1366
            put(key, 1366, v)
            put(key, 761, {"x": v["x"] * k, "y": v["y"] * k, "r": v["r"], "s": v["s"], "ib": v.get("ib")})
    for key, v in old["laptop"].items():
        put(key, 1366, v)
        put(key, 761, v)
    for key, v in old["mobile"].items():
        put(key, 760, v)
        put(key, 320, v)
    return rules


def load_anchors():
    """回傳 {(ep, sel): {"ib": bool, "anchors": {寬度(int): {x,y,r,s}}}}。沒有 anchors.json 時從舊 CSS 遷移（不寫檔）。"""
    if not ANCH.exists():
        return migrate_v1()
    raw = json.loads(ANCH.read_text(encoding="utf-8"))
    out = {}
    for r in raw.get("rules", []):
        out[(r["ep"], r["sel"])] = {"ib": bool(r.get("ib")),
                                     "anchors": {int(w): clean_vals(v) for w, v in r.get("anchors", {}).items()}}
    return out


def save_anchors(rules):
    lst = []
    for (ep, sel), r in rules.items():
        if not r["anchors"]:
            continue
        lst.append({"ep": ep, "sel": sel, "ib": bool(r.get("ib")),
                    "anchors": {str(w): r["anchors"][w] for w in sorted(r["anchors"])}})
    ANCH.write_text(json.dumps({"version": 1, "note": "朵拉排版編輯器的錨點正本；site/edit-overrides.css 由這份產生，不要手改 CSS",
                                "rules": lst}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_overrides(rules)


def mq(lo, hi):
    parts = []
    if lo:
        parts.append("(min-width:%dpx)" % lo)
    if hi is not None:
        parts.append("(max-width:%dpx)" % hi)
    return "@media " + " and ".join(parts)


def tf_const(v):
    return "translate(%spx,%spx) rotate(%sdeg) scale(%s)" % (num(v["x"], 1), num(v["y"], 1), num(v["r"], 2), num(v["s"], 3))


def tf_lerp(w1, a, w2, b):
    """w1～w2 之間線性內插。translate：px＋數字×長度÷數字；旋轉、縮放要無單位比例，
    用 tan(atan2(100vw - w1, w2 - w1)) 算出 0～1（兩個長度相除的合法寫法）。"""
    d = w2 - w1
    t = "tan(atan2(100vw - %dpx, %dpx))" % (w1, d)

    def ln(k, nd=1):
        if abs(a[k] - b[k]) < 1e-9:
            return "%spx" % num(a[k], nd)
        return "calc(%spx + %s * (100vw - %dpx) / %d)" % (num(a[k], nd), num(b[k] - a[k], nd), w1, d)
    r = ("%sdeg" % num(a["r"], 2)) if abs(a["r"] - b["r"]) < 1e-9 else \
        "calc(%sdeg + %sdeg * %s)" % (num(a["r"], 2), num(b["r"] - a["r"], 2), t)
    s = num(a["s"], 3) if abs(a["s"] - b["s"]) < 1e-9 else \
        "calc(%s + %s * %s)" % (num(a["s"], 3), num(b["s"] - a["s"], 3), t)
    return "translate(%s,%s) rotate(%s) scale(%s)" % (ln("x"), ln("y"), r, s)


def css_for(ep, sel, r):
    """一個元素的所有 CSS 行（每行一條：@media{選擇器{transform}}）。"""
    lines = []
    tail = ";display:inline-block!important" if r.get("ib") else ""

    def rule(media, tf):
        lines.append('%s{html:has(link[data-ep="%s"]) %s{transform:%s!important%s}}' % (media, ep, sel, tf, tail))

    anc = r["anchors"]
    for name, lo, hi in SEGS:
        ws = sorted(w for w in anc if seg_of(w) == name)
        if not ws:
            if name == "laptop":
                dws = sorted(w for w in anc if seg_of(w) == "desktop")
                if dws:  # 筆電段沒錨點：照桌機最窄錨點等比例
                    v = anc[dws[0]]
                    rule(mq(lo, hi) + "/*auto*/",
                         "translate(calc(%s * 100vw / 1366),calc(%s * 100vw / 1366)) rotate(%sdeg) scale(%s)" % (
                             num(v["x"], 1), num(v["y"], 1), num(v["r"], 2), num(v["s"], 3)))
            continue
        same = all(anc[w] == anc[ws[0]] for w in ws)
        if len(ws) == 1 or same:
            rule(mq(lo, hi), tf_const(anc[ws[0]]))
            continue
        if lo < ws[0]:
            rule(mq(lo, ws[0]), tf_const(anc[ws[0]]))
        for w1, w2 in zip(ws, ws[1:]):
            a, b = anc[w1], anc[w2]
            rule(mq(w1, w2), tf_const(a) if a == b else tf_lerp(w1, a, w2, b))
        if hi is None or ws[-1] < hi:
            rule(mq(ws[-1], hi), tf_const(anc[ws[-1]]))
    return lines


def write_overrides(rules):
    out = [
        "/* edit-overrides.css：由排版編輯器 tools/editor/dora-editor.py 從 tools/editor/anchors.json 自動產生，不要手改（下次存檔會被蓋掉）。",
        "   每個元素可以在不同預覽寬度各存一個「錨點」；兩個錨點之間照視窗寬度平滑內插，",
        "   不跨手機（≤760）、筆電（761–1366）、桌機（≥1367）的邊界。每行一條：@media{頁面 選擇器{transform}}。 */",
    ]
    for (ep, sel), r in rules.items():
        if not r["anchors"]:
            continue
        out.append("/* @anchor %s | %s | %s */" % (ep, sel.replace("*/", "* /"), " ".join(str(w) for w in sorted(r["anchors"]))))
        out.extend(css_for(ep, sel, r))
    OVR.write_text("\n".join(out) + "\n", encoding="utf-8")


def anchors_payload(ep):
    rules = load_anchors()
    return [{"sel": sel, "ib": r["ib"], "anchors": [dict(w=w, **r["anchors"][w]) for w in sorted(r["anchors"])]}
            for (e, sel), r in rules.items() if e == ep and r["anchors"]]

LINK_RE = re.compile(r'<link rel="stylesheet" href="/edit-overrides\.css(?:\?v=[^"]*)?"(?: data-ep="[^"]*")?>')


def ensure_link(text, ep, ver):
    """頁面 <head> 裡 suya.css 後面要有 overrides 的 link；有就更新版本參數。"""
    new = '<link rel="stylesheet" href="/edit-overrides.css?v=%s" data-ep="%s">' % (ver, ep)
    if LINK_RE.search(text):
        return LINK_RE.sub(lambda m: new, text, count=1)
    m = re.search(r'<link rel="stylesheet" href="/suya\.css[^"]*">', text)
    if m:
        return text[:m.end()] + "\n" + new + text[m.end():]
    if "</head>" in text:
        return text.replace("</head>", new + "\n</head>", 1)
    raise ValueError("找不到 suya.css 的 link 也找不到 </head>，無法加上 overrides 樣式表")


# ---------- 存檔 ----------

def backup(files):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    d, i = BACKUPS / stamp, 1
    while d.exists():
        d, i = BACKUPS / ("%s-%d" % (stamp, i)), i + 1
    for f in files:
        if f.exists():
            dest = d / f.resolve().relative_to(REPO.resolve())
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest)
    d.mkdir(parents=True, exist_ok=True)
    (d / "_files.json").write_text(json.dumps([str(f.resolve().relative_to(REPO.resolve())) for f in files],
                                              ensure_ascii=False, indent=1), encoding="utf-8")
    return d


def req_width(req):
    try:
        w = int(round(float(req.get("width"))))
    except (TypeError, ValueError):
        raise ValueError("沒有帶預覽寬度")
    if not 200 <= w <= 4000:
        raise ValueError("預覽寬度不合理：%s" % w)
    return w


def do_save(req):
    f = url_to_file("/" + req.get("file", ""))
    if not f or f.suffix != ".html":
        raise ValueError("找不到頁面檔：%s" % req.get("file"))
    width = req_width(req)
    relp = rel(f)
    ep = page_key(relp)
    text = f.read_text(encoding="utf-8")
    new_text = text

    # 1. 改字：全部都找得到才寫，有一個失敗就整批不寫
    errors = []
    for t in req.get("texts", []):
        try:
            if generated_page(relp):
                raise ValueError("整頁是自動產生的（日報目錄），改字會被下次重生蓋掉")
            a, b = locate(new_text, t["path"], t["old"])
            g = in_generated(new_text, a)
            if g:
                raise ValueError("這塊是自動產生的（%s），改字會被下次重生蓋掉" % g)
            new_text = new_text[:a] + t["new"] + new_text[b:]
        except ValueError as e:
            errors.append({"label": t.get("label", ""), "error": str(e)})
    if errors:
        return {"ok": False, "error": "改字失敗，這次什麼都沒寫入", "details": errors}

    # 2. 位置／旋轉／縮放：只新增或更新「這個寬度」的錨點，其他寬度的錨點不動
    tfs = [t for t in req.get("transforms", []) if t.get("selector") and "{" not in t["selector"] and "}" not in t["selector"]]
    if tfs:
        new_text = ensure_link(new_text, ep, time.strftime("%Y%m%d%H%M%S"))

    touched = []
    if new_text != text:
        touched.append(f)
    if tfs:
        touched += [OVR, ANCH]
    if not touched:
        return {"ok": True, "written": [], "note": "沒有變更"}
    bdir = backup(touched)

    if tfs:
        rules = load_anchors()
        for t in tfs:
            key = (ep, t["selector"])
            r = rules.setdefault(key, {"ib": False, "anchors": {}})
            # 同一個元素以前用別的選擇器存的錨點，搬到新選擇器底下（新選擇器已有的寬度以新的為準）
            for old in t.get("renameFrom", []) or []:
                o = rules.pop((ep, old), None)
                if o:
                    for w, v in o["anchors"].items():
                        r["anchors"].setdefault(w, v)
                    r["ib"] = r["ib"] or o["ib"]
            others = [w for w in r["anchors"] if w != width]
            if t.get("isBase") and not others:
                rules.pop(key, None)  # 唯一的錨點又調回原狀：整條拿掉
                continue
            r["anchors"][width] = clean_vals(t)
            r["ib"] = r["ib"] or bool(t.get("ib"))
        save_anchors(rules)
    if new_text != text:
        f.write_text(new_text, encoding="utf-8")
    return {"ok": True, "written": [str(p.resolve().relative_to(REPO.resolve())) for p in touched],
            "backup": str(bdir.relative_to(REPO)), "ep": ep, "width": width}


def do_delete_anchor(req):
    f = url_to_file("/" + req.get("file", ""))
    if not f or f.suffix != ".html":
        raise ValueError("找不到頁面檔：%s" % req.get("file"))
    width = req_width(req)
    ep = page_key(rel(f))
    rules = load_anchors()
    key = (ep, req.get("selector", ""))
    if key not in rules or width not in rules[key]["anchors"]:
        return {"ok": False, "error": "這個元素沒有 %d 寬的錨點" % width}
    text = f.read_text(encoding="utf-8")
    new_text = ensure_link(text, ep, time.strftime("%Y%m%d%H%M%S"))
    bdir = backup([OVR, ANCH] + ([f] if new_text != text else []))
    del rules[key]["anchors"][width]
    if not rules[key]["anchors"]:
        del rules[key]
    save_anchors(rules)
    if new_text != text:
        f.write_text(new_text, encoding="utf-8")
    return {"ok": True, "backup": str(bdir.relative_to(REPO)), "left": len(rules.get(key, {}).get("anchors", {}))}

def do_probe(req):
    f = url_to_file("/" + req.get("file", ""))
    if not f:
        return {"ok": False, "error": "找不到頁面檔"}
    relp = rel(f)
    if generated_page(relp):
        return {"ok": False, "generated": True, "error": "整頁是 build-index.py 自動產生的，改字會被下次重生蓋掉；位置、大小可以調"}
    text = f.read_text(encoding="utf-8")
    try:
        a, b = locate(text, req["path"], req["old"])
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    g = in_generated(text, a)
    if g:
        return {"ok": False, "generated": True, "error": "這塊是自動產生的（%s），改字會被下次重生蓋掉；位置、大小可以調" % g}
    return {"ok": True}


# ---------- HTTP ----------

def inject(html, relp):
    cfg = {"file": relp, "ep": page_key(relp), "generatedPage": generated_page(relp), "markers": GEN_MARKERS}
    # 編輯模式停用拍立得放大與舊微調器（改成 text/plain 不執行；元素數量不變，不影響改字定位）
    html = re.sub(r'<script src="/(pola-zoom|tune)\.js"([^>]*)></script>',
                  r'<script type="text/plain" data-de-off src="/\1.js"\2></script>', html)
    t = int(time.time())
    tag = ('<link rel="stylesheet" href="/__editor/editor.css?t=%d" data-de-ui>'
           '<script data-de-ui>window.__DE_CFG=%s</script>'
           '<script src="/__editor/editor.js?t=%d" data-de-ui></script>') % (t, json.dumps(cfg, ensure_ascii=False), t)
    i = html.lower().rfind("</body>")
    return html[:i] + tag + html[i:] if i >= 0 else html + tag


class H(BaseHTTPRequestHandler):
    server_version = "DoraEditor/1.0"

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        u = urlsplit(self.path)
        q = parse_qs(u.query)
        if u.path.startswith("/__editor/"):
            name = u.path.rsplit("/", 1)[-1]
            f = HERE / name
            if name in ("editor.js", "editor.css") and f.exists():
                return self.send(200, f.read_bytes(), MIME[f.suffix])
            return self.send(404, "not found")
        if u.path == "/__anchors":
            ep = (q.get("ep") or [""])[0]
            return self.send(200, json.dumps(anchors_payload(ep), ensure_ascii=False), MIME[".json"])
        if u.path == "/__pages":
            return self.send(200, json.dumps(list_pages(), ensure_ascii=False), MIME[".json"])
        if u.path == "/edit-overrides.css" and not OVR.exists():
            return self.send(200, "", MIME[".css"])
        if not u.path.endswith("/") and (SITE / unquote(u.path).lstrip("/")).is_dir():
            self.send_response(301)
            self.send_header("Location", u.path + "/" + (("?" + u.query) if u.query else ""))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        f = url_to_file(u.path)
        if not f:
            return self.send(404, "找不到：" + u.path)
        if f.suffix == ".html" and q.get("edit") == ["1"]:
            relp = rel(f)
            if q.get("frame") == ["1"]:
                return self.send(200, inject(f.read_text(encoding="utf-8"), relp), MIME[".html"])
            shell = (HERE / "shell.html").read_text(encoding="utf-8").replace("__START__", json.dumps(u.path))
            return self.send(200, shell, MIME[".html"])
        return self.send(200, f.read_bytes(), MIME.get(f.suffix.lower(), "application/octet-stream"))

    def do_POST(self):
        u = urlsplit(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
            if u.path == "/__save":
                res = do_save(req)
            elif u.path == "/__anchor_delete":
                res = do_delete_anchor(req)
            elif u.path == "/__probe":
                res = do_probe(req)
            else:
                return self.send(404, "not found")
        except Exception as e:  # 回報給畫面，不讓伺服器掛掉
            res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
        self.send(200, json.dumps(res, ensure_ascii=False), MIME[".json"])


def main():
    if sys.argv[1:2] == ["--migrate"]:  # 一次性：舊三段 CSS → anchors.json，並重新產生 CSS
        if ANCH.exists():
            print("anchors.json 已經存在，不重做遷移")
            return
        bdir = backup([OVR])
        save_anchors(migrate_v1())
        print("已遷移；舊 CSS 備份在", bdir)
        return
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    srv = ThreadingHTTPServer((HOST, port), H)
    print("朵拉排版編輯器：http://%s:%d/?edit=1   （Ctrl+C 結束）" % (HOST, port), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
