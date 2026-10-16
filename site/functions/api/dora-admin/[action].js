// 朵拉小客服「我是江江」後台入口：/api/dora-admin/{session|login|logout|message}
import { handleAdmin } from "../../_lib/admin-core.mjs";
export const onRequest = (context) => handleAdmin(context, String(context.params.action || ""));
