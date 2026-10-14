#!/usr/bin/env python3
"""排版編輯器「錨點」測試（本機用，需要 Google Chrome；只用 Python 標準函式庫）

    python3 tools/editor/test-anchors.py selftest
        複製一份 site/ 到暫存資料夾，模擬在 1136 寬存一個錨點、在 900 寬存另一個，
        用 headless Chrome 量 computed transform：1136、900 各自是存的值，1000 在兩者中間，
        1300／800 沿用最近的錨點，1920 桌機不受影響。不會動到真的 site/ 與 anchors.json。

    python3 tools/editor/test-anchors.py compare 舊.css 新.css
        同一份網站分別套兩份 edit-overrides.css，在 1920、1440、1366、1100、900、800、390 寬
        比對每一條規則元素的 computed transform（給遷移前後比對用）。
"""
import importlib.util, json, math, os, re, shutil, subprocess, sys, tempfile, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PAGES = {"home": "/", "blog": "/blog/", "daily": "/daily/"}
WIDTHS = [1920, 1440, 1366, 1100, 900, 800, 390]
SEL_RE = re.compile(r'html:has\(link\[data-ep="([^"]+)"\]\)\s+(.+?)\{transform')


def load_editor():
    spec = importlib.util.spec_from_file_location("dora_editor", HERE / "dora-editor.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


PROBE = """<script>(function(){function run(){var o={iw:innerWidth,res:{}};(window.__SELS||[]).forEach(function(s){
var e=null;try{e=document.querySelector(s)}catch(x){}o.res[s]=e?getComputedStyle(e).transform:null});
var p=document.createElement('pre');p.id='anch-out';p.textContent=JSON.stringify(o);document.body.appendChild(p)}
addEventListener('load',function(){setTimeout(run,300)})})()</script>"""


def serve(root, css_text, sels_by_ep):
    """root 底下的網站，/edit-overrides.css 換成 css_text，HTML 注入量測 script。回傳 (server, port)。"""
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            u = urlsplit(self.path)
            p = unquote(u.path)
            if p == "/__wrap":  # 用 iframe 包住指定寬度（Chrome 視窗最窄只能 500，手機寬要靠 iframe）
                q = dict(x.split("=", 1) for x in u.query.split("&") if "=" in x)
                body = ('<!doctype html><body style="margin:0"><iframe id="f" src="%s" style="width:%spx;height:900px;border:0"></iframe>'
                        '<script>var f=document.getElementById("f");(function w(){var d=null;try{d=f.contentDocument.getElementById("anch-out")}catch(e){}'
                        'if(d){var p=document.createElement("pre");p.id="anch-out";p.textContent=d.textContent;document.body.appendChild(p)}else setTimeout(w,100)})()</script>'
                        % (unquote(q.get("u", "/")), int(q.get("w", "1000")))).encode("utf-8")
                ct = "text/html; charset=utf-8"
            elif p == "/edit-overrides.css":
                body, ct = css_text.encode("utf-8"), "text/css; charset=utf-8"
            else:
                f = (Path(root) / p.lstrip("/"))
                if f.is_dir():
                    f = f / "index.html"
                if not f.is_file():
                    self.send_response(404); self.end_headers(); return
                body = f.read_bytes()
                ct = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
                      ".webp": "image/webp", ".json": "application/json", ".svg": "image/svg+xml",
                      ".png": "image/png", ".jpg": "image/jpeg"}.get(f.suffix, "application/octet-stream")
                if f.suffix == ".html":
                    t = body.decode("utf-8")
                    m = re.search(r'data-ep="([^"]+)"', t)
                    sels = sels_by_ep.get(m.group(1) if m else "", [])
                    inj = "<script>window.__SELS=%s</script>%s" % (json.dumps(sels), PROBE)
                    i = t.lower().rfind("</body>")
                    t = t[:i] + inj + t[i:] if i >= 0 else t + inj
                    body = t.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def chrome_measure(url, width, prof):
    out = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
                          "--user-data-dir=" + prof, "--window-size=2100,1000",
                          "--virtual-time-budget=5000", "--dump-dom", "%s/__wrap?u=%s&w=%d" % (url[0], url[1], width)],
                         capture_output=True, text=True, timeout=90).stdout
    m = re.search(r'<pre id="anch-out">(.*?)</pre>\s*</body>', out, re.S) or re.search(r'<pre id="anch-out">(.*?)</pre>', out, re.S)
    if not m:
        raise RuntimeError("量不到：%s @%d" % (url[1], width))
    import html
    return json.loads(html.unescape(m.group(1)))


def parse_m(t):
    """computed transform → (a,b,c,d,e,f)"""
    if not t or t == "none":
        return (1, 0, 0, 1, 0, 0)
    nums = [float(x) for x in re.findall(r"-?[\d.]+(?:e-?\d+)?", t)]
    if t.startswith("matrix3d"):
        return (nums[0], nums[1], nums[4], nums[5], nums[12], nums[13])
    return tuple(nums[:6])


def mat(x, y, r, s):
    a = math.radians(r)
    return (s * math.cos(a), s * math.sin(a), -s * math.sin(a), s * math.cos(a), x, y)


def close(m1, m2, tol_px=0.06, tol=0.0015):
    return all(abs(p - q) < tol for p, q in zip(m1[:4], m2[:4])) and all(abs(p - q) < tol_px for p, q in zip(m1[4:], m2[4:]))


