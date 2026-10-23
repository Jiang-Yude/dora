# 朵拉的聲音設定

江江 2026-10-23 定案。

- 模型：gemini-3.8-flash-tts（Google Gemini API，金鑰 GEMINI_API_KEY）
- 聲音：voiceName `Achernar`
- 樣本：`dora-voice.wav`（約 12 秒，只唸台詞）

## 語氣指示（一定要用分段格式，不然模型會把指示唸出來）

```
# AUDIO PROFILE: 朵拉
十四、五歲少女，日系動漫美少女，天生甜美可愛，剛出廠天真呆萌的小機器貓。

### DIRECTOR'S NOTES
Style: 輕柔、溫柔、帶自然的氣音，聲音甜美清亮，沒有鼻音、不尖銳。不害羞、不畏縮，語氣溫暖而有自信，從容、穩定、親切，像溫柔地跟朋友分享好消息。
Pace: 慢慢地說，字字清楚，語尾輕輕上揚。
Accent: 台灣口音（台灣國語腔，不要大陸腔）。

#### TRANSCRIPT
（要唸的台詞）
```

## 注意
- systemInstruction 會回 400，指示要放在內容裡。
- 產生後用 gemini-3.8-flash 轉錄檢查，確認只唸了台詞。
- 範例程式：`dora_tts.py`（樣式欄位換成上面的 Style 即可）。
