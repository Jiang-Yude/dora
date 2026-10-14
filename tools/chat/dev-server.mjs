#!/usr/bin/env node
// 朵拉小客服本機預覽：不改任何頁面原檔，回應 HTML 時才把 widget 注入進去。
// 靜態檔讀「站點資料夾」（預設主 clone 的 site/，拿得到總控台最新的頁面與 search-index.json），
// /dora-chat/* 讀本 worktree 的新檔，/api/dora-chat 直接呼叫 functions/_lib/chat-core.mjs。
// 用法：node tools/chat/dev-server.mjs [站點資料夾] [port]
//   預設模型走本機 codex 轉接器（先另開 node tools/chat/codex-shim.mjs）。只聽 127.0.0.1。
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT_SITE = path.resolve(HERE, '../../site');
const SITE = path.resolve(process.argv[2] || path.join(os.homedir(), 'Developer/dora/site'));
const PORT = Number(process.argv[3] || 8788);
const { handleChat } = await import(pathToFileURL(path.join(WT_SITE, 'functions/_lib/chat-core.mjs')).href);

const env = {
  DORA_LLM_PROVIDER: process.env.DORA_LLM_PROVIDER || 'openai',
  DORA_LLM_BASE_URL: process.env.DORA_LLM_BASE_URL || 'http://127.0.0.1:18902/v1',
  DORA_LLM_MODEL: process.env.DORA_LLM_MODEL || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  DORA_LLM_EFFORT: process.env.DORA_LLM_EFFORT || '',
  ASSETS: { fetch: async (u) => serveFile(new URL(u).pathname) },
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const INJECT = '<script src="/dora-chat/dora-chat-loader.js" defer></script>';

async function serveFile(p) {
  let rel = decodeURIComponent(p);
  if (rel.includes('..') || rel.startsWith('/functions/')) return new Response('nope', { status: 404 });
  const roots = rel.startsWith('/dora-chat/') ? [WT_SITE] : [SITE, WT_SITE];
  for (const r of roots) {
    let f = path.join(r, rel);
    try {
      if ((await stat(f)).isDirectory()) f = path.join(f, 'index.html');
      let buf = await readFile(f);
      const type = TYPES[path.extname(f)] || 'application/octet-stream';
      if (type.startsWith('text/html')) {
        const html = buf.toString('utf8');
        buf = html.includes('dora-chat-widget.js') ? html : html.replace(/<\/body>/i, INJECT + '\n</body>');
      }
      return new Response(buf, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
    } catch (e) { /* 換下一個根目錄 */ }
  }
  return new Response('not found', { status: 404 });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  let out;
  if (url.pathname === '/api/dora-chat') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    try { out = await handleChat({ request, env, waitUntil: (p) => p }); }
    catch (e) { console.error('[dev] chat crash', e); out = new Response('{"error":"crash"}', { status: 500 }); }
    console.log('[dev] chat', out.status);
  } else {
    out = await serveFile(url.pathname);
  }
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => console.log(`[dev] http://127.0.0.1:${PORT}/  站點=${SITE}  provider=${env.DORA_LLM_PROVIDER}`));
