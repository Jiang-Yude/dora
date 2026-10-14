#!/usr/bin/env python3
"""把朵拉靈魂檔＋客服任務規則組成 system prompt，輸出 site/functions/_lib/persona.mjs。

人設唯一真相是 repo 根目錄的 SKILL.md／GUARDRAILS.md／VOICE_EXAMPLES.md，
本支只做組裝，不手抄人設（真相分身禁令）。靈魂檔改版後重跑本支即可。
用法：python3 tools/chat/build-persona.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "functions" / "_lib" / "persona.mjs"


def read(name):
    return (ROOT / name).read_text(encoding="utf-8").strip()


def strip_frontmatter(text):
    return re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S).strip()


skill = read("SKILL.md")
version = re.search(r"^version:\s*(\S+)", skill, flags=re.M)
version = version.group(1) if version else "unknown"

parts = [
    "以下是朵拉的靈魂檔與邊界原文。優先順序：邊界 > 人設 > 客服任務規則 > 說話範例。",
    "===== 邊界（GUARDRAILS.md）=====\n" + read("GUARDRAILS.md"),
    "===== 人設（SKILL.md）=====\n" + strip_frontmatter(skill),
    "===== 客服任務規則 =====\n" + strip_frontmatter(read("tools/chat/chat-task-rules.md")),
    "===== 說話範例（VOICE_EXAMPLES.md，抓語氣用，不是白名單）=====\n" + read("VOICE_EXAMPLES.md"),
]
prompt = "\n\n".join(parts)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    "// 自動產生，勿手改。來源：SKILL.md v" + version
    + "、GUARDRAILS.md、VOICE_EXAMPLES.md、tools/chat/chat-task-rules.md\n"
    + "// 重生：python3 tools/chat/build-persona.py\n"
    + "export const PERSONA_VERSION = " + json.dumps(version) + ";\n"
    + "export const PERSONA = " + json.dumps(prompt, ensure_ascii=False) + ";\n",
    encoding="utf-8",
)
print(f"ok persona v{version} → {OUT.relative_to(ROOT)}（{len(prompt)} 字）")
