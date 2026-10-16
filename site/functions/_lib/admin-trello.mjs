// 朵拉後台的 Trello 工具（只給後台 Claude 用；用朵拉自己的 Trello 身分 dora_ai）
// 江江 2026-10-16：登入（第一道）只開唯讀；過了操作密碼（第二道）才開寫入，而且每次寫入都要江江在畫面按確認才真的執行。
// 伺服端硬擋（不靠模型自律）：
//   - 任何情況都不能勾或取消「江江放行」（那是江江專屬的人類核可）。
//   - 只開：開卡、改卡片描述、貼留言、附圖片網址、勾「跨家複查通過」。刪除、封存、搬卡、改成員、改看板設定一律沒有對應函式。
//   - 不給任意 HTTP 或任意 Trello API；Claude 只能呼叫下面定義好的函式。
// 環境變數：DORA_TRELLO_KEY、DORA_TRELLO_TOKEN（Pages secret）、DORA_TRELLO_BOARD（看板 id 或短碼）
const API = "https://api.trello.com/1/";
const REVIEW_ITEM = "跨家複查通過";
const FORBIDDEN_ITEM = /江江放行/;
const DORA_MEMBER = "6acd7107ea7dcde1cdf80e60";

function auth(env) { return "key=" + encodeURIComponent(env.DORA_TRELLO_KEY) + "&token=" + encodeURIComponent(env.DORA_TRELLO_TOKEN); }
async function tget(env, path, q = "") {
  const r = await fetch(API + path + "?" + (q ? q + "&" : "") + auth(env));
  if (!r.ok) throw new Error("Trello 讀取失敗 " + r.status);
  return r.json();
}
async function tsend(env, method, path, params) {
  const body = new URLSearchParams({ ...params, key: env.DORA_TRELLO_KEY, token: env.DORA_TRELLO_TOKEN });
  const r = await fetch(API + path, { method, body });
  if (!r.ok) throw new Error("Trello 寫入失敗 " + r.status);
  return r.json();
}
const tp = (iso) => iso ? new Date(Date.parse(iso) + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 16) : null;

/* ── 給 Claude 的工具定義 ── */
export const READ_TOOLS = [
  { name: "trello_board_overview", description: "讀社群媒體發文看板：每一欄（通常一欄一天）的卡片標題、發文時間、平台標籤、成員、勾選清單狀態。會另外列出「江江放行還沒勾」的卡與「明天要發」的卡。",
    input_schema: { type: "object", properties: { include_done: { type: "boolean", description: "要不要包含已完成的卡，預設 false" } } } },
  { name: "trello_get_card", description: "讀一張卡的完整內容（描述、勾選清單、最近留言）。card_id 可用卡片網址最後那段短碼。",
    input_schema: { type: "object", properties: { card_id: { type: "string" } }, required: ["card_id"] } },
];
export const WRITE_TOOLS = [
  { name: "trello_create_card", description: "在發文看板某一欄開一張新卡，成員掛朵拉。會自動加上勾選清單「發文關卡」（跨家複查通過、江江放行，兩項都不勾）。",
    input_schema: { type: "object", properties: { list_name: { type: "string", description: "欄位名稱，例如 10/18" }, name: { type: "string" }, desc: { type: "string" }, labels: { type: "array", items: { type: "string" }, description: "平台標籤名稱，例如 Threads、IG" }, due: { type: "string", description: "ISO 時間，台北時間請帶 +08:00" } }, required: ["list_name", "name"] } },
  { name: "trello_update_desc", description: "改一張卡的描述（整段取代）。", input_schema: { type: "object", properties: { card_id: { type: "string" }, desc: { type: "string" } }, required: ["card_id", "desc"] } },
  { name: "trello_add_comment", description: "在一張卡貼留言。", input_schema: { type: "object", properties: { card_id: { type: "string" }, text: { type: "string" } }, required: ["card_id", "text"] } },
  { name: "trello_attach_image_url", description: "把一個公開圖片網址附到卡片上。", input_schema: { type: "object", properties: { card_id: { type: "string" }, url: { type: "string" }, name: { type: "string" } }, required: ["card_id", "url"] } },
  { name: "trello_check_review", description: "把卡上的「跨家複查通過」勾起來（只能勾這一項；「江江放行」只有江江自己能勾）。", input_schema: { type: "object", properties: { card_id: { type: "string" } }, required: ["card_id"] } },
];
export const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

