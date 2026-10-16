// 朵拉小客服「我是江江」後台入口（Cloudflare Pages Functions 與本機 dev server 共用）
// 江江 2026-10-16：第四顆快捷鈕改「我是江江」。兩道驗證（江江定）：
//   第一道「登入密碼」：通過才進後台模式（只能對話）。
//   第二道「操作密碼」：任何會動東西的操作之前都要先過（目前還沒有操作功能，只先做好這道關卡與 /verify-action、/session 狀態）。
//   兩道各自一天一次：憑證有效到台北時間當天午夜，過了重新輸入；兩道各自計錯，同一 IP 連錯 5 次鎖 15 分鐘。
//
// 環境變數（只放伺服器端）：
//   DORA_ENTRY_HASH        登入密碼的 PBKDF2 雜湊「pbkdf2-sha256$次數$鹽(base64)$雜湊(base64)」（Pages secret）。沒設＝入口關閉。
//   DORA_ACTION_HASH       操作密碼的 PBKDF2 雜湊（同格式）。沒設＝操作關卡關閉（verify-action 一律不通過）。
//   DORA_ADMIN_WRITE       設 "on" 才開 Trello 寫入（江江 10/16：先只要讀得到，不用操作；預設關）
//   DORA_ADMIN_API_KEY     後台專用的 Claude API key（Pages secret，跟公開客服的 ANTHROPIC_API_KEY 分開）。沒設＝後台只回「尚未接上」。
//   DORA_ADMIN_LIMITS      用量上限 JSON（美元），預設 {"daySoft":2,"monthSoft":30,"monthHard":50,"dayHard":5}
//                          軟上限到了只通知不停；monthHard（江江定「50 鎂就自動停」）與 dayHard（防濫用保險，非江江要求，可拿掉）到了就停。
//   DORA_ADMIN_PRICES      各模型單價 JSON（美元／百萬 token），{"model":{"in":x,"out":y}}；用量＝token×單價估算
//   DORA_ALERT_TRELLO_KEY / DORA_ALERT_TRELLO_TOKEN / DORA_ALERT_TRELLO_CARD   有設才推播：在該 Trello 卡留言 @江江（Trello 會推到江江手機）
// 後台只做對話：不給 Claude 任何工具，不接 Trello、不發文、不改檔、不部署、不動帳號。
// 密碼不寫在前端、不寫在 repo；憑證是 httpOnly cookie，不進 localStorage。鎖定紀錄有 DORA_DB 用 D1，沒有就用記憶體。

