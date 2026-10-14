// 朵拉小客服問句記錄讀取：GET /api/dora-chat-log?month=YYYY-MM&limit=N（header X-Read-Token）
import { handleLogRead } from "../_lib/chat-core.mjs";
export const onRequestGet = (context) => handleLogRead(context);
