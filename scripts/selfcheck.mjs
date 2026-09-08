/**
 * scripts/selfcheck.mjs · 无浏览器自检
 *   node scripts/selfcheck.mjs
 * 覆盖：SRS 调度、存储迁移与合并、学习引擎、Worker 鉴权/同步/代理
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ---- 浏览器环境最小模拟 ----
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
globalThis.window = { location: { origin: 'https://example.test', protocol: 'https:', hostname: 'example.test', port: '' }, addEventListener() {}, dispatchEvent() {}, speechSynthesis: undefined };
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: { classList: { toggle() {} }, dataset: {} } };
globalThis.CustomEvent = class { constructor(t, d) { this.type = t; this.detail = d?.detail; } };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('  ✓', name); }).catch(e => { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; });
}

const srs = await import('../js/core/srs.js');
const { storage } = await import('../js/core/storage.js');
const Lexicon = await import('../js/core/lexicon.js');
const Engine = await import('../js/features/study-engine.js');
const { deriveAuthKey } = await import('../js/core/crypto.js');
const worker = (await import('../server/cloudflare-worker.js')).default;

console.log('\n[SRS]');
await test('新词 good → 1 天后复习，状态 review', () => {
  const c = srs.schedule(srs.newCard('2026-09-08'), 'good', '2026-09-08');
  assert.equal(c.s, 'review'); assert.equal(c.i, 1); assert.equal(c.due, '2026-09-09');
});
await test('新词 easy → 4 天', () => {
  const c = srs.schedule(srs.newCard('2026-09-08'), 'easy', '2026-09-08');
  assert.equal(c.i, 4); assert.equal(c.due, '2026-09-12');
});
await test('复习卡 good 间隔按 ease 放大', () => {
  const c = srs.schedule({ s: 'review', e: 2.5, i: 4, due: '2026-09-08', r: 2, l: 0, c: 2, last: '' }, 'good', '2026-09-08');
  assert.equal(c.i, 10); assert.equal(c.due, '2026-09-18');
});
await test('again 记一次遗忘并回到今天', () => {
  const c = srs.schedule({ s: 'review', e: 2.5, i: 10, due: '2026-09-08', r: 3, l: 0, c: 3, last: '' }, 'again', '2026-09-08');
  assert.equal(c.l, 1); assert.equal(c.i, 0); assert.equal(c.s, 'learning'); assert.equal(c.due, '2026-09-08'); assert.equal(c.e, 2.3);
});
await test('间隔上限 365 天，ease 不低于 1.3', () => {
  let c = { s: 'review', e: 3.0, i: 300, due: '2026-09-08', r: 9, l: 0, c: 9, last: '' };
  c = srs.schedule(c, 'easy', '2026-09-08'); assert.equal(c.i, 365); assert.equal(c.e, 3.0);
  let d = { s: 'review', e: 1.35, i: 2, due: '2026-09-08', r: 1, l: 3, c: 0, last: '' };
  d = srs.schedule(d, 'again', '2026-09-08'); assert.equal(d.e, 1.3);
});
await test('previewIntervals 给出四个评分的预告', () => {
  const p = srs.previewIntervals({ s: 'review', e: 2.5, i: 4, due: '2026-09-08', r: 1, l: 0, c: 1, last: '' }, '2026-09-08');
  assert.equal(p.again, '稍后'); assert.equal(p.good, '10 天'); assert.ok(p.easy.includes('天') || p.easy.includes('月'));
});

console.log('\n[Storage 迁移与合并]');
await test('从 v1 迁移：历史打卡词变成复习卡，密钥保留', () => {
  store.clear();
  const today = srs.todayKey();
  const y = srs.addDays(today, -1);
  localStorage.setItem('lexora.browser-data.v1', JSON.stringify({
    settings: { apiKey: 'sk-old', model: 'm', baseUrl: 'https://a/v1' }, dailyGoal: 30,
    sessions: [{ id: 's1', type: 'study', date: y, words: ['abandon', 'ability'], genre: '背词打卡' }, { id: 'r1', type: 'reading', date: y, words: ['emerge'], title: 'T', body: 'x' }],
  }));
  const s = storage.getSettings();
  assert.equal(s.apiKey, 'sk-old'); assert.equal(s.dailyNew, 30);
  const cards = storage.getCards();
  assert.ok(cards.abandon && cards.ability && !cards.emerge);
  assert.equal(cards.abandon.s, 'review'); assert.ok(cards.abandon.due >= today);
  assert.equal(storage.getSessions().length, 2);
  assert.ok(localStorage.getItem('yuki.data.v2'));
});
await test('importMerge：空密钥不覆盖本机，卡片取较新，日志取最大', () => {
  storage.saveCard('abandon', { s: 'review', e: 2.5, i: 5, due: '2026-10-01', r: 3, l: 0, c: 3, last: '2026-09-08T10:00:00.000Z' });
  storage.bumpLog('2026-09-01', { new: 5, review: 2, again: 1, total: 7 });
  storage.importMerge({ version: 2, settings: { apiKey: '', model: 'remote-m' }, sessions: [{ id: 'x9', type: 'study', date: '2026-09-01', words: ['zoo'] }],
    cards: { abandon: { s: 'review', e: 2.6, i: 12, due: '2026-10-20', r: 4, l: 0, c: 4, last: '2026-09-08T12:00:00.000Z' }, zoo: { s: 'learning', e: 2.5, i: 0, due: '2026-09-01', r: 0, l: 0, c: 0, last: '' } },
    log: { '2026-09-01': { new: 3, review: 9, again: 0, total: 12 } } });
  const s = storage.getSettings();
  assert.equal(s.apiKey, 'sk-old'); assert.equal(s.model, 'remote-m');
  assert.equal(storage.getCard('abandon').i, 12);
  assert.ok(storage.getCard('zoo'));
  const day = storage.getLog()['2026-09-01'];
  assert.equal(day.new, 5); assert.equal(day.review, 9); assert.equal(day.total, 12);
  assert.ok(storage.getSessions().find(x => x.id === 'x9'));
});
await test('exportForSync 不含 apiKey 与 cloudAuth', () => {
  storage.saveCloudAuth({ token: 't', username: 'u', serverUrl: 'https://x' });
  const p = storage.exportForSync();
  assert.equal(p.settings.apiKey, undefined); assert.equal(p.cloudAuth, undefined); assert.ok(Array.isArray(p.sessions)); assert.ok(p.cards);
});

console.log('\n[学习引擎]');
await Lexicon.loadLexicon();
await test('词库加载 4500+ 且可查', () => { assert.ok(Lexicon.size() > 4000); assert.equal(Lexicon.lookup('Abandon').word, 'abandon'); });
await test('getNewEntries 跳过已有卡片', () => {
  const { entries } = Engine.getNewEntries(5);
  assert.equal(entries.length, 5);
  assert.ok(!entries.some(e => ['abandon', 'ability', 'zoo'].includes(e.word)));
});
await test('rateEntry：新词 again 留队，good 毕业并计入 new', () => {
  storage.resetAll();
  const today = srs.todayKey();
  const item = Lexicon.lookup('resilient');
  const entry = { item, word: 'resilient', card: null, relearn: false, reviewCounted: false };
  let r = Engine.rateEntry(entry, 'again', today);
  assert.equal(r.requeue, true); assert.equal(storage.getCard('resilient').l, 1);
  r = Engine.rateEntry(entry, 'good', today);
  assert.equal(r.requeue, false); assert.equal(storage.getCard('resilient').s, 'review');
  const log = storage.getLog()[today];
  assert.equal(log.new, 1); assert.equal(log.again, 1); assert.equal(log.total, 2);
});
await test('rateEntry：复习卡 again 进入重学，重学 good 不再改调度', () => {
  const today = srs.todayKey();
  storage.saveCard('catalyst', { s: 'review', e: 2.5, i: 6, due: today, r: 2, l: 0, c: 2, last: '' });
  const entry = { item: Lexicon.lookup('catalyst'), word: 'catalyst', card: storage.getCard('catalyst'), relearn: false, reviewCounted: false };
  let r = Engine.rateEntry(entry, 'again', today);
  assert.equal(r.requeue, true); assert.equal(entry.relearn, true);
  const after = storage.getCard('catalyst');
  r = Engine.rateEntry(entry, 'good', today);
  assert.equal(r.requeue, false); assert.deepEqual(storage.getCard('catalyst'), after);
  assert.equal(storage.getLog()[today].review, 1);
});
await test('到期 / 错词 / 连续天数 统计', () => {
  const today = srs.todayKey();
  assert.equal(Engine.countDue(today), 1);
  assert.equal(Engine.countWrong(), 2);
  assert.equal(Engine.computeStreak(today), 1);
});

console.log('\n[Worker]');
const KV = new Map();
const env = { LEXORA_KV: {
  get: async (k, t) => { const v = KV.get(k); if (v === undefined) return null; if (v.exp && v.exp < Date.now()) { KV.delete(k); return null; } return t === 'json' ? JSON.parse(v.val) : v.val; },
  put: async (k, val, opts) => { KV.set(k, { val, exp: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 }); },
  delete: async (k) => { KV.delete(k); },
} };
const call = (path, init = {}) => worker.fetch(new Request('https://suki0201.cc.cd' + path, init), env, {});
const post = (path, body, headers = {}) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

await test('注册 → 登录 → 推送(剔除密钥) → 拉取 → 退出后 token 失效', async () => {
  const authKey = await deriveAuthKey('Yuki', 'secret-pass');
  assert.match(authKey, /^[a-f0-9]{64}$/);
  let r = await post('/api/auth/register', { username: 'Yuki', authKey });
  assert.equal(r.status, 200);
  const reg = await r.json(); assert.equal(reg.username, 'yuki');
  const stored = JSON.parse(KV.get('user:yuki').val);
  assert.equal(stored.scheme, 'pbkdf2-client-v1'); assert.ok(stored.salt && stored.hash && !stored.pwdHash);

  r = await post('/api/auth/login', { username: 'yuki', authKey: 'f'.repeat(64) });
  assert.equal(r.status, 401);
  r = await post('/api/auth/login', { username: 'yuki', authKey });
  assert.equal(r.status, 200);
  const { token } = await r.json();

  r = await post('/api/sync/push', { data: { settings: { apiKey: 'LEAK', model: 'm' }, cloudAuth: { token: 'x' }, sessions: [{ id: 'a' }] } }, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  const saved = JSON.parse(KV.get('data:yuki').val);
  assert.equal(saved.data.settings.apiKey, undefined); assert.equal(saved.data.cloudAuth, undefined); assert.ok(saved.updatedAt);

  r = await call('/api/sync/pull', { headers: { Authorization: `Bearer ${token}` } });
  const pulled = await r.json(); assert.equal(pulled.data.sessions[0].id, 'a');

  r = await post('/api/auth/logout', {}, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  r = await call('/api/sync/pull', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 401);
});
await test('旧版 SHA-256 账号：首次登录要求升级，带明文后升级成功', async () => {
  const legacyHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('oldpass' + '_lexora_salt_2026')))).map(b => b.toString(16).padStart(2, '0')).join('');
  KV.set('user:tester', { val: JSON.stringify({ username: 'tester', pwdHash: legacyHash, token: 'old' }), exp: 0 });
  const authKey = await deriveAuthKey('tester', 'oldpass');
  let r = await post('/api/auth/login', { username: 'tester', authKey });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, 'LEGACY_UPGRADE');
  r = await post('/api/auth/login', { username: 'tester', authKey, password: 'wrong' });
  assert.equal(r.status, 401);
  r = await post('/api/auth/login', { username: 'tester', authKey, password: 'oldpass' });
  assert.equal(r.status, 200);
  const u = JSON.parse(KV.get('user:tester').val);
  assert.equal(u.scheme, 'pbkdf2-client-v1'); assert.ok(!u.pwdHash && !u.token);
  r = await post('/api/auth/login', { username: 'tester', authKey });
  assert.equal(r.status, 200);
});
await test('登录失败限流：12 次后 429', async () => {
  for (let i = 0; i < 12; i++) await post('/api/auth/login', { username: 'nobody', authKey: 'a'.repeat(64) }, { 'CF-Connecting-IP': '1.2.3.4' });
  const r = await post('/api/auth/login', { username: 'yuki', authKey: 'a'.repeat(64) }, { 'CF-Connecting-IP': '1.2.3.4' });
  assert.equal(r.status, 429);
});
await test('代理：转发密钥、透传 SSE、拦截 http / 内网 / 超大请求体', async () => {
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { captured = { url: String(url), opts }; return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); };
  try {
    let r = await call('/api/chat/completions', { method: 'POST', headers: { 'X-Lexora-Upstream': 'https://integrate.api.nvidia.com/v1/', Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' }, body: '{"model":"m"}' });
    assert.equal(r.status, 200);
    assert.equal(captured.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
    assert.equal(captured.opts.headers.get('Authorization'), 'Bearer sk-test');
    assert.equal(r.headers.get('Content-Type'), 'text/event-stream');
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
    for (const bad of ['http://example.com/v1', 'https://127.0.0.1/v1', 'https://10.0.0.5/v1', 'https://192.168.1.5/v1', 'https://localhost/v1', 'https://[::1]/v1']) {
      const rr = await call('/api/models', { headers: { 'X-Lexora-Upstream': bad } });
      assert.ok(rr.status === 400 || rr.status === 403, `${bad} 应被拦截，实际 ${rr.status}`);
    }
    const big = await call('/api/chat/completions', { method: 'POST', headers: { 'X-Lexora-Upstream': 'https://api.openai.com/v1', 'Content-Type': 'application/json' }, body: 'x'.repeat(300 * 1024) });
    assert.equal(big.status, 413);
    const allow = { LEXORA_KV: env.LEXORA_KV, PROXY_ALLOWED_HOSTS: 'api.openai.com' };
    const denied = await worker.fetch(new Request('https://x/api/models', { headers: { 'X-Lexora-Upstream': 'https://evil.example/v1' } }), allow, {});
    assert.equal(denied.status, 403);
  } finally { globalThis.fetch = realFetch; }
});

console.log(`\n${passed} 项通过${process.exitCode ? '，有失败项' : ''}`);
