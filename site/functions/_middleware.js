// 朵拉小客服掛載點：網頁送出時才把 widget 那一行插進 </body> 前，站上的 HTML 原檔一個字都不改
// （江江 2026-10-14：版面已微調好，只加客服、不要覆蓋原本的版面）。
// 開關：Pages 環境變數 DORA_CHAT_WIDGET=off 就整站不出現小客服，不用改程式也不用動 HTML。
const TAG = '<script src="/dora-chat/dora-chat-widget.js" defer></script>';

export async function onRequest(context) {
  const res = await context.next();
  if (context.env.DORA_CHAT_WIDGET === "off") return res;
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;
  return new HTMLRewriter()
    .on("body", { element(el) { el.append(TAG, { html: true }); } })
    .transform(res);
}
