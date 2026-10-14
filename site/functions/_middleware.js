// 朵拉小客服掛載點：網頁送出時才把 widget 那一行插進 </body> 前，站上的 HTML 原檔一個字都不改
// （江江 2026-10-14：版面已微調好，只加客服、不要覆蓋原本的版面）。
// 開關：Pages 環境變數 DORA_CHAT_WIDGET=off 就整站不出現小客服，不用改程式也不用動 HTML。
const TAG = '<script src="/dora-chat/dora-chat-loader.js" defer></script>';  // 只插 2KB 載入器，按下才載完整版

export async function onRequest(context) {
  const res = await context.next();
  // 後台頁：不插客服、不給搜尋引擎收錄
  if (new URL(context.request.url).pathname.startsWith("/dora-chat/admin")) {
    const r = new Response(res.body, res);
    r.headers.set("X-Robots-Tag", "noindex, nofollow");
    r.headers.set("Cache-Control", "no-store");
    return r;
  }
  if (context.env.DORA_CHAT_WIDGET === "off") return res;
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;
  return new HTMLRewriter()
    .on("body", { element(el) { el.append(TAG, { html: true }); } })
    .transform(res);
}
