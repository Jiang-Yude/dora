#!/usr/bin/env node
// 本機模擬用：把 OpenAI 相容的 /v1/chat/completions 請求轉給本機 codex exec（吃 ChatGPT 訂閱，不用 API key）。
// 只給第一輪測試用，只聽 127.0.0.1；線上一律走正式 Claude API key。
// 範本＝~/Developer/my-proposals/tools/xilian/codex-shim.mjs，差別：型號不寫死（CODEX_SHIM_MODEL 沒設就用 codex 自己的預設）。
// 用法：node tools/chat/codex-shim.mjs [port]（預設 18902）
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = Number(process.argv[2] || 18902);
const MODEL = process.env.CODEX_SHIM_MODEL || '';
const EFFORT = process.env.CODEX_SHIM_EFFORT || 'low';
const WORK = mkdtempSync(path.join(tmpdir(), 'dora-codex-shim-'));

function toPrompt(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const convo = messages.filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'user' ? '訪客：' : '朵拉：') + m.content).join('\n\n');
  return [
    '你現在扮演下面「系統設定」描述的網站小客服。不要讀任何檔案、不要執行任何指令、不要呼叫任何工具或外掛，只根據系統設定裡的資料回答。',
    '只輸出朵拉要對訪客說的那一則回覆本身。',
    '===== 系統設定 =====', sys,
    '===== 對話 =====', convo,
    '===== 請寫出「朵拉」的下一則回覆 =====',
  ].join('\n\n');
}

function runCodex(prompt) {
  return new Promise((resolve, reject) => {
    const out = path.join(WORK, 'out-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
    const args = ['exec', '-c', 'model_reasoning_effort=' + EFFORT, '-s', 'read-only', '--skip-git-repo-check', '-o', out];
    if (MODEL) args.splice(1, 0, '-m', MODEL);
    args.push(prompt);
    const p = spawn('codex', args, { cwd: WORK, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      try { resolve(readFileSync(out, 'utf8').trim()); }
      catch (e) { reject(new Error('codex exit ' + code + ' ' + err.slice(-300))); }
    });
  });
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end(); }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const j = JSON.parse(body || '{}');
      const t0 = Date.now();
      const text = await runCodex(toPrompt(j.messages || []));
      console.log('[shim] ok', ((Date.now() - t0) / 1000).toFixed(1) + 's', text.length + ' 字');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }));
    } catch (e) {
      console.error('[shim] fail', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'codex shim failed' } }));
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log('[shim] http://127.0.0.1:' + PORT + '/v1  model=' + (MODEL || 'codex 預設') + ' effort=' + EFFORT));
