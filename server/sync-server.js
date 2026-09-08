/**
 * server/sync-server.js · 自建同步服务 (Node ≥ 18，零依赖)
 *
 * 与 cloudflare-worker.js 完全同协议：
 *  - 浏览器端先算 authKey = PBKDF2-SHA256(password, "yuki:" + username, 200000)
 *  - 服务端存 SHA-256(随机盐 + authKey)
 *  - Token 30 天过期；登录失败限流；同步数据剔除密钥
 *  - 同时提供静态文件托管（public/ 目录）与模型接口同源代理
 *
 * 启动：node server/sync-server.js      (PORT=3000 可改)
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'storage_db.json');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'public');

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const LOGIN_FAIL_LIMIT = 12;
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const LEGACY_SALT = '_lexora_salt_2026';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function readDb() {
  try { return { users: {}, tokens: {}, data: {}, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; }
  catch { return { users: {}, tokens: {}, data: {} }; }
}
function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const isValidAuthKey = (k) => /^[a-f0-9]{64}$/i.test(String(k || ''));
const isValidUsername = (u) => /^[a-z0-9_\-一-龥]{2,24}$/.test(u);

const failures = new Map();
function failCount(ip) {
  const rec = failures.get(ip);
  if (!rec || Date.now() - rec.at > LOGIN_FAIL_WINDOW_MS) return 0;
  return rec.n;
}
function recordFailure(ip) {
  failures.set(ip, { n: failCount(ip) + 1, at: Date.now() });
}

function isPrivateHost(h) {
  h = h.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h === '::1') return true;
  const m = h.match(/^(\d+)\.(\d+)\./);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > limit) { reject(new Error('请求体过大')); req.destroy(); } });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Lexora-Upstream');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const ip = req.socket.remoteAddress || 'unknown';
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const error = (msg, status = 400, extra = {}) => json(status, { error: msg, ...extra });

  // 模型接口代理
  if (pathname === '/api/models' || pathname === '/api/chat/completions') {
    const upstream = String(req.headers['x-lexora-upstream'] || '').trim();
    if (!upstream) return error('缺少上游接口地址 (X-Lexora-Upstream)');
    let target;
    try { target = new URL(upstream.replace(/\/+$/, '') + pathname.slice(4)); } catch { return error('上游接口地址无效'); }
    if (target.protocol !== 'https:') return error('上游接口必须是 https 地址');
    if (isPrivateHost(target.hostname)) return error('不允许代理到内网地址', 403);
    let body = '';
    try { body = req.method === 'POST' ? await readBody(req, 256 * 1024) : ''; } catch (e) { return error(e.message, 413); }
    const headers = {};
    for (const h of ['authorization', 'content-type', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
    const up = https.request(target, { method: req.method, headers }, (upRes) => {
      res.writeHead(upRes.statusCode || 502, { 'Content-Type': upRes.headers['content-type'] || 'application/json', 'Cache-Control': 'no-store' });
      upRes.pipe(res);
    });
    up.on('error', (e) => error(`无法连接上游模型接口：${e.message}`, 502));
    up.end(body || undefined);
    return;
  }

  if (!pathname.startsWith('/api/')) {
    // 静态文件
    let file = path.normalize(path.join(STATIC_DIR, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('public/ 目录不存在，请先运行 npm run build'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }

  const db = readDb();
  let body = {};
  if (req.method === 'POST') {
    try { const raw = await readBody(req, 2 * 1024 * 1024); body = raw ? JSON.parse(raw) : {}; }
    catch (e) { return error(e.message === '请求体过大' ? e.message : '无效的 JSON 请求体', e.message === '请求体过大' ? 413 : 400); }
  }

  const issueToken = (u) => { const t = crypto.randomBytes(24).toString('hex'); db.tokens[t] = { username: u, expiresAt: Date.now() + TOKEN_TTL_MS }; return t; };
  const storeCredential = (user, authKey) => { user.salt = crypto.randomBytes(16).toString('hex'); user.hash = sha256(user.salt + authKey); user.scheme = 'pbkdf2-client-v1'; delete user.pwdHash; return user; };

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    if (failCount(ip) >= LOGIN_FAIL_LIMIT) return error('操作过于频繁，请稍后再试', 429);
    const u = String(body.username || '').trim().toLowerCase();
    if (!isValidUsername(u)) return error('用户名需为 2~24 位字母、数字、下划线或中文');
    if (!isValidAuthKey(body.authKey)) return error('客户端凭证格式无效');
    if (db.users[u]) return error('该用户名已被注册');
    db.users[u] = storeCredential({ username: u, createdAt: new Date().toISOString() }, body.authKey);
    const token = issueToken(u);
    writeDb(db);
    return json(200, { success: true, token, username: u });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (failCount(ip) >= LOGIN_FAIL_LIMIT) return error('登录失败次数过多，请 15 分钟后再试', 429);
    const u = String(body.username || '').trim().toLowerCase();
    const user = db.users[u];
    if (!user) { recordFailure(ip); return error('用户名或密码不正确', 401); }
    let ok = false;
    if (user.scheme === 'pbkdf2-client-v1') {
      ok = isValidAuthKey(body.authKey) && safeEqual(sha256(user.salt + body.authKey), user.hash);
    } else if (user.pwdHash) {
      if (typeof body.password !== 'string') return error('账号需要升级安全方案', 409, { code: 'LEGACY_UPGRADE' });
      ok = safeEqual(sha256(body.password + LEGACY_SALT), user.pwdHash);
      if (ok && isValidAuthKey(body.authKey)) storeCredential(user, body.authKey);
    }
    if (!ok) { recordFailure(ip); return error('用户名或密码不正确', 401); }
    const token = issueToken(u);
    writeDb(db);
    return json(200, { success: true, token, username: u });
  }

  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!/^[a-f0-9]{48}$/.test(token)) return error('登录已过期，请重新登录', 401);
  const tokenRec = db.tokens[token];
  const tokenUser = typeof tokenRec === 'string' ? tokenRec : tokenRec?.username;
  if (!tokenUser || (tokenRec?.expiresAt && tokenRec.expiresAt < Date.now())) return error('登录已过期，请重新登录', 401);

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    delete db.tokens[token]; writeDb(db);
    return json(200, { success: true });
  }
  if (pathname === '/api/sync/pull' && req.method === 'GET') {
    const rec = db.data[tokenUser];
    return json(200, { success: true, data: rec?.data ?? rec ?? null, updatedAt: rec?.updatedAt || null, pulledAt: new Date().toISOString() });
  }
  if (pathname === '/api/sync/push' && req.method === 'POST') {
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    if (data.settings) delete data.settings.apiKey;
    delete data.cloudAuth;
    const now = new Date().toISOString();
    db.data[tokenUser] = { data, updatedAt: now };
    writeDb(db);
    return json(200, { success: true, syncedAt: now });
  }
  return error('接口不存在', 404);
});

server.listen(PORT, () => {
  console.log(`[Yuki Sync Server] http://localhost:${PORT}  (静态目录: ${STATIC_DIR})`);
});

export default server;