import { READ_TOOLS, WRITE_TOOLS, WRITE_NAMES, describeWrite, runRead, runWrite } from "./admin-trello.mjs";

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60e3;
const GATES = { entry: { env: "DORA_ENTRY_HASH", cookie: "dora_admin" }, action: { env: "DORA_ACTION_HASH", cookie: "dora_action" } };

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function hmac(keyStr, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(keyStr), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
function same(a, b) {  // 等長逐字比，不提早結束
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

/* ── 鎖定紀錄：IP 只存雜湊 ── */
const mem = new Map();
async function ensureTable(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS admin_lock (k TEXT PRIMARY KEY, fails INTEGER NOT NULL, until INTEGER NOT NULL)").run();
}
async function getLock(env, k) {
  if (env.DORA_DB) {
    await ensureTable(env.DORA_DB);
    return (await env.DORA_DB.prepare("SELECT fails, until FROM admin_lock WHERE k = ?1").bind(k).first()) || { fails: 0, until: 0 };
  }
  return mem.get(k) || { fails: 0, until: 0 };
}
async function setLock(env, k, fails, until) {
  if (env.DORA_DB) {
    await env.DORA_DB.prepare("INSERT INTO admin_lock (k, fails, until) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET fails = ?2, until = ?3").bind(k, fails, until).run();
  } else mem.set(k, { fails, until });
}

const b64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
async function pbkdf2Ok(stored, pass) {  // stored＝pbkdf2-sha256$次數$鹽(base64)$雜湊(base64)
  const [alg, iterS, saltS, hashS] = String(stored || "").split("$");
  const iter = Number(iterS);
  if (alg !== "pbkdf2-sha256" || !(iter > 0) || !saltS || !hashS || !pass) return false;
  const want = b64(hashS);
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const got = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64(saltS), iterations: iter, hash: "SHA-256" }, key, want.length * 8));
  let d = got.length ^ want.length; for (let i = 0; i < want.length; i++) d |= got[i] ^ want[i];
  return d === 0;
}
function nowMs(env) { return Date.now() + Number(env.DORA_ADMIN_TEST_SHIFT_MS || 0); }  // 只給本機測試模擬時間用，正式不設
function nextTaipeiMidnight(now) {  // 台北 UTC+8，憑證到當天 24:00 失效
  const tp = now + 8 * 3600e3;
  return Math.floor(tp / 864e5) * 864e5 + 864e5 - 8 * 3600e3;
}
async function gateOk(env, request, gate) {
  const g = GATES[gate];
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + g.cookie + "=(\\d+)\\.([0-9a-f]{64})"));
  if (!m || !env[g.env]) return 0;
  const exp = Number(m[1]);
  if (!(exp > nowMs(env))) return 0;
  return same(m[2], await hmac(env[g.env], gate + ":" + exp)) ? exp : 0;
}
const sessionOk = (env, request) => gateOk(env, request, "entry");
function cookie(name, value, maxAgeSec, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/api/dora-admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}
async function checkPass(env, request, gate) {
  const g = GATES[gate];
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const k = await sha256("dora-admin:" + gate + ":" + ip);
  const now = nowMs(env);
  const lock = await getLock(env, k);
  if (lock.until > now) return json({ ok: false, locked: true, retryAfterSec: Math.ceil((lock.until - now) / 1000) }, 429);
  let pass = "";
  try { pass = String((await request.json()).pass || ""); } catch (e) {}
  const ok = pass.length > 0 && pass.length <= 200 && await pbkdf2Ok(env[g.env], pass);
  if (!ok) {
    const fails = (lock.until && lock.until <= now ? 0 : lock.fails) + 1;
    const until = fails >= MAX_FAILS ? now + LOCK_MS : 0;
    await setLock(env, k, fails >= MAX_FAILS ? 0 : fails, until);
    if (until) return json({ ok: false, locked: true, retryAfterSec: LOCK_MS / 1000 }, 429);
    return json({ ok: false, left: MAX_FAILS - fails }, 401);
  }
  await setLock(env, k, 0, 0);
  const exp = nextTaipeiMidnight(now);
  const sig = await hmac(env[g.env], gate + ":" + exp);
  return json({ ok: true, exp }, 200, { "set-cookie": cookie(g.cookie, exp + "." + sig, Math.ceil((exp - now) / 1000), request) });
}


