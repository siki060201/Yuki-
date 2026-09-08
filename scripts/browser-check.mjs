/**
 * scripts/browser-check.mjs · 用本机 Edge/Chrome 无头模式打开站点，逐页截图并收集控制台错误
 *   node scripts/browser-check.mjs http://localhost:3210 [outDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:3210';
const outDir = process.argv[3] || '_archive/screens';
mkdirSync(outDir, { recursive: true });

const candidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const browser = candidates.find(p => existsSync(p));
if (!browser) { console.error('未找到 Edge/Chrome'); process.exit(1); }

const port = 9333;
const proc = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(process.env.TEMP || '/tmp', 'yuki-headless')}`, '--window-size=1440,960', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('无法连接浏览器调试端口');
}

let id = 0;
const pending = new Map();
const logs = [];
let ws;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log('  📸', name);
}

try {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg.result || msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      logs.push(`[${msg.params.type}] ${text}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') logs.push(`[log-error] ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: `${base}/#home` });
  await sleep(2500);
  // 灌入一些学习数据，让页面有内容
  await evaluate(`(async () => {
    const { storage } = await import('./js/core/storage.js');
    const srs = await import('./js/core/srs.js');
    const today = srs.todayKey();
    const cards = {};
    const words = ['abandon','ability','absent','absorb','abstract','academic','accelerate','access','accident','accompany','accomplish','account','accumulate','accurate','accuse','achieve','acid','acquire','adapt','adequate','adjust','administration','admire','admit','adopt','advance','advantage','adventure','advertise','advocate'];
    words.forEach((w, i) => { cards[w] = { s: 'review', e: 2.5, i: (i % 5) + 1, due: i < 12 ? today : srs.addDays(today, (i % 6) + 1), r: 2 + (i % 4), l: i % 4 === 0 ? 1 + (i % 3) : 0, c: 2, last: new Date(Date.now() - i * 86400000).toISOString() }; });
    storage.saveCards(cards);
    for (let d = 0; d < 40; d++) { if (d % 3 === 1) continue; const k = srs.addDays(today, -d); storage.bumpLog(k, { new: 5 + (d % 7), review: 8 + (d % 11), again: d % 4, total: 13 + (d % 18) }); }
    storage.saveSession({ type: 'study', date: today, title: '今日复习 · 12 词', words: words.slice(0, 12), source: '今日复习', accuracy: 83, durationSec: 312 });
    storage.saveSession({ type: 'study', date: srs.addDays(today, -1), title: '学新词 · 10 词', words: words.slice(12, 22), source: '学新词', accuracy: 90, durationSec: 280 });
    return Object.keys(storage.getCards()).length;
  })()`);
  await send('Page.reload'); await sleep(2800);
  await shot('01-home-dark');

  for (const [view, name] of [['learn', '02-learn-dark'], ['reading', '03-reading-dark'], ['chat', '04-chat-dark'], ['stats', '05-stats-dark'], ['settings', '06-settings-dark']]) {
    await evaluate(`location.hash = '#${view}'; new Promise(r => setTimeout(r, 900))`);
    await shot(name);
  }

  // 背词交互：翻牌 → 评分
  await evaluate(`location.hash = '#learn'; new Promise(r => setTimeout(r, 600))`);
  const learnState = await evaluate(`(() => { const el = document.querySelector('#spell-input'); if (el) { el.value = 'abandon'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } return new Promise(r => setTimeout(() => r({ revealed: !document.querySelector('#flash-back').hidden, word: document.querySelector('#ans-word')?.textContent, pv: document.querySelector('#pv-good')?.textContent }), 900)); })()`);
  console.log('  背词翻牌状态:', JSON.stringify(learnState));
  await shot('07-learn-revealed');
  await evaluate(`document.querySelector('.rate-good').click(); new Promise(r => setTimeout(r, 500))`);
  const afterRate = await evaluate(`({ counter: document.querySelector('#flash-counter').textContent, progress: document.querySelector('#queue-progress').textContent })`);
  console.log('  评分后:', JSON.stringify(afterRate));

  // 词卡抽屉
  await evaluate(`import('./js/ui/overlay.js').then(m => m.openWordSheet('resilient', 'The team proved to be resilient when their initial experiment failed.')); new Promise(r => setTimeout(r, 600))`);
  await shot('08-word-sheet');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); new Promise(r => setTimeout(r, 400))`);

  // 浅色主题
  await evaluate(`import('./js/ui/theme.js').then(m => m.applyTheme('light')); location.hash = '#home'; new Promise(r => setTimeout(r, 900))`);
  await shot('09-home-light');
  await evaluate(`location.hash = '#learn'; new Promise(r => setTimeout(r, 700))`);
  await shot('10-learn-light');
  await evaluate(`location.hash = '#stats'; new Promise(r => setTimeout(r, 700))`);
  await shot('11-stats-light');
  await evaluate(`import('./js/ui/theme.js').then(m => m.applyTheme('dark'))`);

  // 移动端
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate(`location.hash = '#home'; new Promise(r => setTimeout(r, 800))`);
  await shot('12-mobile-home');
  await evaluate(`location.hash = '#learn'; new Promise(r => setTimeout(r, 800))`);
  await shot('13-mobile-learn');
  await evaluate(`location.hash = '#chat'; new Promise(r => setTimeout(r, 800))`);
  await shot('14-mobile-chat');

  const errors = logs.filter(l => /^\[(error|exception|log-error)\]/.test(l));
  console.log('\n控制台记录:'); logs.forEach(l => console.log('   ', l.slice(0, 300)));
  console.log(errors.length ? `\n❌ ${errors.length} 条错误` : '\n✅ 无控制台错误');
  process.exitCode = errors.length ? 1 : 0;
} catch (e) {
  console.error('browser-check 失败:', e);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  proc.kill();
}
