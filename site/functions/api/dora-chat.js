// 朵拉小客服對話端點：POST /api/dora-chat → {reply, sources}
import { handleChat } from "../_lib/chat-core.mjs";
export const onRequestPost = (context) => handleChat(context);