/* ── 後台對話：Claude API（只對話、不給工具）── */
const DEFAULT_LIMITS = { daySoft: 2, monthSoft: 30, monthHard: 50, dayHard: 5 };
const DEFAULT_PRICES = {  // 美元／百萬 token，官方定價 https://platform.claude.com/docs/en/about-claude/pricing（2026-10-16 查）；以設定值 DORA_ADMIN_PRICES 為準
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },   // 提示 100K token 以內的價；後台對話不會超過
};
const SYSTEM = [
  "你是朵拉網站的後台 AI，正在跟江江（江昱德，江江教練）本人對話。江江是通過通行密碼進來的。",
  "這一版後台只能對話：你沒有任何工具，不能發文、不能改檔案、不能部署、不能動任何帳號、不能操作 Trello。",
  "江江要你做這類動作時，先說明「後台尚未開動作」，再看能不能幫他想清楚、整理成步驟或草擬文字，讓他自己去做。",
  "用繁體中文，口氣自然簡潔，不用破折號。不確定的事直接說不確定，不要編。",
  "畫面只顯示純文字：不要用 markdown（不要 # 標題、** 粗體、表格、程式碼框），用一句一行與空行分段，清單用「1.」「・」開頭。",
].join("\n");
function cfg(env, name, dflt) { try { return { ...dflt, ...JSON.parse(env[name] || "{}") }; } catch (e) { return dflt; } }
function pickModel(text) {
  const t = text.trim();
  if (/^(#?深思|深度思考)/.test(t) || /#深思/.test(t)) return { model: "claude-opus-5-5", why: "深思標記" };
  if (/^(#?分類|#快)/.test(t)) return { model: "claude-haiku-5-5", why: "簡單分類" };
  if (t.length > 800) return { model: "claude-opus-5-5", why: "內容很長" };
  return { model: "claude-sonnet-5-5", why: "預設" };
}
function tpTime() { const d = new Date(Date.now() + 8 * 3600e3).toISOString(); return { day: d.slice(0, 10), month: d.slice(0, 7), t: d.replace("T", " ").slice(0, 19) }; }
const memUsage = [];
const memAlerts = new Set();
async function usageSums(env) {
  const { day, month } = tpTime();
  if (env.DORA_DB) {
    await env.DORA_DB.prepare("CREATE TABLE IF NOT EXISTS admin_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL, day TEXT NOT NULL, month TEXT NOT NULL, model TEXT NOT NULL, in_tok INTEGER NOT NULL, out_tok INTEGER NOT NULL, usd REAL NOT NULL)").run();
    const r = await env.DORA_DB.prepare("SELECT COALESCE(SUM(CASE WHEN day = ?1 THEN usd END),0) AS today, COALESCE(SUM(usd),0) AS mon FROM admin_usage WHERE month = ?2").bind(day, month).first();
    const by = await env.DORA_DB.prepare("SELECT model, SUM(in_tok) AS i, SUM(out_tok) AS o, SUM(usd) AS usd, COUNT(*) AS n FROM admin_usage WHERE month = ?1 GROUP BY model").bind(month).all();
    return { today: r.today, month: r.mon, byModel: by.results || [] };
  }
  const mon = memUsage.filter((u) => u.month === month);
  const byModel = Object.values(mon.reduce((a, u) => { const m = a[u.model] || (a[u.model] = { model: u.model, i: 0, o: 0, usd: 0, n: 0 }); m.i += u.in_tok; m.o += u.out_tok; m.usd += u.usd; m.n++; return a; }, {}));
  return { today: mon.filter((u) => u.day === day).reduce((a, u) => a + u.usd, 0), month: mon.reduce((a, u) => a + u.usd, 0), byModel };
}
async function recordUsage(env, model, inTok, outTok, usd) {
  const { day, month, t } = tpTime();
  if (env.DORA_DB) await env.DORA_DB.prepare("INSERT INTO admin_usage (t, day, month, model, in_tok, out_tok, usd) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind(t, day, month, model, inTok, outTok, usd).run();
  else memUsage.push({ day, month, model, in_tok: inTok, out_tok: outTok, usd });
}
/* 每個上限每天（或每月）只通知一次；有設 Trello 就在卡上 @江江 留言（Trello 會推到手機），沒設就只記在 D1 */
async function alertOnce(env, key, text) {
  if (env.DORA_DB) {
    await env.DORA_DB.prepare("CREATE TABLE IF NOT EXISTS admin_alerts (k TEXT PRIMARY KEY, t TEXT NOT NULL, text TEXT NOT NULL)").run();
    const r = await env.DORA_DB.prepare("INSERT OR IGNORE INTO admin_alerts (k, t, text) VALUES (?1, ?2, ?3)").bind(key, tpTime().t, text).run();
    if (!r.meta || !r.meta.changes) return false;
  } else { if (memAlerts.has(key)) return false; memAlerts.add(key); }
  if (env.DORA_ALERT_TRELLO_KEY && env.DORA_ALERT_TRELLO_TOKEN && env.DORA_ALERT_TRELLO_CARD) {
    const body = new URLSearchParams({ text: "@ai_pkm " + text, key: env.DORA_ALERT_TRELLO_KEY, token: env.DORA_ALERT_TRELLO_TOKEN });
    await fetch("https://api.trello.com/1/cards/" + env.DORA_ALERT_TRELLO_CARD + "/actions/comments", { method: "POST", body }).catch(() => {});
  }
  return true;
}
function limitState(sums, L) {
  return {
    daySoft: sums.today >= L.daySoft, monthSoft: sums.month >= L.monthSoft,
    monthHard: sums.month >= L.monthHard, dayHard: sums.today >= L.dayHard,
  };
}
async function adminChat(env, text, history, actionOk) {
  const L = cfg(env, "DORA_ADMIN_LIMITS", DEFAULT_LIMITS);
  const P = cfg(env, "DORA_ADMIN_PRICES", DEFAULT_PRICES);
  const { day, month } = tpTime();
  let sums = await usageSums(env);
  const { model, why } = pickModel(text);
  const price = P[model] || { in: 15, out: 75 };
  const maxOut = model === "claude-opus-5-5" ? 4000 : model === "claude-haiku-5-5" ? 800 : 2000;
  const turns = (Array.isArray(history) ? history : []).slice(-12)
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text.slice(0, 4000) }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  turns.push({ role: "user", content: text });
  const trelloOn = !!(env.DORA_TRELLO_KEY && env.DORA_TRELLO_TOKEN && env.DORA_TRELLO_BOARD);
  const writeOn = env.DORA_ADMIN_WRITE === "on";
  if (!writeOn) actionOk = false;
  const tools = trelloOn ? [...READ_TOOLS, ...(actionOk ? WRITE_TOOLS : [])] : [];
  const system = SYSTEM + "\n" + (trelloOn
    ? (actionOk
      ? "你可以用 Trello 函式讀社群媒體發文看板，也可以提出寫入（開卡、改描述、留言、附圖網址、勾「跨家複查通過」）。寫入不會立刻執行，會先給江江看「即將做什麼」，他按確認才做。「江江放行」只有江江能勾，你不能勾也不能請求勾。刪卡、搬卡、改成員、改看板設定、發 Threads、部署網站都沒有開。"
      : (writeOn ? "你可以用 Trello 函式讀社群媒體發文看板（唯讀）。江江還沒過操作密碼，所以你不能改看板；他要你改，請他先按上方「操作驗證」。發 Threads、部署網站都沒有開。" : "你可以用 Trello 函式讀社群媒體發文看板（唯讀）。後台目前只開讀取，寫入功能還沒開：江江要你改看板時，說明「後台尚未開動作」，可以幫他整理要改什麼。發 Threads、部署網站都沒有開。被問到有哪些文章、排程、哪些還沒放行時，先呼叫看板總覽再回答，標出欄位、時間、平台與放行狀態。"))
    : "目前沒有接任何工具。");
  let inTok = 0, outTok = 0, usd = 0, reply = "", pending = [];
  for (let round = 0; round < 4; round++) {
    // 呼叫前先占額：用字數粗估輸入、用輸出上限估最大花費，會超過硬上限就不呼叫
    const estIn = Math.ceil((system.length + JSON.stringify(turns).length) * 1.2);
    const reserve = (estIn * price.in + maxOut * price.out) / 1e6;
    if (sums.month + reserve > L.monthHard) {
      await alertOnce(env, "monthHard:" + month, `朵拉後台本月用量已達 ${L.monthHard} 美元上限，已自動停止（目前約 ${sums.month.toFixed(2)} 美元）`);
      return { ok: false, stopped: "monthHard", reply: `本月已達 ${L.monthHard} 美元上限\n後台先停下來了\n要繼續請調高設定值 DORA_ADMIN_LIMITS`, usage: { ...sums, limits: L } };
    }
    if (sums.today + reserve > L.dayHard) {
      await alertOnce(env, "dayHard:" + day, `朵拉後台今天用量已達 ${L.dayHard} 美元的安全上限，已停止（目前約 ${sums.today.toFixed(2)} 美元）`);
      return { ok: false, stopped: "dayHard", reply: `今天已達 ${L.dayHard} 美元的安全上限\n後台先停下來了\n明天會恢復 要提早恢復請調高設定值`, usage: { ...sums, limits: L } };
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.DORA_ADMIN_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model, max_tokens: maxOut,
        // Sonnet 5.5 不收 disabled（2026-10-16 實測 400），要關思考用 between_tools
        thinking: { type: model === "claude-opus-5-5" ? "adaptive" : model === "claude-sonnet-5-5" ? "between_tools" : "disabled" },
        system, messages: turns, ...(tools.length ? { tools } : {}),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reply: "後台呼叫 Claude 失敗（" + r.status + "）\n等一下再試", usage: { ...sums, limits: L } };
    const u = j.usage || {};
    const i1 = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), o1 = u.output_tokens || 0;
    const c1 = (i1 * price.in + o1 * price.out) / 1e6;
    inTok += i1; outTok += o1; usd += c1;
    await recordUsage(env, model, i1, o1, c1);
    sums = await usageSums(env);
    const content = j.content || [];
    reply += content.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (j.stop_reason === "refusal") { reply = "這題 Claude 沒辦法回答"; break; }
    const uses = content.filter((b) => b.type === "tool_use");
    if (j.stop_reason !== "tool_use" || !uses.length) break;
    const results = [];
    for (const tu of uses) {
      let out;
      try {
        if (WRITE_NAMES.has(tu.name)) {
          if (!actionOk) throw new Error("還沒過操作密碼，不能寫入");
          const p = await savePending(env, tu.name, tu.input || {});
          pending.push(p);
          out = { status: "已送給江江確認，他按確認才會執行", summary: p.summary };
        } else out = await runRead(env, tu.name, tu.input || {});
      } catch (e) { out = { error: String(e.message || e) }; }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 30000) });
    }
    turns.push({ role: "assistant", content }, { role: "user", content: results });
    if (pending.length) break;  // 有寫入等確認就先停，不再呼叫
  }
  const st = limitState(sums, L);
  if (st.daySoft) await alertOnce(env, "daySoft:" + day, `朵拉後台今天用量已達 ${L.daySoft} 美元（目前約 ${sums.today.toFixed(2)} 美元），只是通知，對話照常`);
  if (st.monthSoft) await alertOnce(env, "monthSoft:" + month, `朵拉後台本月用量已達 ${L.monthSoft} 美元（目前約 ${sums.month.toFixed(2)} 美元），只是通知，對話照常`);
  reply = reply.trim() || (pending.length ? "要做下面這件事 請你確認" : "（沒有回覆內容）");
  return { ok: true, reply, pending, meta: { model, why, inTok, outTok, usd }, usage: { ...sums, limits: L } };
}

