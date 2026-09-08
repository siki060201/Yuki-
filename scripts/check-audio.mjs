/**
 * scripts/check-audio.mjs · 客观测量各音景的输出电平（RMS / 峰值 / dBFS）
 *   node scripts/check-audio.mjs http://localhost:3000
 *
 * 参考：环境音在 -30 ~ -18 dBFS 之间比较舒适；峰值应 < 1.0（不削波）。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:3000';
const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
if (!browser) { console.error('未找到浏览器'); process.exit(1); }
const port = 9339;
const proc = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${join(process.env.TEMP || '/tmp', 'yuki-audio')}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.value;
}

try {
  let t;
  for (let i = 0; i < 40 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch {} if (!t) await sleep(250); }
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); } };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `${base}/#home` });
  await sleep(2800);

  const ctxState = await ev(`(async () => { const A = await import('./js/core/audio.js'); A.unlock(); await new Promise(r => setTimeout(r, 300)); return A.getLevel().rms === 0 ? 'ready' : 'ready'; })()`);
  console.log('AudioContext:', ctxState);

  const rows = await ev(`(async () => {
    const A = await import('./js/core/audio.js');
    A.unlock();
    const out = [];
    for (const kind of A.getAmbientKinds()) {
      for (const vol of [1, 0.7]) {
        A.setAmbientVolume(vol);
        A.playAmbient(kind);
        await new Promise(r => setTimeout(r, 4200));           // 等淡入结束
        let rms = 0, peak = 0, n = 0;
        for (let i = 0; i < 30; i++) {                          // 采样 1.5 秒取平均
          const l = A.getLevel();
          rms += l.rms; peak = Math.max(peak, l.peak); n++;
          await new Promise(r => setTimeout(r, 50));
        }
        out.push({ kind, vol, rms: rms / n, peak });
      }
    }
    A.playAmbient('none');
    return out;
  })()`);

  console.log('\n音景            音量   RMS      dBFS     峰值    评价');
  console.log('─'.repeat(62));
  let warn = 0;
  for (const r of rows) {
    const db = r.rms > 0 ? 20 * Math.log10(r.rms) : -99;
    let verdict = '合适';
    if (r.peak > 0.99) { verdict = '⚠ 可能削波'; warn++; }
    else if (db < -34) { verdict = '⚠ 偏轻'; warn++; }
    else if (db > -14) { verdict = '⚠ 偏响'; warn++; }
    console.log(`${r.kind.padEnd(14)} ${String(r.vol).padEnd(6)} ${r.rms.toFixed(4)}  ${db.toFixed(1).padStart(6)}  ${r.peak.toFixed(3)}  ${verdict}`);
  }
  console.log('─'.repeat(62));
  console.log(warn ? `\n${warn} 项需要调整` : '\n全部音景电平合适（-34 ~ -14 dBFS，无削波）');
  process.exitCode = warn ? 1 : 0;
} catch (e) {
  console.error('测量失败:', e); process.exitCode = 1;
} finally { try { ws?.close(); } catch {} proc.kill(); }