/* ── 寫入前給江江看的「即將做什麼」 ── */
export function describeWrite(name, input) {
  const s = (v, n = 80) => String(v || "").replace(/\s+/g, " ").slice(0, n);
  switch (name) {
    case "trello_create_card": return `在「${s(input.list_name, 20)}」欄開新卡「${s(input.name)}」` + (input.labels && input.labels.length ? `，標籤 ${input.labels.join("、")}` : "") + (input.due ? `，時間 ${s(input.due, 25)}` : "");
    case "trello_update_desc": return `把卡 ${s(input.card_id, 30)} 的描述換成：${s(input.desc, 120)}`;
    case "trello_add_comment": return `在卡 ${s(input.card_id, 30)} 留言：${s(input.text, 120)}`;
    case "trello_attach_image_url": return `把圖片 ${s(input.url, 100)} 附到卡 ${s(input.card_id, 30)}`;
    case "trello_check_review": return `把卡 ${s(input.card_id, 30)} 的「跨家複查通過」勾起來`;
    default: return "（不認得的動作）";
  }
}

async function cardOnBoard(env, cardId) {
  const c = await tget(env, "cards/" + encodeURIComponent(cardId), "fields=name,idBoard,shortLink,shortUrl");
  const b = await tget(env, "boards/" + encodeURIComponent(env.DORA_TRELLO_BOARD), "fields=id");
  if (c.idBoard !== b.id) throw new Error("這張卡不在發文看板上，不處理");
  return c;
}

/* ── 執行：讀 ── */
export async function runRead(env, name, input) {
  if (name === "trello_board_overview") {
    const lists = await tget(env, "boards/" + encodeURIComponent(env.DORA_TRELLO_BOARD) + "/lists", "fields=name&filter=open");
    const cards = await tget(env, "boards/" + encodeURIComponent(env.DORA_TRELLO_BOARD) + "/cards", "fields=name,idList,due,dueComplete,labels,idMembers,shortLink&checklists=all&members=true&member_fields=username");
    const tomorrow = new Date(Date.now() + 8 * 3600e3 + 864e5).toISOString().slice(0, 10);
    const out = { lists: [], unapproved: [], tomorrow: [] };
    for (const l of lists) {
      const cs = cards.filter((c) => c.idList === l.id && (input.include_done || !c.dueComplete)).map((c) => {
        const items = (c.checklists || []).flatMap((cl) => cl.checkItems.map((i) => ({ name: i.name, done: i.state === "complete" })));
        const card = { id: c.shortLink, name: c.name, due: tp(c.due), done: !!c.dueComplete, labels: (c.labels || []).map((x) => x.name).filter(Boolean), members: (c.members || []).map((m) => m.username), checks: items };
        const appr = items.find((i) => FORBIDDEN_ITEM.test(i.name));
        if (appr && !appr.done && !c.dueComplete) out.unapproved.push({ id: card.id, name: card.name, list: l.name, due: card.due });
        if (card.due && card.due.slice(0, 10) === tomorrow && !c.dueComplete) out.tomorrow.push({ id: card.id, name: card.name, due: card.due, approved: appr ? appr.done : null });
        return card;
      });
      out.lists.push({ name: l.name, cards: cs });
    }
    return out;
  }
  if (name === "trello_get_card") {
    const c = await cardOnBoard(env, input.card_id);
    const full = await tget(env, "cards/" + c.id, "fields=name,desc,due,dueComplete,labels,shortUrl&checklists=all&actions=commentCard&actions_limit=5");
    return { name: full.name, url: full.shortUrl, due: tp(full.due), done: full.dueComplete, labels: (full.labels || []).map((x) => x.name), desc: String(full.desc || "").slice(0, 6000),
      checks: (full.checklists || []).flatMap((cl) => cl.checkItems.map((i) => ({ name: i.name, done: i.state === "complete" }))),
      comments: (full.actions || []).map((a) => ({ t: tp(a.date), by: a.memberCreator && a.memberCreator.username, text: String(a.data && a.data.text || "").slice(0, 500) })) };
  }
  throw new Error("沒有這個讀取函式");
}

