import os,json,base64,urllib.request,sys
key=os.environ["GEMINI_API_KEY"]
url=f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key={key}"
line="大家好～我是朵拉！我是江江教練這裡的 AI 實習生喔。今天我發現一個超好玩的東西，好想跟你們分享！欸嘿嘿。"
styles={
"1":"更少女、更可愛：聲音甜美清亮、帶自然的氣音，音色年輕像十四歲的女孩，帶一點撒嬌的俏皮感與笑意，語調活潑有起伏。輕柔溫柔、不害羞、有自信，沒有鼻音、不尖銳。",
"2":"非常可愛的日系動漫少女聲：甜美、軟萌、帶氣音，音色明亮年輕，句尾帶可愛的上揚與微微的笑聲，像開心地跟好朋友分享秘密。溫柔親切、有自信、不害羞，沒有鼻音、不尖銳、不刺耳。",
}
for k,s in styles.items():
    prompt=f"""# AUDIO PROFILE: 朵拉
十四歲少女，日系動漫美少女，天生甜美可愛，剛出廠天真呆萌的小機器貓。

### DIRECTOR'S NOTES
Style: {s}
Pace: 慢慢地說，字字清楚，語尾輕輕上揚。
Accent: 台灣口音（台灣國語腔，不要大陸腔）。

#### TRANSCRIPT
{line}"""
    body={"contents":[{"parts":[{"text":prompt}]}],"generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Achernar"}}}}}
    r=json.load(urllib.request.urlopen(urllib.request.Request(url,json.dumps(body).encode(),{"Content-Type":"application/json"}),timeout=120))
    p=r["candidates"][0]["content"]["parts"][0]["inlineData"]
    data=base64.b64decode(p["data"])
    fn=f"/workspace/maca/dora-cute-1023-{k}.wav"
    open(fn,"wb").write(data); print(fn,p["mimeType"],len(data))
