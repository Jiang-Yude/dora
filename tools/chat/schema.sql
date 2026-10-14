-- 朵拉小客服 D1 資料庫（dora-chat，與咪卡的 Upstash 分開；江江 2026-10-14：同樣概念、分開放）
-- 套用：wrangler d1 execute dora-chat --remote --file tools/chat/schema.sql
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t TEXT NOT NULL,          -- 台北時間 YYYY-MM-DD HH:MM:SS
  month TEXT NOT NULL,      -- YYYY-MM，後台按月查
  q TEXT NOT NULL,          -- 訪客問句（已遮 Email、電話、身分證、長串數字）
  a TEXT,                   -- 朵拉的回答（前 600 字）
  page TEXT,                -- 訪客在哪一頁問
  hits INTEGER,             -- 檢索命中幾篇（0＝站上找不到，補別名候選）
  sources TEXT,             -- 附了哪些文章卡（網址，逗號分隔）
  status TEXT,              -- ok／not_ready／error
  v TEXT                    -- 人設版本
);
CREATE INDEX IF NOT EXISTS idx_questions_month ON questions(month, id);
-- 用量限流計數（IP 只存雜湊；過期列由程式順手清）
CREATE TABLE IF NOT EXISTS ratelimit (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  exp INTEGER NOT NULL
);
