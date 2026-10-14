#!/bin/bash
# 朵拉排版編輯器：雙擊就開（啟動本機伺服器 127.0.0.1:8792，再用預設瀏覽器打開編輯頁）
# sync-guard:allow（遠端領先只動 media/）
cd "$(dirname "$0")" || exit 1
URL="http://127.0.0.1:8792/?edit=1"
if lsof -iTCP:8792 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "編輯器已經在跑了，直接打開：$URL"
  open "$URL"
  exit 0
fi
(sleep 1; open "$URL") &
echo "關掉這個視窗（或按 Ctrl+C）就會停止編輯器。"
exec /usr/bin/env python3 dora-editor.py
