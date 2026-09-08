/**
 * scripts/shot-scenes.mjs · 给每个音景 × 每个主题截一张图，用来肉眼检查配色与动效
 *   node scripts/shot-scenes.mjs http://localhost:3000
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:3000';
const outDir = process.argv[3] || '_archive/screens/scenes';
mkdirSync(outDir, { recursive: true });
const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
const port = 9337;
const proc = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${join(process.env.TEMP || '/tmp', 'yuki-shots')}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errs = [];
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result?.value; };
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, `${n}.png`), Buffer.from(r.data, 'base64')); console.log('  📸', n); };

try {
  let t;
  for (let i = 0; i < 40 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch {} if (!t) await sleep(250); }
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/#home` });
  await sleep(2800);

  // 灌一点数据让首页不空
  await ev(`(async () => {
    const { storage } = await import('./js/core/storage.js');
    const srs = await import('./js/core/srs.js');
    const today = srs.todayKey();
    const cards = {};
    ['abandon','ability','absorb','abstract','academic','access','accident','accompany','account','accurate','achieve','acquire'].forEach((w,i)=>{ cards[w]={s:'review',e:2.5,i:(i%5)+1,due:i<7?today:srs.addDays(today,i%5+1),r:2,l:i%3===0?1:0,c:2,last:new Date().toISOString()}; });
    storage.saveCards(cards);
    storage.bumpLog(today, { new: 8, review: 12, again: 2, total: 22, focusSec: 3720, breakSec: 900, pomos: 3 });
    storage.saveSettings({ pomodoroMinutes: 25, breakMinutes: 5 });
    storage.saveSession({ type:'study', date: today, title:'今日复习 · 12 词', words:Object.keys(cards), source:'今日复习', accuracy:86, durationSec:420 });
  })()`);
  await send('Page.reload'); await sleep(2600);

  const kinds = ['none', 'rain', 'fire', 'waves', 'forest', 'cafe', 'night'];
  for (const theme of ['dark', 'light']) {
    await ev(`(async () => { const T = await import('./js/ui/theme.js'); T.applyTheme('${theme}'); })(); new Promise(r => setTimeout(r, 500))`);
    for (const k of kinds) {
      await ev(`(async () => { const A = await import('./js/core/audio.js'); A.setAmbientVolume(0.8); A.playAmbient('${k}'); })(); new Promise(r => setTimeout(r, 1500))`);
      await shot(`${theme}-${k}`);
    }
    // 专注模式
    await ev(`(async () => { const A = await import('./js/core/audio.js'); A.playAmbient('rain'); const P = await import('./js/features/pomodoro.js'); P.enterImmersive(); P.start(); })(); new Promise(r => setTimeout(r, 1600))`);
    await shot(`${theme}-focus`);
    await ev(`(async () => { const P = await import('./js/features/pomodoro.js'); P.pause(); P.exitImmersive(); const A = await import('./js/core/audio.js'); A.playAmbient('none'); })(); new Promise(r => setTimeout(r, 700))`);
  }
  console.log(errs.length ? `\n❌ ${errs.length} 条异常: ${errs[0]}` : '\n✅ 无异常');
} catch (e) { console.error('失败:', e); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} proc.kill(); }