/* ── 寫入待確認與稽核紀錄 ── */
const memPending = new Map(), memAudit = [];
async function savePending(env, tool, input) {
  const id = crypto.randomUUID();
  const summary = describeWrite(tool, input);
  const rec = { id, tool, input: JSON.stringify(input).slice(0, 20000), summary, t: Date.now() };
  if (env.DORA_DB) {
    await env.DORA_DB.prepare("CREATE TABLE IF NOT EXISTS admin_pending (id TEXT PRIMARY KEY, t INTEGER NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL, summary TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0)").run();
    await env.DORA_DB.prepare("INSERT INTO admin_pending (id, t, tool, input, summary) VALUES (?1,?2,?3,?4,?5)").bind(id, rec.t, tool, rec.input, summary).run();
  } else memPending.set(id, { ...rec, used: 0 });
  return { id, summary };
}
async function takePending(env, id) {  // 只能用一次、30 分鐘內有效
  let rec;
  if (env.DORA_DB) {
    rec = await env.DORA_DB.prepare("UPDATE admin_pending SET used = 1 WHERE id = ?1 AND used = 0 RETURNING tool, input, summary, t").bind(id).first();
  } else { rec = memPending.get(id); if (rec && !rec.used) rec.used = 1; else rec = null; }
  if (!rec || Date.now() - rec.t > 30 * 60e3) return null;
  return rec;
}
async function audit(env, action, card, by, ok, detail) {
  const t = tpTime().t;
  if (env.DORA_DB) {
    await env.DORA_DB.prepare("CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL, action TEXT NOT NULL, card TEXT, by TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT)").run();
    await env.DORA_DB.prepare("INSERT INTO admin_audit (t, action, card, by, ok, detail) VALUES (?1,?2,?3,?4,?5,?6)").bind(t, action, card || "", by, ok ? 1 : 0, String(detail || "").slice(0, 500)).run();
  } else memAudit.push({ t, action, card: card || "", by, ok: ok ? 1 : 0, detail: String(detail || "").slice(0, 500) });
}
async function recentAudit(env) {
  if (env.DORA_DB) {
    try { return (await env.DORA_DB.prepare("SELECT t, action, card, by, ok, detail FROM admin_audit ORDER BY id DESC LIMIT 20").all()).results || []; } catch (e) { return []; }
  }
  return memAudit.slice(-20).reverse();
}

