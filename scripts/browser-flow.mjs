/**
 * scripts/browser-flow.mjs · 端到端交互流程（需本地 sync-server 运行）
 *   node scripts/browser-flow.mjs http://localhost:3210
 * 覆盖：完成一轮背词 → 汇总页；注册/登录/同步（浏览器端 PBKDF2 → 服务端）；离线短文生成；
 *       无密钥发送对话 → 跳设置；快速查词；听写模式；首页按钮进入复习。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:3210';
const outDir = process.argv[3] || '_archive/screens';
mkdirSync(outDir, { recursive: true });
const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
if (!browser) { console.error('未找到浏览器'); process.exit(1); }
const port = 9334;
const proc = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(process.env.TEMP || '/tmp', 'yuki-headless-flow')}`, '--window-size=1440,960', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const logs = [];
const send = (method, params = {}) => new Promise((resolve) => { const m = ++id; pending.set(m, resolve); ws.send(JSON.stringify({ id: m, method, params })); });
async function evaluate(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed'); if (!r.result) throw new Error('evaluate 无结果: ' + JSON.stringify(r).slice(0, 200)); return r.result.value; }
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64')); console.log('  📸', name); }
const results = [];
function check(name, ok, extra = '') { results.push(ok); console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`); }

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg); pending.delete(msg.id); return; } if (msg.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)); if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') logs.push('[error] ' + msg.params.args.map(a => a.value ?? a.description).join(' ')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/#home` }); await sleep(2500);
  await evaluate(`localStorage.clear(); 'ok'`);
  await send('Page.reload'); await sleep(2800);

  // 1. 首页 → 学新词（每组 5 词）→ 全部评「记住」→ 汇总
  await evaluate(`(async () => { const { storage } = await import('./js/core/storage.js'); storage.saveSettings({ groupSize: 5, dailyNew: 5 }); })()`);
  await evaluate(`document.querySelector('#btn-start-new').click(); new Promise(r => setTimeout(r, 900))`);
  check('首页「学新词」进入背词页', await evaluate(`document.body.dataset.view`) === 'learn');
  const modeActive = await evaluate(`document.querySelector('.mode-tab.is-active')?.dataset.mode`);
  check('模式为学新词', modeActive === 'new', modeActive);
  for (let i = 0; i < 5; i++) {
    await evaluate(`(() => { const el = document.querySelector('#spell-input'); el.value = document.querySelector('#cue-def') ? '' : ''; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return new Promise(r => setTimeout(r, 350)); })()`);
    await evaluate(`document.querySelector('.rate-good').click(); new Promise(r => setTimeout(r, 300))`);
  }
  const summaryShown = await evaluate(`!document.querySelector('#flash-summary').hidden`);
  check('5 词全部记住后出现汇总页', summaryShown, await evaluate(`document.querySelector('#sum-count')?.textContent + ' 词 · ' + document.querySelector('#sum-rate')?.textContent`));
  await shot('20-summary');
  const stateAfter = await evaluate(`(async () => { const { storage } = await import('./js/core/storage.js'); const s = storage.getSessions(); const cards = Object.values(storage.getCards()); const today = Object.values(storage.getLog())[0]; return { sessions: s.length, cards: cards.length, review: cards.filter(c => c.s === 'review').length, log: today }; })()`);
  check('记录已保存：1 条会话、5 张复习卡、日志 new=5', stateAfter.sessions === 1 && stateAfter.cards === 5 && stateAfter.review === 5 && stateAfter.log?.new === 5, JSON.stringify(stateAfter));

  // 2. 听写模式
  await evaluate(`document.querySelector('#sum-again').click(); new Promise(r => setTimeout(r, 500))`);
  await evaluate(`document.querySelector('[data-input="dictation"]').click(); new Promise(r => setTimeout(r, 400))`);
  const dict = await evaluate(`({ playShown: !document.querySelector('#dictation-play').hidden, defHidden: document.querySelector('#cue-def').hidden, mode: document.querySelector('.segmented [data-input].is-active')?.dataset.input })`);
  check('听写模式：隐藏释义、显示再听一遍', dict.playShown && dict.defHidden && dict.mode === 'dictation', JSON.stringify(dict));
  await shot('21-dictation');
  await evaluate(`document.querySelector('[data-input="spell"]').click()`);

  // 3. 注册 → 同步 → 退出 → 登录（浏览器端 PBKDF2，真实请求本地服务）
  const user = 'flow_' + Date.now().toString(36);
  const reg = await evaluate(`(async () => { const Sync = await import('./js/core/sync.js'); try { const r = await Sync.register('${user}', 'pass-1234', '${base}'); return { ok: true, state: Sync.getState(), user: r.username, auth: Sync.getAuth() }; } catch (e) { return { ok: false, err: e.message }; } })()`);
  check('注册并上传成功', reg.ok && reg.state === 'synced' && /^[a-f0-9]{48}$/.test(reg.auth?.token || ''), JSON.stringify({ user: reg.user, state: reg.state, err: reg.err }));
  await sleep(400);
  const chip = await evaluate(`({ state: document.querySelector('#sync-chip').dataset.state, text: document.querySelector('#sync-chip-text').textContent })`);
  check('侧栏同步状态显示已同步', chip.state === 'synced', JSON.stringify(chip));
  const wiped = await evaluate(`(async () => { const Sync = await import('./js/core/sync.js'); const { storage } = await import('./js/core/storage.js'); await Sync.logout(); storage.resetAll(); return Object.keys(storage.getCards()).length; })()`);
  check('退出并清空本地', wiped === 0);
  const login = await evaluate(`(async () => { const Sync = await import('./js/core/sync.js'); const { storage } = await import('./js/core/storage.js'); try { await Sync.login('${user}', 'pass-1234', '${base}'); return { ok: true, cards: Object.keys(storage.getCards()).length, sessions: storage.getSessions().length, state: Sync.getState() }; } catch (e) { return { ok: false, err: e.message }; } })()`);
  check('重新登录后数据从云端合并回来（5 卡 1 会话）', login.ok && login.cards === 5 && login.sessions === 1, JSON.stringify(login));
  const badLogin = await evaluate(`(async () => { const Sync = await import('./js/core/sync.js'); try { await Sync.login('${user}', 'wrong-pass', '${base}'); return 'ok'; } catch (e) { return e.message; } })()`);
  check('错误密码被拒绝', /不正确|错误/.test(badLogin), badLogin);
  await evaluate(`location.hash = '#settings'; new Promise(r => setTimeout(r, 700))`);
  await shot('22-settings-logged-in');

  // 4. 阅读室离线生成
  await evaluate(`location.hash = '#reading'; new Promise(r => setTimeout(r, 700))`);
  await evaluate(`document.querySelector('#rd-generate').click(); new Promise(r => setTimeout(r, 900))`);
  const rd = await evaluate(`({ lib: document.querySelector('#rd-lib-count').textContent, source: document.querySelector('#rd-source').textContent, hl: document.querySelectorAll('.hl-word').length, note: document.querySelector('#rd-note').textContent })`);
  check('无密钥时生成离线短文并入书架', rd.lib.startsWith('1') && rd.hl >= 4, JSON.stringify(rd));
  await shot('23-reading-generated');
  const sheet = await evaluate(`(() => { document.querySelector('.hl-word').click(); return new Promise(r => setTimeout(() => r({ open: !!document.querySelector('.overlay-sheet.is-open .sheet-word'), word: document.querySelector('.sheet-word')?.textContent || '', root: document.querySelector('#overlay-root').children.length }), 700)); })()`);
  check('点击高亮词打开词卡抽屉', sheet.open, JSON.stringify(sheet));
  await shot('25-reading-sheet');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); new Promise(r => setTimeout(r, 400))`);

  // 5. 无密钥发送对话 → 跳设置
  await evaluate(`location.hash = '#chat'; new Promise(r => setTimeout(r, 600))`);
  await evaluate(`document.querySelector('#chat-input').value = 'hello'; document.querySelector('#chat-send').click(); new Promise(r => setTimeout(r, 600))`);
  check('无密钥发送 → 自动跳到设置页', await evaluate(`document.body.dataset.view`) === 'settings');

  // 6. 快速查词
  await evaluate(`location.hash = '#home'; new Promise(r => setTimeout(r, 500))`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true })); new Promise(r => setTimeout(r, 400))`);
  await evaluate(`const i = document.querySelector('#lookup-input'); i.value = 'resil'; i.dispatchEvent(new Event('input')); new Promise(r => setTimeout(r, 200))`);
  const hits = await evaluate(`document.querySelectorAll('#lookup-list [data-w]').length`);
  check('「/」呼出查词并命中结果', hits >= 1, `${hits} 条`);
  await shot('24-lookup');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);

  // 7. 首页「开始复习」在无到期词时禁用
  const disabled = await evaluate(`document.querySelector('#btn-start-review').disabled`);
  check('无到期词时「开始复习」禁用', disabled === true);

  console.log(`\n${results.filter(Boolean).length}/${results.length} 项通过`);
  if (logs.length) { console.log('控制台错误:'); logs.forEach(l => console.log('   ', l.slice(0, 300))); }
  process.exitCode = results.every(Boolean) && !logs.length ? 0 : 1;
} catch (e) {
  console.error('flow 失败:', e); process.exitCode = 1;
} finally { try { ws?.close(); } catch {} proc.kill(); }
