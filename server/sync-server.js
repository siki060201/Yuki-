/**
 * server/sync-server.js
 * 
 * 轻量 Node.js 原生同步服务器 (适用于自建 VPS、家用 NAS、Docker)
 * 采用原生 ESM 编写，无需安装第三方依赖，开箱即用！
 * 
 * 启动方法：
 *   node server/sync-server.js
 * 默认端口: 3000 (可通过 PORT=8080 node server/sync-server.js 指定)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const DB_FILE = path.join(__dirname, 'storage_db.json');

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) return { users: {}, tokens: {}, data: {} };
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: {}, tokens: {}, data: {} };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write DB:', e);
  }
}

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + '_lexora_salt_2026').digest('hex');
}

const server = http.createServer((req, res) => {
  // 统一 CORS 允许跨域调用
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  function json(status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  function parseBody(callback) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        callback(null, parsed);
      } catch (e) {
        callback(e);
      }
    });
  }

  function getToken() {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return null;
  }

  const db = readDb();

  // 1. 注册: POST /api/auth/register
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    return parseBody((err, body) => {
      if (err) return json(400, { error: '无效的 JSON 请求体' });
      const { username, password } = body;
      if (!username || !password) return json(400, { error: '用户名与密码不能为空' });
      const u = username.trim().toLowerCase();
      if (db.users[u]) return json(400, { error: '该用户名已被注册' });

      const pwdHash = hashPassword(password);
      const token = crypto.randomUUID();
      db.users[u] = { username: u, pwdHash, createdAt: new Date().toISOString() };
      db.tokens[token] = u;
      writeDb(db);

      return json(200, { success: true, token, username: u });
    });
  }

  // 2. 登录: POST /api/auth/login
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    return parseBody((err, body) => {
      if (err) return json(400, { error: '无效的 JSON 请求体' });
      const { username, password } = body;
      if (!username || !password) return json(400, { error: '用户名与密码不能为空' });
      const u = username.trim().toLowerCase();

      const user = db.users[u];
      if (!user || user.pwdHash !== hashPassword(password)) {
        return json(401, { error: '用户名或密码不正确' });
      }

      const token = crypto.randomUUID();
      db.tokens[token] = u;
      writeDb(db);

      return json(200, { success: true, token, username: u });
    });
  }

  // 鉴权校验
  const token = getToken();
  if (!token || !db.tokens[token]) {
    return json(401, { error: '登录凭证无效或已过期，请重新登录' });
  }
  const currentUser = db.tokens[token];

  // 3. 拉取数据: GET /api/sync/pull
  if (pathname === '/api/sync/pull' && req.method === 'GET') {
    const userData = db.data[currentUser] || { sessions: [], dailyGoal: 20 };
    return json(200, {
      success: true,
      data: userData,
      pulledAt: new Date().toISOString()
    });
  }

  // 4. 推送数据: POST /api/sync/push
  if (pathname === '/api/sync/push' && req.method === 'POST') {
    return parseBody((err, body) => {
      if (err) return json(400, { error: '无效的 JSON 请求体' });
      db.data[currentUser] = body.data || {};
      writeDb(db);
      return json(200, {
        success: true,
        syncedAt: new Date().toISOString()
      });
    });
  }

  json(404, { error: 'Endpoint Not Found' });
});

server.listen(PORT, () => {
  console.log(`[Lexora Sync Server] Running at http://localhost:${PORT}`);
});

export default server;