/* ── 執行：寫（只在江江按確認、而且操作密碼憑證有效時才會被呼叫）── */
export async function runWrite(env, name, input) {
  if (!WRITE_NAMES.has(name)) throw new Error("沒有這個寫入函式");
  if (name === "trello_create_card") {
    const lists = await tget(env, "boards/" + encodeURIComponent(env.DORA_TRELLO_BOARD) + "/lists", "fields=name&filter=open");
    const l = lists.find((x) => x.name.trim() === String(input.list_name || "").trim()) || lists.find((x) => x.name.startsWith(String(input.list_name || "").trim()));
    if (!l) throw new Error("找不到欄位「" + input.list_name + "」");
    const labels = await tget(env, "boards/" + encodeURIComponent(env.DORA_TRELLO_BOARD) + "/labels", "fields=name");
    const ids = (input.labels || []).map((n) => (labels.find((x) => x.name === n) || {}).id).filter(Boolean);
    const p = { idList: l.id, name: String(input.name).slice(0, 300), desc: String(input.desc || "").slice(0, 15000), idMembers: DORA_MEMBER, pos: "bottom" };
    if (ids.length) p.idLabels = ids.join(",");
    if (input.due) p.due = new Date(input.due).toISOString();
    const c = await tsend(env, "POST", "cards", p);
    const cl = await tsend(env, "POST", "checklists", { idCard: c.id, name: "發文關卡" });
    await tsend(env, "POST", "checklists/" + cl.id + "/checkItems", { name: REVIEW_ITEM, checked: "false" });
    await tsend(env, "POST", "checklists/" + cl.id + "/checkItems", { name: "江江放行", checked: "false" });  // 只建立、永遠不勾
    return { card: c.shortLink, url: c.shortUrl };
  }
  const c = await cardOnBoard(env, input.card_id);
  if (name === "trello_update_desc") { await tsend(env, "PUT", "cards/" + c.id, { desc: String(input.desc || "").slice(0, 15000) }); return { card: c.shortLink, url: c.shortUrl }; }
  if (name === "trello_add_comment") { await tsend(env, "POST", "cards/" + c.id + "/actions/comments", { text: String(input.text || "").slice(0, 5000) }); return { card: c.shortLink, url: c.shortUrl }; }
  if (name === "trello_attach_image_url") {
    if (!/^https:\/\//.test(String(input.url || ""))) throw new Error("圖片網址要是 https");
    await tsend(env, "POST", "cards/" + c.id + "/attachments", { url: input.url, name: String(input.name || "圖片").slice(0, 100) });
    return { card: c.shortLink, url: c.shortUrl };
  }
  if (name === "trello_check_review") {
    const cls = await tget(env, "cards/" + c.id + "/checklists");
    const item = cls.flatMap((cl) => cl.checkItems).find((i) => i.name.startsWith(REVIEW_ITEM));
    if (!item) throw new Error("這張卡沒有「跨家複查通過」");
    if (FORBIDDEN_ITEM.test(item.name)) throw new Error("「江江放行」只有江江能勾");  // 雙重保險
    await tsend(env, "PUT", "cards/" + c.id + "/checkItem/" + item.id, { state: "complete" });
    return { card: c.shortLink, url: c.shortUrl };
  }
  throw new Error("沒有這個寫入函式");
}
