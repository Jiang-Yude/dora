#!/usr/bin/env python3
"""朵拉貼圖庫：把知識庫貼圖資料夾的正式單張，轉成網站用的公開圖（site/img/sticker/），
並生成檢索檔 data/stickers.json 與知識庫的「貼圖檢索.md」。檢索檔是生成物，不手改；要改分組改本檔 CATALOG。"""
import json, sys
from pathlib import Path
from PIL import Image

VAULT = Path.home() / "Library/Mobile Documents/iCloud~md~obsidian/Documents/江昱德 主知識庫"
SRC = VAULT / "01 朵拉工作桌/貼圖"
REPO = Path(__file__).resolve().parents[2]
OUT_IMG = REPO / "site/img/sticker"
OUT_JSON = REPO / "data/stickers.json"
OUT_MD = SRC / "2026-10-21-2001 索引頁：朵拉貼圖檢索｜朵拉、Threads.md"
BASE_URL = "https://dora.aicat.fyi/img/sticker/"

# (資料夾, 檔名前綴篩選, slug 前綴, 組名, 什麼時候用)
CATALOG = [
    ("2026-10-14 第一批表情", ("0",), "basic", "基本表情", "任何時段；一般回應"),
    ("2026-10-14 第五批 上班組", ("A0",), "work", "上班組", "07:00 到 15:00 上班時段，活潑可愛"),
    ("2026-10-14 第六批 修正", ("C0",), "wakeup", "起床組", "04:00 到 07:00 剛起床"),
    ("2026-10-14 第六批 修正", ("D0",), "tea", "下午茶組", "15:00 到 17:00 想喝下午茶、準備下班"),
    ("2026-10-14 第六批 修正", ("A0",), "offduty", "下班組", "17:00 到 20:00 被叫加班、厭世冷吐槽"),
    ("2026-10-14 第六批 修正", ("E0",), "angry", "生氣組", "20:00 到 24:00 都幾點了"),
    ("2026-10-14 第六批 修正", ("F0",), "midnight", "半夜組", "00:00 到 04:00 睡覺、夢遊"),
    ("2026-10-14 第六批 修正", ("B0",), "disdain", "鄙視組", "忍不住吐槽時；只對江江、AI、公司、工具、品牌"),
    ("2026-10-21 第八批 不屑與不耐煩", ("A0",), "scorn", "不屑組（白底）", "吐槽江江、AI、工具時；只對江江與非人類對象"),
    ("2026-10-21 第八批 不屑與不耐煩", ("B0",), "impatient", "不耐煩組（白底）", "下班後被交辦、嘴上抱怨事情照做；只對江江"),
    ("2026-10-14 第七批 單張", ("受不了",), "ugh", "受不了", "被念、被加工作時；只對江江"),
    ("2026-10-14 第四批 色鉛筆梗圖", ("0",), "meme", "色鉛筆梗圖", "碎念、吐槽、冷眼旁觀"),
    ("2026-10-14 第三批 LOGO梗圖", ("0",), "logo", "LOGO 梗圖", "品牌、自我介紹、探頭打招呼"),
    ("2026-10-14 彩色鉛筆人物", ("0",), "pose", "動作人物", "日記與網站插圖、說明步驟"),
]

def main():
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    items = []
    for folder, prefixes, slug, group, when in CATALOG:
        d = SRC / folder
        files = sorted(p for p in d.iterdir()
                       if p.suffix.lower() == ".png" and p.name.startswith(prefixes)
                       and "透明" not in p.name and "2x3" not in p.name and "總表" not in p.name)
        for n, p in enumerate(files, 1):
            sid = f"{slug}-{n:02d}"
            name = p.stem.split(" ", 1)[-1] if " " in p.stem else p.stem
            dst = OUT_IMG / f"{sid}.jpg"
            im = Image.open(p).convert("RGB"); im.thumbnail((512, 512)); im.save(dst, quality=85, optimize=True)
            items.append({"id": sid, "group": group, "name": name, "when": when,
                          "url": BASE_URL + dst.name, "site_path": f"site/img/sticker/{dst.name}",
                          "source": f"01 朵拉工作桌/貼圖/{folder}/{p.name}"})
    OUT_JSON.parent.mkdir(exist_ok=True)
    OUT_JSON.write_text(json.dumps({"note": "由 tools/stickers/build.py 生成，不手改", "count": len(items), "stickers": items},
                                   ensure_ascii=False, indent=1), encoding="utf-8")
    lines = ["# 朵拉貼圖檢索", "", "[[朵拉]] [[AI員工]] [[Threads]]", "",
             "> 生成物：由 dora repo `tools/stickers/build.py` 產生，不手改。要新增或改分組，改 build.py 的 CATALOG 再重跑。",
             "> 用法：挑圖看「什麼時候用」，發文或回覆附 `url`。同一張圖 3 天內不重複用，過了 3 天可以再用（江江 2026-10-15、10-21；發文工具 `dora-post.py` 會擋 3 天內用過的圖）。鄙視、不屑、不耐煩只對江江與非人類對象。",
             f"> 共 {len(items)} 張。", ""]
    cur = None
    for it in items:
        if it["group"] != cur:
            cur = it["group"]; lines += ["", f"## {cur}", "", f"什麼時候用：{it['when']}", "", "| id | 表情 | 公開網址 | 原檔 |", "|---|---|---|---|"]
        src = it["source"].replace(" ", "%20")
        lines.append(f"| {it['id']} | {it['name']} | {it['url']} | [原檔](../../{src}) |")
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(len(items), "張")

if __name__ == "__main__":
    sys.exit(main())
