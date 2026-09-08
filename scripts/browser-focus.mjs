/**
 * scripts/browser-focus.mjs · 番茄钟专注模式 / 环境音 / 动效 的无头验证
 *   node scripts/browser-focus.mjs http://localhost:3000
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:3000';
const outDir = process.argv[3] || '_archive/screens';
mkdirSync(outDir, { recursive: true });
const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
if (!browser) { console.error('未找到浏览器'); process.exit(1); }
const port = 9336;
// 允许自动播放音频，让 AudioContext 能直接 running
const proc = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${join(process.env.TEMP || '/tmp', 'yuki-headless-focus')}`, '--window-size=1440,960', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const logs = [];
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.value;
}
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64')); console.log('  📸', name); }
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`); };

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('[error] ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/#home` }); await sleep(2600);
  await ev(`localStorage.clear(); 'ok'`);
  await send('Page.reload'); await sleep(2800);

  // 1. 番茄钟：设置 1 分钟专注 + 1 分钟短休，点开始 → 进入沉浸模式
  await ev(`(async () => { const { storage } = await import('./js/core/storage.js'); storage.saveSettings({ pomodoroMinutes: 1, breakMinutes: 1, longBreakMinutes: 2, longBreakEvery: 2 }); })()`);
  await send('Page.reload'); await sleep(2600);
  const beforeText = await ev(`document.querySelector('#pomo-time').textContent`);
  check('卡片显示自定义的 1 分钟', beforeText === '01:00', beforeText);

  await ev(`document.querySelector('#pomo-start').click(); new Promise(r => setTimeout(r, 900))`);
  const imm = await ev(`({ immersive: document.body.classList.contains('is-immersive'), stageOpen: !!document.querySelector('.focus-stage.is-open'), focusAttr: document.body.dataset.focus, time: document.querySelector('#focus-time')?.textContent, phase: document.querySelector('.focus-stage')?.dataset.phase })`);
  check('点开始后进入沉浸专注模式（界面只剩倒计时）', imm.immersive && imm.stageOpen && imm.focusAttr === 'on', JSON.stringify(imm));
  const appHidden = await ev(`getComputedStyle(document.querySelector('.app')).opacity`);
  check('主界面已淡出', Number(appHidden) < 0.05, `opacity=${appHidden}`);
  await shot('30-focus-immersive');

  // 2. 环境音：开雨声 → 检查 AudioContext、背景切换、动效 canvas
  await ev(`document.querySelector('.focus-stage [data-ambient="rain"]').click(); new Promise(r => setTimeout(r, 1200))`);
  const rain = await ev(`(async () => { const A = await import('./js/core/audio.js'); return { kind: A.getAmbient(), vol: A.getAmbientVolume(), bodyAmbient: document.body.dataset.ambient, fx: !!document.querySelector('.ambient-fx.is-on'), scene: getComputedStyle(document.querySelector('.scene')).backgroundImage.includes('rain') }; })()`);
  check('雨声开启并联动背景与动效', rain.kind === 'rain' && rain.bodyAmbient === 'rain' && rain.fx && rain.scene, JSON.stringify(rain));
  const fxPixels = await ev(`(() => { const c = document.querySelector('.ambient-fx'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, Math.min(400, c.height)).data; let n = 0; for (let i = 3; i < d.length; i += 4000) if (d[i] > 0) n++; return n; })()`);
  check('雨丝动效已绘制到 canvas', fxPixels > 0, `${fxPixels} 个非透明采样点`);
  await shot('31-focus-rain');

  // 3. 音量调节
  const vol = await ev(`(async () => { const A = await import('./js/core/audio.js'); const r = document.querySelector('.focus-stage input[type=range]'); r.value = 100; r.dispatchEvent(new Event('input')); await new Promise(x => setTimeout(x, 300)); const hi = A.getAmbientVolume(); r.value = 20; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); await new Promise(x => setTimeout(x, 300)); const { storage } = await import('./js/core/storage.js'); return { hi, lo: A.getAmbientVolume(), saved: storage.getSettings().ambientVolume }; })()`);
  check('音量可调且持久化', vol.hi === 1 && Math.abs(vol.lo - 0.2) < 0.01 && Math.abs(vol.saved - 0.2) < 0.01, JSON.stringify(vol));

  // 4. 六种音景都能启动且无异常
  const kinds = await ev(`(async () => { const A = await import('./js/core/audio.js'); const out = {}; for (const k of A.getAmbientKinds()) { A.playAmbient(k); await new Promise(r => setTimeout(r, 260)); out[k] = A.getAmbient() === k; } A.playAmbient('rain'); return out; })()`);
  check('六种音景全部可启动', Object.values(kinds).every(Boolean), JSON.stringify(kinds));

  // 5. 空格暂停 / Esc 退出全屏（计时继续）
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); new Promise(r => setTimeout(r, 400))`);
  const paused = await ev(`document.querySelector('#focus-phase-text').textContent`);
  check('空格暂停', paused.includes('暂停'), paused);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); new Promise(r => setTimeout(r, 500))`);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); new Promise(r => setTimeout(r, 600))`);
  const exited = await ev(`({ immersive: document.body.classList.contains('is-immersive'), mini: !document.querySelector('#pomo-mini').hidden, miniText: document.querySelector('#pomo-mini span').textContent })`);
  check('Esc 退出全屏后顶栏出现迷你计时', !exited.immersive && exited.mini, JSON.stringify(exited));
  await shot('32-mini-timer');

  // 6. 计时到点自动进入休息 + 统计落盘
  console.log('  ⏳ 等待 1 分钟专注计时结束…');
  await sleep(50000);
  const stats1 = await ev(`(async () => { const P = await import('./js/features/pomodoro.js'); const s = P.todayStats(); return { ...s, snap: P.snapshot() }; })()`);
  console.log('    中途统计:', JSON.stringify(stats1));
  await sleep(16000);
  const done = await ev(`(async () => { const P = await import('./js/features/pomodoro.js'); const s = P.todayStats(); const snap = P.snapshot(); return { focusSec: s.focusSec, breakSec: s.breakSec, pomos: s.pomos, phase: snap.phase, running: snap.running, round: snap.round }; })()`);
  check('专注结束后计入 1 轮并自动切到休息', done.pomos >= 1 && done.phase !== 'focus' && done.running, JSON.stringify(done));
  check('今日专注时长已记录（≈60 秒）', done.focusSec >= 50 && done.focusSec <= 75, `focusSec=${done.focusSec}`);
  await sleep(6000);
  const brk = await ev(`(async () => { const P = await import('./js/features/pomodoro.js'); return P.todayStats().breakSec; })()`);
  check('休息时长也在累计', brk >= 3, `breakSec=${brk}`);

  // 7. 首页与统计页展示
  await ev(`(async () => { const P = await import('./js/features/pomodoro.js'); P.pause(); })(); location.hash = '#home'; new Promise(r => setTimeout(r, 800))`);
  const homeStats = await ev(`document.querySelector('#pomo-today').textContent.replace(/\\s+/g, ' ')`);
  check('首页显示今日专注/休息/轮数', /专注/.test(homeStats) && /休息/.test(homeStats), homeStats.trim().slice(0, 60));
  await shot('33-home-pomodoro');
  await ev(`location.hash = '#stats'; new Promise(r => setTimeout(r, 900))`);
  const st = await ev(`({ bars: document.querySelectorAll('#st-focus-bars .bar').length, totals: document.querySelector('#st-focus-totals').textContent.replace(/\\s+/g,' ').slice(0, 50) })`);
  check('统计页有专注柱图与累计面板', st.bars === 14 && st.totals.includes('专注'), JSON.stringify(st));
  await shot('34-stats-focus');

  // 8. 浅色主题背景可见度
  await ev(`(async () => { const T = await import('./js/ui/theme.js'); T.applyTheme('light'); })(); location.hash = '#home'; new Promise(r => setTimeout(r, 900))`);
  const light = await ev(`(() => { const s = getComputedStyle(document.querySelector('.scene')); return { img: s.backgroundImage.split('/').pop().replace(/["')]/g, ''), overlay: s.backgroundImage.includes('gradient') }; })()`);
  check('浅色主题有背景照片', light.img.endsWith('.jpg') && light.overlay, JSON.stringify(light));
  await shot('35-home-light-scene');
  await ev(`(async () => { const T = await import('./js/ui/theme.js'); T.applyTheme('dark'); })()`);

  console.log(`\n${results.filter(Boolean).length}/${results.length} 项通过`);
  if (logs.length) { console.log('控制台错误:'); logs.forEach(l => console.log('   ', l.slice(0, 240))); }
  process.exitCode = results.every(Boolean) && !logs.length ? 0 : 1;
} catch (e) {
  console.error('focus-check 失败:', e); process.exitCode = 1;
} finally { try { ws?.close(); } catch {} proc.kill(); }