export async function handleAdmin(context, action) {
  const { request, env } = context;
  if (!env.DORA_ENTRY_HASH) return json({ error: "closed" }, 503);
  if (request.method !== "POST" && action !== "session") return json({ error: "method" }, 405);

  if (action === "session") {
    const exp = await sessionOk(env, request);
    const act = exp ? await gateOk(env, request, "action") : 0;
    return json({ ok: !!exp, exp: exp || null, action: !!act, actionExp: act || null, actionGate: !!env.DORA_ACTION_HASH, writeEnabled: env.DORA_ADMIN_WRITE === "on" });
  }
  if (action === "login") return checkPass(env, request, "entry");
  if (action === "verify-action") {  // 第二道：先要有登入憑證；日後任何操作功能都要先檢查 gateOk(env, request, "action")
    if (!(await sessionOk(env, request))) return json({ ok: false, expired: true }, 401);
    if (!env.DORA_ACTION_HASH) return json({ ok: false, error: "closed" }, 503);
    return checkPass(env, request, "action");
  }
  if (action === "logout") {
    const h = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    h.append("set-cookie", cookie("dora_admin", "", 0, request));
    h.append("set-cookie", cookie("dora_action", "", 0, request));
    return new Response('{"ok":true}', { headers: h });
  }

  if (action === "usage") {
    if (!(await sessionOk(env, request))) return json({ ok: false, expired: true }, 401);
    const L = cfg(env, "DORA_ADMIN_LIMITS", DEFAULT_LIMITS);
    const sums = await usageSums(env);
    return json({ ok: true, usage: { ...sums, limits: L }, connected: !!env.DORA_ADMIN_API_KEY });
  }

  if (action === "confirm") {  // 江江按確認：要有登入憑證＋操作憑證，待確認的動作只能用一次
    if (env.DORA_ADMIN_WRITE !== "on") return json({ ok: false, reply: "後台目前只開讀取，寫入還沒開" }, 403);
    if (!(await sessionOk(env, request))) return json({ ok: false, expired: true }, 401);
    if (!(await gateOk(env, request, "action"))) return json({ ok: false, needAction: true, reply: "要先過操作密碼才能執行" }, 403);
    let id = "", cancel = false;
    try { const b = await request.json(); id = String(b.id || ""); cancel = !!b.cancel; } catch (e) {}
    const rec = await takePending(env, id);
    if (!rec) return json({ ok: false, reply: "這個動作已經處理過或過期了" }, 410);
    if (cancel) { await audit(env, rec.tool, "", "江江取消（後台）", true, rec.summary); return json({ ok: true, reply: "已取消：" + rec.summary }); }
    try {
      const out = await runWrite(env, rec.tool, JSON.parse(rec.input));
      await audit(env, rec.tool, out.card, "江江確認（後台）", true, rec.summary);
      return json({ ok: true, reply: "已完成：" + rec.summary + (out.url ? "\n" + out.url : "") });
    } catch (e) {
      await audit(env, rec.tool, "", "江江確認（後台）", false, rec.summary + "｜" + (e.message || e));
      return json({ ok: false, reply: "沒有做成：" + (e.message || e) });
    }
  }

  if (action === "audit") {
    if (!(await sessionOk(env, request))) return json({ ok: false, expired: true }, 401);
    return json({ ok: true, items: await recentAudit(env) });
  }

  if (action === "message") {
    if (!(await sessionOk(env, request))) return json({ ok: false, expired: true }, 401);
    let text = "", history = [];
    try { const b = await request.json(); text = String(b.text || "").slice(0, 8000); history = b.history || []; } catch (e) {}
    if (!text.trim()) return json({ ok: false }, 400);
    if (!env.DORA_ADMIN_API_KEY) {
      return json({ ok: true, reply: "後台還沒接上 Claude\n你的留言先看到了\n接上之後就能在這裡直接對話" });
    }
    const actionOk = !!(await gateOk(env, request, "action"));
    try { return json(await adminChat(env, text, history, actionOk)); }
    catch (e) { return json({ ok: false, reply: "後台出錯了 等一下再試" }, 500); }
  }
  return json({ error: "not found" }, 404);
}