def measure_all(root, css, sels_by_ep, widths, prof):
    srv, port = serve(root, css, sels_by_ep)
    try:
        res = {}
        for ep, url in PAGES.items():
            if not sels_by_ep.get(ep):
                continue
            for w in widths:
                r = chrome_measure(("http://127.0.0.1:%d" % port, url), w, prof)
                if r["iw"] != w:
                    raise RuntimeError("視窗寬度不對：要 %d 實際 %d" % (w, r["iw"]))
                for s, t in r["res"].items():
                    res[(ep, s, w)] = t
        return res
    finally:
        srv.shutdown()


def cmd_compare(a, b):
    ca, cb = Path(a).read_text(encoding="utf-8"), Path(b).read_text(encoding="utf-8")
    sels = {}
    for ep, s in SEL_RE.findall(ca) + SEL_RE.findall(cb):
        sels.setdefault(ep, [])
        if s not in sels[ep]:
            sels[ep].append(s)
    with tempfile.TemporaryDirectory() as prof:
        ra = measure_all(REPO / "site", ca, sels, WIDTHS, prof)
        rb = measure_all(REPO / "site", cb, sels, WIDTHS, prof)
    bad = 0
    for k in sorted(ra, key=lambda k: (k[0], k[1], -k[2])):
        if ra[k] is None and rb.get(k) is None:
            continue
        if not close(parse_m(ra[k]), parse_m(rb.get(k))):
            bad += 1
            print("不一致", k, ra[k], "→", rb.get(k))
    print("比對 %d 筆（%d 個元素 × %d 個寬度），不一致 %d 筆" % (len(ra), sum(len(v) for v in sels.values()), len(WIDTHS), bad))
    return 1 if bad else 0


def ref_value(anchors, w):
    """不靠 CSS、照規格直接算某寬度該顯示的值（給 selftest 對答案）。"""
    segs = [(0, 760), (761, 1366), (1367, 10 ** 9)]
    lo, hi = next(s for s in segs if s[0] <= w <= s[1])
    ws = sorted(x for x in anchors if lo <= x <= hi)
    if not ws:
        return None
    if w <= ws[0]:
        return dict(anchors[ws[0]])
    if w >= ws[-1]:
        return dict(anchors[ws[-1]])
    for w1, w2 in zip(ws, ws[1:]):
        if w1 <= w <= w2:
            t = (w - w1) / (w2 - w1)
            return {k: anchors[w1][k] + (anchors[w2][k] - anchors[w1][k]) * t for k in "xyrs"}


def cmd_selftest():
    ed = load_editor()
    tmp = Path(tempfile.mkdtemp(prefix="anchor-test-"))
    site = tmp / "site"
    shutil.copytree(REPO / "site", site)
    tools = tmp / "tools" / "editor"
    tools.mkdir(parents=True)
    # 指到暫存複本；起點＝真的錨點（有 anchors.json 用它，沒有就從真的 CSS 遷移）
    start = ed.load_anchors()
    ed.REPO, ed.SITE, ed.OVR, ed.ANCH, ed.BACKUPS = tmp, site, site / "edit-overrides.css", tools / "anchors.json", tools / "backups"
    ed.save_anchors(start)
    sel = "div.sprite.think"
    before = {w: v for w, v in start.get(("home", sel), {"anchors": {}})["anchors"].items()}
    A = {"x": 40, "y": -20, "r": 10, "s": 1.5}
    B = {"x": -30, "y": 10, "r": -10, "s": 0.8}
    r1 = ed.do_save({"file": "index.html", "width": 1136, "transforms": [dict(selector=sel, **A)]})
    r2 = ed.do_save({"file": "index.html", "width": 900, "transforms": [dict(selector=sel, **B)]})
    assert r1["ok"] and r2["ok"], (r1, r2)
    after = ed.load_anchors()[("home", sel)]["anchors"]
    assert after[1136] == A and after[900] == B, after
    for w, v in before.items():
        assert after[w] == v, "其他寬度的錨點被動到了：%d" % w
    print("錨點檔：", sorted(after))
    expect = {w: ref_value(after, w) for w in (1136, 900, 1000, 1300, 800, 1920)}
    assert expect[1136] == A and expect[900] == B
    m = expect[1000]
    for k in A:  # 1000 一定落在 900 與 1136 存的值中間
        assert min(A[k], B[k]) - 1e-9 <= m[k] <= max(A[k], B[k]) + 1e-9, (k, m)
    expect = {w: v for w, v in expect.items() if v}
    css = (site / "edit-overrides.css").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as prof:
        res = measure_all(site, css, {"home": [sel]}, sorted(expect), prof)
    bad = 0
    for w, v in sorted(expect.items()):
        got = res[("home", sel, w)]
        ok = close(parse_m(got), mat(v["x"], v["y"], v["r"], v["s"]))
        bad += not ok
        print("%s %4d 寬：預期 x=%.2f y=%.2f r=%.2f s=%.3f｜實際 %s" % ("OK " if ok else "NG ", w, v["x"], v["y"], v["r"], v["s"], got))
    shutil.rmtree(tmp, ignore_errors=True)
    print("selftest：%s" % ("全部通過" if not bad else "%d 筆失敗" % bad))
    return 1 if bad else 0


if __name__ == "__main__":
    if sys.argv[1:2] == ["selftest"]:
        sys.exit(cmd_selftest())
    if sys.argv[1:2] == ["compare"] and len(sys.argv) == 4:
        sys.exit(cmd_compare(sys.argv[2], sys.argv[3]))
    print(__doc__)
    sys.exit(2)
